#!/usr/bin/env node
// Download every dataset the app needs. Safe to re-run: only missing files are fetched.
//
// Usage: pnpm data:setup
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CACHE_DIR, requireCommands } from "./lib.mjs";
import { DATASETS } from "./status.mjs";

// Check every prerequisite before starting any download.
requireCommands(["tar", "unzip", "ffmpeg"]);

console.log(
  [
    "Downloading datasets (~520 MB). The first run takes about 10-15 minutes;",
    `files are cached in ${CACHE_DIR}, so later runs and other clones are instant.`,
    "",
  ].join("\n"),
);

const here = dirname(fileURLToPath(import.meta.url));
const failed = [];
for (const dataset of DATASETS) {
  const result = spawnSync(process.execPath, [join(here, dataset.script), ...dataset.args], {
    stdio: "inherit",
  });
  if (result.status !== 0) failed.push(dataset.name);
}

if (failed.length > 0) {
  console.error(`\nNot finished: ${failed.join(", ")}. Run \`pnpm data:setup\` again to resume.`);
  process.exit(1);
}
console.log("\nAll datasets ready in data/. See data/README.md for the file layout.");
