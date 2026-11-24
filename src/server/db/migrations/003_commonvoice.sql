-- Allow Common Voice clips in the catalog. Additive: existing rows and queries are unaffected.
-- Applied to the shared Neon database on 2026-11-24. Safe to re-run.
--
-- Nothing else changes: Common Voice rows keep the sentence in `metadata->>'transcript'`,
-- so `search_text` already indexes it and scripts/embed-catalog.mts already embeds it.
-- The list order (LibriSpeech first, then the rest by id) puts them after AudioCaps.

ALTER TABLE audios
  DROP CONSTRAINT IF EXISTS audios_source_check,
  ADD CONSTRAINT audios_source_check CHECK (source IN ('librispeech', 'audiocaps', 'commonvoice'));
