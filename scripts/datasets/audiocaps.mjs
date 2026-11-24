#!/usr/bin/env node
// Download an AudioCaps split (https://github.com/cdjkim/audiocaps).
//
// AudioCaps ships only YouTube IDs + start times, so each 10 s clip is cut
// from YouTube with yt-dlp (standalone binary, auto-downloaded into the cache)
// and ffmpeg (must be installed, e.g. `brew install ffmpeg`).
//
// Usage: node scripts/datasets/audiocaps.mjs [--split=val|test|train]
//          [--concurrency=4] [--retry-unavailable]
//
// Output: data/audiocaps/<split>/
//   audio/<youtube_id>_<start>.flac   10 s, 16 kHz mono FLAC
//   manifest.jsonl                    one clip per line: id, youtube_id,
//                                     start_time, file, captions[], audiocap_ids[]
//   captions.csv                      original AudioCaps CSV (all rows)
//   unavailable.json                  clips whose video is gone (skipped on re-runs)
//
// Re-runs only fetch missing clips. Exits non-zero if clips failed for
// transient reasons (rate limits, network); run it again to fill the gaps.
import { execFile, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
} from "node:fs";
import { arch, platform } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

import {
  CACHE_DIR,
  DATA_DIR,
  download,
  log,
  mirror,
  requireCommands,
  tmpPath,
  writeFileAtomic,
} from "./lib.mjs";

const execFileAsync = promisify(execFile);

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    return [key, value ?? true];
  }),
);
const split = args.split ?? "val";
const concurrency = Number(args.concurrency ?? 4);
const retryUnavailable = Boolean(args["retry-unavailable"]);

// Pinned so captions never change underneath us.
const AUDIOCAPS_COMMIT = "d004db3ea1b01cf4fd0347dd8d27db90cadc8809";
const CSV_URL = `https://raw.githubusercontent.com/cdjkim/audiocaps/${AUDIOCAPS_COMMIT}/dataset/${split}.csv`;
const CLIP_SECONDS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const YTDLP_MAX_AGE_MS = 7 * DAY_MS; // YouTube breaks old yt-dlp versions
const YTDLP_BUILDS = {
  darwin: "yt-dlp_macos",
  linux: arch() === "arm64" ? "yt-dlp_linux_aarch64" : "yt-dlp_linux",
};
// yt-dlp errors that mean the clip will never be downloadable without an
// account. ("Sign in to confirm you're not a bot" is rate limiting, so it is
// deliberately not matched and gets retried.)
const UNAVAILABLE =
  /video unavailable|this video is unavailable|private video|has been removed|no longer available|account associated with this video has been terminated|copyright|not available in your country|blocked it in your country|confirm your age|please sign in\. this helps protect our community|members-only|members only/i;

const scope = `audiocaps:${split}`;
const cacheDir = join(CACHE_DIR, "audiocaps", split);
const audioDir = join(cacheDir, "audio");
const workspaceDir = join(DATA_DIR, "audiocaps", split);
const unavailablePath = join(cacheDir, "unavailable.json");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1);
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

// Uses yt-dlp's unpacked (.zip) build. The single-file build unpacks itself on
// every launch, which costs ~90 s per clip on macOS.
async function ensureYtDlp() {
  const build = YTDLP_BUILDS[platform()];
  if (!build) throw new Error(`No yt-dlp build for platform ${platform()}`);
  const binDir = join(CACHE_DIR, "bin");
  const pointer = join(binDir, "yt-dlp-current");
  const currentName = existsSync(pointer) ? readFileSync(pointer, "utf8").trim() : null;
  const current = currentName ? join(binDir, currentName, build) : null;
  if (current && existsSync(current) && Date.now() - statSync(pointer).mtimeMs < YTDLP_MAX_AGE_MS) {
    return current;
  }

  try {
    log(scope, "Downloading latest yt-dlp ...");
    const name = `yt-dlp-${Date.now()}`;
    const zip = tmpPath(join(binDir, `${build}.zip`));
    const extractDir = tmpPath(join(binDir, name));
    try {
      await download(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${build}.zip`, zip);
      const unzip = spawnSync("unzip", ["-q", zip, "-d", extractDir], { stdio: "inherit" });
      if (unzip.error || unzip.status !== 0) throw new Error("unzip failed (is `unzip` installed?)");
      chmodSync(join(extractDir, build), 0o755);
      renameSync(extractDir, join(binDir, name));
    } finally {
      rmSync(zip, { force: true });
      rmSync(extractDir, { recursive: true, force: true });
    }
    const bin = join(binDir, name, build);
    // The first launch is slow on macOS (security scan); get it out of the way
    // before launching many in parallel.
    spawnSync(bin, ["--version"], { stdio: "ignore" });
    writeFileAtomic(pointer, `${name}\n`);
    // Stamp the build we just replaced, so its mtime marks when it was
    // superseded rather than when it was downloaded.
    if (currentName && existsSync(join(binDir, currentName))) {
      const now = new Date();
      utimesSync(join(binDir, currentName), now, now);
    }
    // Remove older builds, with a day's grace (since being superseded) for
    // runs that may still use them.
    for (const entry of readdirSync(binDir)) {
      const path = join(binDir, entry);
      if (entry.startsWith("yt-dlp") && entry !== name && path !== pointer &&
          Date.now() - statSync(path).mtimeMs > DAY_MS) {
        rmSync(path, { recursive: true, force: true });
      }
    }
    return bin;
  } catch (error) {
    if (!current || !existsSync(current)) throw error;
    log(scope, `Could not update yt-dlp (${error.message}); using existing build`);
    return current;
  }
}

async function loadClips() {
  const csvPath = join(cacheDir, "captions.csv");
  if (!existsSync(csvPath)) {
    const res = await fetch(CSV_URL);
    if (!res.ok) throw new Error(`GET ${CSV_URL} failed: HTTP ${res.status}`);
    writeFileAtomic(csvPath, await res.text());
  }
  const [header, ...rows] = parseCsv(readFileSync(csvPath, "utf8"));
  const col = Object.fromEntries(header.map((name, i) => [name, i]));
  const clips = new Map();
  for (const row of rows) {
    const youtubeId = row[col.youtube_id];
    const startTime = Number(row[col.start_time]);
    const id = `${youtubeId}_${startTime}`;
    const clip = clips.get(id) ?? {
      id,
      youtube_id: youtubeId,
      start_time: startTime,
      file: `audio/${id}.flac`,
      captions: [],
      audiocap_ids: [],
    };
    clip.captions.push(row[col.caption]);
    clip.audiocap_ids.push(Number(row[col.audiocap_id]));
    clips.set(id, clip);
  }
  return [...clips.values()];
}

/** Returns "ok", or { unavailable: reason }, or { error: reason }. */
async function fetchClip(ytDlp, clip) {
  const tmpBase = join(audioDir, `${clip.id}.tmp-${process.pid}`);
  const end = clip.start_time + CLIP_SECONDS;
  try {
    await execFileAsync(
      ytDlp,
      [
        "--quiet",
        "--no-warnings",
        "--no-progress",
        "--no-playlist",
        "--js-runtimes",
        `node:${process.execPath}`,
        "--retries",
        "3",
        "-f",
        "bestaudio/best",
        "--download-sections",
        `*${clip.start_time}-${end}`,
        "--force-keyframes-at-cuts",
        "-x",
        "--audio-format",
        "flac",
        "--postprocessor-args",
        "ffmpeg:-ar 16000 -ac 1",
        "-o",
        `${tmpBase}.%(ext)s`,
        "--",
        `https://www.youtube.com/watch?v=${clip.youtube_id}`,
      ],
      { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 },
    );
    if (!existsSync(`${tmpBase}.flac`)) return { error: "yt-dlp produced no file" };
    renameSync(`${tmpBase}.flac`, join(audioDir, `${clip.id}.flac`));
    return "ok";
  } catch (error) {
    const message = `${error.stderr ?? ""}${error.message ?? ""}`;
    const reason = (
      message
        .split("\n")
        .find((line) => line.startsWith("ERROR:"))
        ?.replace(/^ERROR:\s*(\[[^\]]+\]\s*[\w-]+:\s*)?/, "") ??
      (error.killed ? "timed out" : message.trim().split("\n").pop())
    ).split(/\.\s/)[0]; // first sentence; yt-dlp appends long FAQ hints
    return UNAVAILABLE.test(message) ? { unavailable: reason } : { error: reason };
  } finally {
    const prefix = basename(tmpBase);
    for (const name of readdirSync(audioDir)) {
      if (name.startsWith(prefix)) rmSync(join(audioDir, name), { force: true });
    }
  }
}

async function runPool(items, size, worker) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await worker(items[next++]);
    }),
  );
}

requireCommands(["ffmpeg", "unzip"]);
const clips = await loadClips();
const unavailable = readJson(unavailablePath, {});
const present = (clip) => existsSync(join(audioDir, `${clip.id}.flac`));
const todo = clips.filter((clip) => !present(clip) && (retryUnavailable || !unavailable[clip.id]));

if (todo.length > 0) {
  const ytDlp = await ensureYtDlp();
  mkdirSync(audioDir, { recursive: true });
  // Clean up partial files left by interrupted runs (not ones still in progress).
  for (const name of readdirSync(audioDir)) {
    const path = join(audioDir, name);
    if (name.includes(".tmp-") && Date.now() - statSync(path).mtimeMs > 60 * 60 * 1000) {
      rmSync(path, { force: true });
    }
  }
  log(scope, `Fetching ${todo.length} of ${clips.length} clips from YouTube (concurrency ${concurrency}) ...`);

  let done = 0;
  let failed = [];
  const recovered = new Set();
  const attempt = async (clip) => {
    const result = await fetchClip(ytDlp, clip);
    done++;
    if (result === "ok") {
      delete unavailable[clip.id];
      recovered.add(clip.id);
    } else if (result.unavailable) {
      unavailable[clip.id] = result.unavailable;
      log(scope, `${clip.id}: unavailable (${result.unavailable})`);
    } else {
      failed.push(clip);
      log(scope, `${clip.id}: failed (${result.error})`);
    }
    if (done % 25 === 0) log(scope, `${done}/${todo.length} processed`);
  };
  await runPool(todo, concurrency, attempt);

  if (failed.length > 0) {
    log(scope, `Retrying ${failed.length} failed clips one at a time ...`);
    const retry = failed;
    failed = [];
    done = 0;
    await runPool(retry, 1, attempt);
  }

  // Merge with entries written by concurrent runs before saving, dropping
  // clips this run managed to download.
  const merged = { ...readJson(unavailablePath, {}), ...unavailable };
  for (const id of recovered) delete merged[id];
  writeFileAtomic(unavailablePath, `${JSON.stringify(merged, null, 2)}\n`);
  if (failed.length > 0) {
    process.exitCode = 1;
    log(scope, `${failed.length} clips failed (likely rate limiting). Re-run \`pnpm data:audiocaps\` to fetch them.`);
  }
} else {
  log(scope, `Using cached copy in ${cacheDir}`);
}

const available = clips.filter(present);
writeFileAtomic(
  join(cacheDir, "manifest.jsonl"),
  available.map((clip) => JSON.stringify(clip)).join("\n") + "\n",
);
const copied = mirror(cacheDir, workspaceDir, {
  refresh: ["manifest.jsonl", "unavailable.json", "captions.csv"],
});
log(
  scope,
  `Ready at data/audiocaps/${split}: ${available.length}/${clips.length} clips ` +
    `(${Object.keys(readJson(unavailablePath, {})).length} unavailable on YouTube, ${copied} files copied into workspace)`,
);
