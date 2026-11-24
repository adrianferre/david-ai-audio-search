import "server-only";

import { z } from "zod";

import { getSql } from "@/server/db";

import type { AudioRecord } from "./types";

// Columns of the `audios` table (schema: src/server/db/schema.sql).
const speakerSchema = z.object({ id: z.string(), sex: z.string().nullable(), name: z.string().nullable() });
const chapterSchema = z.object({ id: z.string(), title: z.string().nullable(), bookTitle: z.string().nullable() });

const fileColumns = {
  id: z.string(),
  file_name: z.string(),
  blob_pathname: z.string(),
  duration_seconds: z.number(),
  sample_rate: z.number(),
  channels: z.number(),
};

const rowSchema = z.discriminatedUnion("source", [
  z.object({
    ...fileColumns,
    source: z.literal("librispeech"),
    metadata: z.object({
      utteranceId: z.string(),
      speaker: speakerSchema,
      chapter: chapterSchema,
      transcript: z.string(),
    }),
  }),
  z.object({
    ...fileColumns,
    source: z.literal("audiocaps"),
    metadata: z.object({
      clipId: z.string(),
      youtubeId: z.string(),
      startTime: z.number(),
      captions: z.array(z.string()),
      audiocapIds: z.array(z.number()),
    }),
  }),
]);

function toRecord(row: unknown): AudioRecord {
  const r = rowSchema.parse(row);
  const file = {
    id: r.id,
    fileName: r.file_name,
    blobPathname: r.blob_pathname,
    durationSeconds: r.duration_seconds,
    sampleRate: r.sample_rate,
    channels: r.channels,
  };
  return r.source === "librispeech"
    ? { ...file, source: r.source, ...r.metadata }
    : { ...file, source: r.source, ...r.metadata };
}

export type AudioPage = { items: AudioRecord[]; total: number };

/** LibriSpeech first, then AudioCaps, each sorted by id. */
export async function listAudios({ offset, limit }: { offset: number; limit: number }): Promise<AudioPage> {
  const sql = getSql();
  // One round trip and one snapshot (REPEATABLE READ; the default READ COMMITTED
  // gives each statement its own), so `total` always matches the page.
  const [rows, [{ total }]] = await sql.transaction(
    [
      sql`
        SELECT id, source, file_name, blob_pathname, duration_seconds, sample_rate, channels, metadata
        FROM audios
        ORDER BY (CASE source WHEN 'librispeech' THEN 0 ELSE 1 END), id
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`SELECT count(*)::int AS total FROM audios`,
    ],
    { readOnly: true, isolationLevel: "RepeatableRead" },
  );
  return { items: rows.map(toRecord), total: total as number };
}

export async function getAudio(id: string): Promise<AudioRecord | null> {
  const rows = await getSql()`
    SELECT id, source, file_name, blob_pathname, duration_seconds, sample_rate, channels, metadata
    FROM audios
    WHERE id = ${id}
  `;
  return rows[0] ? toRecord(rows[0]) : null;
}
