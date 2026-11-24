/**
 * Waveform overviews: a few dozen peak levels per clip, stored with the clip in
 * the `audios` table (`waveform_peaks`, src/server/db/schema.sql) and sent with
 * it by the API. scripts/compute-waveforms.mts computes them; the UI only draws.
 *
 * No imports and no `server-only`: plain Node loads this file from the script.
 */

/** Levels kept per clip. Views draw fewer bars by merging neighbours. */
export const PEAK_COUNT = 64;

/** Sample rate the clip is decoded at. Enough for an overview, and keeps memory small. */
export const PEAK_SAMPLE_RATE = 8_000;

/** Peak levels from 0 to 1, `PEAK_COUNT` of them. */
export type Peaks = readonly number[];

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
  // A gentle curve, so quiet passages still show next to loud ones. Three decimals
  // are far finer than any bar drawn, and keep the API responses small.
  return peaks.map((p) => Math.round(Math.pow(p / loudest, 0.7) * 1000) / 1000);
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
