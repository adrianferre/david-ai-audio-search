/**
 * Fills `waveform_peaks` in the `audios` table (src/server/db/schema.sql): each
 * clip's waveform overview, which the UI draws from the API response.
 *
 *   node --env-file=.env.local scripts/compute-waveforms.mts [--limit N] [--all]
 *
 * It WRITES TO THE SHARED PRODUCTION DATABASE. It only computes the rows that
 * have no peaks yet (or every row with `--all`, after changing src/lib/audio/peaks.ts),
 * so it can be stopped and re-run. Costs nothing but Blob reads.
 *
 * Needs `ffmpeg` on the PATH, to decode the FLACs.
 */
import { spawn } from "node:child_process";

import { neon } from "@neondatabase/serverless";
import { get } from "@vercel/blob";

import { computePeaks, PEAK_COUNT, PEAK_SAMPLE_RATE } from "../src/lib/audio/peaks.ts";

const CONCURRENCY = 16;

type Row = { id: string; blob_pathname: string };

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Run with --env-file=.env.local`);
  return value;
}

const sql = neon(requireEnv("DATABASE_URL"));
const blobStoreId = requireEnv("BLOB_STORE_ID");

async function readFlac(pathname: string): Promise<Buffer> {
  const blob = await get(pathname, { access: "private", storeId: blobStoreId });
  if (!blob || blob.statusCode !== 200) throw new Error(`Blob not found: ${pathname}`);
  return Buffer.from(await new Response(blob.stream).arrayBuffer());
}

/** FLAC bytes in, mono 32-bit float samples at `PEAK_SAMPLE_RATE` out. */
function decode(flac: Buffer): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      "ffmpeg",
      [
        "-hide_banner", "-loglevel", "error", "-i", "pipe:0",
        "-ac", "1", "-ar", String(PEAK_SAMPLE_RATE), "-f", "f32le", "pipe:1",
      ],
      { stdio: ["pipe", "pipe", "inherit"] },
    );
    const chunks: Buffer[] = [];
    ffmpeg.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exited with code ${code}`));
      const pcm = Buffer.concat(chunks);
      // Copy into an aligned buffer: a Buffer's offset in its pool may not be a multiple of 4.
      const samples = new Float32Array(pcm.byteLength / 4);
      new Uint8Array(samples.buffer).set(pcm.subarray(0, samples.byteLength));
      resolve(samples);
    });
    // ffmpeg can exit before reading everything; its exit code reports that.
    ffmpeg.stdin.on("error", () => {});
    ffmpeg.stdin.end(flac);
  });
}

async function computeRow(row: Row): Promise<void> {
  const samples = await decode(await readFlac(row.blob_pathname));
  if (samples.length < PEAK_COUNT) throw new Error(`Only ${samples.length} samples`);
  const peaks = computePeaks(samples);
  await sql`UPDATE audios SET waveform_peaks = ${peaks}::real[] WHERE id = ${row.id}`;
}

function parseLimit(): number | null {
  const index = process.argv.indexOf("--limit");
  if (index === -1) return null;
  const limit = Number(process.argv[index + 1]);
  if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit needs a positive integer");
  return limit;
}

const limit = parseLimit();
const all = process.argv.includes("--all");
const rows = (await sql`
  SELECT id, blob_pathname
  FROM audios
  WHERE ${all} OR waveform_peaks IS NULL
  ORDER BY id
  LIMIT ${limit}
`) as Row[];

console.log(`${rows.length} clips to compute (${PEAK_COUNT} peaks each)`);

let done = 0;
const failed: string[] = [];
let next = 0;

async function worker(): Promise<void> {
  while (next < rows.length) {
    const row = rows[next++];
    try {
      await computeRow(row);
    } catch (error) {
      failed.push(row.id);
      console.error(`FAILED ${row.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
    done++;
    if (done % 100 === 0 || done === rows.length) console.log(`${done}/${rows.length}`);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const [{ missing }] = await sql`SELECT count(*)::int AS missing FROM audios WHERE waveform_peaks IS NULL`;
console.log(`Done. ${failed.length} failed in this run; ${missing} clips still without peaks.`);
if (failed.length > 0) {
  console.log("Run the script again to retry the failed clips.");
  process.exitCode = 1;
}
