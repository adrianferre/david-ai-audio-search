import "server-only";

import path from "node:path";

import { loadAudioCaps } from "./audiocaps";
import { readFlacInfo } from "./flac";
import { loadLibriSpeech } from "./librispeech";
import type { AudioRecord, PendingRecord } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const FLAC_READ_CONCURRENCY = 64;

export type AudioCatalog = {
  /** LibriSpeech first, then AudioCaps; each sorted by id. */
  items: AudioRecord[];
  byId: Map<string, AudioRecord>;
};

async function safeLoad<T>(name: string, load: () => Promise<T[]>): Promise<T[]> {
  try {
    return await load();
  } catch (error) {
    console.warn(
      `[audios] Could not load dataset "${name}" (run \`pnpm data:setup\`):`,
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}

async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const byIdAsc = (a: { id: string }, b: { id: string }) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

async function buildCatalog(): Promise<AudioCatalog> {
  const [librispeech, audiocaps] = await Promise.all([
    safeLoad("librispeech", () => loadLibriSpeech(path.join(DATA_DIR, "librispeech"))),
    safeLoad("audiocaps", () => loadAudioCaps(path.join(DATA_DIR, "audiocaps"))),
  ]);
  const pending: PendingRecord[] = [
    ...librispeech.sort(byIdAsc),
    ...audiocaps.sort(byIdAsc),
  ];

  const resolved = await mapConcurrent(pending, FLAC_READ_CONCURRENCY, async (record) => {
    try {
      const { durationSeconds, sampleRate, channels } = await readFlacInfo(record.filePath);
      return { ...record, durationSeconds, sampleRate, channels } as AudioRecord;
    } catch {
      // Listed in a manifest/transcript but missing or unreadable on disk.
      return null;
    }
  });
  const items = resolved.filter((r): r is AudioRecord => r !== null);

  return { items, byId: new Map(items.map((item) => [item.id, item])) };
}

let catalogPromise: Promise<AudioCatalog> | undefined;

/** Builds the in-memory index once per server process. */
export function getCatalog(): Promise<AudioCatalog> {
  catalogPromise ??= buildCatalog().catch((error) => {
    catalogPromise = undefined; // allow a retry on the next request
    throw error;
  });
  return catalogPromise;
}
