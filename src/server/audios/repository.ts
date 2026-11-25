import "server-only";

import { z } from "zod";

import { getSql } from "@/server/db";
import {
  EXACT_PHRASE_BONUS,
  EXACT_WORDS_BONUS,
  isStrongMatch,
  MIN_SHARE_OF_BEST,
  MIN_TYPED_SOUND_Z_SCORE,
  MIN_Z_SCORE,
} from "@/server/search/ranking-config";

import { accentsOf, catalogCondition, facetMatches, genderOf } from "./facets";
import {
  type AudioRecord,
  type AudioSearchHit,
  type AudioSource,
  type CatalogFilter,
  type DatasetRecord,
  type FacetFilters,
  NO_FACETS,
  type SearchMatch,
  type SimilarAudioHit,
} from "./types";

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
      audioSetLabels: z.array(z.string()).default([]),
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
 * Only the audios that pass `filter`: its dataset, length and facets
 * (`total` counts only those).
 */
export async function listAudios({
  offset,
  limit,
  ...filter
}: {
  offset: number;
  limit: number;
} & CatalogFilter): Promise<AudioPage> {
  const sql = getSql();
  // One round trip and one snapshot (REPEATABLE READ; the default READ COMMITTED
  // gives each statement its own), so `total` always matches the page.
  const [rows, [{ total }]] = await sql.transaction(
    [
      sql`
        SELECT id, source, file_name, blob_pathname, duration_seconds, sample_rate, channels, waveform_peaks, metadata
        FROM audios a
        WHERE ${catalogCondition(sql, filter)}
        ORDER BY (CASE source WHEN 'librispeech' THEN 0 ELSE 1 END), id
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`
        SELECT count(*)::int AS total
        FROM audios a
        WHERE ${catalogCondition(sql, filter)}
      `,
    ],
    { readOnly: true, isolationLevel: "RepeatableRead" },
  );
  return { items: rows.map(toRecord), total: total as number };
}

// Columns of the `datasets` table (migrations/005_datasets.sql).
const datasetRowSchema = z.object({
  source: z.enum(["librispeech", "audiocaps", "commonvoice"]),
  split: z.string(),
  original_format: z.string(),
  lossy_origin: z.boolean(),
});

function toDataset(row: unknown): DatasetRecord {
  const r = datasetRowSchema.parse(row);
  return { source: r.source, split: r.split, originalFormat: r.original_format, lossyOrigin: r.lossy_origin };
}

export type DatasetSummary = DatasetRecord & {
  count: number;
  durationSeconds: { min: number; max: number } | null;
};

/**
 * Every dataset of the catalog with how many audios it has (0 when none yet), or
 * how many of `duration`'s length and with `facets`, and the length of its
 * shortest and longest audio (of all of them, whatever the filters).
 */
export async function listDatasets(filter: Omit<CatalogFilter, "source"> = {}): Promise<DatasetSummary[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT d.source, d.split, d.original_format, d.lossy_origin,
           count(a.id) FILTER (WHERE ${catalogCondition(sql, { ...filter, source: null })})::int AS count,
           min(a.duration_seconds)::float8 AS min_duration,
           max(a.duration_seconds)::float8 AS max_duration
    FROM datasets d
    LEFT JOIN audios a ON a.source = d.source
    GROUP BY d.source
  `;
  return rows.map((row) => ({
    ...toDataset(row),
    count: row.count as number,
    durationSeconds:
      row.min_duration === null ? null : { min: row.min_duration as number, max: row.max_duration as number },
  }));
}

export type FacetCount = { value: string; count: number };

/**
 * How many clips have each value of each facet (src/server/audios/facets.ts),
 * of the clips of `filter`'s dataset and length. A facet's counts also apply
 * the other facets of `filter`, not its own: what picking one more of its
 * values would add. Only the values some clip has, most clips first. A clip
 * with several accents counts in each of their groups.
 */
export async function countFacets(filter: CatalogFilter = {}): Promise<Record<keyof FacetFilters, FacetCount[]>> {
  const sql = getSql();
  const matches = facetMatches(sql, filter.facets ?? NO_FACETS);
  const rows = await sql`
    WITH clips AS (
      SELECT ${genderOf(sql)} AS gender, ${accentsOf(sql)} AS accents,
             ${matches.gender} AS gender_ok, ${matches.accent} AS accent_ok
      FROM audios a
      WHERE ${catalogCondition(sql, { source: filter.source, duration: filter.duration })}
    )
    SELECT 'gender' AS facet, gender AS value, count(*)::int AS count
    FROM clips WHERE gender IS NOT NULL AND accent_ok GROUP BY gender
    UNION ALL
    SELECT 'accent', accent, count(*)::int
    FROM clips CROSS JOIN unnest(accents) AS accent WHERE gender_ok GROUP BY accent
    ORDER BY count DESC, value
  `;
  const counts: Record<keyof FacetFilters, FacetCount[]> = { gender: [], accent: [] };
  for (const row of rows) {
    counts[row.facet as keyof FacetFilters].push({ value: row.value as string, count: row.count as number });
  }
  return counts;
}

/** Every dataset of the catalog, by source: what the details of its audios quote. */
export async function getDatasets(): Promise<Map<AudioSource, DatasetRecord>> {
  const rows = await getSql()`SELECT source, split, original_format, lossy_origin FROM datasets`;
  return new Map(rows.map((row) => {
    const dataset = toDataset(row);
    return [dataset.source, dataset];
  }));
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

/*
 * Similarities are compared as z-scores: how many standard deviations a clip
 * stands above the catalog's mean for this query. That puts text-to-text and
 * text-to-audio similarity on one scale (their raw values differ, and both
 * shift from query to query), so the two signals can be ranked together.
 * The cut-offs and bonuses are in src/server/search/ranking-config.ts, shared
 * with the evaluation (scripts/eval/run.mts re-implements this ranking).
 */

export type AudioSearchResult = {
  hits: AudioSearchHit[];
  /**
   * Something clearly matches the query: the best result scores at least
   * STRONG_MATCH_SCORE, or scores lower but its text is close to the query in
   * absolute terms (isStrongMatch in ranking-config.ts). Not judged (true) when the sound is an example's: the
   * threshold is calibrated on typed queries, and a clip's nearest sounds
   * stand out on another scale.
   */
  strongMatch: boolean;
};

/**
 * Text search over two signals:
 *  - its text (transcript or captions): `vectors.text` against the text vectors,
 *    plus full-text search for exact words (a bonus when the text has every
 *    word of the query, and more when it has the query as typed),
 *  - what it sounds like: `vectors.sound` against the audio vectors.
 * A clip's score is its best signal, not the sum: the two overlap (the audio
 * vector carries the spoken words too, and captions describe the sound), so
 * adding them would count the same evidence twice.
 * A signal whose vector is missing is skipped.
 * With `soundOf` (an audio's id) and no `vectors.sound`, the sound signal is
 * that audio's own vector: search by an example's sound, plus its words.
 * `soundIsExample` says the sound vector is a clip's (`soundOf`, or an uploaded
 * clip's), not the typed query's, so the stricter typed-sound cut-off doesn't apply.
 * Results below MIN_SHARE_OF_BEST of the best one are dropped.
 * Only the clips that pass `filter` (the sidebar's dataset, length and facets)
 * are returned, and `exclude` (an audio's id) is left out: the clip
 * searched with, which would come first. All are still scored against the whole
 * catalog, so a score means the same with or without them; the best result is
 * the best of those returned.
 *
 * It scores every clip: fine for a few thousand rows. At a much larger scale,
 * take the top candidates per signal from a vector index and estimate the
 * mean and deviation from a sample.
 */
export async function searchAudios({
  query,
  vectors,
  soundOf = null,
  soundIsExample = soundOf !== null,
  limit,
  exclude = null,
  ...filter
}: {
  query: string;
  vectors: Partial<Record<SearchMatch, number[]>>;
  soundOf?: string | null;
  soundIsExample?: boolean;
  limit: number;
  exclude?: string | null;
} & CatalogFilter): Promise<AudioSearchResult> {
  const soundMinZ = vectors.text && !soundIsExample ? MIN_TYPED_SOUND_Z_SCORE : MIN_Z_SCORE;
  const sql = getSql();
  const rows = await sql`
    WITH q AS (
      SELECT ${toVector(vectors.text)}::vector AS text_vector,
             coalesce(
               ${toVector(vectors.sound)}::vector,
               (SELECT audio_embedding FROM audios WHERE id = ${soundOf}::text)
             ) AS sound_vector,
             websearch_to_tsquery('english', ${query}) AS words,
             -- The query as typed: no stemming or stop words, words in a row.
             -- None when it excludes a word (-dog): the phrase would drop the
             -- minus and match the very words the query leaves out.
             CASE WHEN websearch_to_tsquery('simple', ${query})::text LIKE '%!%'
               THEN ''::tsquery
               ELSE phraseto_tsquery('simple', ${query})
             END AS phrase,
             -- Any of the query's words, to pick the caption to show.
             replace(plainto_tsquery('english', ${query})::text, '&', '|')::tsquery AS any_word
    ),
    scored AS (
      SELECT a.id,
             (q.text_vector IS NOT NULL AND a.search_text @@ q.words) AS has_words,
             -- The same per-clip text as the Words filter (searchAudiosByExactWords).
             (q.text_vector IS NOT NULL AND numnode(q.phrase) > 0 AND coalesce(
               to_tsvector('simple', a.metadata->>'transcript'),
               to_tsvector('simple', a.metadata->'captions')
             ) @@ q.phrase) AS has_phrase,
             s.text AS text_cosine,
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
      SELECT id, text_cosine,
             CASE
               WHEN has_words OR has_phrase
                 THEN ${EXACT_WORDS_BONUS}::float8
                      + CASE WHEN has_phrase THEN ${EXACT_PHRASE_BONUS}::float8 ELSE 0 END
                      + greatest(text_z, 0)
               WHEN text_z >= ${MIN_Z_SCORE}::float8 THEN text_z
               ELSE 0
             END AS text,
             CASE WHEN sound_z >= ${soundMinZ}::float8 THEN sound_z ELSE 0 END AS sound
      FROM scored
    ),
    matched AS (
      SELECT g.id, greatest(g.text, g.sound)::float8 AS score, g.text > 0 AS text, g.sound > 0 AS sound,
             max(greatest(g.text, g.sound)) OVER ()::float8 AS best,
             -- How close the best text match is in absolute terms, for strongMatch.
             max(g.text_cosine) FILTER (WHERE g.text > 0) OVER ()::float8 AS best_text_cosine
      FROM signals g
      JOIN audios a USING (id)
      WHERE (g.text > 0 OR g.sound > 0)
        AND ${catalogCondition(sql, filter)}
        AND (${exclude}::text IS NULL OR a.id <> ${exclude})
    )
    SELECT a.id, a.source, a.file_name, a.blob_pathname, a.duration_seconds, a.sample_rate, a.channels, a.waveform_peaks,
           a.metadata, m.score, m.text, m.sound, m.best, m.best_text_cosine,
           (
             SELECT caption
             FROM jsonb_array_elements_text(a.metadata->'captions') WITH ORDINALITY AS c(caption, position)
             ORDER BY ts_rank(to_tsvector('english', caption), q.any_word) DESC, position
             LIMIT 1
           ) AS caption
    FROM matched m
    JOIN audios a USING (id)
    CROSS JOIN q
    WHERE m.score >= ${MIN_SHARE_OF_BEST}::float8 * m.best
    ORDER BY m.score DESC, a.id
    LIMIT ${limit}
  `;
  return {
    hits: rows.map((row) => ({
      record: toRecord(row),
      score: row.score as number,
      matches: [...(row.text ? ["text" as const] : []), ...(row.sound ? ["sound" as const] : [])],
      caption: (row.caption as string | null) ?? null,
    })),
    strongMatch: rows.length > 0 && (
      soundIsExample || isStrongMatch(rows[0].best as number, rows[0].best_text_cosine as number | null)
    ),
  };
}

/**
 * Exact-word search over the clip's text (transcript or captions), no vectors:
 * a clip matches when its text contains every word of the query as written
 * (case and punctuation aside). Unlike the `search_text` index it does not stem
 * ("barking" doesn't match "barks") or drop stop words ("the", "a"), so it is
 * computed per query, which is fine for a few thousand rows. Web-search syntax
 * works: "a quoted phrase" for words in a row, `or`, and `-word` to exclude.
 * Most relevant first (`ts_rank_cd`: more and closer occurrences), then by id.
 */
export async function searchAudiosByExactWords({
  query,
  limit,
  exclude = null,
  ...filter
}: {
  query: string;
  limit: number;
  /** An audio's id to leave out: the clip searched with. */
  exclude?: string | null;
} & CatalogFilter): Promise<AudioSearchHit[]> {
  const sql = getSql();
  const rows = await sql`
    WITH q AS (
      SELECT websearch_to_tsquery('simple', ${query}) AS words,
             -- Any of the query's words, to pick the caption to show.
             replace(plainto_tsquery('simple', ${query})::text, '&', '|')::tsquery AS any_word
    )
    SELECT a.id, a.source, a.file_name, a.blob_pathname, a.duration_seconds, a.sample_rate, a.channels, a.waveform_peaks,
           a.metadata, ts_rank_cd(t.doc, q.words)::float8 AS score,
           (
             SELECT caption
             FROM jsonb_array_elements_text(a.metadata->'captions') WITH ORDINALITY AS c(caption, position)
             ORDER BY (to_tsvector('simple', caption) @@ q.words) DESC,
                      ts_rank(to_tsvector('simple', caption), q.any_word) DESC, position
             LIMIT 1
           ) AS caption
    FROM audios a
    CROSS JOIN q
    CROSS JOIN LATERAL (
      -- The captions as jsonb, not as text: each caption is indexed on its own,
      -- with a gap between them, so a quoted phrase can't span two captions.
      SELECT coalesce(
               to_tsvector('simple', a.metadata->>'transcript'),
               to_tsvector('simple', a.metadata->'captions'),
               ''::tsvector
             ) AS doc
    ) t
    WHERE t.doc @@ q.words
      AND ${catalogCondition(sql, filter)}
      AND (${exclude}::text IS NULL OR a.id <> ${exclude})
    ORDER BY score DESC, a.id
    LIMIT ${limit}
  `;
  return rows.map((row) => ({
    record: toRecord(row),
    score: row.score as number,
    matches: ["text"],
    caption: (row.caption as string | null) ?? null,
  }));
}

/**
 * Search by example: the clips whose audio vector is nearest to the one of
 * `id`, most similar first, of those that pass `filter`. Returns null when
 * `id` doesn't exist, and an empty list when it has no vector yet.
 */
export async function findSimilarAudios(
  id: string,
  limit: number,
  filter: CatalogFilter = {},
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
          AND ${catalogCondition(sql, filter)}
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
 * `vector` (an embedded audio file), most similar first, of those that pass `filter`.
 */
export async function findAudiosNearVector(
  vector: number[],
  limit: number,
  filter: CatalogFilter = {},
): Promise<SimilarAudioHit[]> {
  const sql = getSql();
  const rows = await sql`
    WITH q AS (SELECT ${toVector(vector)}::vector AS v)
    SELECT a.id, a.source, a.file_name, a.blob_pathname, a.duration_seconds, a.sample_rate, a.channels, a.waveform_peaks,
           a.metadata, (1 - (a.audio_embedding <=> q.v))::float8 AS similarity
    FROM audios a
    CROSS JOIN q
    WHERE a.audio_embedding IS NOT NULL
      AND ${catalogCondition(sql, filter)}
    ORDER BY a.audio_embedding <=> q.v, a.id
    LIMIT ${limit}
  `;
  return rows.map((row) => ({ record: toRecord(row), similarity: row.similarity as number }));
}
