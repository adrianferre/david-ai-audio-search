/**
 * The Embedding Map's data: every clip of the catalog placed on two 2D UMAP
 * maps (one of its audio vector, one of its text vector) plus the numbers the
 * map's story quotes. Computed offline, served as a static file
 * (`public/embedding-map.json`), and read by the map view only.
 *
 *   pnpm export-embedding-map   # design/embedding-map/*.json, from the database
 *   pnpm build-embedding-map    # public/embedding-map.json, from those files
 *
 * No imports: plain Node loads this file from scripts/build-embedding-map.mts.
 */

/** Where the browser loads the map from. */
export const EMBEDDING_MAP_URL = "/embedding-map.json";

/** AudioCaps sound families, from AudioSet labels, in the order the map colours them. */
export const SOUND_FAMILIES = [
  "Vehicles",
  "Animals",
  "Human sounds",
  "Tools & machines",
  "Water & weather",
  "Household & other",
] as const;

export type SoundFamily = (typeof SOUND_FAMILIES)[number];

/** A point of the map: one clip, with what the map colours it by. */
export type EmbeddingMapClip = {
  id: string;
  source: "librispeech" | "audiocaps" | "commonvoice";
  /** The transcript, or an AudioCaps clip's first caption (as the API's `text`), cut to 240 characters. */
  text: string;
  durationSeconds: number;
  /** 64 levels from 0 to 1, as the API's `waveformPeaks`. */
  waveformPeaks: number[] | null;
  /** Position on the map of the audio vectors, both axes in [0, 1] on one scale. */
  audioMap: [number, number];
  /** Position on the map of the text vectors (transcript, or captions joined). */
  textMap: [number, number];
  // AudioCaps
  soundFamily?: SoundFamily;
  soundLabels?: string[];
  hasSpeech?: boolean;
  // LibriSpeech
  bookTitle?: string;
  chapterId?: string;
  speakerId?: string;
  sex?: "F" | "M";
  // Common Voice (self-reported)
  gender?: "F" | "M";
  age?: string;
  accent?: string;
};

/** p10 / p50 / p90 of a query's cosine similarity against every vector of one kind. */
export type SimilarityPercentiles = { p10: number; p50: number; p90: number };

export type EmbeddingMapV1 = {
  version: 1;
  generatedAt: string;
  model: string;
  dimensions: number;
  umap: { metric: string; nNeighbors: number; minDist: number; seed: number };
  totalDurationHours: number;
  clips: EmbeddingMapClip[];
  /** Measured on the 768-d vectors, 10 nearest neighbours (cosine), in percent. */
  stats: {
    sameDatasetNeighbors: { librispeech: number; audiocaps: number; commonvoice: number };
    speechNeighborsOfSpeech: number;
    soundFamily: { agreement: number; chance: number };
    hasSpeech: { withSpeech: number; withoutSpeech: number };
    librispeech: {
      sameChapter: { audio: number; text: number };
      sameSpeakerOtherChapter: { audio: number; text: number };
      sameSexOtherSpeakers: { audio: number; text: number; chance: number };
    };
    commonvoiceSameGender: { audio: number; text: number; chance: number };
  };
  /** How far a query sits from text vectors and from audio vectors. */
  modalityGap: {
    /** Start of each histogram bin; every bin is `binWidth` wide. */
    binStarts: number[];
    binWidth: number;
    /** The example queries against every clip, summed over the queries. */
    examples: {
      queries: string[];
      text: { counts: number[] } & SimilarityPercentiles;
      audio: { counts: number[] } & SimilarityPercentiles;
    };
    /** From the retrieval evaluation (many queries), quoted. */
    evaluation: { text: SimilarityPercentiles; audio: SimilarityPercentiles };
  };
  /** Queries to try, with precision@10 from the retrieval evaluation when measured (0 to 1). */
  examples: { query: string; precisionAt10: number | null }[];
};
