import "server-only";

import { z } from "zod";

import { getSql } from "@/server/db";

import type { AudioRecord, AudioSearchHit, SearchMatch, SimilarAudioHit } from "./types";

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

/** pgvector's text format, cast with `::vector` in the query. */
function toVector(embedding: number[] | undefined): string | null {
  return embedding ? `[${embedding.join(",")}]` : null;
}

/**
 * Similarities are compared as z-scores: how many standard deviations a clip
 * stands above the catalog's mean for this query. That puts text-to-text and
 * text-to-audio similarity on one scale (their raw values differ, and both
 * shift from query to query), so the two signals can be ranked together.
 *
 * A vector list has no natural end, since every clip has some similarity to
 * every query. Below this z-score a clip is not a match. It trims the tail; it
 * cannot tell that a query has no good answer (the nearest clips to nonsense
 * still stand out a little).
 */
const MIN_Z_SCORE = 3;
/** Added when the clip's text contains every word of the query: worth one clear match. */
const EXACT_WORDS_BONUS = 3;

/**
 * Text search over two signals:
 *  - its text (transcript or captions): `vectors.text` against the text vectors,
 *    plus full-text search for exact words,
 *  - what it sounds like: `vectors.sound` against the audio vectors.
 * A clip's score is its best signal, not the sum: the two overlap (the audio
 * vector carries the spoken words too, and captions describe the sound), so
 * adding them would count the same evidence twice.
 * A signal whose vector is missing is skipped.
 *
 * It scores every clip: fine for a few thousand rows. At a much larger scale,
 * take the top candidates per signal from a vector index and estimate the
 * mean and deviation from a sample.
 */
export async function searchAudios({
  query,
  vectors,
  limit,
}: {
  query: string;
  vectors: Partial<Record<SearchMatch, number[]>>;
  limit: number;
}): Promise<AudioSearchHit[]> {
  const rows = await getSql()`
    WITH q AS (
      SELECT ${toVector(vectors.text)}::vector AS text_vector,
             ${toVector(vectors.sound)}::vector AS sound_vector,
             websearch_to_tsquery('english', ${query}) AS words,
             -- Any of the query's words, to pick the caption to show.
             replace(plainto_tsquery('english', ${query})::text, '&', '|')::tsquery AS any_word
    ),
    scored AS (
      SELECT a.id,
             (q.text_vector IS NOT NULL AND a.search_text @@ q.words) AS has_words,
             (s.text - avg(s.text) OVER ()) / nullif(stddev_samp(s.text) OVER (), 0) AS text_z,
             (s.sound - avg(s.sound) OVER ()) / nullif(stddev_samp(s.sound) OVER (), 0) AS sound_z
      FROM audios a
      CROSS JOIN q
      CROSS JOIN LATERAL (
        SELECT 1 - (a.text_embedding <=> q.text_vector) AS text,
               1 - (a.audio_embedding <=> q.sound_vector) AS sound
      ) s
    ),
    signals AS (
      SELECT id,
             CASE
               WHEN has_words THEN ${EXACT_WORDS_BONUS}::float8 + greatest(text_z, 0)
               WHEN text_z >= ${MIN_Z_SCORE}::float8 THEN text_z
               ELSE 0
             END AS text,
             CASE WHEN sound_z >= ${MIN_Z_SCORE}::float8 THEN sound_z ELSE 0 END AS sound
      FROM scored
    )
    SELECT a.id, a.source, a.file_name, a.blob_pathname, a.duration_seconds, a.sample_rate, a.channels,
           a.metadata, greatest(g.text, g.sound)::float8 AS score, g.text > 0 AS text, g.sound > 0 AS sound,
           (
             SELECT caption
             FROM jsonb_array_elements_text(a.metadata->'captions') WITH ORDINALITY AS c(caption, position)
             ORDER BY ts_rank(to_tsvector('english', caption), q.any_word) DESC, position
             LIMIT 1
           ) AS caption
    FROM signals g
    JOIN audios a USING (id)
    CROSS JOIN q
    WHERE g.text > 0 OR g.sound > 0
    ORDER BY score DESC, a.id
    LIMIT ${limit}
  `;
  return rows.map((row) => ({
    record: toRecord(row),
    score: row.score as number,
    matches: [...(row.text ? ["text" as const] : []), ...(row.sound ? ["sound" as const] : [])],
    caption: (row.caption as string | null) ?? null,
  }));
}

/**
 * Search by example: the clips whose audio vector is nearest to the one of
 * `id`, most similar first. Returns null when `id` doesn't exist, and an empty
 * list when it has no vector yet.
 */
export async function findSimilarAudios(id: string, limit: number): Promise<SimilarAudioHit[] | null> {
  const sql = getSql();
  const [found, rows] = await sql.transaction(
    [
      sql`SELECT 1 FROM audios WHERE id = ${id}`,
      sql`
        SELECT a.id, a.source, a.file_name, a.blob_pathname, a.duration_seconds, a.sample_rate, a.channels,
               a.metadata, (1 - (a.audio_embedding <=> example.audio_embedding))::float8 AS similarity
        FROM audios a
        JOIN audios example ON example.id = ${id}
        WHERE a.id <> example.id
          AND a.audio_embedding IS NOT NULL
          AND example.audio_embedding IS NOT NULL
        ORDER BY a.audio_embedding <=> example.audio_embedding, a.id
        LIMIT ${limit}
      `,
    ],
    { readOnly: true },
  );
  if (found.length === 0) return null;
  return rows.map((row) => ({ record: toRecord(row), similarity: row.similarity as number }));
}

/** The audios with these ids, in the order given. Unknown ids are left out. */
export async function getAudios(ids: string[]): Promise<AudioRecord[]> {
  if (ids.length === 0) return [];
  const rows = await getSql()`
    SELECT id, source, file_name, blob_pathname, duration_seconds, sample_rate, channels, metadata
    FROM audios
    WHERE id = ANY(${ids})
  `;
  const byId = new Map(rows.map((row) => {
    const record = toRecord(row);
    return [record.id, record];
  }));
  return ids.flatMap((id) => byId.get(id) ?? []);
}
