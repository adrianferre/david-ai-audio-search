/**
 * Public contract of the v1 HTTP API. Shared by the route handlers (server)
 * and the fetchers/components (client), so both sides stay in sync.
 * Never change these shapes in a breaking way: add a v2 instead.
 */

/** The datasets of the catalog, in the order the list and the UI show them. */
export const AUDIO_SOURCES = ["librispeech", "audiocaps", "commonvoice"] as const;

export type AudioSource = (typeof AUDIO_SOURCES)[number];

/**
 * A range of clip lengths, in seconds, both ends included: the `minDuration`
 * and `maxDuration` query parameters of every endpoint that takes `source`.
 * A null end is open: no shortest or no longest length.
 */
export type DurationRangeV1 = { min: number | null; max: number | null };

export const ANY_DURATION: DurationRangeV1 = { min: null, max: null };

/**
 * The speaker's gender: LibriSpeech's `sex` (F, M) and Common Voice's
 * self-reported `gender` (female_feminine, male_masculine). AudioCaps clips have no speaker.
 */
export const GENDERS = ["female", "male"] as const;
export type GenderV1 = (typeof GENDERS)[number];

/** The speaker's age, by decade, as Common Voice records it (self-reported; its spelling, "fourties"). */
export const AGES = [
  "teens",
  "twenties",
  "thirties",
  "fourties",
  "fifties",
  "sixties",
  "seventies",
  "eighties",
  "nineties",
] as const;
export type AgeV1 = (typeof AGES)[number];

/**
 * The speaker's accent, as Common Voice speakers describe it, grouped: each
 * of Common Voice's English accents, and `other` for the rest (a free-text
 * accent, or one with few speakers). A speaker who gives several accents
 * ("United States English, England English") is in each of their groups.
 */
export const ACCENTS = [
  "us",
  "england",
  "south-asia",
  "canada",
  "australia",
  "ireland",
  "southern-africa",
  "hong-kong",
  "new-zealand",
  "philippines",
  "malaysia",
  "wales",
  "west-indies",
  "singapore",
  "scotland",
  "other",
] as const;
export type AccentV1 = (typeof ACCENTS)[number];

/**
 * Filters by the clips' metadata: the `gender`, `age`, `accent` and `label`
 * query parameters of every endpoint that takes `source`, each repeatable
 * (`gender=female&gender=male`). A clip matches a filter when it has any of
 * its values, and must match every filter that has values; an empty list
 * doesn't filter. A clip without that metadata doesn't match: with `gender`,
 * no AudioCaps clip; with `age` or `accent`, only Common Voice clips; with
 * `label`, only AudioCaps clips.
 */
export type FacetFiltersV1 = {
  gender: GenderV1[];
  age: AgeV1[];
  accent: AccentV1[];
  /** AudioSet labels, as written (`Dog`, `Bee, wasp, etc.`): AudioCaps clips with any of them. */
  label: string[];
};

export type FacetV1 = keyof FacetFiltersV1;

export const FACETS = ["gender", "age", "accent", "label"] as const satisfies readonly FacetV1[];

export const NO_FACETS: FacetFiltersV1 = { gender: [], age: [], accent: [], label: [] };

/** Most values one facet parameter takes. */
export const MAX_FACET_VALUES = 50;

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
} & DatasetFactsV1;

/** Facts that hold for every clip of a dataset (the `datasets` table). */
type DatasetFactsV1 = {
  /** The split the catalog took from the dataset: `dev-clean` (LibriSpeech), `val` (AudioCaps), `dev` (Common Voice). */
  split: string;
  /** What the audio was before it was stored as 16 kHz mono FLAC: `FLAC`, `MP3` or `YouTube audio`. */
  originalFormat: string;
  /** The original audio was lossy (MP3, YouTube): compression artefacts may remain. */
  lossyOrigin: boolean;
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
  /**
   * The AudioSet labels of the clip's YouTube segment (AudioCaps clips are AudioSet segments),
   * e.g. `["Sneeze", "Speech"]`. Empty when the segment has none.
   */
  audioSetLabels: string[];
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

/**
 * One dataset of the catalog and how many audios it has (`GET /api/v1/datasets`).
 * With `minDuration`/`maxDuration` or the facet filters (`gender`, `age`,
 * `accent`, `label`), `count` is of the audios that pass them only;
 * `durationSeconds` is always of the whole dataset.
 */
export type DatasetV1 = {
  source: AudioSource;
  count: number;
  /** The shortest and the longest audio of the dataset. Null while it has none. */
  durationSeconds: { min: number; max: number } | null;
} & DatasetFactsV1;

export type DatasetsResponseV1 = DataResponse<DatasetV1[]>;

/** How many clips have one value of a facet. */
export type FacetCountV1<T extends string = string> = { value: T; count: number };

/**
 * The values of each facet and how many clips have each (`GET /api/v1/facets`),
 * of the `source` and length given. A facet's counts also apply the other
 * facets' filters, not its own, so they say what picking that value would add.
 * `gender`, `age` and `accent` list every value, in their order, 0 included;
 * `label` only those some clip has, most clips first.
 */
export type FacetsV1 = {
  gender: FacetCountV1<GenderV1>[];
  age: FacetCountV1<AgeV1>[];
  accent: FacetCountV1<AccentV1>[];
  label: FacetCountV1[];
};

export type FacetsResponseV1 = DataResponse<FacetsV1>;
export type AudioDetailResponseV1 = DataResponse<AudioDetailV1>;

/**
 * Why a search result matched: its text (the transcript of a LibriSpeech or
 * Common Voice audio, the captions of an AudioCaps audio) or what it sounds like
 * (the audio itself).
 */
export type SearchMatchV1 = "text" | "sound";

/**
 * `match` query parameter of the search endpoint. `exact` is the text alone, by
 * its exact words (no vectors); its results match on `text`.
 */
export type SearchMatchFilterV1 = "all" | SearchMatchV1 | "exact";

/**
 * Most characters the search endpoint takes in `q`: room for the transcript of
 * a 30 s clip, searched by what's said in it. The search box stops at 200.
 */
export const MAX_SEARCH_QUERY_LENGTH = 1000;

export type AudioSearchResultV1 = AudioListItemV1 & {
  /** How far the audio stands out for this query, higher is better. Only comparable within one response. */
  score: number;
  matches: SearchMatchV1[];
};

export type SimilarAudioV1 = AudioListItemV1 & {
  /** Cosine similarity to the example audio, at most 1. */
  similarity: number;
};

export type AudioSearchResponseV1 = DataResponse<AudioSearchResultV1[]> & {
  /**
   * Something clearly matches the query. When false, the results (if any) are
   * only the closest clips: nothing in the catalog stands out for it.
   */
  strongMatch: boolean;
};
export type SimilarAudiosResponseV1 = DataResponse<SimilarAudioV1[]>;

/**
 * What's said in a clip (`GET /api/v1/audios/{id}/transcript`), or in a WAV
 * clip of the user's (`POST /api/v1/transcriptions`).
 */
export type TranscriptV1 = {
  /** Empty when nobody speaks in the clip. */
  text: string;
  /**
   * Made by a speech-to-text model, not part of the dataset: AudioCaps clips
   * (they come with captions, not transcripts) and the user's own clips.
   */
  generated: boolean;
};

export type TranscriptResponseV1 = DataResponse<TranscriptV1>;

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
