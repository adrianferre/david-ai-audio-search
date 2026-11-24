-- Search columns for the audio catalog. Additive: existing rows and queries are unaffected.
-- Applied to the shared Neon database on 2026-11-24. Safe to re-run.
-- The vectors are filled by scripts/embed-catalog.mts.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE audios
  ADD COLUMN IF NOT EXISTS audio_embedding vector(768),
  ADD COLUMN IF NOT EXISTS text_embedding vector(768),
  ADD COLUMN IF NOT EXISTS embedding_model text,
  ADD COLUMN IF NOT EXISTS search_text tsvector
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(metadata->>'transcript', ''))) STORED;

CREATE INDEX IF NOT EXISTS audios_search_text_idx ON audios USING gin (search_text);
