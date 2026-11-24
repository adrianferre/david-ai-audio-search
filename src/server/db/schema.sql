-- Schema of the audio catalog in Neon Postgres, shared by every Vercel environment
-- (development, preview and production use the same database).
-- Reference only: the table already exists and nothing applies this file. Change it
-- with an explicit migration and keep src/server/audios/repository.ts in sync.
--
-- The FLAC files are in the private Vercel Blob store, at `blob_pathname`.

CREATE TABLE IF NOT EXISTS audios (
  -- "C" collation: byte-wise ordering, the same on every server locale.
  id               text COLLATE "C" PRIMARY KEY,
  source           text NOT NULL CHECK (source IN ('librispeech', 'audiocaps')),
  file_name        text NOT NULL,
  -- Pathname of the FLAC in the private Vercel Blob store.
  blob_pathname    text NOT NULL,
  duration_seconds double precision NOT NULL,
  sample_rate      integer NOT NULL,
  channels         smallint NOT NULL,
  -- Dataset-specific fields (LibriSpeechMetadata / AudioCapsMetadata in src/server/audios/types.ts).
  metadata         jsonb NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Matches the ORDER BY of the list endpoint: LibriSpeech first, then AudioCaps, each by id.
CREATE INDEX IF NOT EXISTS audios_list_order_idx
  ON audios ((CASE source WHEN 'librispeech' THEN 0 ELSE 1 END), id);
