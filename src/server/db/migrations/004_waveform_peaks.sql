-- Store each clip's waveform overview with the clip, so the UI draws it from the API
-- response instead of downloading and decoding every FLAC in the browser.
-- Additive: existing rows and queries are unaffected. Safe to re-run.
-- Applied to the shared Neon database on 2026-11-24.
-- scripts/compute-waveforms.mts fills it (src/lib/audio/peaks.ts: 64 levels from 0 to 1).

ALTER TABLE audios
  ADD COLUMN IF NOT EXISTS waveform_peaks real[];

ALTER TABLE audios
  DROP CONSTRAINT IF EXISTS audios_waveform_peaks_check,
  ADD CONSTRAINT audios_waveform_peaks_check
    CHECK (waveform_peaks IS NULL OR (array_ndims(waveform_peaks) = 1 AND cardinality(waveform_peaks) = 64));
