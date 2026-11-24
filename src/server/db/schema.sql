-- Schema of the audio catalog in Neon Postgres, shared by every Vercel environment
-- (development, preview and production use the same database).
-- Reference only: the table already exists and nothing applies this file. Change it
-- with an explicit migration and keep src/server/audios/repository.ts in sync.
--
-- The FLAC files are in the private Vercel Blob store, at `blob_pathname`.

-- pgvector, for the embedding columns.
CREATE EXTENSION IF NOT EXISTS vector;

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
  updated_at       timestamptz NOT NULL DEFAULT now(),

  -- Search (migrations/001_search.sql). The vectors come from one multimodal model
  -- (src/server/search/embedding-config.ts), so text and audio share a vector space.
  -- scripts/embed-catalog.mts fills them; NULL means "not embedded yet".
  -- What the clip sounds like: embedding of the waveform. Every clip.
  audio_embedding  vector(768),
  -- What is said: embedding of the transcript. LibriSpeech only; AudioCaps captions
  -- are deliberately not indexed (sounds are found from the audio alone).
  text_embedding   vector(768),
  -- Model that produced both vectors.
  embedding_model  text,
  -- Full-text index of the transcript, for exact words.
  search_text      tsvector GENERATED ALWAYS AS
                     (to_tsvector('english', coalesce(metadata->>'transcript', ''))) STORED
);

-- Matches the ORDER BY of the list endpoint: LibriSpeech first, then AudioCaps, each by id.
CREATE INDEX IF NOT EXISTS audios_list_order_idx
  ON audios ((CASE source WHEN 'librispeech' THEN 0 ELSE 1 END), id);

CREATE INDEX IF NOT EXISTS audios_search_text_idx ON audios USING gin (search_text);

-- No vector index on purpose. With a few thousand rows an exact scan takes a few
-- milliseconds and returns the true nearest neighbours. At a much larger scale add
-- approximate indexes, e.g.:
--   CREATE INDEX ON audios USING hnsw (audio_embedding vector_cosine_ops);
