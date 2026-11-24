import { downloadZip } from "client-zip";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { type AudioExportManifestV1, exportFileName, MAX_EXPORT_IDS } from "@/lib/api/v1/types";
import { apiError, internalError } from "@/server/api/errors";
import { toAudioDetailV1 } from "@/server/api/v1/audios";
import { getAudios } from "@/server/audios/repository";
import { type AudioFileResponse, getAudioFile } from "@/server/audios/storage";
import type { AudioRecord } from "@/server/audios/types";

/** Blob reads started ahead of the file being zipped, so the next one is ready. */
const PREFETCH = 3;

const bodySchema = z.object({
  ids: z
    .array(z.string().min(1))
    .min(1)
    .transform((ids) => [...new Set(ids)])
    .pipe(z.array(z.string()).max(MAX_EXPORT_IDS)),
});

/**
 * POST /api/v1/audios/export  body: { "ids": ["…"] }
 *
 * Streams a ZIP with `metadata.json` (every audio's v1 detail) and each audio's
 * FLAC at `audio/<id>.flac`. Streamed, so it isn't bound by the 4.5 MB response
 * limit; entries are stored uncompressed (FLAC is already compressed).
 */
export async function POST(request: NextRequest) {
  const json: unknown = await request.json().catch(() => undefined);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return apiError(
      400,
      "invalid_request",
      `Body must be { "ids": string[] } with 1 to ${MAX_EXPORT_IDS} ids`,
      z.flattenError(parsed.error).fieldErrors,
    );
  }
  const { ids } = parsed.data;

  let records;
  try {
    records = await getAudios(ids);
  } catch (error) {
    return internalError(error);
  }
  if (records.length < ids.length) {
    const found = new Set(records.map((r) => r.id));
    const missingIds = ids.filter((id) => !found.has(id));
    return apiError(404, "not_found", "Some audios were not found", { missingIds });
  }

  const now = new Date();
  const manifest: AudioExportManifestV1 = {
    exportedAt: now.toISOString(),
    count: records.length,
    audios: records.map(toAudioDetailV1),
  };
  const zip = downloadZip(zipEntries(records, manifest, now, request.signal));

  const fileName = exportFileName(records.length, now);
  return new Response(zip.body, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${fileName}"`,
      "cache-control": "no-store",
    },
  });
}

async function* zipEntries(
  records: AudioRecord[],
  manifest: AudioExportManifestV1,
  lastModified: Date,
  signal: AbortSignal,
) {
  yield {
    name: "metadata.json",
    input: JSON.stringify(manifest, null, 2),
    lastModified,
  };

  const pending: Promise<AudioFileResponse | null>[] = [];
  const read = (record: AudioRecord) => {
    const file = getAudioFile(record.blobPathname, { signal });
    // Awaited later, in order; don't let an early failure go unhandled meanwhile.
    file.catch(() => {});
    pending.push(file);
  };

  let next = 0;
  try {
    for (const record of records) {
      while (next < records.length && pending.length <= PREFETCH) read(records[next++]);
      const file = await pending.shift()!;
      if (!file?.body) throw new Error(`Audio file for "${record.id}" not found in the Blob store`);
      yield {
        name: `audio/${record.id}.flac`,
        input: file.body,
        size: Number(file.headers.get("content-length")) || undefined,
        lastModified,
      };
    }
  } catch (error) {
    // Headers are already sent: the download fails instead of returning a JSON error.
    if (!signal.aborted) console.error("[api] Export failed mid-stream:", error);
    throw error;
  } finally {
    // Stream ended early (error or client gone): release the prefetched bodies.
    for (const file of pending) {
      void file.then((f) => f?.body?.cancel()).catch(() => {});
    }
  }
}
