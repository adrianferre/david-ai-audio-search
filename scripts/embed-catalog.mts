/**
 * Fills the search vectors of the `audios` table (src/server/db/schema.sql):
 * `audio_embedding` for every clip and `text_embedding` for LibriSpeech transcripts.
 *
 *   node --env-file=.env.local scripts/embed-catalog.mts [--limit N]
 *
 * It WRITES TO THE SHARED PRODUCTION DATABASE and spends AI Gateway credits
 * (about $5 for the whole catalog). It only touches rows whose `audio_embedding`
 * is NULL, so it can be stopped and re-run.
 *
 * Needs `ffmpeg` on the PATH: the model takes WAV or MP3, the store holds FLAC.
 */
import { spawn } from "node:child_process";

import { neon } from "@neondatabase/serverless";
import { get } from "@vercel/blob";
import { embed } from "ai";

import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  toTranscriptDocument,
} from "../src/server/search/embedding-config.ts";

const CONCURRENCY = 24;

type Row = { id: string; blob_pathname: string; transcript: string | null };

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Run with --env-file=.env.local`);
  return value;
}

const sql = neon(requireEnv("DATABASE_URL"));
const blobStoreId = requireEnv("BLOB_STORE_ID");

/** FLAC bytes in, 16 kHz mono WAV bytes out. */
function flacToWav(flac: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-ac", "1", "-ar", "16000", "-f", "wav", "pipe:1"],
      { stdio: ["pipe", "pipe", "inherit"] },
    );
    const chunks: Buffer[] = [];
    ffmpeg.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) =>
      code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg exited with code ${code}`)),
    );
    // ffmpeg can exit before reading everything; its exit code reports that.
    ffmpeg.stdin.on("error", () => {});
    ffmpeg.stdin.end(flac);
  });
}

async function readFlac(pathname: string): Promise<Buffer> {
  const blob = await get(pathname, { access: "private", storeId: blobStoreId });
  if (!blob || blob.statusCode !== 200) throw new Error(`Blob not found: ${pathname}`);
  return Buffer.from(await new Response(blob.stream).arrayBuffer());
}

function checked(embedding: number[]): string {
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Expected ${EMBEDDING_DIMENSIONS} dimensions, got ${embedding.length}`);
  }
  // pgvector's text format.
  return `[${embedding.join(",")}]`;
}

async function embedAudio(wav: Buffer): Promise<string> {
  const { embedding } = await embed({
    model: EMBEDDING_MODEL,
    // The audio goes in `content`; the text value stays empty so only the audio is embedded.
    value: "",
    dimensions: EMBEDDING_DIMENSIONS,
    providerOptions: {
      google: { content: [[{ inlineData: { mimeType: "audio/wav", data: wav.toString("base64") } }]] },
    },
    maxRetries: 5,
  });
  return checked(embedding);
}

async function embedTranscript(transcript: string): Promise<string> {
  const { embedding } = await embed({
    model: EMBEDDING_MODEL,
    value: toTranscriptDocument(transcript),
    dimensions: EMBEDDING_DIMENSIONS,
    maxRetries: 5,
  });
  return checked(embedding);
}

async function embedRow(row: Row): Promise<void> {
  const [audioVector, textVector] = await Promise.all([
    readFlac(row.blob_pathname).then(flacToWav).then(embedAudio),
    row.transcript ? embedTranscript(row.transcript) : null,
  ]);
  await sql`
    UPDATE audios
    SET audio_embedding = ${audioVector}::vector,
        text_embedding = ${textVector}::vector,
        embedding_model = ${EMBEDDING_MODEL}
    WHERE id = ${row.id}
  `;
}

function parseLimit(): number | null {
  const index = process.argv.indexOf("--limit");
  if (index === -1) return null;
  const limit = Number(process.argv[index + 1]);
  if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit needs a positive integer");
  return limit;
}

const limit = parseLimit();
const rows = (await sql`
  SELECT id, blob_pathname, metadata->>'transcript' AS transcript
  FROM audios
  WHERE audio_embedding IS NULL
  ORDER BY id
  LIMIT ${limit}
`) as Row[];

console.log(`${rows.length} clips to embed with ${EMBEDDING_MODEL} (${EMBEDDING_DIMENSIONS} dimensions)`);

let done = 0;
const failed: string[] = [];
let next = 0;

async function worker(): Promise<void> {
  while (next < rows.length) {
    const row = rows[next++];
    try {
      await embedRow(row);
    } catch (error) {
      failed.push(row.id);
      console.error(`FAILED ${row.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
    done++;
    if (done % 100 === 0 || done === rows.length) console.log(`${done}/${rows.length}`);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const [{ missing }] = await sql`SELECT count(*)::int AS missing FROM audios WHERE audio_embedding IS NULL`;
console.log(`Done. ${failed.length} failed in this run; ${missing} clips still without a vector.`);
if (failed.length > 0) {
  console.log("Run the script again to retry the failed clips.");
  process.exitCode = 1;
}
