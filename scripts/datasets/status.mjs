#!/usr/bin/env node
// Lists the datasets the app needs. Run directly (as `pnpm dev` does) to print
// a reminder when some are missing; it never fails or downloads anything.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { DATA_DIR } from "./lib.mjs";

export const DATASETS = [
  {
    name: "LibriSpeech dev-clean",
    script: "librispeech.mjs",
    args: ["dev-clean"],
    marker: join(DATA_DIR, "librispeech", "LibriSpeech", "dev-clean"),
  },
  {
    name: "AudioCaps val",
    script: "audiocaps.mjs",
    args: ["--split=val"],
    marker: join(DATA_DIR, "audiocaps", "val", "manifest.jsonl"),
  },
];

export const missingDatasets = () => DATASETS.filter((d) => !existsSync(d.marker));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const missing = missingDatasets();
  if (missing.length > 0) {
    console.warn(
      `\x1b[33m⚠ Missing datasets: ${missing.map((d) => d.name).join(", ")}.\n` +
        "  Run `pnpm data:setup` to download them (see README → Getting started).\x1b[0m\n",
    );
  }
}
