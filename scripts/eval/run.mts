/**
 * Retrieval evaluation of the search: runs every query set of eval/queries.json
 * through the production ranking and its variants, and writes eval/results.json
 * and eval/report.md.
 *
 *   pnpm eval              # everything, including the live API checks
 *   pnpm eval --skip-live  # offline: no requests to the deployed API
 *
 * How it stays faithful and safe:
 *  - READ-ONLY. It reads the stored vectors once (read-only transactions) and
 *    ranks in memory, so ranking variants can be tried without touching the
 *    production database. Full-text matching uses Postgres itself (read-only), so
 *    it is the same parser and stemmer as production.
 *  - PARITY. The in-memory ranking re-implements src/server/audios/repository.ts.
 *    The run compares it with the live /api/v1/search and /similar and fails
 *    when they disagree, so the numbers describe what users get.
 *  - NO LEAKAGE. A caption query's own caption is removed from its clip's text
 *    vector and full-text index for that query (the clip is re-embedded from its
 *    other captions).
 *  - Query embeddings are cached in .eval-cache/ (gitignored); a fresh checkout
 *    recomputes them (about $0.02 of AI Gateway credit).
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";

import { neon } from "@neondatabase/serverless";
import { embed, embedMany } from "ai";

import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  toAudioInput,
  toSoundQuery,
  toTextDocument,
  toTextQuery,
} from "../../src/server/search/embedding-config.ts";
import {
  EXACT_PHRASE_BONUS,
  EXACT_WORDS_BONUS,
  MIN_SHARE_OF_BEST,
  MIN_TYPED_SOUND_Z_SCORE,
  MIN_Z_SCORE,
  STRONG_MATCH_SCORE,
} from "../../src/server/search/ranking-config.ts";
import {
  bootstrapDifference,
  bootstrapMean,
  firstRelevantRank,
  type Interval,
  mean,
  METRIC_NAMES,
  percentile,
  type QueryMetrics,
  rocAuc,
  scoreQuery,
} from "./metrics.mts";
import type { EvalQuery, QueryFile } from "./types.mts";

const LIMIT = 50; // the API's default `limit`
const ROOT = new URL("../../", import.meta.url);
const CACHE_DIR = new URL(".eval-cache/", ROOT);
const API = process.env.EVAL_API_URL ?? "https://david-ai-audio-search.vercel.app";
const SKIP_LIVE = process.argv.includes("--skip-live");
const LIVE_GAP_MS = 700; // stays under the API's 120 requests/minute per IP

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set. Run with --env-file=.env.local");
const sql = neon(process.env.DATABASE_URL);
const log = (...args: unknown[]) => console.log(`[eval ${new Date().toISOString().slice(11, 19)}]`, ...args);

// ---------------------------------------------------------------------------
// Catalog: every clip's vectors, read once.
// ---------------------------------------------------------------------------

type Clip = { id: string; source: string; snippet: string; text: Float32Array; audio: Float32Array };

function unit(values: ArrayLike<number>): Float32Array {
  const v = Float32Array.from(values);
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

async function loadCatalog(): Promise<Clip[]> {
  const clips: Clip[] = [];
  for (let offset = 0; ; offset += 200) {
    const [rows] = (await sql.transaction(
      [
        sql`SELECT id, source, text_embedding::text AS t, audio_embedding::text AS a,
                   coalesce(metadata->>'transcript', metadata->'captions'->>0) AS snippet
            FROM audios ORDER BY id LIMIT 200 OFFSET ${offset}`,
      ],
      { readOnly: true },
    )) as { id: string; source: string; t: string | null; a: string | null; snippet: string }[][];
    for (const r of rows) {
      if (!r.t || !r.a) throw new Error(`Clip ${r.id} has no vector: run pnpm embed-catalog first`);
      clips.push({ id: r.id, source: r.source, snippet: r.snippet, text: unit(JSON.parse(r.t)), audio: unit(JSON.parse(r.a)) });
    }
    if (rows.length < 200) break;
  }
  return clips;
}

// ---------------------------------------------------------------------------
// Embeddings, cached on disk by (model, size, input).
// ---------------------------------------------------------------------------

const embeddingCacheFile = new URL("embeddings.jsonl", CACHE_DIR);
const embeddingCache = new Map<string, Float32Array>();
let embeddingTokensSpent = 0;

const cacheKey = (value: string) => createHash("sha1").update(`${EMBEDDING_MODEL}|${EMBEDDING_DIMENSIONS}|${value}`).digest("hex");

async function loadEmbeddingCache() {
  await mkdir(CACHE_DIR, { recursive: true });
  if (!existsSync(embeddingCacheFile)) return;
  for (const line of (await readFile(embeddingCacheFile, "utf8")).split("\n")) {
    if (!line) continue;
    const { k, v } = JSON.parse(line) as { k: string; v: number[] };
    embeddingCache.set(k, unit(v));
  }
}

async function embedTexts(values: string[]): Promise<void> {
  const missing = [...new Set(values)].filter((v) => !embeddingCache.has(cacheKey(v)));
  log(`embedding ${missing.length} new texts (${new Set(values).size - missing.length} cached)`);
  for (let start = 0; start < missing.length; start += 200) {
    const chunk = missing.slice(start, start + 200);
    const { embeddings, usage } = await embedMany({
      model: EMBEDDING_MODEL,
      values: chunk,
      dimensions: EMBEDDING_DIMENSIONS,
      maxParallelCalls: 4,
      maxRetries: 5,
    });
    embeddingTokensSpent += usage.tokens;
    const lines = chunk.map((value, i) => {
      embeddingCache.set(cacheKey(value), unit(embeddings[i]));
      return JSON.stringify({ k: cacheKey(value), v: embeddings[i] });
    });
    await appendFile(embeddingCacheFile, `${lines.join("\n")}\n`);
  }
}

const vectorOf = (value: string) => {
  const v = embeddingCache.get(cacheKey(value));
  if (!v) throw new Error(`Not embedded: ${value.slice(0, 60)}`);
  return v;
};

/** The text a clip is indexed by, as scripts/embed-catalog.mts builds it. */
const heldOutDocument = (captions: string[]) => toTextDocument(captions.join(". "));

// ---------------------------------------------------------------------------
// Full-text matching, in Postgres (same `english` parser as production).
// ---------------------------------------------------------------------------

type FullText = {
  /** Clips whose text contains every word: production's `has_words`. */
  allWords: Set<string>;
  /** ts_rank of the clips that contain any word, for the keyword baselines. */
  rankAny: Map<string, number>;
  rankAll: Map<string, number>;
  /** Clips whose text contains the query as typed, words in a row: production's `has_phrase`. */
  phrase: Set<string>;
};

async function fullText(query: Extract<EvalQuery, { kind: "text" }>): Promise<FullText> {
  const statements = [
    sql`
      WITH q AS (
        SELECT websearch_to_tsquery('english', ${query.text}) AS words,
               replace(plainto_tsquery('english', ${query.text})::text, '&', '|')::tsquery AS any_word
      )
      SELECT id, search_text @@ q.words AS all_words,
             ts_rank(search_text, q.any_word)::float8 AS rank_any,
             ts_rank(search_text, q.words)::float8 AS rank_all
      FROM audios CROSS JOIN q
      WHERE search_text @@ q.any_word
    `,
  ];
  if (query.heldOut) {
    // The clip's index without the held-out caption (`metadata->>'captions'` is JSON text).
    const doc = JSON.stringify(query.heldOut.captions);
    statements.push(sql`
      WITH q AS (
        SELECT websearch_to_tsquery('english', ${query.text}) AS words,
               replace(plainto_tsquery('english', ${query.text})::text, '&', '|')::tsquery AS any_word,
               to_tsvector('english', ${doc}) AS doc
      )
      SELECT doc @@ words AS all_words, doc @@ any_word AS any_words,
             ts_rank(doc, any_word)::float8 AS rank_any, ts_rank(doc, words)::float8 AS rank_all
      FROM q
    `);
  }
  const [rows, held] = (await sql.transaction(statements, { readOnly: true })) as Record<string, unknown>[][];
  const result: FullText = { allWords: new Set(), rankAny: new Map(), rankAll: new Map(), phrase: new Set() };
  for (const r of rows) {
    const id = r.id as string;
    if (query.heldOut && id === query.heldOut.id) continue;
    if (r.all_words) {
      result.allWords.add(id);
      result.rankAll.set(id, r.rank_all as number);
    }
    result.rankAny.set(id, r.rank_any as number);
  }
  if (query.heldOut && held?.[0]) {
    const h = held[0];
    if (h.all_words) {
      result.allWords.add(query.heldOut.id);
      result.rankAll.set(query.heldOut.id, h.rank_all as number);
    }
    if (h.any_words) result.rankAny.set(query.heldOut.id, h.rank_any as number);
  }
  return result;
}

/**
 * The clips whose text contains the query as typed (production's `has_phrase`):
 * the `simple` parser, no stemming or stop words, words in a row, on the same
 * per-clip document as the Words filter. None when the query excludes a word (`-dog`). A caption query's own caption is left out.
 */
async function phraseMatches(query: Extract<EvalQuery, { kind: "text" }>): Promise<string[]> {
  const statements = [
    sql`
      WITH q AS (
        SELECT CASE WHEN websearch_to_tsquery('simple', ${query.text})::text LIKE '%!%'
                 THEN ''::tsquery
                 ELSE phraseto_tsquery('simple', ${query.text})
               END AS phrase
      )
      SELECT id FROM audios CROSS JOIN q
      WHERE numnode(q.phrase) > 0
        AND coalesce(to_tsvector('simple', metadata->>'transcript'), to_tsvector('simple', metadata->'captions')) @@ q.phrase
    `,
  ];
  if (query.heldOut) {
    statements.push(sql`
      SELECT websearch_to_tsquery('simple', ${query.text})::text NOT LIKE '%!%'
             AND to_tsvector('simple', ${JSON.stringify(query.heldOut.captions)}::jsonb) @@ phraseto_tsquery('simple', ${query.text}) AS phrase
    `);
  }
  const [rows, held] = (await sql.transaction(statements, { readOnly: true })) as Record<string, unknown>[][];
  const ids = rows.map((r) => r.id as string).filter((id) => id !== query.heldOut?.id);
  if (query.heldOut && held?.[0]?.phrase) ids.push(query.heldOut.id);
  return ids;
}

async function mapLimit<T, R>(items: readonly T[], concurrency: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    }),
  );
  return results;
}

// ---------------------------------------------------------------------------
// Ranking: production and its variants.
// ---------------------------------------------------------------------------

type Signals = {
  /** Cosine similarity of each clip to the text-formatted query (null: signal off). */
  text: Float64Array | null;
  sound: Float64Array | null;
  fullText: FullText;
};

function zScores(values: Float64Array): Float64Array {
  const n = values.length;
  let sum = 0;
  for (const v of values) sum += v;
  const avg = sum / n;
  let sq = 0;
  for (const v of values) sq += (v - avg) ** 2;
  const sd = Math.sqrt(sq / (n - 1)); // stddev_samp
  return values.map((v) => (sd === 0 ? 0 : (v - avg) / sd));
}

type Hit = { index: number; score: number; text: boolean; sound: boolean };

function byScore(clips: Clip[]) {
  return (a: Hit, b: Hit) => b.score - a.score || (clips[a.index].id < clips[b.index].id ? -1 : 1);
}

type RankOptions = {
  minZ?: number;
  /** The sound cut-off next to the text signal: production uses MIN_TYPED_SOUND_Z_SCORE for typed queries. */
  soundMinZ?: number;
  bonus?: number;
  phraseBonus?: number;
  /** Results below this share of the best score are dropped (0: off). */
  shareOfBest?: number;
  limit?: number;
};

/** The ranking before the relative cut-off, stricter typed-sound cut-off and phrase bonus. */
const PREVIOUS: RankOptions = { soundMinZ: MIN_Z_SCORE, phraseBonus: 0, shareOfBest: 0 };
/** Production scores with nothing cut. */
const NO_CUT_OFF: RankOptions = { minZ: -Infinity, soundMinZ: -Infinity, shareOfBest: 0 };

/**
 * Production ranking (repository.ts `searchAudios`): z-score per signal, a
 * clip's score is its best signal, signals below their cut-off count as no
 * match, clips whose text has every query word get `bonus` + max(text z, 0)
 * (+ `phraseBonus` when it has the query as typed), and results below
 * `shareOfBest` of the top score are dropped.
 */
function rankProduction(
  clips: Clip[],
  s: Signals,
  {
    minZ = MIN_Z_SCORE,
    soundMinZ = MIN_TYPED_SOUND_Z_SCORE,
    bonus = EXACT_WORDS_BONUS,
    phraseBonus = EXACT_PHRASE_BONUS,
    shareOfBest = MIN_SHARE_OF_BEST,
    limit = LIMIT,
  }: RankOptions = {},
): Hit[] {
  const tz = s.text ? zScores(s.text) : null;
  const sz = s.sound ? zScores(s.sound) : null;
  const hits: Hit[] = [];
  for (let i = 0; i < clips.length; i++) {
    let text = 0;
    if (tz) {
      const hasPhrase = bonus > 0 && s.fullText.phrase.has(clips[i].id);
      const hasWords = bonus > 0 && (hasPhrase || s.fullText.allWords.has(clips[i].id));
      text = hasWords ? bonus + (hasPhrase ? phraseBonus : 0) + Math.max(tz[i], 0) : tz[i] >= minZ ? tz[i] : 0;
    }
    // The stricter typed-sound cut-off applies next to the text signal (All), not to sound alone.
    const sound = sz && sz[i] >= (tz ? Math.max(minZ, soundMinZ) : minZ) ? sz[i] : 0;
    if (text > 0 || sound > 0) hits.push({ index: i, score: Math.max(text, sound), text: text > 0, sound: sound > 0 });
  }
  const best = hits.reduce((m, h) => Math.max(m, h.score), 0);
  return hits.filter((h) => h.score >= shareOfBest * best).sort(byScore(clips)).slice(0, limit);
}

/** A pure ranking with no cut-off: score every clip and keep the top `limit`. */
function rankBy(clips: Clip[], score: (i: number) => number, limit = LIMIT, include?: (i: number) => boolean): Hit[] {
  const hits: Hit[] = [];
  for (let i = 0; i < clips.length; i++) {
    if (include && !include(i)) continue;
    hits.push({ index: i, score: score(i), text: false, sound: false });
  }
  return hits.sort(byScore(clips)).slice(0, limit);
}

function ranks(values: Float64Array): Float64Array {
  const order = [...values.keys()].sort((a, b) => values[b] - values[a]);
  const r = new Float64Array(values.length);
  order.forEach((index, position) => (r[index] = position + 1));
  return r;
}

type SystemName = string;
type TextSystem = { name: SystemName; description: string; run: (clips: Clip[], s: Signals) => Hit[]; signals: "both" | "text" | "sound" };

const TEXT_SYSTEMS: TextSystem[] = [
  {
    name: "production",
    signals: "both",
    description: `Production (\`match=all\`): best of text and sound z-scores, cut at ${MIN_Z_SCORE} (typed sound at ${MIN_TYPED_SOUND_Z_SCORE}), exact-words bonus ${EXACT_WORDS_BONUS} (+${EXACT_PHRASE_BONUS} for the phrase), results under ${MIN_SHARE_OF_BEST} × the best dropped`,
    run: (c, s) => rankProduction(c, s),
  },
  { name: "production · text", signals: "text", description: "Production `match=text`", run: (c, s) => rankProduction(c, s) },
  { name: "production · sound", signals: "sound", description: "Production `match=sound` (audio vector only)", run: (c, s) => rankProduction(c, s) },
  { name: "previous production", signals: "both", description: "The ranking before this change: one cut-off z ≥ 3 for both signals, no phrase bonus, no relative cut-off", run: (c, s) => rankProduction(c, s, PREVIOUS) },
  { name: "previous · sound", signals: "sound", description: "Previous `match=sound`: audio vector, z ≥ 3, no relative cut-off", run: (c, s) => rankProduction(c, s, PREVIOUS) },
  { name: "no relative cut-off", signals: "both", description: "Production without the share-of-best cut-off", run: (c, s) => rankProduction(c, s, { shareOfBest: 0 }) },
  { name: "share of best 0.4", signals: "both", description: "Production, results under 0.4 × the best dropped", run: (c, s) => rankProduction(c, s, { shareOfBest: 0.4 }) },
  { name: "share of best 0.6", signals: "both", description: "Production, results under 0.6 × the best dropped", run: (c, s) => rankProduction(c, s, { shareOfBest: 0.6 }) },
  { name: "share of best 0.7", signals: "both", description: "Production, results under 0.7 × the best dropped", run: (c, s) => rankProduction(c, s, { shareOfBest: 0.7 }) },
  { name: "typed sound z ≥ 3", signals: "both", description: "Production with the typed-sound cut-off at 3, like text", run: (c, s) => rankProduction(c, s, { soundMinZ: 3 }) },
  { name: "typed sound z ≥ 3.5", signals: "both", description: "Production with the typed-sound cut-off at 3.5", run: (c, s) => rankProduction(c, s, { soundMinZ: 3.5 }) },
  { name: "no phrase bonus", signals: "both", description: "Production without the exact-phrase bonus", run: (c, s) => rankProduction(c, s, { phraseBonus: 0 }) },
  { name: "no cut-off", signals: "both", description: "Production scores with no cut-off at all (z or share of best)", run: (c, s) => rankProduction(c, s, NO_CUT_OFF) },
  { name: "no exact-words bonus", signals: "both", description: "Production without the full-text bonuses", run: (c, s) => rankProduction(c, s, { bonus: 0 }) },
  {
    name: "z-sum",
    signals: "both",
    description: "Sum of text and sound z-scores instead of the max (no cut-off)",
    run: (c, s) => {
      const t = zScores(s.text!), d = zScores(s.sound!);
      return rankBy(c, (i) => t[i] + d[i]);
    },
  },
  {
    name: "RRF",
    signals: "both",
    description: "Reciprocal rank fusion of the text and sound rankings, k = 60 (no cut-off)",
    run: (c, s) => {
      const t = ranks(s.text!), d = ranks(s.sound!);
      return rankBy(c, (i) => 1 / (60 + t[i]) + 1 / (60 + d[i]));
    },
  },
  {
    name: "raw cosine max",
    signals: "both",
    description: "Max of the raw cosine similarities, no normalisation (no cut-off)",
    run: (c, s) => rankBy(c, (i) => Math.max(s.text![i], s.sound![i])),
  },
  {
    name: "keyword (all words)",
    signals: "both",
    description: "Baseline: Postgres full-text search, every word required, ts_rank",
    run: (c, s) => rankBy(c, (i) => s.fullText.rankAll.get(c[i].id) ?? 0, LIMIT, (i) => s.fullText.rankAll.has(c[i].id)),
  },
  {
    name: "keyword (any word)",
    signals: "both",
    description: "Baseline: Postgres full-text search, any word, ts_rank",
    run: (c, s) => rankBy(c, (i) => s.fullText.rankAny.get(c[i].id) ?? 0, LIMIT, (i) => s.fullText.rankAny.has(c[i].id)),
  },
];

const THRESHOLDS = [0, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5];
const SHARES = [0, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];

// ---------------------------------------------------------------------------
// Live checks: parity with the deployed API, latency.
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function live(path: string, init?: RequestInit): Promise<{ ms: number; status: number; body: unknown }> {
  await sleep(LIVE_GAP_MS);
  const started = performance.now();
  const response = await fetch(`${API}${path}`, init);
  const body = response.headers.get("content-type")?.includes("json") ? await response.json() : await response.text();
  return { ms: performance.now() - started, status: response.status, body };
}

/** A 16 kHz mono 16-bit WAV: a chirp over noise, for timing the audio-search endpoint. */
function syntheticWav(seconds: number): Uint8Array<ArrayBuffer> {
  const rate = 16000, n = rate * seconds;
  const buffer = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buffer);
  const text = (offset: number, s: string) => [...s].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, 36 + n * 2, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, n * 2, true);
  let seed = 1;
  for (let i = 0; i < n; i++) {
    seed = (seed * 16807) % 2147483647;
    const t = i / rate;
    const sample = 0.4 * Math.sin(2 * Math.PI * (200 + 300 * t) * t) + 0.1 * (seed / 2147483647 - 0.5);
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 32767, true);
  }
  return new Uint8Array(buffer);
}

// ---------------------------------------------------------------------------
// Run.
// ---------------------------------------------------------------------------

const queryFile = JSON.parse(await readFile(new URL("eval/queries.json", ROOT), "utf8")) as QueryFile;
const queries = queryFile.queries;
const textQueries = queries.filter((q): q is Extract<EvalQuery, { kind: "text" }> => q.kind === "text");
const exampleQueries = queries.filter((q): q is Extract<EvalQuery, { kind: "example" }> => q.kind === "example");

log(`${queries.length} queries; loading catalog`);
const clips = await loadCatalog();
const indexOf = new Map(clips.map((c, i) => [c.id, i]));
log(`${clips.length} clips loaded`);

/** AudioSet sound labels (not speech or place), for judging caption failures. */
const NON_SOUND_LABEL = /speech|speaking|conversation|narration|babbling|^inside,|^outside,|silence/i;
const audiosetLabels = (JSON.parse(await readFile(new URL("eval/data/audioset-labels.json", ROOT), "utf8")) as { labels: Record<string, string[]> }).labels;
const soundLabels = (id: string) => new Set((audiosetLabels[id] ?? []).filter((l) => !NON_SOUND_LABEL.test(l)));
const shareSoundLabel = (a: string, b: string) => {
  const la = soundLabels(a);
  return [...soundLabels(b)].some((l) => la.has(l));
};

await loadEmbeddingCache();
await embedTexts([
  ...textQueries.flatMap((q) => [toTextQuery(q.text), toSoundQuery(q.text)]),
  ...textQueries.flatMap((q) => (q.heldOut ? [heldOutDocument(q.heldOut.captions)] : [])),
]);

const fullTextCacheFile = new URL("fulltext.json", CACHE_DIR);
const fullTextCache: Record<string, { allWords: string[]; rankAny: [string, number][]; rankAll: [string, number][] }> = existsSync(fullTextCacheFile)
  ? JSON.parse(await readFile(fullTextCacheFile, "utf8"))
  : {};
log("full-text matching in Postgres (read-only)");
const fullTexts = await mapLimit(textQueries, 8, async (q) => {
  const key = cacheKey(`${q.text}|${q.heldOut ? JSON.stringify(q.heldOut) : ""}`);
  const cached = fullTextCache[key];
  if (cached) return { allWords: new Set(cached.allWords), rankAny: new Map(cached.rankAny), rankAll: new Map(cached.rankAll), phrase: new Set<string>() };
  const ft = await fullText(q);
  fullTextCache[key] = { allWords: [...ft.allWords], rankAny: [...ft.rankAny], rankAll: [...ft.rankAll] };
  return ft;
});
await writeFile(fullTextCacheFile, JSON.stringify(fullTextCache));

const phraseCacheFile = new URL("phrase.json", CACHE_DIR);
const phraseCache: Record<string, string[]> = existsSync(phraseCacheFile) ? JSON.parse(await readFile(phraseCacheFile, "utf8")) : {};
log("phrase matching in Postgres (read-only)");
await mapLimit(textQueries, 8, async (q, i) => {
  const key = cacheKey(`phrase|${q.text}|${q.heldOut ? JSON.stringify(q.heldOut) : ""}`);
  phraseCache[key] ??= await phraseMatches(q);
  fullTexts[i].phrase = new Set(phraseCache[key]);
});
await writeFile(phraseCacheFile, JSON.stringify(phraseCache));

function signalsFor(q: Extract<EvalQuery, { kind: "text" }>, ft: FullText, which: "both" | "text" | "sound", heldOut = true): Signals {
  const tq = vectorOf(toTextQuery(q.text));
  const sq = vectorOf(toSoundQuery(q.text));
  let text: Float64Array | null = null;
  if (which !== "sound") {
    text = new Float64Array(clips.length);
    for (let i = 0; i < clips.length; i++) text[i] = dot(tq, clips[i].text);
    if (heldOut && q.heldOut) text[indexOf.get(q.heldOut.id)!] = dot(tq, vectorOf(heldOutDocument(q.heldOut.captions)));
  }
  let sound: Float64Array | null = null;
  if (which !== "text") {
    sound = new Float64Array(clips.length);
    for (let i = 0; i < clips.length; i++) sound[i] = dot(sq, clips[i].audio);
  }
  return { text, sound, fullText: ft };
}

type PerQuery = {
  id: string;
  set: string;
  group: string;
  metrics: Record<SystemName, QueryMetrics>;
  rank: Record<SystemName, number | null>;
  returned: Record<SystemName, number>;
  /** Share of the returned clips that are relevant (null: nothing returned). */
  precision: Record<SystemName, number | null>;
  topScore?: number;
};

const groupOf = (q: EvalQuery) => {
  if (q.set === "fragment" || q.set === "paraphrase") return `${q.set} · ${q.id.split(":")[1].split("-")[0]}`;
  return q.set;
};

log("ranking text queries");
const perQuery: PerQuery[] = [];
const failures: unknown[] = [];
type SweepRow = { set: string; minZ: number; returned: number; recall10: number };
const sweep: Record<string, SweepRow[]> = {};
const shareSweep: Record<string, SweepRow[]> = {};
const diagnostics = { soundSpeechShare: [] as number[], textSimStats: [] as number[], soundSimStats: [] as number[], topScorePositive: [] as number[], topScoreNegative: [] as number[] };
const negativeDetail: { query: string; returned: number; topScore: number; top: { id: string; snippet: string; score: number; matches: string }[] }[] = [];
const conceptDetail: { query: string; relevant: number; production: Record<string, number>; sound: Record<string, number> }[] = [];
const captionClap: Record<string, QueryMetrics[]> = { "sound · full catalog": [], "sound · AudioCaps clips only": [] };
const audiocapsIndexes = new Set(clips.flatMap((c, i) => (c.source === "audiocaps" ? [i] : [])));

textQueries.forEach((q, qi) => {
  const ft = fullTexts[qi];
  const both = signalsFor(q, ft, "both");
  const bySignals = {
    both,
    text: { ...both, sound: null },
    sound: { ...both, text: null },
  };
  const record: PerQuery = { id: q.id, set: q.set, group: groupOf(q), metrics: {}, rank: {}, returned: {}, precision: {} };
  const ids = (hits: Hit[]) => hits.map((h) => clips[h.index].id);
  for (const system of TEXT_SYSTEMS) {
    const hits = system.run(clips, bySignals[system.signals]);
    record.metrics[system.name] = scoreQuery(ids(hits), q.relevant);
    record.rank[system.name] = firstRelevantRank(ids(hits), q.relevant);
    record.returned[system.name] = hits.length;
    record.precision[system.name] = hits.length === 0 ? null : ids(hits).filter((id) => (q.relevant[id] ?? 0) > 0).length / hits.length;
  }
  const uncut = rankProduction(clips, both, { ...NO_CUT_OFF, limit: 1 });
  record.topScore = uncut[0]?.score;

  // Threshold sweeps: one z cut-off for both signals on the previous ranking, and the share of the best on production.
  for (const minZ of THRESHOLDS) {
    const hits = rankProduction(clips, both, { ...PREVIOUS, minZ, soundMinZ: minZ });
    (sweep[q.set] ??= []).push({ set: q.set, minZ, returned: hits.length, recall10: scoreQuery(ids(hits), q.relevant)["R@10"] });
  }
  for (const share of SHARES) {
    const hits = rankProduction(clips, both, { shareOfBest: share });
    (shareSweep[q.set] ??= []).push({ set: q.set, minZ: share, returned: hits.length, recall10: scoreQuery(ids(hits), q.relevant)["R@10"] });
  }

  if (q.set === "negative") {
    diagnostics.topScoreNegative.push(record.topScore ?? 0);
    const hits = rankProduction(clips, both);
    negativeDetail.push({
      query: q.text,
      returned: hits.length,
      topScore: record.topScore ?? 0,
      top: hits.slice(0, 3).map((h) => ({ id: clips[h.index].id, snippet: clips[h.index].snippet.slice(0, 90), score: +h.score.toFixed(2), matches: [h.text && "text", h.sound && "sound"].filter(Boolean).join("+") })),
    });
  } else {
    diagnostics.topScorePositive.push(record.topScore ?? 0);
  }

  // "Speech also matches sounds like": share of speech clips in sound-only results for sound concepts.
  if (q.set === "concept") {
    const top = rankProduction(clips, bySignals.sound, { ...NO_CUT_OFF, limit: 10 });
    diagnostics.soundSpeechShare.push(top.filter((h) => clips[h.index].source !== "audiocaps").length / 10);
  }
  if (qi % 50 === 0) {
    diagnostics.textSimStats.push(...[...both.text!].filter((_, i) => i % 97 === 0));
    diagnostics.soundSimStats.push(...[...both.sound!].filter((_, i) => i % 97 === 0));
  }

  // The CLAP-comparable setting: caption → audio vector, no cut-off.
  if (q.set === "caption") {
    captionClap["sound · full catalog"].push(scoreQuery(ids(rankBy(clips, (i) => both.sound![i])), q.relevant));
    captionClap["sound · AudioCaps clips only"].push(
      scoreQuery(ids(rankBy(clips, (i) => both.sound![i], LIMIT, (i) => audiocapsIndexes.has(i))), q.relevant),
    );
  }

  // Failure analysis on production.
  if (q.set !== "negative" && record.metrics.production["R@10"] === 0) {
    const tz = zScores(both.text!), sz = zScores(both.sound!);
    const targets = Object.keys(q.relevant).map((id) => indexOf.get(id)!);
    const best = targets.reduce((a, b) => (Math.max(tz[b], sz[b]) > Math.max(tz[a], sz[a]) ? b : a));
    const uncutRank = record.rank["no cut-off"];
    const prodHits = rankProduction(clips, both);
    failures.push({
      id: q.id,
      set: q.set,
      query: q.text,
      relevantCount: targets.length,
      target: {
        id: clips[best].id,
        // A caption query's own caption is out of the index: show another one.
        snippet: (q.heldOut?.id === clips[best].id ? q.heldOut.captions[0] : clips[best].snippet).slice(0, 120), textZ: +tz[best].toFixed(2), soundZ: +sz[best].toFixed(2), hasWords: ft.allWords.has(clips[best].id) },
      productionRank: record.rank.production,
      uncutRank,
      returned: prodHits.length,
      topSharesSoundLabel: prodHits[0] ? shareSoundLabel(clips[best].id, clips[prodHits[0].index].id) : false,
      soundBeatsText: sz[best] > tz[best],
      cause:
        record.rank.production !== null ? "ranked below 10" : uncutRank !== null && uncutRank <= 10 ? "cut off" : "not near the query",
      top: prodHits.slice(0, 3).map((h) => ({ id: clips[h.index].id, snippet: clips[h.index].snippet.slice(0, 90), score: +h.score.toFixed(2), matches: [h.text && "text", h.sound && "sound"].filter(Boolean).join("+") })),
      notes: q.notes,
    });
  }
  if (q.set === "concept") {
    conceptDetail.push({
      query: q.text,
      relevant: Object.keys(q.relevant).length,
      production: { "P@10": record.metrics.production["P@10"], "nDCG@10": record.metrics.production["nDCG@10"] },
      sound: { "P@10": record.metrics["production · sound"]["P@10"], "nDCG@10": record.metrics["production · sound"]["nDCG@10"] },
    });
  }
  perQuery.push(record);
});

log("ranking example queries (search by example)");
const EXAMPLE_SYSTEMS = ["audio nearest neighbours"];
for (const q of exampleQueries) {
  const self = indexOf.get(q.exampleId)!;
  const v = clips[self].audio;
  const hits = rankBy(clips, (i) => dot(v, clips[i].audio), LIMIT, (i) => i !== self);
  const ids = hits.map((h) => clips[h.index].id);
  perQuery.push({
    id: q.id,
    set: q.set,
    group: q.set,
    metrics: { [EXAMPLE_SYSTEMS[0]]: scoreQuery(ids, q.relevant) },
    rank: { [EXAMPLE_SYSTEMS[0]]: firstRelevantRank(ids, q.relevant) },
    returned: { [EXAMPLE_SYSTEMS[0]]: hits.length },
    precision: { [EXAMPLE_SYSTEMS[0]]: ids.filter((id) => (q.relevant[id] ?? 0) > 0).length / Math.max(1, ids.length) },
  });
}

// Chance level of P@10 for the example sets: share of the pool that is relevant.
const chance = (set: string) =>
  mean(exampleQueries.filter((q) => q.set === set).map((q) => Object.keys(q.relevant).length / (clips.length - 1)));

// ---------------------------------------------------------------------------
// Aggregate.
// ---------------------------------------------------------------------------

type Summary = Record<string, Record<SystemName, Record<string, Interval> & { returnedMean: number; precisionMean: number; emptyShare: number; n: number }>>;

function summarize(groupKey: "set" | "group"): Summary {
  const out: Summary = {};
  const groups = [...new Set(perQuery.map((r) => r[groupKey]))];
  for (const g of groups) {
    const rows = perQuery.filter((r) => r[groupKey] === g);
    out[g] = {};
    for (const system of Object.keys(rows[0].metrics)) {
      const entry = Object.fromEntries(METRIC_NAMES.map((m) => [m, bootstrapMean(rows.map((r) => r.metrics[system][m]))])) as Record<string, Interval>;
      out[g][system] = Object.assign(entry, {
        returnedMean: mean(rows.map((r) => r.returned[system])),
        precisionMean: mean(rows.flatMap((r) => (r.precision[system] == null ? [] : [r.precision[system]]))),
        emptyShare: mean(rows.map((r) => (r.returned[system] === 0 ? 1 : 0))),
        n: rows.length,
      });
    }
  }
  return out;
}

const bySet = summarize("set");
const byGroup = summarize("group");

const POSITIVE_TEXT_SETS = ["caption", "fragment", "paraphrase", "concept"];
const comparisons: Record<string, Record<SystemName, { nDCG: Interval; R10: Interval }>> = {};
for (const set of POSITIVE_TEXT_SETS) {
  const rows = perQuery.filter((r) => r.set === set);
  comparisons[set] = {};
  for (const system of TEXT_SYSTEMS.map((s) => s.name).filter((n) => n !== "production")) {
    comparisons[set][system] = {
      nDCG: bootstrapDifference(rows.map((r) => r.metrics.production["nDCG@10"]), rows.map((r) => r.metrics[system]["nDCG@10"])),
      R10: bootstrapDifference(rows.map((r) => r.metrics.production["R@10"]), rows.map((r) => r.metrics[system]["R@10"])),
    };
  }
}

const summarizeSweep = (rowsBySet: Record<string, SweepRow[]>, values: number[]) =>
  Object.fromEntries(
    Object.entries(rowsBySet).map(([set, rows]) => [
      set,
      values.map((minZ) => {
        const at = rows.filter((r) => r.minZ === minZ);
        return { minZ, recall10: mean(at.map((r) => r.recall10)), returned: mean(at.map((r) => r.returned)), empty: mean(at.map((r) => (r.returned === 0 ? 1 : 0))) };
      }),
    ]),
  );
const sweepSummary = summarizeSweep(sweep, THRESHOLDS);
const shareSweepSummary = summarizeSweep(shareSweep, SHARES);

const clapSummary = Object.fromEntries(
  Object.entries(captionClap).map(([name, rows]) => [name, Object.fromEntries(METRIC_NAMES.map((m) => [m, bootstrapMean(rows.map((r) => r[m]))]))]),
);

const answerability = {
  auc: rocAuc(diagnostics.topScorePositive, diagnostics.topScoreNegative),
  positive: { p10: percentile(diagnostics.topScorePositive, 10), p50: percentile(diagnostics.topScorePositive, 50), p90: percentile(diagnostics.topScorePositive, 90) },
  negative: { p10: percentile(diagnostics.topScoreNegative, 10), p50: percentile(diagnostics.topScoreNegative, 50), p90: percentile(diagnostics.topScoreNegative, 90) },
  /** At each candidate STRONG_MATCH_SCORE: share of queries told "nothing clearly matches". */
  strongMatch: [4, 4.5, 5, 5.5, 6].map((threshold) => ({
    threshold,
    negativeFlagged: mean(diagnostics.topScoreNegative.map((t) => (t < threshold ? 1 : 0))),
    positiveFlagged: mean(diagnostics.topScorePositive.map((t) => (t < threshold ? 1 : 0))),
    positiveFlaggedBySet: Object.fromEntries(
      POSITIVE_TEXT_SETS.map((set) => {
        const tops = perQuery.filter((r) => r.set === set && r.topScore !== undefined).map((r) => r.topScore!);
        return [set, mean(tops.map((t) => (t < threshold ? 1 : 0)))];
      }),
    ),
  })),
};

const paraphraseNoOverlap = perQuery.filter((r) => r.set === "paraphrase" && (textQueries.find((q) => q.id === r.id)?.notes?.sharedWords as string[]).length === 0);

// ---------------------------------------------------------------------------
// Live API: parity, latency, cost; database timing.
// ---------------------------------------------------------------------------

type LiveReport = {
  parity: { queries: number; top10Overlap: number; identicalLists: number; maxScoreDiff: number; similarIdentical: number; similarChecked: number };
  latency: Record<string, { n: number; p50: number; p95: number; errors: number }>;
} | null;
let liveReport: LiveReport = null;

if (!SKIP_LIVE) {
  log(`live checks against ${API} (one request every ${LIVE_GAP_MS} ms)`);
  const parityQueries = textQueries.filter((q) => !q.heldOut).filter((_, i) => i % 25 === 0).slice(0, 20);
  const overlaps: number[] = [];
  let identical = 0, maxScoreDiff = 0;
  const searchTimes: number[] = [];
  let searchErrors = 0;
  for (const q of parityQueries) {
    const res = await live(`/api/v1/search?q=${encodeURIComponent(q.text)}&limit=${LIMIT}`);
    if (res.status !== 200) { searchErrors++; continue; }
    searchTimes.push(res.ms);
    const liveHits = (res.body as { data: { id: string; score: number }[] }).data;
    const local = rankProduction(clips, signalsFor(q, fullTexts[textQueries.indexOf(q)], "both", false));
    const localIds = local.map((h) => clips[h.index].id);
    const liveIds = liveHits.map((h) => h.id);
    const top10 = new Set(localIds.slice(0, 10));
    const denominator = Math.max(1, Math.min(10, liveIds.length, localIds.length));
    overlaps.push(liveIds.slice(0, 10).filter((id) => top10.has(id)).length / denominator);
    if (liveIds.join() === localIds.join()) identical++;
    liveHits.forEach((h) => {
      const l = local.find((x) => clips[x.index].id === h.id);
      if (l) maxScoreDiff = Math.max(maxScoreDiff, Math.abs(l.score - h.score));
    });
  }
  const similarTimes: number[] = [];
  let similarIdentical = 0, similarErrors = 0;
  const similarIds = exampleQueries.filter((_, i) => i % 30 === 0).slice(0, 20).map((q) => q.exampleId);
  for (const id of similarIds) {
    const res = await live(`/api/v1/audios/${id}/similar?limit=10`);
    if (res.status !== 200) { similarErrors++; continue; }
    similarTimes.push(res.ms);
    const self = indexOf.get(id)!;
    const local = rankBy(clips, (i) => dot(clips[self].audio, clips[i].audio), 10, (i) => i !== self).map((h) => clips[h.index].id);
    if ((res.body as { data: { id: string }[] }).data.map((h) => h.id).join() === local.join()) similarIdentical++;
  }
  const audioTimes: number[] = [];
  let audioErrors = 0;
  const wav = syntheticWav(5);
  for (let i = 0; i < 8; i++) {
    const res = await live(`/api/v1/search/audio?limit=10`, { method: "POST", headers: { "content-type": "audio/wav" }, body: wav });
    if (res.status !== 200) { audioErrors++; continue; }
    audioTimes.push(res.ms);
  }
  const stat = (times: number[], errors: number) => ({ n: times.length, p50: percentile(times, 50), p95: percentile(times, 95), errors });
  liveReport = {
    parity: {
      queries: overlaps.length,
      top10Overlap: mean(overlaps),
      identicalLists: identical,
      maxScoreDiff,
      similarIdentical,
      similarChecked: similarIds.length - similarErrors,
    },
    latency: {
      "GET /api/v1/search (text, match=all)": stat(searchTimes, searchErrors),
      "GET /api/v1/audios/{id}/similar": stat(similarTimes, similarErrors),
      "POST /api/v1/search/audio (5 s WAV)": stat(audioTimes, audioErrors),
    },
  };
  if (liveReport.parity.top10Overlap < 0.9) {
    console.error("PARITY FAILED: the in-memory ranking disagrees with the live API", liveReport.parity);
    process.exitCode = 1;
  }
}

log("timing the database queries (EXPLAIN ANALYZE, read-only)");
const dbTimes = { similar: [] as number[], search: [] as number[] };
for (const q of exampleQueries.slice(0, 7)) {
  const [plan] = (await sql.transaction(
    [
      sql`EXPLAIN (ANALYZE, FORMAT JSON)
          SELECT a.id FROM audios a JOIN audios example ON example.id = ${q.exampleId}
          WHERE a.id <> example.id ORDER BY a.audio_embedding <=> example.audio_embedding, a.id LIMIT 50`,
    ],
    { readOnly: true },
  )) as { "QUERY PLAN": { "Execution Time": number }[] }[][];
  dbTimes.similar.push(plan[0]["QUERY PLAN"][0]["Execution Time"]);
}
for (const q of textQueries.filter((x) => x.set === "concept").slice(0, 7)) {
  const t = `[${[...vectorOf(toTextQuery(q.text))].join(",")}]`;
  const s = `[${[...vectorOf(toSoundQuery(q.text))].join(",")}]`;
  const [plan] = (await sql.transaction(
    [
      // The production query of repository.ts `searchAudios`, verbatim (typed query, no source or exclude).
      sql`EXPLAIN (ANALYZE, FORMAT JSON)
        WITH q AS (
          SELECT ${t}::vector AS text_vector,
                 ${s}::vector AS sound_vector,
                 websearch_to_tsquery('english', ${q.text}) AS words,
                 CASE WHEN websearch_to_tsquery('simple', ${q.text})::text LIKE '%!%'
                   THEN ''::tsquery
                   ELSE phraseto_tsquery('simple', ${q.text})
                 END AS phrase,
                 replace(plainto_tsquery('english', ${q.text})::text, '&', '|')::tsquery AS any_word
        ),
        scored AS (
          SELECT a.id,
                 (q.text_vector IS NOT NULL AND a.search_text @@ q.words) AS has_words,
                 (q.text_vector IS NOT NULL AND numnode(q.phrase) > 0 AND coalesce(
                   to_tsvector('simple', a.metadata->>'transcript'),
                   to_tsvector('simple', a.metadata->'captions')
                 ) @@ q.phrase) AS has_phrase,
                 (s.text - avg(s.text) OVER ()) / nullif(stddev_samp(s.text) OVER (), 0) AS text_z,
                 (s.sound - avg(s.sound) OVER ()) / nullif(stddev_samp(s.sound) OVER (), 0) AS sound_z
          FROM audios a
          CROSS JOIN q
          CROSS JOIN LATERAL (
            SELECT 1 - (a.text_embedding <=> q.text_vector) AS text,
                   1 - (a.audio_embedding <=> q.sound_vector) AS sound
          ) s
        ),
        signals AS (
          SELECT id,
                 CASE
                   WHEN has_words OR has_phrase
                     THEN ${EXACT_WORDS_BONUS}::float8
                          + CASE WHEN has_phrase THEN ${EXACT_PHRASE_BONUS}::float8 ELSE 0 END
                          + greatest(text_z, 0)
                   WHEN text_z >= ${MIN_Z_SCORE}::float8 THEN text_z
                   ELSE 0
                 END AS text,
                 CASE WHEN sound_z >= ${MIN_TYPED_SOUND_Z_SCORE}::float8 THEN sound_z ELSE 0 END AS sound
          FROM scored
        ),
        matched AS (
          SELECT g.id, greatest(g.text, g.sound)::float8 AS score, g.text > 0 AS text, g.sound > 0 AS sound,
                 max(greatest(g.text, g.sound)) OVER ()::float8 AS best
          FROM signals g
          JOIN audios a USING (id)
          WHERE (g.text > 0 OR g.sound > 0)
        )
        SELECT a.id, a.metadata, m.score, m.best,
               (
                 SELECT caption
                 FROM jsonb_array_elements_text(a.metadata->'captions') WITH ORDINALITY AS c(caption, position)
                 ORDER BY ts_rank(to_tsvector('english', caption), q.any_word) DESC, position
                 LIMIT 1
               ) AS caption
        FROM matched m
        JOIN audios a USING (id)
        CROSS JOIN q
        WHERE m.score >= ${MIN_SHARE_OF_BEST}::float8 * m.best
        ORDER BY m.score DESC, a.id
        LIMIT 50`,
    ],
    { readOnly: true },
  )) as { "QUERY PLAN": { "Execution Time": number }[] }[][];
  dbTimes.search.push(plan[0]["QUERY PLAN"][0]["Execution Time"]);
}

log("measuring tokens and price per query");
const pricing = await fetch("https://ai-gateway.vercel.sh/v1/models")
  .then((r) => r.json() as Promise<{ data: { id: string; pricing?: Record<string, string> }[] }>)
  .then((d) => d.data.find((m) => m.id === EMBEDDING_MODEL)?.pricing ?? {})
  .catch(() => ({}) as Record<string, string>);
const sampleText = textQueries.find((q) => q.set === "concept")!.text;
const textUsage = await embedMany({ model: EMBEDDING_MODEL, values: [toTextQuery(sampleText), toSoundQuery(sampleText)], dimensions: EMBEDDING_DIMENSIONS });
const embedTimes: number[] = [];
for (const q of textQueries.filter((x) => x.set === "paraphrase").slice(0, 8)) {
  const started = performance.now();
  await embedMany({ model: EMBEDDING_MODEL, values: [toTextQuery(`${q.text} `), toSoundQuery(`${q.text} `)], dimensions: EMBEDDING_DIMENSIONS });
  embedTimes.push(performance.now() - started);
}
const audioUsage = await embed({ model: EMBEDDING_MODEL, ...toAudioInput(Buffer.from(syntheticWav(10)).toString("base64")), dimensions: EMBEDDING_DIMENSIONS });
const textPrice = Number(pricing.input ?? Number.NaN);
const audioPrice = Number(pricing.audio_input_token_cost ?? Number.NaN);
const cost = {
  textSearchTokens: textUsage.usage.tokens,
  textSearchUsd: textUsage.usage.tokens * textPrice,
  audioSearchTokensPer10s: audioUsage.usage.tokens,
  audioSearchUsdPer10s: audioUsage.usage.tokens * audioPrice,
  queryEmbeddingMs: { p50: percentile(embedTimes, 50), p95: percentile(embedTimes, 95) },
  pricing,
  evalRunEmbeddingTokens: embeddingTokensSpent,
};

// ---------------------------------------------------------------------------
// Write results and the report.
// ---------------------------------------------------------------------------

const results = {
  generatedAt: new Date().toISOString(),
  model: EMBEDDING_MODEL,
  ranking: {
    minZ: MIN_Z_SCORE,
    typedSoundMinZ: MIN_TYPED_SOUND_Z_SCORE,
    exactWordsBonus: EXACT_WORDS_BONUS,
    exactPhraseBonus: EXACT_PHRASE_BONUS,
    minShareOfBest: MIN_SHARE_OF_BEST,
    strongMatchScore: STRONG_MATCH_SCORE,
    limit: LIMIT,
  },
  catalog: Object.fromEntries([...new Set(clips.map((c) => c.source))].map((s) => [s, clips.filter((c) => c.source === s).length])),
  queryCounts: queryFile.counts,
  systems: TEXT_SYSTEMS.map(({ name, description }) => ({ name, description })),
  bySet,
  byGroup,
  comparisons,
  sweep: sweepSummary,
  shareSweep: shareSweepSummary,
  clap: clapSummary,
  example: { chanceP10: { example: chance("example"), speaker: chance("speaker") } },
  answerability,
  negatives: negativeDetail,
  concepts: conceptDetail,
  diagnostics: {
    speechShareInSoundOnlyTop10ForSoundConcepts: mean(diagnostics.soundSpeechShare),
    speechShareOfCatalog: clips.filter((c) => c.source !== "audiocaps").length / clips.length,
    textCosine: { p10: percentile(diagnostics.textSimStats, 10), p50: percentile(diagnostics.textSimStats, 50), p90: percentile(diagnostics.textSimStats, 90) },
    soundCosine: { p10: percentile(diagnostics.soundSimStats, 10), p50: percentile(diagnostics.soundSimStats, 50), p90: percentile(diagnostics.soundSimStats, 90) },
    paraphraseNoSharedWords: {
      n: paraphraseNoOverlap.length,
      production: Object.fromEntries(METRIC_NAMES.map((m) => [m, bootstrapMean(paraphraseNoOverlap.map((r) => r.metrics.production[m]))])),
    },
  },
  failures: {
    counts: Object.fromEntries(POSITIVE_TEXT_SETS.map((set) => {
      const f = failures.filter((x) => (x as { set: string }).set === set) as { cause: string }[];
      return [set, { total: f.length, ...Object.fromEntries([...new Set(f.map((x) => x.cause))].map((c) => [c, f.filter((x) => x.cause === c).length])) }];
    })),
    captionTopSharesSoundLabel: mean((failures as { set: string; topSharesSoundLabel: boolean }[]).filter((f) => f.set === "caption").map((f) => (f.topSharesSoundLabel ? 1 : 0))),
    captionSoundBeatsText: mean((failures as { set: string; soundBeatsText: boolean }[]).filter((f) => f.set === "caption").map((f) => (f.soundBeatsText ? 1 : 0))),
    captionHardClips: (() => {
      const perClip = new Map<string, number>();
      for (const f of failures as { set: string; id: string }[]) if (f.set === "caption") perClip.set(f.id.split(":")[1], (perClip.get(f.id.split(":")[1]) ?? 0) + 1);
      return { clipsWithAFailure: perClip.size, clipsFailingAtLeast3Of5: [...perClip.values()].filter((n) => n >= 3).length };
    })(),
    cases: failures,
  },
  live: liveReport,
  database: { similarMs: { p50: percentile(dbTimes.similar, 50), max: Math.max(...dbTimes.similar) }, searchMs: { p50: percentile(dbTimes.search, 50), max: Math.max(...dbTimes.search) } },
  cost,
};
await writeFile(new URL("eval/results.json", ROOT), `${JSON.stringify(results, null, 1)}\n`);

const { renderReport } = await import("./report.mts");
await writeFile(new URL("eval/report.md", ROOT), renderReport(results));
log("wrote eval/results.json and eval/report.md");
