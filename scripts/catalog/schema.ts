/**
 * Postgres schema of the audio catalog. Every statement is idempotent, so
 * `pnpm catalog:sync` applies it on every run. Change it additively, or
 * write an explicit migration before dropping or renaming anything: the app
 * reads these columns in src/server/audios/repository.ts.
 */
export const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS audios (
    -- "C" collation: byte-wise ordering, the same on every server locale.
    id               text COLLATE "C" PRIMARY KEY,
    source           text NOT NULL CHECK (source IN ('librispeech', 'audiocaps')),
    file_name        text NOT NULL,
    -- Pathname of the FLAC in the private Vercel Blob store.
    blob_pathname    text NOT NULL,
    duration_seconds double precision NOT NULL,
    sample_rate      integer NOT NULL,
    channels         smallint NOT NULL,
    -- Dataset-specific fields (see LibriSpeechMetadata / AudioCapsMetadata).
    metadata         jsonb NOT NULL,
    updated_at       timestamptz NOT NULL DEFAULT now()
  )`,
  // Matches the ORDER BY of the list endpoint: LibriSpeech first, then AudioCaps, each by id.
  `CREATE INDEX IF NOT EXISTS audios_list_order_idx
    ON audios ((CASE source WHEN 'librispeech' THEN 0 ELSE 1 END), id)`,
];
