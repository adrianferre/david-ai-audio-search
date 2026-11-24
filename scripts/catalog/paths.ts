import path from "node:path";

/**
 * Blob pathname of a file under `data/`: its path relative to `data/`, with
 * forward slashes (e.g. `audiocaps/val/audio/vfY_TJq7n_U_130.flac`).
 */
export function blobPathnameFor(dataDir: string, filePath: string): string {
  return path.relative(dataDir, filePath).split(path.sep).join("/");
}
