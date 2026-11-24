import "server-only";

/**
 * Internal, version-agnostic representation of an audio file.
 * API versions map this to their own public shapes (see src/server/api/vN).
 */

type AudioFileInfo = {
  /** Absolute path on disk. Never exposed through the API. */
  filePath: string;
  fileName: string;
  durationSeconds: number;
  sampleRate: number;
  channels: number;
};

export type LibriSpeechRecord = AudioFileInfo & {
  id: string;
  source: "librispeech";
  utteranceId: string;
  speaker: { id: string; sex: string | null; name: string | null };
  chapter: { id: string; title: string | null; bookTitle: string | null };
  transcript: string;
};

export type AudioCapsRecord = AudioFileInfo & {
  id: string;
  source: "audiocaps";
  clipId: string;
  youtubeId: string;
  startTime: number;
  captions: string[];
  audiocapIds: number[];
};

export type AudioRecord = LibriSpeechRecord | AudioCapsRecord;

/** A record before its FLAC header has been read. */
export type PendingRecord<T extends AudioRecord = AudioRecord> = T extends AudioRecord
  ? Omit<T, "durationSeconds" | "sampleRate" | "channels">
  : never;
