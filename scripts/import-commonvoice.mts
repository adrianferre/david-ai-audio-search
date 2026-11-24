/**
 * Adds a sample of Mozilla Common Voice (English, v17.0 dev split) to the catalog:
 * one clip per speaker, spread over genders and accents, with the sentence each
 * speaker read as its transcript.
 *
 *   node --env-file=.env.local scripts/import-commonvoice.mts [--count N] [--dry-run]
 *
 * `--dry-run` only prints the sample it would import.
 *
 * It WRITES TO THE SHARED PRODUCTION DATABASE AND BLOB STORE. It only touches
 * `commonvoice` rows and never deletes anything, so re-running it is safe: blobs
 * already uploaded are skipped and unchanged rows are left alone. The new rows
 * have no vectors yet: run `pnpm embed-catalog` afterwards.
 *
 * Source: the official Common Voice downloads moved to Mozilla's Data Collective
 * (account required), so this reads the public CC0 mirror on Hugging Face,
 * `fsicoli/common_voice_17_0`. The dev audio is one 717 MB tar of MP3s; it is
 * streamed once and only the sampled files are written to a temporary folder.
 *
 * Needs `ffmpeg` and `tar` on the PATH: the store holds 16 kHz mono FLAC.
 */
import { spawn } from "node:child_process";
import { mkdtemp, open, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { neon } from "@neondatabase/serverless";
import { list, put } from "@vercel/blob";

const MIRROR = "https://huggingface.co/datasets/fsicoli/common_voice_17_0/resolve/main";
const TSV_URL = `${MIRROR}/transcript/en/dev.tsv`;
const TAR_URL = `${MIRROR}/audio/en/dev/en_dev_0.tar`;
const BLOB_PREFIX = "commonvoice/en/dev/";
const DEFAULT_COUNT = 200;
const MIN_WORDS = 4;
const CONCURRENCY = 8;
const ATTEMPTS = 3;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Run with --env-file=.env.local`);
  return value;
}

const sql = neon(requireEnv("DATABASE_URL"));
const storeId = requireEnv("BLOB_STORE_ID");

type Clip = {
  clientId: string;
  path: string;
  sentenceId: string;
  sentence: string;
  upVotes: number;
  downVotes: number;
  age: string;
  gender: string;
  accent: string;
  locale: string;
};

function parseCount(): number {
  const index = process.argv.indexOf("--count");
  if (index === -1) return DEFAULT_COUNT;
  const count = Number(process.argv[index + 1]);
  if (!Number.isInteger(count) || count < 1) throw new Error("--count needs a positive integer");
  return count;
}

/** Accents are free text, comma-separated: trim each one and drop stray quotes. */
function cleanAccent(accent: string): string {
  return accent
    .split(",")
    .map((part) => part.trim().replace(/^"+|"+$/g, "").replaceAll("_", " ").trim())
    .filter(Boolean)
    .join(", ");
}

/** Common Voice TSVs are tab-separated with a header row and no quoting. */
function parseTsv(text: string): Clip[] {
  const [header, ...lines] = text.split("\n");
  const columns = header.split("\t");
  const col = (name: string) => {
    const i = columns.indexOf(name);
    if (i === -1) throw new Error(`dev.tsv has no "${name}" column`);
    return i;
  };
  const c = {
    clientId: col("client_id"),
    path: col("path"),
    sentenceId: col("sentence_id"),
    sentence: col("sentence"),
    upVotes: col("up_votes"),
    downVotes: col("down_votes"),
    age: col("age"),
    gender: col("gender"),
    accent: col("accents"),
    locale: col("locale"),
  };
  return lines
    .filter((line) => line.trim())
    .map((line) => {
      const f = line.split("\t");
      return {
        clientId: f[c.clientId],
        path: f[c.path],
        sentenceId: f[c.sentenceId],
        sentence: f[c.sentence].trim(),
        upVotes: Number(f[c.upVotes]),
        downVotes: Number(f[c.downVotes]),
        age: f[c.age] ?? "",
        gender: f[c.gender] ?? "",
        accent: cleanAccent(f[c.accent] ?? ""),
        locale: f[c.locale] ?? "en",
      };
    });
}

/**
 * The sample, deterministic for a given dev.tsv: well-validated clips from
 * speakers who filled in age, gender and accent, one clip per speaker. It takes
 * one gender at a time in turn (most volunteers are male), and within a gender
 * one accent at a time in turn, so small groups are represented too.
 */
function selectSample(clips: Clip[], count: number): Clip[] {
  const eligible = clips
    .filter(
      (clip) =>
        clip.age &&
        clip.gender &&
        clip.accent &&
        clip.upVotes >= 2 &&
        clip.downVotes === 0 &&
        clip.sentence.split(/\s+/).length >= MIN_WORDS,
    )
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const firstPerSpeaker = new Map<string, Clip>();
  for (const clip of eligible) if (!firstPerSpeaker.has(clip.clientId)) firstPerSpeaker.set(clip.clientId, clip);

  // gender → accent → clips, all in a stable order.
  const byGender = new Map<string, Map<string, Clip[]>>();
  for (const clip of firstPerSpeaker.values()) {
    const accents = byGender.get(clip.gender) ?? new Map<string, Clip[]>();
    byGender.set(clip.gender, accents);
    accents.set(clip.accent, [...(accents.get(clip.accent) ?? []), clip]);
  }
  const queues = [...byGender.keys()].sort().map((gender) => {
    const accents = byGender.get(gender)!;
    return { accents: [...accents.keys()].sort().map((accent) => accents.get(accent)!), turn: 0 };
  });
  const nextOf = (queue: (typeof queues)[number]): Clip | undefined => {
    const remaining = queue.accents.filter((clipsOfAccent) => clipsOfAccent.length > 0);
    if (remaining.length === 0) return undefined;
    return remaining[queue.turn++ % remaining.length].shift();
  };

  const sample: Clip[] = [];
  while (sample.length < count) {
    let picked = false;
    for (const queue of queues) {
      if (sample.length >= count) break;
      const clip = nextOf(queue);
      if (clip) {
        sample.push(clip);
        picked = true;
      }
    }
    if (!picked) break;
  }
  return sample;
}

function run(command: string, args: string[], stdin?: Readable): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: [stdin ? "pipe" : "ignore", "inherit", "inherit"] });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)),
    );
    if (stdin && child.stdin) {
      stdin.on("error", (error) => {
        child.kill();
        reject(error);
      });
      child.stdin.on("error", () => {});
      stdin.pipe(child.stdin);
    }
  });
}

/** Streams the dev tar and writes only the sampled MP3s into `dir`, without folders. */
async function extractMp3s(fileNames: string[], dir: string): Promise<void> {
  const response = await fetch(TAR_URL);
  if (!response.ok || !response.body) throw new Error(`GET ${TAR_URL}: ${response.status}`);
  // bsdtar (macOS) and GNU tar both accept member patterns; `*` also matches the folder.
  await run(
    "tar",
    ["-x", "-f", "-", "-C", dir, ...(process.platform === "darwin" ? ["-s", ",.*/,,"] : ["--transform", "s,.*/,,"]),
      ...fileNames.map((name) => `*${name}`)],
    Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
  );
}

function mp3ToFlac(input: string, output: string): Promise<void> {
  return run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-i", input,
    "-ac", "1", "-ar", "16000", "-sample_fmt", "s16", "-c:a", "flac", output,
  ]);
}

/**
 * Reads the FLAC STREAMINFO block (always the first metadata block) from the
 * first 42 bytes: "fLaC" (4) + block header (4) + STREAMINFO (34).
 */
async function readFlacInfo(filePath: string) {
  const handle = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(42);
    const { bytesRead } = await handle.read(buf, 0, 42, 0);
    if (bytesRead < 42 || buf.toString("ascii", 0, 4) !== "fLaC") throw new Error(`Not a FLAC file: ${filePath}`);
    // Bytes 10..17 of STREAMINFO: sample rate (20 bits) | channels-1 (3) | bits-1 (5) | total samples (36).
    const s = 8 + 10;
    const sampleRate = (buf[s] << 12) | (buf[s + 1] << 4) | (buf[s + 2] >> 4);
    const channels = ((buf[s + 2] >> 1) & 0b111) + 1;
    const totalSamples = (buf[s + 3] & 0x0f) * 2 ** 32 + buf.readUInt32BE(s + 4);
    const durationSeconds = sampleRate > 0 ? Math.round((totalSamples / sampleRate) * 1000) / 1000 : 0;
    return { sampleRate, channels, durationSeconds };
  } finally {
    await handle.close();
  }
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
}

async function mapConcurrent<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return results;
}

/** pathname → size of the Common Voice blobs already in the store. */
async function listUploaded(): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();
  let cursor: string | undefined;
  do {
    const page = await withRetry(() => list({ prefix: BLOB_PREFIX, cursor, limit: 1000, storeId }));
    for (const blob of page.blobs) sizes.set(blob.pathname, blob.size);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return sizes;
}

const count = parseCount();

console.log("Reading the Common Voice en dev transcripts…");
const tsv = await fetch(TSV_URL);
if (!tsv.ok) throw new Error(`GET ${TSV_URL}: ${tsv.status}`);
const sample = selectSample(parseTsv(await tsv.text()), count);
const groups = (key: (clip: Clip) => string) =>
  Object.entries(Object.groupBy(sample, key))
    .map(([name, clips]) => `${name} ${clips!.length}`)
    .join(", ");
console.log(`  ${sample.length} clips from ${sample.length} speakers.`);
console.log(`  Gender: ${groups((clip) => clip.gender)}`);
console.log(`  Age: ${groups((clip) => clip.age)}`);
console.log(`  ${new Set(sample.map((clip) => clip.accent)).size} accents: ${groups((clip) => clip.accent)}`);
if (process.argv.includes("--dry-run")) process.exit(0);

const workDir = await mkdtemp(path.join(tmpdir(), "commonvoice-"));
try {
  console.log("Extracting the sampled MP3s from the dev tar (717 MB stream)…");
  await extractMp3s(sample.map((clip) => clip.path), workDir);

  console.log("Converting to 16 kHz mono FLAC…");
  const items = await mapConcurrent(sample, async (clip) => {
    const clipId = clip.path.replace(/\.mp3$/, "");
    const fileName = `${clipId}.flac`;
    const filePath = path.join(workDir, fileName);
    await mp3ToFlac(path.join(workDir, clip.path), filePath);
    return { clip, clipId, fileName, filePath, ...(await readFlacInfo(filePath)) };
  });

  console.log("Uploading to Vercel Blob (private)…");
  const uploaded = await listUploaded();
  let skipped = 0;
  await mapConcurrent(items, async (item) => {
    const pathname = `${BLOB_PREFIX}${item.fileName}`;
    const { size } = await stat(item.filePath);
    if (uploaded.get(pathname) === size) {
      skipped++;
      return;
    }
    const body = await readFile(item.filePath);
    await withRetry(() =>
      put(pathname, body, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "audio/flac",
        storeId,
      }),
    );
  });
  console.log(`  ${items.length - skipped} uploaded, ${skipped} already there.`);

  // Upload first, so every row written below points at a blob that exists.
  console.log("Writing the rows to Postgres…");
  const rows = JSON.stringify(
    items.map(({ clip, clipId, fileName, durationSeconds, sampleRate, channels }) => ({
      id: `commonvoice-${clipId}`,
      source: "commonvoice",
      file_name: fileName,
      blob_pathname: `${BLOB_PREFIX}${fileName}`,
      duration_seconds: durationSeconds,
      sample_rate: sampleRate,
      channels,
      // CommonVoiceMetadata in src/server/audios/types.ts.
      metadata: {
        clipId,
        sentenceId: clip.sentenceId,
        speaker: { clientId: clip.clientId, age: clip.age || null, gender: clip.gender || null, accent: clip.accent || null },
        transcript: clip.sentence,
        upVotes: clip.upVotes,
        downVotes: clip.downVotes,
        locale: clip.locale,
      },
    })),
  );
  // Changing a row's metadata clears its vectors, so embed-catalog recomputes them.
  const written = await sql`
    INSERT INTO audios (id, source, file_name, blob_pathname, duration_seconds, sample_rate, channels, metadata)
    SELECT id, source, file_name, blob_pathname, duration_seconds, sample_rate, channels, metadata
    FROM jsonb_to_recordset(${rows}::jsonb) AS r(
      id text, source text, file_name text, blob_pathname text,
      duration_seconds double precision, sample_rate integer, channels smallint, metadata jsonb
    )
    ON CONFLICT (id) DO UPDATE SET
      source = EXCLUDED.source,
      file_name = EXCLUDED.file_name,
      blob_pathname = EXCLUDED.blob_pathname,
      duration_seconds = EXCLUDED.duration_seconds,
      sample_rate = EXCLUDED.sample_rate,
      channels = EXCLUDED.channels,
      metadata = EXCLUDED.metadata,
      audio_embedding = NULL,
      text_embedding = NULL,
      embedding_model = NULL,
      updated_at = now()
    WHERE audios.source = 'commonvoice'
      AND (audios.file_name, audios.blob_pathname, audios.duration_seconds,
           audios.sample_rate, audios.channels, audios.metadata)
      IS DISTINCT FROM (EXCLUDED.file_name, EXCLUDED.blob_pathname, EXCLUDED.duration_seconds,
           EXCLUDED.sample_rate, EXCLUDED.channels, EXCLUDED.metadata)
    RETURNING id
  `;
  const [{ total }] = await sql`SELECT count(*)::int AS total FROM audios WHERE source = 'commonvoice'`;
  console.log(`  ${written.length} rows inserted or updated; ${total} Common Voice rows in the catalog.`);
  console.log("Done. Run `pnpm embed-catalog` to embed the new clips.");
} finally {
  await rm(workDir, { recursive: true, force: true });
}
