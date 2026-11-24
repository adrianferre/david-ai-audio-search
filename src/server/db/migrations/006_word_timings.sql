-- When each word of a clip's transcript is said, so the UI can point at the words a search
-- found and play from them. LibriSpeech and Common Voice only (the clips with a transcript).
-- Additive: existing rows and queries are unaffected. Safe to re-run.
-- Applied to the shared Neon database on 2026-11-24.
-- scripts/compute-word-timings.mts fills it: a JSON array with one
-- `{ "word": "MISTER", "start": 0.541, "end": 0.802 }` per word of the transcript
-- (split on whitespace, as written), seconds from the start of the clip
-- (src/lib/audio/word-timings.ts).

ALTER TABLE audios
  ADD COLUMN IF NOT EXISTS word_timings jsonb,
  -- The speech-to-text model that timed the words, e.g. 'spacexai/grok-stt'.
  ADD COLUMN IF NOT EXISTS word_timings_model text;

ALTER TABLE audios
  DROP CONSTRAINT IF EXISTS audios_word_timings_check,
  ADD CONSTRAINT audios_word_timings_check
    CHECK (word_timings IS NULL OR jsonb_typeof(word_timings) = 'array');
