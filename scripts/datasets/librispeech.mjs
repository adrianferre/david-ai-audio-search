#!/usr/bin/env node
// Download a LibriSpeech subset from OpenSLR (https://www.openslr.org/12).
//
// Usage: node scripts/datasets/librispeech.mjs [subset]   (default: dev-clean)
//
// Output: data/librispeech/LibriSpeech/<subset>/<speaker>/<chapter>/
//   <speaker>-<chapter>-<utt>.flac     16 kHz mono FLAC
//   <speaker>-<chapter>.trans.txt      "<utterance-id> <TRANSCRIPT>" per line
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
  CACHE_DIR,
  DATA_DIR,
  cloneFile,
  download,
  log,
  mirror,
  requireCommands,
  tmpPath,
} from "./lib.mjs";

const subset = process.argv[2] ?? "dev-clean";
requireCommands(["tar"]);
const BASE_URL = "https://www.openslr.org/resources/12";
const METADATA_FILES = ["BOOKS.TXT", "CHAPTERS.TXT", "LICENSE.TXT", "README.TXT", "SPEAKERS.TXT"];

const cacheRoot = join(CACHE_DIR, "librispeech", "LibriSpeech");
const workspaceRoot = join(DATA_DIR, "librispeech", "LibriSpeech");
const scope = `librispeech:${subset}`;

async function fetchToCache() {
  const sums = await (await fetch(`${BASE_URL}/md5sum.txt`)).text();
  const md5 = sums
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .find(([, file]) => file === `${subset}.tar.gz`)?.[0];
  if (!md5) throw new Error(`Unknown LibriSpeech subset: ${subset}`);

  mkdirSync(cacheRoot, { recursive: true });
  const tarball = tmpPath(join(cacheRoot, `${subset}.tar.gz`));
  const extractDir = tmpPath(join(cacheRoot, "extract"));
  try {
    log(scope, `Downloading ${subset}.tar.gz ...`);
    await download(`${BASE_URL}/${subset}.tar.gz`, tarball, { md5 });
    log(scope, "Extracting ...");
    mkdirSync(extractDir);
    const tar = spawnSync("tar", ["-xzf", tarball, "-C", extractDir], { stdio: "inherit" });
    if (tar.status !== 0) throw new Error("tar extraction failed");
    const extracted = join(extractDir, "LibriSpeech");
    for (const file of METADATA_FILES) {
      const target = join(cacheRoot, file);
      if (!existsSync(target) && existsSync(join(extracted, file))) {
        renameSync(join(extracted, file), target);
      }
    }
    // Another workspace may have finished first; keep whichever landed.
    if (!existsSync(join(cacheRoot, subset))) {
      renameSync(join(extracted, subset), join(cacheRoot, subset));
    }
  } finally {
    rmSync(tarball, { force: true });
    rmSync(extractDir, { recursive: true, force: true });
  }
}

if (existsSync(join(cacheRoot, subset))) {
  log(scope, `Using cached copy in ${cacheRoot}`);
} else {
  await fetchToCache();
}

const copied = mirror(join(cacheRoot, subset), join(workspaceRoot, subset));
for (const file of METADATA_FILES) {
  if (existsSync(join(cacheRoot, file)) && !existsSync(join(workspaceRoot, file))) {
    cloneFile(join(cacheRoot, file), join(workspaceRoot, file));
  }
}
log(scope, `Ready at data/librispeech/LibriSpeech/${subset} (${copied} files copied into workspace)`);
