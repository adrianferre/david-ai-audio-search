/**
 * Stores the AudioSet labels of every AudioCaps clip of the catalog in its
 * `metadata.audioSetLabels` (e.g. `["Sneeze", "Speech"]`, `[]` when AudioSet has
 * none). AudioCaps clips are AudioSet segments, matched on YouTube id and start
 * time against AudioSet's unbalanced_train_segments.csv (~100 MB, streamed, not
 * kept). AudioSet labels are CC BY 4.0 (Google).
 *
 *   node --env-file=.env.local scripts/import-audioset-labels.mts [--dry-run]
 *
 * `--dry-run` only prints what it would write.
 *
 * It WRITES TO THE SHARED PRODUCTION DATABASE. It only sets `audioSetLabels` in
 * the metadata of `audiocaps` rows (vectors and every other field stay as they
 * are) and skips rows that already have the same labels, so re-running it is safe.
 */
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import { neon } from "@neondatabase/serverless";

const AUDIOSET_CSV = "http://storage.googleapis.com/us_audioset/youtube_corpus/v1/csv";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Run with --env-file=.env.local`);
  return value;
}

const sql = neon(requireEnv("DATABASE_URL"));
const dryRun = process.argv.includes("--dry-run");

async function lines(url: string): Promise<AsyncIterable<string>> {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`GET ${url}: ${response.status}`);
  return createInterface({
    input: Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>),
    crlfDelay: Infinity,
  });
}

type Segment = { id: string; youtube_id: string; start_time: number };

const segments = (await sql`
  SELECT id, metadata->>'youtubeId' AS youtube_id, (metadata->>'startTime')::float8 AS start_time
  FROM audios
  WHERE source = 'audiocaps'
  ORDER BY id
`) as Segment[];
console.log(`${segments.length} AudioCaps clips in the catalog`);
const bySegment = new Map(segments.map((s) => [`${s.youtube_id},${s.start_time}`, s.id]));

const names = new Map<string, string>();
for await (const line of await lines(`${AUDIOSET_CSV}/class_labels_indices.csv`)) {
  const match = /^\d+,([^,]+),"?(.*?)"?$/.exec(line);
  if (match) names.set(match[1], match[2]);
}

console.log("Reading AudioSet's segments (~100 MB, streamed)…");
const labels: Record<string, string[]> = Object.fromEntries(segments.map((s) => [s.id, []]));
for await (const line of await lines(`${AUDIOSET_CSV}/unbalanced_train_segments.csv`)) {
  if (line.startsWith("#")) continue;
  // YTID, start_seconds, end_seconds, "mid1,mid2,..."
  const [youtubeId, start] = line.split(/,\s*/, 2);
  const id = bySegment.get(`${youtubeId},${Number(start)}`);
  if (!id) continue;
  labels[id] = line
    .slice(line.indexOf('"'))
    .replaceAll('"', "")
    .split(",")
    .map((mid) => names.get(mid.trim()) ?? mid.trim());
}

const unlabelled = Object.values(labels).filter((l) => l.length === 0).length;
console.log(`${segments.length - unlabelled} clips labelled, ${unlabelled} without AudioSet labels`);

if (dryRun) {
  for (const [id, l] of Object.entries(labels).slice(0, 10)) console.log(`  ${id}: ${l.join(", ") || "—"}`);
  console.log("Dry run: nothing written.");
} else {
  const written = await sql`
    UPDATE audios a
    SET metadata = jsonb_set(a.metadata, '{audioSetLabels}', l.labels),
        updated_at = now()
    FROM jsonb_each(${JSON.stringify(labels)}::jsonb) AS l(id, labels)
    WHERE a.id = l.id
      AND a.source = 'audiocaps'
      AND a.metadata->'audioSetLabels' IS DISTINCT FROM l.labels
    RETURNING a.id
  `;
  console.log(`${written.length} rows updated; the rest already had these labels.`);
}
