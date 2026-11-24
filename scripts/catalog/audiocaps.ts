import { readFile } from "node:fs/promises";
import path from "node:path";

import type { AudioCapsRecord } from "../../src/server/audios/types";
import { blobPathnameFor } from "./paths";
import type { LocalRecord } from "./types";

type ManifestLine = {
  id: string;
  youtube_id: string;
  start_time: number;
  file: string;
  captions: string[];
  audiocap_ids: number[];
};

/** Reads `data/audiocaps/<split>/manifest.jsonl`: one record per downloaded clip. */
export async function loadAudioCaps(
  dataDir: string,
  split = "val",
): Promise<LocalRecord<AudioCapsRecord>[]> {
  const splitDir = path.join(dataDir, "audiocaps", split);
  const manifest = await readFile(path.join(splitDir, "manifest.jsonl"), "utf8");

  const records: LocalRecord<AudioCapsRecord>[] = [];
  for (const line of manifest.split("\n")) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line) as ManifestLine;
    const filePath = path.join(splitDir, entry.file);
    records.push({
      id: `audiocaps-${entry.id}`,
      source: "audiocaps",
      clipId: entry.id,
      youtubeId: entry.youtube_id,
      startTime: entry.start_time,
      filePath,
      blobPathname: blobPathnameFor(dataDir, filePath),
      fileName: path.basename(entry.file),
      captions: entry.captions,
      audiocapIds: entry.audiocap_ids,
    });
  }
  return records;
}
