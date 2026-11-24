/**
 * Writes eval/data/audioset-labels.json: the AudioSet labels of every AudioCaps
 * clip in the catalog. They are the ground truth for the sound-concept and
 * audio-by-example query sets (scripts/eval/build-queries.mts).
 *
 *   node --env-file=.env.local scripts/eval/fetch-audioset-labels.mts
 *
 * AudioCaps clips are AudioSet segments (YouTube id + start second). Their labels
 * are in AudioSet's unbalanced_train_segments.csv (~100 MB, streamed, not kept).
 * Read-only on the database. AudioSet labels are CC BY 4.0 (Google).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import { neon } from "@neondatabase/serverless";

const BASE = "http://storage.googleapis.com/us_audioset/youtube_corpus/v1/csv";
const OUT = new URL("../../eval/data/audioset-labels.json", import.meta.url);

const sql = neon(process.env.DATABASE_URL ?? "");
const [clips] = (await sql.transaction(
  [
    sql`SELECT id, metadata->>'youtubeId' AS youtube_id, (metadata->>'startTime')::float8 AS start
        FROM audios WHERE source = 'audiocaps' ORDER BY id`,
  ],
  { readOnly: true },
)) as { id: string; youtube_id: string; start: number }[][];
const bySegment = new Map(clips.map((c) => [`${c.youtube_id},${c.start}`, c.id]));

async function lines(url: string): Promise<AsyncIterable<string>> {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`GET ${url}: ${response.status}`);
  return createInterface({ input: Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>), crlfDelay: Infinity });
}

const names = new Map<string, string>();
for await (const line of await lines(`${BASE}/class_labels_indices.csv`)) {
  const match = /^\d+,([^,]+),"?(.*?)"?$/.exec(line);
  if (match) names.set(match[1], match[2]);
}

const labels: Record<string, string[]> = {};
for await (const line of await lines(`${BASE}/unbalanced_train_segments.csv`)) {
  if (line.startsWith("#")) continue;
  const [youtubeId, start, , mids] = line.split(/,\s*/, 3).concat(line.slice(line.indexOf('"')));
  const id = bySegment.get(`${youtubeId},${Number(start)}`);
  if (!id) continue;
  labels[id] = mids
    .replaceAll('"', "")
    .split(",")
    .map((mid) => names.get(mid.trim()) ?? mid.trim());
}

const missing = clips.filter((c) => !labels[c.id]).map((c) => c.id);
await mkdir(new URL(".", OUT), { recursive: true });
await writeFile(
  OUT,
  `${JSON.stringify(
    {
      source: `${BASE}/unbalanced_train_segments.csv`,
      license: "AudioSet labels, CC BY 4.0, Google",
      clips: Object.keys(labels).length,
      missing,
      labels: Object.fromEntries(Object.entries(labels).sort(([a], [b]) => (a < b ? -1 : 1))),
    },
    null,
    2,
  )}\n`,
);
console.log(`${Object.keys(labels).length}/${clips.length} AudioCaps clips labelled; missing: ${missing.length}`);
