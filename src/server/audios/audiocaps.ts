import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { AudioCapsRecord, PendingRecord } from "./types";

type ManifestLine = {
  id: string;
  youtube_id: string;
  start_time: number;
  file: string;
  captions: string[];
  audiocap_ids: number[];
};

export async function loadAudioCaps(
  rootDir: string,
  split = "val",
): Promise<PendingRecord<AudioCapsRecord>[]> {
  const splitDir = path.join(rootDir, split);
  const manifest = await readFile(path.join(splitDir, "manifest.jsonl"), "utf8");

  const records: PendingRecord<AudioCapsRecord>[] = [];
  for (const line of manifest.split("\n")) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line) as ManifestLine;
    records.push({
      id: `audiocaps-${entry.id}`,
      source: "audiocaps",
      clipId: entry.id,
      youtubeId: entry.youtube_id,
      startTime: entry.start_time,
      filePath: path.join(splitDir, entry.file),
      fileName: path.basename(entry.file),
      captions: entry.captions,
      audiocapIds: entry.audiocap_ids,
    });
  }
  return records;
}
