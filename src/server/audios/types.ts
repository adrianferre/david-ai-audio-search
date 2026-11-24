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

export type LibriSpeechRecord = AudioFileInfo &
  LibriSpeechMetadata & { id: string; source: "librispeech" };

export type AudioCapsRecord = AudioFileInfo &
  AudioCapsMetadata & { id: string; source: "audiocaps" };

export type AudioRecord = LibriSpeechRecord | AudioCapsRecord;
