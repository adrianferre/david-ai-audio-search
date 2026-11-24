import "server-only";

import { z } from "zod";

import { getSql } from "@/server/db";

import type { AudioRecord, AudioSearchHit, AudioSource, SearchMatch, SimilarAudioHit } from "./types";

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
  waveform_peaks: z.array(z.number()).nullable(),
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
  z.object({
    ...fileColumns,
    source: z.literal("commonvoice"),
    metadata: z.object({
      clipId: z.string(),
      sentenceId: z.string(),
      speaker: z.object({
        clientId: z.string(),
        age: z.string().nullable(),
        gender: z.string().nullable(),
        accent: z.string().nullable(),
      }),
      transcript: z.string(),
      upVotes: z.number(),
      downVotes: z.number(),
      locale: z.string(),
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
    waveformPeaks: r.waveform_peaks,
  };
  switch (r.source) {
    case "librispeech":
      return { ...file, source: r.source, ...r.metadata };
    case "audiocaps":
      return { ...file, source: r.source, ...r.metadata };
    case "commonvoice":
      return { ...file, source: r.source, ...r.metadata };
  }
}

export type AudioPage = { items: AudioRecord[]; total: number };

/**
 * LibriSpeech first, then the rest (AudioCaps, then Common Voice) by id.
 * With `source`, only that dataset (and `total` counts only it).
 */
export async function listAudios({
  offset,
  limit,
  source = null,
}: {
  offset: number;
  limit: number;
  source?: AudioSource | null;
}): Promise<AudioPage> {
  const sql = getSql();
  // One round trip and one snapshot (REPEATABLE READ; the default READ COMMITTED
  // gives each statement its own), so `total` always matches the page.
  const [rows, [{ total }]] = await sql.transaction(
    [
      sql`
        SELECT id, source, file_name, blob_pathname, duration_seconds, sample_rate, channels, waveform_peaks, metadata
        FROM audios
        WHERE ${source}::text IS NULL OR source = ${source}
        ORDER BY (CASE source WHEN 'librispeech' THEN 0 ELSE 1 END), id
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`SELECT count(*)::int AS total FROM audios WHERE ${source}::text IS NULL OR source = ${source}`,
    ],
    { readOnly: true, isolationLevel: "RepeatableRead" },
  );
  return { items: rows.map(toRecord), total: total as number };
}

/** How many audios each dataset has. A dataset with none is left out. */
export async function countAudiosBySource(): Promise<{ source: AudioSource; count: number }[]> {
  const rows = await getSql()`SELECT source, count(*)::int AS count FROM audios GROUP BY source`;
  return rows.map((row) => ({ source: row.source as AudioSource, count: row.count as number }));
}

export async function getAudio(id: string): Promise<AudioRecord | null> {
  const rows = await getSql()`
    SELECT id, source, file_name, blob_pathname, duration_seconds, sample_rate, channels, waveform_peaks, metadata
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
 * With `source`, only that dataset's clips are returned. They are still scored
 * against the whole catalog, so a score means the same with or without it.
 *
 * It scores every clip: fine for a few thousand rows. At a much larger scale,
 * take the top candidates per signal from a vector index and estimate the
 * mean and deviation from a sample.
 */
export async function searchAudios({
  query,
  vectors,
  limit,
  source = null,
}: {
  query: string;
  vectors: Partial<Record<SearchMatch, number[]>>;
  limit: number;
  source?: AudioSource | null;
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
    SELECT a.id, a.source, a.file_name, a.blob_pathname, a.duration_seconds, a.sample_rate, a.channels, a.waveform_peaks,
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
    WHERE (g.text > 0 OR g.sound > 0)
      AND (${source}::text IS NULL OR a.source = ${source})
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
 * `id`, most similar first, from `source` only when it is set. Returns null when
 * `id` doesn't exist, and an empty list when it has no vector yet.
 */
export async function findSimilarAudios(
  id: string,
  limit: number,
  source: AudioSource | null = null,
): Promise<SimilarAudioHit[] | null> {
  const sql = getSql();
  const [found, rows] = await sql.transaction(
    [
      sql`SELECT 1 FROM audios WHERE id = ${id}`,
      sql`
        SELECT a.id, a.source, a.file_name, a.blob_pathname, a.duration_seconds, a.sample_rate, a.channels, a.waveform_peaks,
               a.metadata, (1 - (a.audio_embedding <=> example.audio_embedding))::float8 AS similarity
        FROM audios a
        JOIN audios example ON example.id = ${id}
        WHERE a.id <> example.id
          AND a.audio_embedding IS NOT NULL
          AND example.audio_embedding IS NOT NULL
          AND (${source}::text IS NULL OR a.source = ${source})
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
    SELECT id, source, file_name, blob_pathname, duration_seconds, sample_rate, channels, waveform_peaks, metadata
    FROM audios
    WHERE id = ANY(${ids})
  `;
  const byId = new Map(rows.map((row) => {
    const record = toRecord(row);
    return [record.id, record];
  }));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

/**
 * Search by an outside example: the clips whose audio vector is nearest to
 * `vector` (an embedded audio file), most similar first, from `source` only when it is set.
 */
export async function findAudiosNearVector(
  vector: number[],
  limit: number,
  source: AudioSource | null = null,
): Promise<SimilarAudioHit[]> {
  const rows = await getSql()`
    WITH q AS (SELECT ${toVector(vector)}::vector AS v)
    SELECT a.id, a.source, a.file_name, a.blob_pathname, a.duration_seconds, a.sample_rate, a.channels, a.waveform_peaks,
           a.metadata, (1 - (a.audio_embedding <=> q.v))::float8 AS similarity
    FROM audios a
    CROSS JOIN q
    WHERE a.audio_embedding IS NOT NULL
      AND (${source}::text IS NULL OR a.source = ${source})
    ORDER BY a.audio_embedding <=> q.v, a.id
    LIMIT ${limit}
  `;
  return rows.map((row) => ({ record: toRecord(row), similarity: row.similarity as number }));
}
