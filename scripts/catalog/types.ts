import type { AudioRecord } from "../../src/server/audios/types";

/** A record read from `data/` whose FLAC header hasn't been read yet. */
export type LocalRecord<T extends AudioRecord = AudioRecord> = T extends AudioRecord
  ? Omit<T, "durationSeconds" | "sampleRate" | "channels"> & {
      /** Absolute path of the FLAC on disk. */
      filePath: string;
    }
  : never;
