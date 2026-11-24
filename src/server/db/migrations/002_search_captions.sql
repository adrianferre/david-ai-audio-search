-- Index AudioCaps captions as text too: the full-text column now covers the transcript
-- (LibriSpeech) or the captions (AudioCaps). `metadata->>'captions'` is the JSON array as
-- text, which the parser splits into words like any other text.
-- Applied to the shared Neon database on 2026-11-24. Safe to re-run.
-- scripts/embed-catalog.mts fills `text_embedding` for the AudioCaps rows.

ALTER TABLE audios
  ALTER COLUMN search_text
  SET EXPRESSION AS (to_tsvector('english', coalesce(metadata->>'transcript', metadata->>'captions', '')));
