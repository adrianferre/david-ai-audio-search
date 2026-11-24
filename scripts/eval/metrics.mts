/**
 * Retrieval metrics and statistics for the evaluation. Pure functions, no I/O:
 * scripts/eval/metrics.test.mts checks them against hand-computed values.
 *
 * Conventions (the same as LAION-CLAP / DCASE language-based audio retrieval):
 *  - `ranked` is the list a system returns, best first. A relevant clip the
 *    system leaves out (cut-off, or not in the top N) counts as not retrieved.
 *  - `relevant` maps a clip id to its gain (> 0). Binary sets use gain 1.
 *  - R@K is "hit at K": 1 when at least one relevant clip is in the top K. For a
 *    query with a single relevant clip (known-item search) it is plain recall.
 */

export type Relevance = Record<string, number>;

export type QueryMetrics = {
  "R@1": number;
  "R@5": number;
  "R@10": number;
  "P@10": number;
  "MRR": number;
  "mAP@10": number;
  "nDCG@10": number;
};

export const METRIC_NAMES: (keyof QueryMetrics)[] = ["R@1", "R@5", "R@10", "P@10", "MRR", "mAP@10", "nDCG@10"];

/** 1-based rank of the first relevant clip, or null when none was returned. */
export function firstRelevantRank(ranked: readonly string[], relevant: Relevance): number | null {
  const index = ranked.findIndex((id) => (relevant[id] ?? 0) > 0);
  return index === -1 ? null : index + 1;
}

export function scoreQuery(ranked: readonly string[], relevant: Relevance): QueryMetrics {
  const gains = Object.values(relevant).filter((g) => g > 0);
  const totalRelevant = gains.length;
  const rank = firstRelevantRank(ranked, relevant);
  const top10 = ranked.slice(0, 10);

  // AP@10 normalised by min(R, 10), as in DCASE task 6B.
  let hits = 0;
  let precisionSum = 0;
  top10.forEach((id, i) => {
    if ((relevant[id] ?? 0) > 0) {
      hits++;
      precisionSum += hits / (i + 1);
    }
  });
  const ap10 = totalRelevant === 0 ? 0 : precisionSum / Math.min(totalRelevant, 10);

  const dcg = top10.reduce((sum, id, i) => sum + (relevant[id] ?? 0) / Math.log2(i + 2), 0);
  const ideal = [...gains]
    .sort((a, b) => b - a)
    .slice(0, 10)
    .reduce((sum, gain, i) => sum + gain / Math.log2(i + 2), 0);

  return {
    "R@1": rank !== null && rank <= 1 ? 1 : 0,
    "R@5": rank !== null && rank <= 5 ? 1 : 0,
    "R@10": rank !== null && rank <= 10 ? 1 : 0,
    "P@10": top10.filter((id) => (relevant[id] ?? 0) > 0).length / 10,
    "MRR": rank === null ? 0 : 1 / rank,
    "mAP@10": ap10,
    "nDCG@10": ideal === 0 ? 0 : dcg / ideal,
  };
}

export function mean(values: readonly number[]): number {
  return values.length === 0 ? Number.NaN : values.reduce((a, b) => a + b, 0) / values.length;
}

/** Mulberry32: a small seeded PRNG, so samples and bootstrap CIs are reproducible. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Interval = { mean: number; low: number; high: number };

/**
 * Percentile bootstrap over queries: resample the queries with replacement and
 * take the 2.5th and 97.5th percentiles of the resampled means.
 */
export function bootstrapMean(values: readonly number[], { resamples = 2000, seed = 1 } = {}): Interval {
  const m = mean(values);
  if (values.length < 2) return { mean: m, low: m, high: m };
  const random = seededRandom(seed);
  const means = new Float64Array(resamples);
  for (let r = 0; r < resamples; r++) {
    let sum = 0;
    for (let i = 0; i < values.length; i++) sum += values[Math.floor(random() * values.length)];
    means[r] = sum / values.length;
  }
  means.sort();
  return { mean: m, low: means[Math.floor(0.025 * resamples)], high: means[Math.ceil(0.975 * resamples) - 1] };
}

/** Paired bootstrap of the mean difference b - a over the same queries. */
export function bootstrapDifference(a: readonly number[], b: readonly number[], options = {}): Interval {
  if (a.length !== b.length) throw new Error("Paired bootstrap needs the same queries on both sides");
  return bootstrapMean(
    a.map((value, i) => b[i] - value),
    options,
  );
}

/**
 * Area under the ROC curve: the probability that a random positive scores
 * higher than a random negative (ties count half).
 */
export function rocAuc(positives: readonly number[], negatives: readonly number[]): number {
  if (positives.length === 0 || negatives.length === 0) return Number.NaN;
  let wins = 0;
  for (const p of positives) for (const n of negatives) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (positives.length * negatives.length);
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}
