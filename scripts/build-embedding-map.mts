/**
 * Builds the file the Embedding Map view loads (public/embedding-map.json) from
 * the export in design/embedding-map/ (points.json, queries.json, summary.json).
 *
 *   node scripts/build-embedding-map.mts
 *
 * Needs no credentials: it only reads and writes files. Run it after
 * `pnpm export-embedding-map` so the map follows the catalog.
 */
import { readFile, writeFile } from "node:fs/promises";

import {
  type EmbeddingMapClip,
  type EmbeddingMapV1,
  SOUND_FAMILIES,
  type SoundFamily,
} from "../src/lib/embedding-map/types.ts";

const IN = new URL("../design/embedding-map/", import.meta.url);
const OUT = new URL("../public/embedding-map.json", import.meta.url);
const MAX_TEXT = 240;

type ExportPoint = {
  id: string;
  source: EmbeddingMapClip["source"];
  text: string;
  durationSeconds: number;
  waveformPeaks: number[] | null;
  audio: { x: number; y: number };
  textEmb: { x: number; y: number };
  soundFamily?: string;
  soundLabels?: string[];
  hasSpeech?: boolean;
  bookTitle?: string;
  chapterId?: string;
  speakerId?: string;
  speakerName?: string;
  sex?: "F" | "M";
  gender?: string;
  age?: string;
  accent?: string;
};
type Histogram = { binStart: number; binEnd: number; count: number }[];
type ExportQuery = {
  query: string;
  similarity: Record<"text" | "audio", { p10: number; p50: number; p90: number; histogram: Histogram }>;
};

async function readJson<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(new URL(name, IN), "utf8")) as T;
}

const round = (value: number, digits: number) => Number(value.toFixed(digits));

/** Common Voice stores gender as e.g. `female_feminine`. */
function genderOf(gender: string | undefined): "F" | "M" | undefined {
  if (gender?.startsWith("female")) return "F";
  if (gender?.startsWith("male")) return "M";
  return undefined;
}

function cut(text: string) {
  return text.length <= MAX_TEXT ? text : `${text.slice(0, MAX_TEXT - 1)}…`;
}

const points = (await readJson<{ points: ExportPoint[] }>("points.json")).points;
const { queries } = await readJson<{ queries: ExportQuery[] }>("queries.json");
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the summary is a loose report
const summary = await readJson<any>("summary.json");

const clips: EmbeddingMapClip[] = points.map((p) => {
  const clip: EmbeddingMapClip = {
    id: p.id,
    source: p.source,
    text: cut(p.text),
    durationSeconds: p.durationSeconds,
    waveformPeaks: p.waveformPeaks?.map((v) => round(v, 2)) ?? null,
    audioMap: [round(p.audio.x, 4), round(p.audio.y, 4)],
    textMap: [round(p.textEmb.x, 4), round(p.textEmb.y, 4)],
  };
  if (p.soundFamily) {
    if (!SOUND_FAMILIES.includes(p.soundFamily as SoundFamily)) throw new Error(`Unknown sound family ${p.soundFamily}`);
    clip.soundFamily = p.soundFamily as SoundFamily;
  }
  if (p.soundLabels) clip.soundLabels = p.soundLabels;
  if (p.hasSpeech !== undefined) clip.hasSpeech = p.hasSpeech;
  if (p.bookTitle) clip.bookTitle = p.bookTitle;
  if (p.chapterId) clip.chapterId = p.chapterId;
  if (p.speakerId) clip.speakerId = p.speakerId;
  if (p.speakerName) clip.speakerName = p.speakerName;
  if (p.sex) clip.sex = p.sex;
  const gender = genderOf(p.gender);
  if (gender) clip.gender = gender;
  if (p.age) clip.age = p.age;
  if (p.accent) clip.accent = p.accent;
  return clip;
});

const first = queries[0].similarity;
const binStarts = first.text.histogram.map((bin) => round(bin.binStart, 4));
const binWidth = round(first.text.histogram[0].binEnd - first.text.histogram[0].binStart, 4);
function summed(kind: "text" | "audio") {
  const counts = binStarts.map(() => 0);
  const avg = { p10: 0, p50: 0, p90: 0 };
  for (const q of queries) {
    q.similarity[kind].histogram.forEach((bin, i) => (counts[i] += bin.count));
    for (const key of ["p10", "p50", "p90"] as const) avg[key] += q.similarity[kind][key] / queries.length;
  }
  return { counts, p10: round(avg.p10, 3), p50: round(avg.p50, 3), p90: round(avg.p90, 3) };
}

const audio = summary.neighbors.audio;
const text = summary.neighbors.text;
const evaluation = summary.fromEvaluation;
const data: EmbeddingMapV1 = {
  version: 1,
  generatedAt: summary.generatedAt,
  model: summary.model,
  dimensions: summary.dimensions,
  umap: summary.umap,
  totalDurationHours: summary.clips.totalDurationHours,
  clips,
  stats: {
    sameDatasetNeighbors: audio.sameDatasetPercent,
    speechNeighborsOfSpeech: audio.speechNeighborsPercent.ofSpeechClips,
    soundFamily: {
      agreement: summary.groupAgreement.audiocapsSoundFamily.audio768d,
      chance: summary.groupAgreement.audiocapsSoundFamily.chancePercent,
    },
    hasSpeech: {
      withSpeech: summary.groupAgreement.audiocapsHasSpeech.withSpeech.speechNeighborsPercent,
      withoutSpeech: summary.groupAgreement.audiocapsHasSpeech.withoutSpeech.speechNeighborsPercent,
    },
    librispeech: {
      sameChapter: { audio: audio.librispeech.sameChapterPercent, text: text.librispeech.sameChapterPercent },
      sameSpeakerOtherChapter: {
        audio: audio.librispeech.sameSpeakerOtherChapterPercent,
        text: text.librispeech.sameSpeakerOtherChapterPercent,
      },
      sameSexOtherSpeakers: {
        audio: audio.librispeech.sameSexAmongOtherSpeakersPercent,
        text: text.librispeech.sameSexAmongOtherSpeakersPercent,
        chance: summary.groupAgreement.librispeechSexOtherSpeakers.chancePercent,
      },
    },
    commonvoiceSameGender: {
      audio: audio.commonvoice.sameGenderPercent,
      text: text.commonvoice.sameGenderPercent,
      chance: summary.commonvoice.genderChancePercent,
    },
  },
  modalityGap: {
    binStarts,
    binWidth,
    examples: { queries: queries.map((q) => q.query), text: summed("text"), audio: summed("audio") },
    evaluation: evaluation.querySimilarity,
  },
  examples: queries.map((q) => ({
    query: q.query,
    precisionAt10: evaluation.precisionAt10[q.query] ?? null,
  })),
};

const json = JSON.stringify(data);
await writeFile(OUT, json);
console.info(`Wrote ${OUT.pathname}: ${clips.length.toLocaleString()} clips, ${(json.length / 1024 / 1024).toFixed(2)} MB`);

