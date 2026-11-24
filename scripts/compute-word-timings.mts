/**
 * Fills `word_timings` in the `audios` table (migrations/006_word_timings.sql):
 * when each word of a clip's transcript is said, so the UI can point at the
 * words a search found and play from them. Only clips with a transcript in
 * the dataset (LibriSpeech, Common Voice): AudioCaps clips match on captions.
 *
 *   node --env-file=.env.local scripts/compute-word-timings.mts [--limit N] [--all]
 *   node --env-file=.env.local scripts/compute-word-timings.mts --compare N
 *
 * Each clip is transcribed by WORD_TIMINGS_MODEL through the Vercel AI Gateway,
 * which times every word it hears, and those words are lined up with the
 * dataset's transcript (alignWords in src/lib/audio/word-timings.ts).
 * The app's transcription model (Voxtral) doesn't time words.
 *
 * It WRITES TO THE SHARED PRODUCTION DATABASE. It only computes the clips that
 * have no timings yet (or every clip with `--all`), so it can be stopped and
 * re-run. Costs about $0.60 of AI Gateway credit for the whole catalog
 * (~5.7 h of speech at $0.000028 a second).
 *
 * `--compare N` writes nothing: it times N clips (the longest ones first) with
 * both WORD_TIMINGS_MODEL and COMPARE_MODEL and reports how far apart their
 * word starts are, to check the timings before trusting them.
 */
import { neon } from "@neondatabase/serverless";
import { get } from "@vercel/blob";
import { transcribe } from "ai";

import { alignWords, type Alignment, type TimedWord } from "../src/lib/audio/word-timings.ts";

/** Times every word; cheapest of the gateway models that do (tested Nov 2026). */
const WORD_TIMINGS_MODEL = "spacexai/grok-stt";
/**
 * Also times every word, by default. For `--compare`, and for the clips where
 * WORD_TIMINGS_MODEL hears nothing (it returned no words for a few quiet Common Voice clips).
 */
const COMPARE_MODEL = "elevenlabs/scribe-v2";
const CONCURRENCY = 8;
/** Below this share of words heard exactly, the clip is listed for a look (the timings are still stored). */
const LOW_EXACT_SHARE = 0.7;

type Row = { id: string; blob_pathname: string; duration_seconds: number; transcript: string };

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Run with --env-file=.env.local`);
  return value;
}

const sql = neon(requireEnv("DATABASE_URL"));
const blobStoreId = requireEnv("BLOB_STORE_ID");
requireEnv("VERCEL_OIDC_TOKEN");

async function readFlac(pathname: string): Promise<Uint8Array> {
  const blob = await get(pathname, { access: "private", storeId: blobStoreId });
  if (!blob || blob.statusCode !== 200) throw new Error(`Blob not found: ${pathname}`);
  return new Uint8Array(await new Response(blob.stream).arrayBuffer());
}

/** The words `model` hears in the clip, with their times. */
async function heardWords(model: string, audio: Uint8Array): Promise<TimedWord[]> {
  const result = await transcribe({ model, audio });
  // The gateway returns word timings as segments, one word each (spaces too, for Scribe).
  const words = result.words?.length ? result.words : result.segments;
  return words.map((w) => ({ text: w.text, start: w.startSecond, end: w.endSecond }));
}

async function align(model: string, row: Row, audio: Uint8Array): Promise<Alignment> {
  const alignment = alignWords(row.transcript, await heardWords(model, audio), row.duration_seconds);
  if (!alignment) throw new Error(`${model} heard no words`);
  return alignment;
}

function parseCount(flag: string): number | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  const count = Number(process.argv[index + 1]);
  if (!Number.isInteger(count) || count < 1) throw new Error(`${flag} needs a positive integer`);
  return count;
}

async function runAll<T>(items: T[], work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < items.length) await work(items[next++]);
  }));
}

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

async function compare(count: number): Promise<void> {
  // The longest clips of each dataset: where pointing at a word matters, and alignment is hardest.
  const rows = (await sql`
    (SELECT id, blob_pathname, duration_seconds, metadata->>'transcript' AS transcript
     FROM audios WHERE source = 'librispeech' ORDER BY duration_seconds DESC LIMIT ${Math.ceil(count * 0.75)})
    UNION ALL
    (SELECT id, blob_pathname, duration_seconds, metadata->>'transcript' AS transcript
     FROM audios WHERE source = 'commonvoice' ORDER BY duration_seconds DESC LIMIT ${Math.floor(count * 0.25)})
  `) as Row[];
  const differences: number[] = [];
  const shares: Record<string, number[]> = { [WORD_TIMINGS_MODEL]: [], [COMPARE_MODEL]: [] };
  await runAll(rows, async (row) => {
    try {
      const audio = await readFlac(row.blob_pathname);
      const [a, b] = await Promise.all([align(WORD_TIMINGS_MODEL, row, audio), align(COMPARE_MODEL, row, audio)]);
      shares[WORD_TIMINGS_MODEL].push(a.exactShare);
      shares[COMPARE_MODEL].push(b.exactShare);
      const clip = a.timings.map((t, i) => Math.abs(t.start - b.timings[i].start));
      differences.push(...clip);
      const sorted = [...clip].sort((x, y) => x - y);
      console.log(`${row.id} (${row.duration_seconds.toFixed(1)} s, ${a.timings.length} words): ` +
        `median ${(quantile(sorted, 0.5) * 1000).toFixed(0)} ms, max ${(sorted.at(-1)! * 1000).toFixed(0)} ms; ` +
        `exact ${(a.exactShare * 100).toFixed(0)}% / ${(b.exactShare * 100).toFixed(0)}%`);
    } catch (error) {
      console.error(`FAILED ${row.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  differences.sort((x, y) => x - y);
  const ms = (q: number) => `${(quantile(differences, q) * 1000).toFixed(0)} ms`;
  console.log(`\n${differences.length} words: start differs by median ${ms(0.5)}, p90 ${ms(0.9)}, p99 ${ms(0.99)}`);
  for (const [model, values] of Object.entries(shares)) {
    const mean = values.reduce((sum, v) => sum + v, 0) / Math.max(values.length, 1);
    console.log(`${model}: heard ${(mean * 100).toFixed(1)}% of the transcript's words exactly`);
  }
}

async function fill(limit: number | null, all: boolean): Promise<void> {
  const rows = (await sql`
    SELECT id, blob_pathname, duration_seconds, metadata->>'transcript' AS transcript
    FROM audios
    WHERE source IN ('librispeech', 'commonvoice') AND (${all} OR word_timings IS NULL)
    ORDER BY id
    LIMIT ${limit}
  `) as Row[];
  console.log(`${rows.length} clips to time with ${WORD_TIMINGS_MODEL}`);

  let done = 0;
  const failed: string[] = [];
  const low: string[] = [];
  await runAll(rows, async (row) => {
    try {
      const audio = await readFlac(row.blob_pathname);
      let model = WORD_TIMINGS_MODEL;
      let alignment;
      try {
        alignment = await align(model, row, audio);
      } catch (error) {
        console.error(`${row.id}: ${error instanceof Error ? error.message : String(error)}; trying ${COMPARE_MODEL}`);
        model = COMPARE_MODEL;
        alignment = await align(model, row, audio);
      }
      const { timings, exactShare } = alignment;
      if (exactShare < LOW_EXACT_SHARE) low.push(`${row.id} (${(exactShare * 100).toFixed(0)}%)`);
      await sql`
        UPDATE audios SET word_timings = ${JSON.stringify(timings)}::jsonb, word_timings_model = ${model}
        WHERE id = ${row.id}
      `;
    } catch (error) {
      failed.push(row.id);
      console.error(`FAILED ${row.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
    done++;
    if (done % 100 === 0 || done === rows.length) console.log(`${done}/${rows.length}`);
  });

  if (low.length > 0) console.log(`Under ${LOW_EXACT_SHARE * 100}% of words heard exactly (worth a look): ${low.join(", ")}`);
  const [{ missing }] = await sql`
    SELECT count(*)::int AS missing FROM audios
    WHERE source IN ('librispeech', 'commonvoice') AND word_timings IS NULL
  `;
  console.log(`Done. ${failed.length} failed in this run; ${missing} clips still without word timings.`);
  if (failed.length > 0) {
    console.log("Run the script again to retry the failed clips.");
    process.exitCode = 1;
  }
}

const compareCount = parseCount("--compare");
if (compareCount) await compare(compareCount);
else await fill(parseCount("--limit"), process.argv.includes("--all"));
