/**
 * Waveform overviews for the catalog clips, computed in the browser: the FLAC
 * is fetched from the API (the same URL the player uses, cached by the browser
 * for an hour), decoded, and reduced to a few dozen peak levels.
 *
 * A stopgap until the peaks are computed once on the server, next to the
 * embeddings: every clip shown costs one audio request the first time.
 */

import { audioFileUrl } from "@/lib/api/v1/client";

/** Levels kept per clip. Views draw fewer bars by merging neighbours. */
export const PEAK_COUNT = 64;

/** Decoding at a low rate is enough for an overview, and keeps memory small. */
const DECODE_SAMPLE_RATE = 8_000;

/** At most this many clips are fetched and decoded at once. */
const MAX_CONCURRENT = 3;

const STORAGE_PREFIX = "waveform:v1:";

/** Peak levels from 0 to 1, `PEAK_COUNT` of them. */
export type Peaks = readonly number[];

let running = 0;
const queue: (() => void)[] = [];

async function withSlot<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (running >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => queue.push(resolve));
  }
  running++;
  try {
    signal?.throwIfAborted();
    return await task();
  } finally {
    running--;
    queue.shift()?.();
  }
}

function readStored(id: string): Peaks | null {
  try {
    const stored = localStorage.getItem(STORAGE_PREFIX + id);
    if (!stored) return null;
    const peaks = stored.split(",").map((value) => Number(value) / 99);
    return peaks.length === PEAK_COUNT && peaks.every(Number.isFinite) ? peaks : null;
  } catch {
    return null;
  }
}

function store(id: string, peaks: Peaks) {
  try {
    localStorage.setItem(STORAGE_PREFIX + id, peaks.map((p) => Math.round(p * 99)).join(","));
  } catch {
    // Storage full or blocked: the peaks are only cached for this page.
  }
}

/** Max absolute level per bucket, scaled so the loudest bucket is 1. */
export function computePeaks(samples: Float32Array, count = PEAK_COUNT): number[] {
  const peaks = new Array<number>(count).fill(0);
  const size = samples.length / count;
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * size);
    const end = Math.max(start + 1, Math.floor((i + 1) * size));
    let max = 0;
    for (let j = start; j < end && j < samples.length; j++) {
      const value = Math.abs(samples[j]);
      if (value > max) max = value;
    }
    peaks[i] = max;
  }
  const loudest = Math.max(...peaks);
  if (loudest === 0) return peaks;
  // A gentle curve, so quiet passages still show next to loud ones.
  return peaks.map((p) => Math.pow(p / loudest, 0.7));
}

/** The clip's peaks, from this browser's cache or by fetching and decoding its FLAC. */
export async function loadPeaks(id: string, signal?: AbortSignal): Promise<Peaks> {
  const stored = readStored(id);
  if (stored) return stored;

  return withSlot(async () => {
    const res = await fetch(audioFileUrl(id), { signal, headers: { accept: "audio/flac" } });
    if (!res.ok) throw new Error(`Couldn't load the audio (${res.status})`);
    const bytes = await res.arrayBuffer();
    const context = new OfflineAudioContext({
      numberOfChannels: 1,
      length: 1,
      sampleRate: DECODE_SAMPLE_RATE,
    });
    const decoded = await context.decodeAudioData(bytes);
    const peaks = computePeaks(decoded.getChannelData(0));
    store(id, peaks);
    return peaks;
  }, signal);
}

/** `peaks` merged into `bars` levels (each the loudest of its group). */
export function resamplePeaks(peaks: Peaks, bars: number): number[] {
  const out = new Array<number>(bars).fill(0);
  const size = peaks.length / bars;
  for (let i = 0; i < bars; i++) {
    const start = Math.floor(i * size);
    const end = Math.max(start + 1, Math.floor((i + 1) * size));
    for (let j = start; j < end; j++) out[i] = Math.max(out[i], peaks[j] ?? 0);
  }
  return out;
}
