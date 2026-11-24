import "server-only";

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { LibriSpeechRecord, PendingRecord } from "./types";

/** Parses LibriSpeech's `;`-commented, `|`-separated metadata files. */
function parsePipeTable(text: string, columns: number): string[][] {
  const rows: string[][] = [];
  for (const line of text.split("\n")) {
    if (!line.trim() || line.startsWith(";")) continue;
    const parts = line.split("|").map((p) => p.trim());
    // Names/titles may contain "|": join the overflow back into the last column.
    if (parts.length > columns) {
      parts.splice(columns - 1, Infinity, parts.slice(columns - 1).join(" | "));
    }
    rows.push(parts);
  }
  return rows;
}

async function readOptional(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

async function listDirs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

export async function loadLibriSpeech(
  rootDir: string,
  subset = "dev-clean",
): Promise<PendingRecord<LibriSpeechRecord>[]> {
  const base = path.join(rootDir, "LibriSpeech");
  const subsetDir = path.join(base, subset);

  // ID | SEX | SUBSET | MINUTES | NAME
  const speakers = new Map(
    parsePipeTable(await readOptional(path.join(base, "SPEAKERS.TXT")), 5).map(
      ([id, sex, , , name]) => [id, { sex: sex || null, name: name || null }],
    ),
  );
  // ID | READER | MINUTES | SUBSET | PROJ. | BOOK ID | CH. TITLE | PROJECT TITLE
  const chapters = new Map(
    parsePipeTable(await readOptional(path.join(base, "CHAPTERS.TXT")), 8).map(
      ([id, , , , , , title, bookTitle]) => [
        id,
        { title: title || null, bookTitle: bookTitle || null },
      ],
    ),
  );

  const records: PendingRecord<LibriSpeechRecord>[] = [];
  for (const speakerId of await listDirs(subsetDir)) {
    const speakerDir = path.join(subsetDir, speakerId);
    for (const chapterId of await listDirs(speakerDir)) {
      const chapterDir = path.join(speakerDir, chapterId);
      const trans = await readOptional(
        path.join(chapterDir, `${speakerId}-${chapterId}.trans.txt`),
      );
      for (const line of trans.split("\n")) {
        const space = line.indexOf(" ");
        if (space <= 0) continue;
        const utteranceId = line.slice(0, space);
        const fileName = `${utteranceId}.flac`;
        records.push({
          id: `librispeech-${utteranceId}`,
          source: "librispeech",
          utteranceId,
          filePath: path.join(chapterDir, fileName),
          fileName,
          speaker: {
            id: speakerId,
            ...(speakers.get(speakerId) ?? { sex: null, name: null }),
          },
          chapter: {
            id: chapterId,
            ...(chapters.get(chapterId) ?? { title: null, bookTitle: null }),
          },
          transcript: line.slice(space + 1).trim(),
        });
      }
    }
  }
  return records;
}
