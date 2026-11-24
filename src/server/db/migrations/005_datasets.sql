-- One row per dataset of the catalog: the split it was taken from and the audio it was
-- converted from. Every clip is stored as 16 kHz mono FLAC, but only LibriSpeech was FLAC
-- to begin with, so a lossy origin means compression artefacts may remain. The API serves
-- these with every clip (`metadata.split`, `metadata.originalFormat`) and with
-- GET /api/v1/datasets, so a new dataset or split only needs a row here.
-- Additive: existing rows and queries are unaffected. Safe to re-run.
-- Applied to the shared Neon database on 2026-11-24.
--
-- AudioCaps clips also get `metadata.audioSetLabels` (no schema change: `metadata` is
-- jsonb). scripts/import-audioset-labels.mts fills it from AudioSet's CSV.

CREATE TABLE IF NOT EXISTS datasets (
  source          text PRIMARY KEY,
  split           text NOT NULL,
  -- What the audio was before it became the stored FLAC: 'FLAC', 'MP3', 'YouTube audio'.
  original_format text NOT NULL,
  lossy_origin    boolean NOT NULL
);

INSERT INTO datasets (source, split, original_format, lossy_origin) VALUES
  ('librispeech', 'dev-clean', 'FLAC', false),
  ('audiocaps', 'val', 'YouTube audio', true),
  ('commonvoice', 'dev', 'MP3', true)
ON CONFLICT (source) DO UPDATE SET
  split = EXCLUDED.split,
  original_format = EXCLUDED.original_format,
  lossy_origin = EXCLUDED.lossy_origin;

-- Every clip belongs to a known dataset.
ALTER TABLE audios
  DROP CONSTRAINT IF EXISTS audios_source_fkey,
  ADD CONSTRAINT audios_source_fkey FOREIGN KEY (source) REFERENCES datasets (source);
