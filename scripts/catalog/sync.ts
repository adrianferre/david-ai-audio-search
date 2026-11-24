// Publishes the local datasets in data/ to the Vercel project's storage:
//   1. uploads every FLAC to the private Vercel Blob store (skips blobs that
//      are already there with the same size), and
//   2. replaces the `audios` table in Neon Postgres with the local catalog.
//
// Safe to re-run. Every Vercel environment (development, preview,
// production) shares the same database and Blob store, so this updates
// production too.
//
// Usage: pnpm catalog:sync
// Credentials come from .env.local (`vercel env pull .env.local`) or from the
// environment: DATABASE_URL_UNPOOLED (or DATABASE_URL), BLOB_STORE_ID and
// VERCEL_OIDC_TOKEN (or BLOB_READ_WRITE_TOKEN).
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { neon } from "@neondatabase/serverless";
import { list, put } from "@vercel/blob";

import type { AudioRecord } from "../../src/server/audios/types";
import { loadAudioCaps } from "./audiocaps";
import { readFlacInfo } from "./flac";
import { loadLibriSpeech } from "./librispeech";
import { SCHEMA } from "./schema";
import type { LocalRecord } from "./types";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const DATA_DIR = path.join(REPO_ROOT, "data");
const ENV_FILE = path.join(REPO_ROOT, ".env.local");
const FLAC_READ_CONCURRENCY = 64;
const UPLOAD_CONCURRENCY = 16;
const UPLOAD_ATTEMPTS = 3;

type LocalAudio = AudioRecord & { filePath: string };

function fail(message: string): never {
  console.error(`\x1b[31m✗ ${message}\x1b[0m`);
  process.exit(1);
}

function loadCredentials() {
  if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

  const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!databaseUrl) {
    fail("DATABASE_URL is not set. Run `vercel env pull .env.local` first.");
  }

  const oidcToken = process.env.VERCEL_OIDC_TOKEN;
  if (oidcToken) {
    // The OIDC token from `vercel env pull` only lasts ~12 h; fail early with a hint.
    const payload = JSON.parse(
      Buffer.from(oidcToken.split(".")[1] ?? "", "base64url").toString() || "{}",
    ) as { exp?: number };
    if (payload.exp && payload.exp * 1000 < Date.now() + 5 * 60_000) {
      fail("VERCEL_OIDC_TOKEN has expired. Run `vercel env pull .env.local` to refresh it.");
    }
    if (!process.env.BLOB_STORE_ID) fail("BLOB_STORE_ID is not set.");
  } else if (!process.env.BLOB_READ_WRITE_TOKEN) {
    fail("No Blob credentials. Run `vercel env pull .env.local` first.");
  }

  return { databaseUrl };
}

async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= UPLOAD_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
}

const byIdAsc = (a: { id: string }, b: { id: string }) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Every local record whose FLAC exists and is readable. */
async function loadLocalCatalog(): Promise<LocalAudio[]> {
  const loaders = {
    librispeech: () => loadLibriSpeech(DATA_DIR),
    audiocaps: () => loadAudioCaps(DATA_DIR),
  };
  const pending: LocalRecord[] = [];
  for (const [name, load] of Object.entries(loaders)) {
    try {
      pending.push(...(await load()));
    } catch (error) {
      // Never sync a partial catalog: that would delete the missing dataset's rows.
      fail(
        `Could not load dataset "${name}" (run \`pnpm data:setup\`): ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  const resolved = await mapConcurrent(pending, FLAC_READ_CONCURRENCY, async (record) => {
    try {
      const { durationSeconds, sampleRate, channels } = await readFlacInfo(record.filePath);
      return { ...record, durationSeconds, sampleRate, channels } as LocalAudio;
    } catch {
      return null; // Listed in a manifest/transcript but missing or unreadable on disk.
    }
  });
  const items = resolved.filter((r): r is LocalAudio => r !== null).sort(byIdAsc);
  const skipped = pending.length - items.length;
  if (skipped > 0) console.warn(`  Skipping ${skipped} records whose FLAC is missing or unreadable.`);
  return items;
}

/** pathname → size of every blob already in the store. */
async function listRemoteBlobs(): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();
  let cursor: string | undefined;
  do {
    const page = await withRetry(() => list({ cursor, limit: 1000 }));
    for (const blob of page.blobs) sizes.set(blob.pathname, blob.size);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return sizes;
}

async function uploadAudio(items: LocalAudio[]): Promise<void> {
  const remote = await listRemoteBlobs();
  const sizes = await mapConcurrent(items, FLAC_READ_CONCURRENCY, async (item) =>
    (await stat(item.filePath)).size,
  );
  const toUpload = items.filter((item, i) => remote.get(item.blobPathname) !== sizes[i]);
  console.log(
    `  ${items.length - toUpload.length} already uploaded, ${toUpload.length} to upload.`,
  );

  let done = 0;
  await mapConcurrent(toUpload, UPLOAD_CONCURRENCY, async (item) => {
    const body = await readFile(item.filePath);
    await withRetry(() =>
      put(item.blobPathname, body, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "audio/flac",
      }),
    );
    done++;
    if (done % 250 === 0 || done === toUpload.length) {
      console.log(`  Uploaded ${done}/${toUpload.length}`);
    }
  });
}

function toRow(item: LocalAudio) {
  const common = {
    id: item.id,
    source: item.source,
    file_name: item.fileName,
    blob_pathname: item.blobPathname,
    duration_seconds: item.durationSeconds,
    sample_rate: item.sampleRate,
    channels: item.channels,
  };
  if (item.source === "librispeech") {
    const { utteranceId, speaker, chapter, transcript } = item;
    return { ...common, metadata: { utteranceId, speaker, chapter, transcript } };
  }
  const { clipId, youtubeId, startTime, captions, audiocapIds } = item;
  return { ...common, metadata: { clipId, youtubeId, startTime, captions, audiocapIds } };
}

async function writeCatalog(databaseUrl: string, items: LocalAudio[]): Promise<void> {
  const sql = neon(databaseUrl);
  const rows = JSON.stringify(items.map(toRow));

  await sql.transaction(SCHEMA.map((statement) => sql.query(statement)));
  // One transaction: readers never see a half-updated catalog.
  const [, deleted] = await sql.transaction([
    sql`
      INSERT INTO audios (id, source, file_name, blob_pathname, duration_seconds, sample_rate, channels, metadata)
      SELECT id, source, file_name, blob_pathname, duration_seconds, sample_rate, channels, metadata
      FROM jsonb_to_recordset(${rows}::jsonb) AS r(
        id text, source text, file_name text, blob_pathname text,
        duration_seconds double precision, sample_rate integer, channels smallint, metadata jsonb
      )
      ON CONFLICT (id) DO UPDATE SET
        source = EXCLUDED.source,
        file_name = EXCLUDED.file_name,
        blob_pathname = EXCLUDED.blob_pathname,
        duration_seconds = EXCLUDED.duration_seconds,
        sample_rate = EXCLUDED.sample_rate,
        channels = EXCLUDED.channels,
        metadata = EXCLUDED.metadata,
        updated_at = now()
      WHERE (audios.source, audios.file_name, audios.blob_pathname, audios.duration_seconds,
             audios.sample_rate, audios.channels, audios.metadata)
        IS DISTINCT FROM (EXCLUDED.source, EXCLUDED.file_name, EXCLUDED.blob_pathname,
             EXCLUDED.duration_seconds, EXCLUDED.sample_rate, EXCLUDED.channels, EXCLUDED.metadata)
    `,
    sql`
      DELETE FROM audios
      WHERE id NOT IN (SELECT r->>'id' FROM jsonb_array_elements(${rows}::jsonb) AS r)
      RETURNING id
    `,
  ]);
  console.log(`  ${items.length} rows in sync, ${deleted.length} stale rows deleted.`);
}

async function main() {
  const { databaseUrl } = loadCredentials();

  console.log("Reading local datasets…");
  const items = await loadLocalCatalog();
  if (items.length === 0) fail("No local audio found in data/. Run `pnpm data:setup` first.");
  const bySource = Object.groupBy(items, (item) => item.source);
  console.log(
    `  ${items.length} audios (${bySource.librispeech?.length ?? 0} LibriSpeech, ` +
      `${bySource.audiocaps?.length ?? 0} AudioCaps).`,
  );

  // Upload first, so every row written below points at a blob that exists.
  console.log("Uploading FLAC files to Vercel Blob (private)…");
  await uploadAudio(items);

  console.log("Writing the catalog to Postgres…");
  await writeCatalog(databaseUrl, items);

  console.log("\x1b[32m✓ Catalog synced.\x1b[0m");
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? (error.stack ?? error.message) : String(error));
});
