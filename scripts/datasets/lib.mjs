// Shared helpers for dataset download scripts.
//
// Datasets are downloaded once per machine into a shared cache
// (~/.cache/david-ai-audio-search, override with DATASETS_CACHE_DIR) and then
// mirrored into each workspace's gitignored data/ directory. On macOS (APFS)
// the mirror uses copy-on-write clones, so every workspace gets its own files
// without using extra disk space. All writes go through a temp file + rename,
// so concurrent runs from several workspaces can't leave partial files behind.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  constants,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DATA_DIR = join(REPO_ROOT, "data");
export const CACHE_DIR =
  process.env.DATASETS_CACHE_DIR ||
  join(homedir(), ".cache", "david-ai-audio-search");

const TMP_MARKER = ".tmp-";

export function tmpPath(path) {
  return `${path}${TMP_MARKER}${process.pid}-${Date.now()}`;
}

export function writeFileAtomic(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = tmpPath(path);
  writeFileSync(tmp, contents);
  renameSync(tmp, path);
}

/** Download `url` to `dest` atomically, optionally verifying an MD5 checksum. */
export async function download(url, dest, { md5 } = {}) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`GET ${url} failed: HTTP ${res.status}`);
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = tmpPath(dest);
  const hash = createHash("md5");
  const tap = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(res.body), tap, createWriteStream(tmp));
    const actual = hash.digest("hex");
    if (md5 && actual !== md5) {
      throw new Error(`Checksum mismatch for ${url}: expected ${md5}, got ${actual}`);
    }
    renameSync(tmp, dest);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

/** Copy one file, as an APFS clone when possible. */
export function cloneFile(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  const tmp = tmpPath(to);
  copyFileSync(from, tmp, constants.COPYFILE_FICLONE);
  renameSync(tmp, to);
}

/**
 * Mirror `src` into `dest`: copies files missing from `dest`, and always
 * refreshes files whose name is in `refresh` (small metadata files).
 * Returns the number of files copied.
 */
export function mirror(src, dest, { refresh = [] } = {}) {
  let copied = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.includes(TMP_MARKER)) continue;
      const from = join(dir, entry.name);
      const to = join(dest, relative(src, from));
      if (entry.isDirectory()) {
        walk(from);
      } else if (entry.isFile() && (!existsSync(to) || refresh.includes(entry.name))) {
        cloneFile(from, to);
        copied++;
      }
    }
  };
  mkdirSync(dest, { recursive: true });
  walk(src);
  return copied;
}

export function log(scope, message) {
  console.log(`[${scope}] ${message}`);
}

const INSTALL_HINTS = {
  ffmpeg: { darwin: "brew install ffmpeg", linux: "sudo apt install ffmpeg  (or your distro's package manager)" },
  unzip: { darwin: "preinstalled on macOS", linux: "sudo apt install unzip" },
  tar: { darwin: "preinstalled on macOS", linux: "sudo apt install tar" },
};

/** Exit with install instructions if any command-line tool is missing. */
export function requireCommands(commands) {
  if (process.platform === "win32") {
    console.error("Dataset scripts support macOS and Linux. On Windows, run them inside WSL.");
    process.exit(1);
  }
  const missing = commands.filter((cmd) => {
    const result = spawnSync(cmd, [cmd === "unzip" ? "-v" : "--version"], { stdio: "ignore" });
    return result.error !== undefined;
  });
  if (missing.length === 0) return;
  console.error("Missing required tools for downloading datasets:\n");
  for (const cmd of missing) {
    console.error(`  - ${cmd}: ${INSTALL_HINTS[cmd]?.[process.platform] ?? "install it and add it to PATH"}`);
  }
  console.error("\nInstall them, then run `pnpm data:setup` again.");
  process.exit(1);
}
