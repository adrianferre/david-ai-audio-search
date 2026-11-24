/**
 * Writes the data of the "Embedding Map" design (design/embedding-map/): every
 * clip placed on two 2D UMAP maps (one of the audio vectors, one of the text
 * vectors) with its 10 nearest neighbours, five example queries with their real
 * results, and the numbers the design prompt quotes.
 *
 *   node --env-file=.env.local scripts/export-embedding-map.mts
 *
 * READ-ONLY on the shared production database (read-only transactions). It
 * makes one AI Gateway request (the 5 queries, a fraction of a cent) and 5 GET
 * requests to the public search API.
 *
 * AudioCaps clips are AudioSet segments: their labels are in the catalog
 * (`metadata.audioSetLabels`, filled by scripts/import-audioset-labels.mts).
 * AudioSet labels are CC BY 4.0 (Google).
 */
import { mkdir, writeFile } from "node:fs/promises";

import { neon } from "@neondatabase/serverless";
import { embedMany } from "ai";
import { UMAP } from "umap-js";

import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  toSoundQuery,
  toTextQuery,
} from "../src/server/search/embedding-config.ts";

const OUT = new URL("../design/embedding-map/", import.meta.url);
const SEARCH_API = "https://david-ai-audio-search.vercel.app/api/v1/search";

const QUERIES = ["dog barking", "baby crying", "someone sneezing", "thank you", "question about pricing"];
const NEIGHBORS = 10;
const UMAP_PARAMS = { metric: "cosine", nNeighbors: 15, minDist: 0.1, seed: 42 } as const;
const HISTOGRAM_BINS = 20;
const PAGE_SIZE = 500;

/** First family (in this order) with a label matching its pattern; the rest is "Household & other". */
const SOUND_FAMILIES: [string, RegExp][] = [
  ["Vehicles", /vehicle|car\b|aircraft|boat|train|bus|motorcycle|truck|engine|race car|accelerat|helicopter|jet|siren/i],
  ["Animals", /animal|bird|insect|bee|dog|cat|bark|chirp|duck|goose|pigeon|frog|cricket|livestock|horse|sheep|goat|cattle|rooster|chicken|fowl|pig|owl|crow/i],
  ["Water & weather", /water|rain|stream|ocean|wave|wind|thunder|splash|drip|pour|gurgl/i],
  ["Human sounds", /laugh|cry|baby|sneez|cough|snor|breath|whistl|clap|applause|footstep|burp|giggl|scream|cheer|crowd|chatter/i],
  ["Tools & machines", /tool|drill|saw|hammer|machine|mechanism|buzz|hum|vacuum|sewing|printer|clock|tick|alarm|bell|beep|typing|power/i],
];
const OTHER_FAMILY = "Household & other";

/**
 * Numbers from the retrieval evaluation (eval/report.md), quoted as they are:
 * this script does not recompute them.
 */
const FROM_EVALUATION = {
  note: "From the retrieval evaluation (eval/report.md); quoted, not recomputed by this script.",
  querySimilarity: {
    text: { p10: 0.537, p50: 0.587, p90: 0.64 },
    audio: { p10: 0.328, p50: 0.481, p90: 0.566 },
  },
  precisionAt10: { "dog barking": 0.7, "baby crying": 0.9, "someone sneezing": 0.3 },
};

type Source = "librispeech" | "audiocaps" | "commonvoice";
const SOURCES: Source[] = ["librispeech", "audiocaps", "commonvoice"];
const SPEECH: ReadonlySet<Source> = new Set(["librispeech", "commonvoice"]);

type Row = {
  id: string;
  source: Source;
  duration_seconds: number;
  metadata: Record<string, unknown>;
  waveform_peaks: number[] | null;
  embedding_model: string | null;
  audio_embedding: string;
  text_embedding: string;
};

type Clip = {
  id: string;
  source: Source;
  text: string;
  captions?: string[];
  durationSeconds: number;
  waveformPeaks: number[] | null;
  youtubeId?: string;
  startTime?: number;
  bookTitle?: string;
  chapterId?: string;
  speakerId?: string;
  speakerName?: string;
  sex?: "F" | "M";
  gender?: string;
  age?: string;
  accent?: string;
  soundLabels?: string[];
  soundFamily?: string;
  hasSpeech?: boolean;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Run with --env-file=.env.local`);
  return value;
}

const round = (value: number, digits: number) => Number(value.toFixed(digits));
const percent = (part: number, total: number) => (total === 0 ? 0 : round((part / total) * 100, 1));

// ---------------------------------------------------------------------------
// 1. Read the catalog (read-only)

const sql = neon(requireEnv("DATABASE_URL"));

async function readCatalog(): Promise<Row[]> {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const [page] = (await sql.transaction(
      [
        sql`SELECT id, source, duration_seconds, metadata, waveform_peaks, embedding_model,
                   audio_embedding::text AS audio_embedding, text_embedding::text AS text_embedding
            FROM audios
            WHERE audio_embedding IS NOT NULL AND text_embedding IS NOT NULL
            ORDER BY id
            LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
      ],
      { readOnly: true },
    )) as Row[][];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  const [[{ total }]] = (await sql.transaction([sql`SELECT count(*)::int AS total FROM audios`], {
    readOnly: true,
  })) as { total: number }[][];
  if (total !== rows.length) console.warn(`${total - rows.length} clips have no vectors and are left out`);
  return rows;
}

function toUnitVector(text: string): Float32Array {
  const values = JSON.parse(text) as number[];
  if (values.length !== EMBEDDING_DIMENSIONS) throw new Error(`Expected ${EMBEDDING_DIMENSIONS}-d vectors`);
  return normalize(values);
}

function normalize(values: ArrayLike<number>): Float32Array {
  let norm = 0;
  for (let i = 0; i < values.length; i++) norm += values[i] * values[i];
  norm = Math.sqrt(norm);
  const unit = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) unit[i] = values[i] / norm;
  return unit;
}

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

// ---------------------------------------------------------------------------
// 2. Sound families

function soundFamily(labels: string[]): string {
  return SOUND_FAMILIES.find(([, pattern]) => labels.some((l) => pattern.test(l)))?.[0] ?? OTHER_FAMILY;
}

// ---------------------------------------------------------------------------
// 3. Clips

function toClip(row: Row): Clip {
  const m = row.metadata;
  const peaks = row.waveform_peaks?.map((p) => round(p, 3)) ?? null;
  const base = { id: row.id, source: row.source, durationSeconds: round(row.duration_seconds, 2), waveformPeaks: peaks };
  if (row.source === "librispeech") {
    const speaker = m.speaker as { id: string; sex: string | null; name: string | null };
    const chapter = m.chapter as { id: string; bookTitle: string | null };
    return {
      ...base,
      text: m.transcript as string,
      bookTitle: chapter.bookTitle ?? undefined,
      chapterId: chapter.id,
      speakerId: speaker.id,
      speakerName: speaker.name ?? undefined,
      sex: speaker.sex === "F" || speaker.sex === "M" ? speaker.sex : undefined,
    };
  }
  if (row.source === "audiocaps") {
    const captions = m.captions as string[];
    const labels = (m.audioSetLabels as string[] | undefined) ?? [];
    return {
      ...base,
      text: captions[0],
      captions,
      ...(labels.length > 0 && {
        soundLabels: labels,
        soundFamily: soundFamily(labels),
        hasSpeech: labels.includes("Speech"),
      }),
      youtubeId: m.youtubeId as string,
      startTime: m.startTime as number,
    };
  }
  // Common Voice: the speaker's clientId stays out on purpose (one clip per speaker, no id needed).
  const speaker = m.speaker as { age: string | null; gender: string | null; accent: string | null };
  return {
    ...base,
    text: m.transcript as string,
    gender: speaker.gender ?? undefined,
    age: speaker.age ?? undefined,
    accent: speaker.accent ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// 4. Neighbours

/** Full cosine similarity matrix (unit vectors), row-major. */
function similarityMatrix(vectors: Float32Array[]): Float32Array {
  const n = vectors.length;
  const matrix = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    matrix[i * n + i] = 1;
    for (let j = i + 1; j < n; j++) {
      const s = dot(vectors[i], vectors[j]);
      matrix[i * n + j] = s;
      matrix[j * n + i] = s;
    }
  }
  return matrix;
}

/** Top-k most similar indices to `i` among `pool` (excluding `i`), best first. */
function topK(matrix: Float32Array, n: number, i: number, k: number, pool?: number[]): number[] {
  const best: [number, number][] = [];
  const consider = (j: number) => {
    if (j === i) return;
    const s = matrix[i * n + j];
    if (best.length === k && s <= best[k - 1][0]) return;
    let at = best.length;
    while (at > 0 && best[at - 1][0] < s) at--;
    best.splice(at, 0, [s, j]);
    if (best.length > k) best.pop();
  };
  if (pool) for (const j of pool) consider(j);
  else for (let j = 0; j < n; j++) consider(j);
  return best.map(([, j]) => j);
}

type NeighborStats = ReturnType<typeof neighborStats>;

function neighborStats(clips: Clip[], matrix: Float32Array) {
  const n = clips.length;
  const all = clips.map((_, i) => i);
  const bySource = (s: Source) => all.filter((i) => clips[i].source === s);
  const ls = bySource("librispeech");
  const cv = bySource("commonvoice").filter((i) => clips[i].gender);

  // Dataset purity over the full catalog.
  const same: Record<Source, [number, number]> = { librispeech: [0, 0], audiocaps: [0, 0], commonvoice: [0, 0] };
  const speech: Record<Source, [number, number]> = { librispeech: [0, 0], audiocaps: [0, 0], commonvoice: [0, 0] };
  // Clips whose neighbours are mostly (≥ half) of the other kind: sounds for a speech clip, speech for a sound.
  const crossover: Record<Source, number> = { librispeech: 0, audiocaps: 0, commonvoice: 0 };
  for (let i = 0; i < n; i++) {
    const s = clips[i].source;
    let otherKind = 0;
    for (const j of topK(matrix, n, i, NEIGHBORS)) {
      same[s][0] += +(clips[j].source === s);
      same[s][1]++;
      speech[s][0] += +SPEECH.has(clips[j].source);
      speech[s][1]++;
      otherKind += +(SPEECH.has(clips[j].source) !== SPEECH.has(s));
    }
    if (otherKind * 2 >= NEIGHBORS) crossover[s]++;
  }
  const speechClips = SOURCES.filter((s) => SPEECH.has(s)).reduce<[number, number]>(
    ([a, b], s) => [a + speech[s][0], b + speech[s][1]],
    [0, 0],
  );

  // LibriSpeech among LibriSpeech.
  let sameSpeaker = 0, sameChapter = 0, sameSpeakerOtherChapter = 0, lsTotal = 0;
  for (const i of ls) {
    for (const j of topK(matrix, n, i, NEIGHBORS, ls)) {
      const a = clips[i], b = clips[j];
      sameSpeaker += +(a.speakerId === b.speakerId);
      sameChapter += +(a.chapterId === b.chapterId);
      sameSpeakerOtherChapter += +(a.speakerId === b.speakerId && a.chapterId !== b.chapterId);
      lsTotal++;
    }
  }

  // Same sex among neighbours read by OTHER speakers (pool: LibriSpeech minus the clip's speaker).
  let sameSex = 0, sexTotal = 0;
  for (const i of ls) {
    const pool = ls.filter((j) => clips[j].speakerId !== clips[i].speakerId);
    for (const j of topK(matrix, n, i, NEIGHBORS, pool)) {
      sameSex += +(clips[j].sex === clips[i].sex);
      sexTotal++;
    }
  }

  // Common Voice same gender (pool: Common Voice clips with a gender).
  let sameGender = 0, genderTotal = 0;
  for (const i of cv) {
    for (const j of topK(matrix, n, i, NEIGHBORS, cv)) {
      sameGender += +(clips[j].gender === clips[i].gender);
      genderTotal++;
    }
  }

  return {
    sameDatasetPercent: Object.fromEntries(SOURCES.map((s) => [s, percent(...same[s])])) as Record<Source, number>,
    speechNeighborsPercent: {
      note: "Share of neighbours that are speech clips (LibriSpeech or Common Voice).",
      ofSpeechClips: percent(...speechClips),
      ...(Object.fromEntries(SOURCES.map((s) => [s, percent(...speech[s])])) as Record<Source, number>),
    },
    clipsWithMostlyOtherKindNeighbors: {
      note: "Clips with at least half of their neighbours of the other kind (sound clips for speech, speech clips for sounds).",
      ...crossover,
    },
    librispeech: {
      pool: "LibriSpeech",
      sameSpeakerPercent: percent(sameSpeaker, lsTotal),
      sameChapterPercent: percent(sameChapter, lsTotal),
      sameSpeakerOtherChapterPercent: percent(sameSpeakerOtherChapter, lsTotal),
      sameSexAmongOtherSpeakersPercent: percent(sameSex, sexTotal),
    },
    commonvoice: { pool: "Common Voice", sameGenderPercent: percent(sameGender, genderTotal) },
  };
}

// ---------------------------------------------------------------------------
// 5. UMAP

/** Deterministic PRNG (mulberry32), so the maps are the same on every run. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cosineDistance = (a: number[], b: number[]) => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return 1 - sum;
};

type Point = { x: number; y: number };
type ProjectedMap = { points: Point[]; place: (vector: Float32Array) => Point };

/**
 * Fits UMAP on unit vectors with the exact cosine kNN, then scales the result
 * into [0, 1] keeping its aspect ratio (the shorter axis is centred).
 */
function project(vectors: Float32Array[], matrix: Float32Array): ProjectedMap {
  const n = vectors.length;
  const k = UMAP_PARAMS.nNeighbors;
  const knnIndices: number[][] = [];
  const knnDistances: number[][] = [];
  for (let i = 0; i < n; i++) {
    // UMAP's kNN includes the point itself, at distance 0.
    const nearest = [i, ...topK(matrix, n, i, k - 1)];
    knnIndices.push(nearest);
    knnDistances.push(nearest.map((j) => Math.max(0, 1 - matrix[i * n + j])));
  }
  const umap = new UMAP({
    nComponents: 2,
    nNeighbors: k,
    minDist: UMAP_PARAMS.minDist,
    distanceFn: cosineDistance,
    random: seededRandom(UMAP_PARAMS.seed),
    // `transform` seeds its neighbour search with `nNeighbors × transformQueueSize` random
    // points. Covering every point makes it an exact search: a query is far from every
    // clip (cosine ~0.5), and the approximate graph search alone can stop in the wrong region.
    transformQueueSize: Math.ceil(n / k),
  });
  umap.setPrecomputedKNN(knnIndices, knnDistances);
  const raw = umap.fit(vectors.map((v) => Array.from(v)));

  const xs = raw.map((p) => p[0]);
  const ys = raw.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.max(maxX - minX, maxY - minY);
  const offsetX = (1 - (maxX - minX) / scale) / 2;
  const offsetY = (1 - (maxY - minY) / scale) / 2;
  const toPoint = ([x, y]: number[]): Point => ({
    x: round(offsetX + (x - minX) / scale, 4),
    y: round(offsetY + (y - minY) / scale, 4),
  });
  return {
    points: raw.map(toPoint),
    place: (vector) => toPoint(umap.transform([Array.from(vector)])[0]),
  };
}

/** Mean 2D distance between clips of the same dataset vs of different datasets, per pair of datasets. */
function mapSeparation(clips: Clip[], points: Point[]) {
  const sums = new Map<string, [number, number]>();
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const key = [clips[i].source, clips[j].source].sort().join("↔");
      const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
      const entry = sums.get(key) ?? [0, 0];
      entry[0] += d;
      entry[1]++;
      sums.set(key, entry);
    }
  }
  const meanDistance = Object.fromEntries([...sums].sort().map(([key, [sum, count]]) => [key, round(sum / count, 4)]));
  // Share of a clip's 10 nearest neighbours IN 2D that come from its own dataset.
  const sameDataset2d: Record<string, [number, number]> = {};
  for (let i = 0; i < points.length; i++) {
    const nearest = points
      .map((p, j) => [Math.hypot(p.x - points[i].x, p.y - points[i].y), j] as const)
      .filter(([, j]) => j !== i)
      .sort((a, b) => a[0] - b[0])
      .slice(0, NEIGHBORS);
    const entry = (sameDataset2d[clips[i].source] ??= [0, 0]);
    entry[0] += nearest.filter(([, j]) => clips[j].source === clips[i].source).length;
    entry[1] += NEIGHBORS;
  }
  return {
    meanDistance,
    sameDataset2dNeighborsPercent: Object.fromEntries(
      Object.entries(sameDataset2d).map(([s, [a, b]]) => [s, percent(a, b)]),
    ),
  };
}

/**
 * Share of a clip's 10 nearest neighbours (among `pool`, the clip excluded) with the
 * same `key`, in the 768-d space and on each 2D map, next to the chance level.
 * `otherSpeakersOnly` leaves the clip's own speaker out of its pool.
 */
function groupAgreement(
  pool: number[],
  key: (clip: Clip) => string | undefined,
  matrices: { audio: Float32Array; text: Float32Array },
  maps: { audio: Point[]; text: Point[] },
  otherSpeakersOnly = false,
) {
  const members = pool.filter((i) => key(clips[i]) !== undefined);
  const poolOf = (i: number) =>
    otherSpeakersOnly ? members.filter((j) => clips[j].speakerId !== clips[i].speakerId) : members;
  const agree = (nearest: (i: number, pool: number[]) => number[]) => {
    let same = 0, total = 0;
    for (const i of members) {
      for (const j of nearest(i, poolOf(i))) {
        same += +(key(clips[j]) === key(clips[i]));
        total++;
      }
    }
    return percent(same, total);
  };
  const nearest2d = (points: Point[]) => (i: number, pool: number[]) =>
    pool
      .filter((j) => j !== i)
      .map((j) => [Math.hypot(points[j].x - points[i].x, points[j].y - points[i].y), j] as const)
      .sort((a, b) => a[0] - b[0])
      .slice(0, NEIGHBORS)
      .map(([, j]) => j);
  const sizes = Object.values(count(members.map((i) => key(clips[i]))));
  return {
    clips: members.length,
    groups: sizes.length,
    chancePercent: round(sizes.reduce((sum, size) => sum + (size / members.length) ** 2, 0) * 100, 1),
    audio768d: agree((i, pool) => topK(matrices.audio, n, i, NEIGHBORS, pool)),
    text768d: agree((i, pool) => topK(matrices.text, n, i, NEIGHBORS, pool)),
    audioMap2d: agree(nearest2d(maps.audio)),
    textMap2d: agree(nearest2d(maps.text)),
  };
}

function count<T>(values: (T | undefined)[]): Record<string, number> {
  const counts = new Map<T, number>();
  for (const v of values) if (v !== undefined) counts.set(v, (counts.get(v) ?? 0) + 1);
  return Object.fromEntries([...counts].sort((a, b) => b[1] - a[1]));
}

function centroids(points: Point[], groups: (string | undefined)[]) {
  const sums = new Map<string, [number, number, number]>();
  groups.forEach((group, i) => {
    if (!group) return;
    const entry = sums.get(group) ?? [0, 0, 0];
    entry[0] += points[i].x;
    entry[1] += points[i].y;
    entry[2]++;
    sums.set(group, entry);
  });
  return Object.fromEntries(
    [...sums].map(([group, [x, y, count]]) => [group, { x: round(x / count, 4), y: round(y / count, 4), count }]),
  );
}

// ---------------------------------------------------------------------------
// 6. Queries

function quantile(sorted: number[], q: number): number {
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

type Distribution = {
  p10: number;
  p50: number;
  p90: number;
  histogram: { binStart: number; binEnd: number; count: number }[];
};

/** Both distributions share one set of bins, so they can be overlaid. */
function distributions(text: number[], audio: number[]): { text: Distribution; audio: Distribution } {
  const all = [...text, ...audio];
  const lo = Math.floor(Math.min(...all) * 20) / 20;
  const hi = Math.ceil(Math.max(...all) * 20) / 20;
  const width = (hi - lo) / HISTOGRAM_BINS;
  const describe = (values: number[]): Distribution => {
    const sorted = [...values].sort((a, b) => a - b);
    const counts = new Array<number>(HISTOGRAM_BINS).fill(0);
    for (const v of values) counts[Math.min(HISTOGRAM_BINS - 1, Math.floor((v - lo) / width))]++;
    return {
      p10: round(quantile(sorted, 0.1), 3),
      p50: round(quantile(sorted, 0.5), 3),
      p90: round(quantile(sorted, 0.9), 3),
      histogram: counts.map((count, b) => ({
        binStart: round(lo + b * width, 4),
        binEnd: round(lo + (b + 1) * width, 4),
        count,
      })),
    };
  };
  return { text: describe(text), audio: describe(audio) };
}

type SearchResult = { id: string; score: number; matches: ("text" | "sound")[] };

async function search(query: string): Promise<SearchResult[]> {
  const url = `${SEARCH_API}?${new URLSearchParams({ q: query, limit: String(NEIGHBORS) })}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url}: ${response.status}`);
  const { data } = (await response.json()) as { data: SearchResult[] };
  return data.map(({ id, score, matches }) => ({ id, score: round(score, 3), matches }));
}

// ---------------------------------------------------------------------------
// Main

const rows = await readCatalog();
const models = new Set(rows.map((r) => r.embedding_model));
if (models.size !== 1 || !models.has(EMBEDDING_MODEL)) {
  throw new Error(`Expected every vector from ${EMBEDDING_MODEL}, found ${[...models].join(", ")}`);
}
console.log(`${rows.length} clips read`);

const clips = rows.map(toClip);
const audioVectors = rows.map((r) => toUnitVector(r.audio_embedding));
const textVectors = rows.map((r) => toUnitVector(r.text_embedding));
const n = clips.length;

const unlabelled = clips.filter((c) => c.source === "audiocaps" && !c.soundLabels).length;
if (unlabelled > 0) {
  console.warn(`${unlabelled} AudioCaps clips have no AudioSet labels (run \`pnpm import-audioset-labels\`)`);
}

console.log("Similarities…");
const audioMatrix = similarityMatrix(audioVectors);
const textMatrix = similarityMatrix(textVectors);
const neighbors = clips.map((_, i) =>
  topK(audioMatrix, n, i, NEIGHBORS).map((j) => ({ id: clips[j].id, similarity: round(audioMatrix[i * n + j], 3) })),
);
const stats: Record<"audio" | "text", NeighborStats> = {
  audio: neighborStats(clips, audioMatrix),
  text: neighborStats(clips, textMatrix),
};

console.log("UMAP (audio)…");
const audioMap = project(audioVectors, audioMatrix);
console.log("UMAP (text)…");
const textMap = project(textVectors, textMatrix);

console.log("Queries…");
const { embeddings } = await embedMany({
  model: EMBEDDING_MODEL,
  values: QUERIES.flatMap((q) => [toTextQuery(q), toSoundQuery(q)]),
  dimensions: EMBEDDING_DIMENSIONS,
});
type Query = {
  query: string;
  audioMap: Point;
  textMap: Point;
  results: SearchResult[];
  similarity: { text: Distribution; audio: Distribution };
};
const queries: Query[] = [];
for (const [q, query] of QUERIES.entries()) {
  const textQuery = normalize(embeddings[2 * q]);
  const soundQuery = normalize(embeddings[2 * q + 1]);
  queries.push({
    query,
    audioMap: audioMap.place(soundQuery),
    textMap: textMap.place(textQuery),
    results: await search(query),
    similarity: distributions(
      textVectors.map((v) => dot(textQuery, v)),
      audioVectors.map((v) => dot(soundQuery, v)),
    ),
  });
}

// ---------------------------------------------------------------------------
// Summary

const of = (s: Source) => clips.filter((c) => c.source === s);
const ls = of("librispeech");
const ac = of("audiocaps");
const cv = of("commonvoice");
const speakers = new Map(ls.map((c) => [c.speakerId, c.sex]));
const indicesOf = (s: Source) => clips.flatMap((c, i) => (c.source === s ? [i] : []));
const matrices = { audio: audioMatrix, text: textMatrix };
const maps2d = { audio: audioMap.points, text: textMap.points };
const agreement = (pool: number[], key: (clip: Clip) => string | undefined, otherSpeakersOnly = false) =>
  groupAgreement(pool, key, matrices, maps2d, otherSpeakersOnly);
/** Share of an AudioCaps clip's neighbours (full catalog, audio vectors) that are speech clips. */
const speechNeighbors = (withSpeech: boolean) => {
  const members = indicesOf("audiocaps").filter((i) => clips[i].hasSpeech === withSpeech);
  let speech = 0;
  for (const i of members) speech += topK(audioMatrix, n, i, NEIGHBORS).filter((j) => SPEECH.has(clips[j].source)).length;
  return { clips: members.length, speechNeighborsPercent: percent(speech, members.length * NEIGHBORS) };
};
const pooled = (signal: "text" | "audio", p: "p10" | "p50" | "p90") =>
  round(queries.reduce((sum, q) => sum + q.similarity[signal][p], 0) / queries.length, 3);

const summary = {
  generatedAt: new Date().toISOString(),
  model: EMBEDDING_MODEL,
  dimensions: EMBEDDING_DIMENSIONS,
  umap: UMAP_PARAMS,
  clips: {
    total: n,
    librispeech: ls.length,
    audiocaps: ac.length,
    commonvoice: cv.length,
    totalDurationHours: round(clips.reduce((sum, c) => sum + c.durationSeconds, 0) / 3600, 2),
  },
  librispeech: {
    speakers: speakers.size,
    speakersBySex: count([...speakers.values()]),
    chapters: new Set(ls.map((c) => c.chapterId)).size,
    books: new Set(ls.map((c) => c.bookTitle)).size,
  },
  audiocaps: {
    labelled: ac.filter((c) => c.soundLabels).length,
    withSpeech: ac.filter((c) => c.hasSpeech).length,
    withMusic: ac.filter((c) => c.soundLabels?.some((l) => /music/i.test(l))).length,
    soundFamilies: count(ac.map((c) => c.soundFamily)),
    soundFamilyRule:
      "First family, in this order, with a label matching its pattern (case-insensitive): " +
      SOUND_FAMILIES.map(([name, pattern]) => `${name} /${pattern.source}/`).join("; ") +
      `; anything else is ${OTHER_FAMILY}.`,
    topLabels: Object.fromEntries(Object.entries(count(ac.flatMap((c) => c.soundLabels ?? []))).slice(0, 25)),
  },
  commonvoice: {
    speakers: cv.length,
    byGender: count(cv.map((c) => c.gender)),
    byAge: count(cv.map((c) => c.age)),
    accents: new Set(cv.map((c) => c.accent).filter(Boolean)).size,
    genderChancePercent: round(
      Object.values(count(cv.map((c) => c.gender))).reduce((sum, k) => sum + (k / cv.length) ** 2, 0) * 100,
      1,
    ),
  },
  neighbors: {
    k: NEIGHBORS,
    note: "Exact cosine nearest neighbours in the 768-d space, the clip itself excluded.",
    audio: stats.audio,
    text: stats.text,
  },
  groupAgreement: {
    note:
      "Share of a clip's 10 nearest neighbours, among clips of the same dataset (the pool), that share the " +
      "group: in the 768-d space (exact cosine) and on each 2D map (Euclidean), next to chance (Σ share²).",
    audiocapsSoundFamily: agreement(indicesOf("audiocaps"), (c) => c.soundFamily),
    librispeechBook: agreement(indicesOf("librispeech"), (c) => c.bookTitle),
    librispeechChapter: agreement(indicesOf("librispeech"), (c) => c.chapterId),
    librispeechSpeaker: agreement(indicesOf("librispeech"), (c) => c.speakerId),
    librispeechSex: agreement(indicesOf("librispeech"), (c) => c.sex),
    librispeechSexOtherSpeakers: agreement(indicesOf("librispeech"), (c) => c.sex, true),
    commonvoiceGender: agreement(indicesOf("commonvoice"), (c) => c.gender),
    commonvoiceAccent: agreement(indicesOf("commonvoice"), (c) => c.accent),
    audiocapsHasSpeech: {
      note: "AudioCaps clips with and without a Speech label: share of their 10 nearest audio neighbours (full catalog) that are speech clips.",
      withSpeech: speechNeighbors(true),
      withoutSpeech: speechNeighbors(false),
    },
  },
  maps: {
    note:
      "How much of the 768-d structure the 2D maps keep: mean distance between clips of each pair of " +
      "datasets (coordinates in [0, 1]), and the share of a clip's 10 nearest neighbours in 2D from its own dataset.",
    audio: {
      ...mapSeparation(clips, audioMap.points),
      soundFamilyCentroids: centroids(audioMap.points, clips.map((c) => c.soundFamily)),
      datasetCentroids: centroids(audioMap.points, clips.map((c) => c.source)),
    },
    text: {
      ...mapSeparation(clips, textMap.points),
      soundFamilyCentroids: centroids(textMap.points, clips.map((c) => c.soundFamily)),
      datasetCentroids: centroids(textMap.points, clips.map((c) => c.source)),
    },
  },
  exampleQueries: {
    note: "Query similarity against every clip, averaged over the 5 example queries (see queries.json).",
    text: { p10: pooled("text", "p10"), p50: pooled("text", "p50"), p90: pooled("text", "p90") },
    audio: { p10: pooled("audio", "p10"), p50: pooled("audio", "p50"), p90: pooled("audio", "p90") },
  },
  fromEvaluation: FROM_EVALUATION,
};

// No audio, Blob paths or Common Voice contributor ids in the output.
const points = clips.map((c, i) => ({
  id: c.id,
  source: c.source,
  text: c.text,
  captions: c.captions,
  durationSeconds: c.durationSeconds,
  waveformPeaks: c.waveformPeaks,
  audio: audioMap.points[i],
  textEmb: textMap.points[i],
  soundFamily: c.soundFamily,
  soundLabels: c.soundLabels,
  hasSpeech: c.hasSpeech,
  bookTitle: c.bookTitle,
  chapterId: c.chapterId,
  speakerId: c.speakerId,
  speakerName: c.speakerName,
  sex: c.sex,
  gender: c.gender,
  age: c.age,
  accent: c.accent,
  neighbors: neighbors[i],
}));
const pointsFile = {
  generatedAt: summary.generatedAt,
  model: EMBEDDING_MODEL,
  umap: UMAP_PARAMS,
  points,
};

// queries.json and summary.json are small and always pretty-printed; points.json only
// while the three files stay under ~5 MB in total.
const pretty = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const files = { "queries.json": pretty({ queries }), "summary.json": pretty(summary) };
const prettyPoints = pretty(pointsFile);
const prettyTotal = prettyPoints.length + files["queries.json"].length + files["summary.json"].length;
const pointsJson = prettyTotal < 5e6 ? prettyPoints : `${JSON.stringify(pointsFile)}\n`;
await mkdir(OUT, { recursive: true });
for (const [name, text] of Object.entries({ "points.json": pointsJson, ...files })) {
  await writeFile(new URL(name, OUT), text);
  console.log(`design/embedding-map/${name}: ${(Buffer.byteLength(text) / 1e6).toFixed(2)} MB`);
}
