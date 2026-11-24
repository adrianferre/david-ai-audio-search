-- Schema of the audio catalog in Neon Postgres, shared by every Vercel environment
-- (development, preview and production use the same database).
-- Reference only: the table already exists and nothing applies this file. Change it
-- with an explicit migration and keep src/server/audios/repository.ts in sync.
--
-- The FLAC files are in the private Vercel Blob store, at `blob_pathname`.

-- pgvector, for the embedding columns.
CREATE EXTENSION IF NOT EXISTS vector;

-- One row per dataset (migrations/005_datasets.sql): facts that hold for every clip of it.
CREATE TABLE IF NOT EXISTS datasets (
  source          text PRIMARY KEY,
  -- The split the catalog took from the dataset: 'dev-clean', 'val', 'dev'.
  split           text NOT NULL,
  -- What the audio was before it became the stored FLAC: 'FLAC', 'MP3', 'YouTube audio'.
  original_format text NOT NULL,
  -- The original audio was lossy: compression artefacts may remain in the FLAC.
  lossy_origin    boolean NOT NULL
);

CREATE TABLE IF NOT EXISTS audios (
  -- "C" collation: byte-wise ordering, the same on every server locale.
  id               text COLLATE "C" PRIMARY KEY,
  -- 'commonvoice' added by migrations/003_commonvoice.sql.
  source           text NOT NULL CHECK (source IN ('librispeech', 'audiocaps', 'commonvoice'))
                     REFERENCES datasets (source),
  file_name        text NOT NULL,
  -- Pathname of the FLAC in the private Vercel Blob store.
  blob_pathname    text NOT NULL,
  duration_seconds double precision NOT NULL,
  sample_rate      integer NOT NULL,
  channels         smallint NOT NULL,
  -- Dataset-specific fields (LibriSpeechMetadata / AudioCapsMetadata / CommonVoiceMetadata in
  -- src/server/audios/types.ts). AudioCaps rows also hold `audioSetLabels`, the AudioSet labels
  -- of their YouTube segment, filled by scripts/import-audioset-labels.mts.
  metadata         jsonb NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- Waveform overview (migrations/004_waveform_peaks.sql): 64 peak levels from 0 to 1
  -- (src/lib/audio/peaks.ts), drawn by the UI. scripts/compute-waveforms.mts fills it;
  -- NULL means "not computed yet".
  waveform_peaks   real[] CHECK (waveform_peaks IS NULL OR (array_ndims(waveform_peaks) = 1 AND cardinality(waveform_peaks) = 64)),
  -- When each word of the transcript is said (migrations/006_word_timings.sql): one
  -- {"word", "start", "end"} per word, in seconds (src/lib/audio/word-timings.ts).
  -- LibriSpeech and Common Voice only. scripts/compute-word-timings.mts fills it;
  -- NULL means "not computed yet".
  word_timings     jsonb CHECK (word_timings IS NULL OR jsonb_typeof(word_timings) = 'array'),
  -- The speech-to-text model that timed the words.
  word_timings_model text,

  -- Search (migrations/001_search.sql). The vectors come from one multimodal model
  -- (src/server/search/embedding-config.ts), so text and audio share a vector space.
  -- scripts/embed-catalog.mts fills them; NULL means "not embedded yet".
  -- What the clip sounds like: embedding of the waveform. Every clip.
  audio_embedding  vector(768),
  -- The clip's text: embedding of the transcript (LibriSpeech, Common Voice) or of
  -- all the captions joined (AudioCaps).
  text_embedding   vector(768),
  -- Model that produced both vectors.
  embedding_model  text,
  -- Full-text index of the same text, for exact words (migrations/002_search_captions.sql).
  -- `metadata->>'captions'` is the JSON array as text; the parser splits it into words.
  search_text      tsvector GENERATED ALWAYS AS
                     (to_tsvector('english', coalesce(metadata->>'transcript', metadata->>'captions', ''))) STORED
);

-- Matches the ORDER BY of the list endpoint: LibriSpeech first, then the rest by id
-- (AudioCaps, then Common Voice).
CREATE INDEX IF NOT EXISTS audios_list_order_idx
  ON audios ((CASE source WHEN 'librispeech' THEN 0 ELSE 1 END), id);

CREATE INDEX IF NOT EXISTS audios_search_text_idx ON audios USING gin (search_text);

-- No vector index on purpose. With a few thousand rows an exact scan takes a few
-- milliseconds and returns the true nearest neighbours. At a much larger scale add
-- approximate indexes, e.g.:
--   CREATE INDEX ON audios USING hnsw (audio_embedding vector_cosine_ops);
