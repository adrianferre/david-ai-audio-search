/**
 * Public contract of the v1 HTTP API. Shared by the route handlers (server)
 * and the fetchers/components (client), so both sides stay in sync.
 * Never change these shapes in a breaking way: add a v2 instead.
 */

/** The datasets of the catalog, in the order the list and the UI show them. */
export const AUDIO_SOURCES = ["librispeech", "audiocaps", "commonvoice"] as const;

export type AudioSource = (typeof AUDIO_SOURCES)[number];

export type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  nextPage: number | null;
  previousPage: number | null;
};

export type PaginatedResponse<T> = {
  data: T[];
  pagination: Pagination;
};

export type DataResponse<T> = {
  data: T;
};

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

/** One row of the audio list. Same shape regardless of the dataset. */
export type AudioListItemV1 = {
  id: string;
  source: AudioSource;
  title: string;
  text: string;
  durationSeconds: number;
  /**
   * Waveform overview to draw: 64 peak levels from 0 (silence) to 1 (the clip's
   * loudest moment), evenly spaced over the clip. Null when not computed yet.
   */
  waveformPeaks: number[] | null;
};

type AudioFileInfoV1 = {
  fileName: string;
  sampleRate: number;
  channels: number;
};

export type LibriSpeechMetadataV1 = AudioFileInfoV1 & {
  utteranceId: string;
  speaker: { id: string; sex: string | null; name: string | null };
  chapter: { id: string; title: string | null; bookTitle: string | null };
  transcript: string;
};

export type AudioCapsMetadataV1 = AudioFileInfoV1 & {
  youtubeId: string;
  youtubeUrl: string;
  startTime: number;
  captions: string[];
  audiocapIds: number[];
};

/** Crowd-sourced speech: an anonymous volunteer reading a prompted sentence. */
export type CommonVoiceMetadataV1 = AudioFileInfoV1 & {
  clipId: string;
  sentenceId: string;
  /** Self-reported and optional. `clientId` is Common Voice's hashed contributor id. */
  speaker: { clientId: string; age: string | null; gender: string | null; accent: string | null };
  transcript: string;
  upVotes: number;
  downVotes: number;
  locale: string;
};

export type AudioDetailV1 =
  | (AudioListItemV1 & { source: "librispeech"; metadata: LibriSpeechMetadataV1 })
  | (AudioListItemV1 & { source: "audiocaps"; metadata: AudioCapsMetadataV1 })
  | (AudioListItemV1 & { source: "commonvoice"; metadata: CommonVoiceMetadataV1 });

export type AudioListResponseV1 = PaginatedResponse<AudioListItemV1>;

/** One dataset of the catalog and how many audios it has (`GET /api/v1/datasets`). */
export type DatasetV1 = {
  source: AudioSource;
  count: number;
};

export type DatasetsResponseV1 = DataResponse<DatasetV1[]>;
export type AudioDetailResponseV1 = DataResponse<AudioDetailV1>;

/**
 * Why a search result matched: its text (the transcript of a LibriSpeech or
 * Common Voice audio, the captions of an AudioCaps audio) or what it sounds like
 * (the audio itself).
 */
export type SearchMatchV1 = "text" | "sound";

/** `match` query parameter of the search endpoint. */
export type SearchMatchFilterV1 = "all" | SearchMatchV1;

export type AudioSearchResultV1 = AudioListItemV1 & {
  /** How far the audio stands out for this query, higher is better. Only comparable within one response. */
  score: number;
  matches: SearchMatchV1[];
};

export type SimilarAudioV1 = AudioListItemV1 & {
  /** Cosine similarity to the example audio, at most 1. */
  similarity: number;
};

export type AudioSearchResponseV1 = DataResponse<AudioSearchResultV1[]>;
export type SimilarAudiosResponseV1 = DataResponse<SimilarAudioV1[]>;

/** Most audios one export can hold (`POST /api/v1/audios/export`). */
export const MAX_EXPORT_IDS = 200;

/** Name of an export ZIP, e.g. `audios-2026-11-24-2.zip` (UTC date). */
export function exportFileName(count: number, date = new Date()): string {
  return `audios-${date.toISOString().slice(0, 10)}-${count}.zip`;
}

/** Body of `POST /api/v1/audios/export`. The response is a ZIP, not JSON. */
export type AudioExportRequestV1 = {
  ids: string[];
};

/** `metadata.json` inside the export ZIP. Each audio's FLAC is at `audio/<id>.flac`. */
export type AudioExportManifestV1 = {
  exportedAt: string;
  count: number;
  audios: AudioDetailV1[];
};
