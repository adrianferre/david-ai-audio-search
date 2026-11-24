import "server-only";

/**
 * Internal, version-agnostic representation of an audio file.
 * API versions map this to their own public shapes (see src/server/api/vN).
 *
 * Records live in the `audios` table in Neon Postgres (src/server/db/schema.sql)
 * and the FLAC files in a private Vercel Blob store.
 */

type AudioFileInfo = {
  /** Pathname of the FLAC in the private Blob store. Never exposed through the API. */
  blobPathname: string;
  fileName: string;
  durationSeconds: number;
  sampleRate: number;
  channels: number;
};

export type LibriSpeechMetadata = {
  utteranceId: string;
  speaker: { id: string; sex: string | null; name: string | null };
  chapter: { id: string; title: string | null; bookTitle: string | null };
  transcript: string;
};

export type AudioCapsMetadata = {
  clipId: string;
  youtubeId: string;
  startTime: number;
  captions: string[];
  audiocapIds: number[];
};

/**
 * A crowd-sourced Common Voice recording: one volunteer reading one prompted sentence.
 * Speakers are anonymous; `clientId` is Common Voice's hashed contributor id. The
 * demographics are self-reported and optional.
 */
export type CommonVoiceMetadata = {
  /** Common Voice clip name without extension, e.g. `common_voice_en_21807105`. */
  clipId: string;
  sentenceId: string;
  speaker: { clientId: string; age: string | null; gender: string | null; accent: string | null };
  /** The sentence the speaker was asked to read, as written (mixed case, punctuated). */
  transcript: string;
  /** Validation votes from other volunteers. */
  upVotes: number;
  downVotes: number;
  locale: string;
};

export type LibriSpeechRecord = AudioFileInfo &
  LibriSpeechMetadata & { id: string; source: "librispeech" };

export type AudioCapsRecord = AudioFileInfo &
  AudioCapsMetadata & { id: string; source: "audiocaps" };

export type CommonVoiceRecord = AudioFileInfo &
  CommonVoiceMetadata & { id: string; source: "commonvoice" };

export type AudioRecord = LibriSpeechRecord | AudioCapsRecord | CommonVoiceRecord;

/** The dataset an audio comes from. */
export type AudioSource = AudioRecord["source"];

/**
 * Why a search result matched: its text (the transcript of a LibriSpeech or
 * Common Voice clip, the captions of an AudioCaps clip) or what it sounds like
 * (the audio).
 */
export type SearchMatch = "text" | "sound";

export type AudioSearchHit = {
  record: AudioRecord;
  /** Relevance, higher is better. Only comparable within one result list. */
  score: number;
  matches: SearchMatch[];
  /**
   * AudioCaps only: the caption that shares most words with the query (the first
   * one when none does). A clip has several captions and any of them can match.
   */
  caption: string | null;
};

export type SimilarAudioHit = {
  record: AudioRecord;
  /** Cosine similarity of the two audio vectors, at most 1. */
  similarity: number;
};
