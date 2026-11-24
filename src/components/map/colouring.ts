import type { AudioSource } from "@/lib/api/v1/types";
import { type EmbeddingMapClip, SOUND_FAMILIES } from "@/lib/embedding-map/types";

import { SOURCE_LABEL } from "../audios/datasets";

/**
 * The canvas paints with hex values, not CSS classes: these are the dataset
 * colours of globals.css (`--color-librispeech`, …), and must stay equal.
 */
export const SOURCE_COLOR: Record<AudioSource, string> = {
  librispeech: "#4b4592",
  audiocaps: "#d9822b",
  commonvoice: "#3f8a73",
};

/**
 * Six hues checked with the dataviz palette validator on the map's ground
 * (#f9f9f6) over ALL pairs, not only neighbours in a legend: on a scatter any
 * two groups can sit side by side. Seven or more failed that check for
 * colour-blind readers, so categories beyond six fold into "Other".
 */
export const CATEGORY_COLORS = ["#1f4e99", "#e0502a", "#1baf7a", "#b04fc8", "#e9ad22", "#8a2f5a"];
/** "Other", and points outside the colouring (a sound when colouring speakers). */
export const OTHER_COLOR = "#c9cac1";
/** Common Voice age, an ordered scale: one hue, light to dark. */
const AGE_COLORS = ["#b5cdee", "#84abe2", "#5487d0", "#2d63b0", "#173f7d"];
const AGE_GROUPS: { label: string; ages: string[] }[] = [
  { label: "Teens", ages: ["teens"] },
  { label: "20s", ages: ["twenties"] },
  { label: "30s", ages: ["thirties"] },
  { label: "40s", ages: ["fourties", "forties"] },
  { label: "50 and over", ages: [] },
];

export type ColourBy = "dataset" | "family" | "book" | "speaker" | "sex" | "age" | "accent";

export const COLOUR_BY_OPTIONS: { value: ColourBy; label: string }[] = [
  { value: "dataset", label: "Dataset" },
  { value: "family", label: "Sound family" },
  { value: "book", label: "Book" },
  { value: "speaker", label: "Speaker" },
  { value: "sex", label: "Sex / gender" },
  { value: "age", label: "Age" },
  { value: "accent", label: "Accent" },
];

/** Which clips a colouring applies to, for the legend's title. */
const SCOPE: Record<ColourBy, string | null> = {
  dataset: null,
  family: SOURCE_LABEL.audiocaps,
  book: SOURCE_LABEL.librispeech,
  speaker: SOURCE_LABEL.librispeech,
  sex: "speech",
  age: SOURCE_LABEL.commonvoice,
  accent: SOURCE_LABEL.commonvoice,
};

export type ColourGroup = { label: string; color: string; count: number; other?: boolean };

export type Colouring = {
  by: ColourBy;
  scope: string | null;
  groups: ColourGroup[];
  /** Index into `groups` per clip, or -1 when the colouring doesn't apply to it. */
  groupOf: Int16Array;
};

const MAX_GROUPS = CATEGORY_COLORS.length;

/** The `MAX_GROUPS` largest values of `key` among `source`'s clips, and the rest as "Other". */
function largest(
  clips: readonly EmbeddingMapClip[],
  source: AudioSource,
  key: (clip: EmbeddingMapClip) => string | undefined,
  label: (value: string) => string,
  noun: string,
): Pick<Colouring, "groups" | "groupOf"> {
  const counts = new Map<string, number>();
  for (const clip of clips) {
    const value = clip.source === source ? key(clip) : undefined;
    if (value !== undefined) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = sorted.slice(0, MAX_GROUPS);
  const rest = sorted.slice(MAX_GROUPS);
  const index = new Map(top.map(([value], i) => [value, i]));
  const groups: ColourGroup[] = top.map(([value, count], i) => ({ label: label(value), color: CATEGORY_COLORS[i], count }));
  if (rest.length > 0) {
    groups.push({
      label: `${rest.length} other ${noun}`,
      color: OTHER_COLOR,
      count: rest.reduce((sum, [, count]) => sum + count, 0),
      other: true,
    });
  }
  const groupOf = new Int16Array(clips.length).fill(-1);
  clips.forEach((clip, i) => {
    const value = clip.source === source ? key(clip) : undefined;
    if (value !== undefined) groupOf[i] = index.get(value) ?? MAX_GROUPS;
  });
  return { groups, groupOf };
}

export function colouringOf(clips: readonly EmbeddingMapClip[], by: ColourBy): Colouring {
  const groupOf = new Int16Array(clips.length).fill(-1);
  const counted = (labels: string[], colors: string[]) => {
    const counts = labels.map(() => 0);
    groupOf.forEach((group) => {
      if (group >= 0) counts[group]++;
    });
    return labels.map((label, i) => ({ label, color: colors[i], count: counts[i] }));
  };
  const scope = SCOPE[by];

  switch (by) {
    case "dataset": {
      const sources: AudioSource[] = ["librispeech", "audiocaps", "commonvoice"];
      clips.forEach((clip, i) => (groupOf[i] = sources.indexOf(clip.source)));
      return { by, scope, groupOf, groups: counted(sources.map((s) => SOURCE_LABEL[s]), sources.map((s) => SOURCE_COLOR[s])) };
    }
    case "family":
      clips.forEach((clip, i) => {
        if (clip.soundFamily) groupOf[i] = SOUND_FAMILIES.indexOf(clip.soundFamily);
      });
      return { by, scope, groupOf, groups: counted([...SOUND_FAMILIES], CATEGORY_COLORS) };
    case "book":
      return { by, scope, ...largest(clips, "librispeech", (c) => c.bookTitle, (b) => b, "books") };
    case "speaker": {
      const sex = new Map(clips.map((c) => [c.speakerId, c.sex]));
      return {
        by,
        scope,
        ...largest(clips, "librispeech", (c) => c.speakerId, (s) => `Speaker ${s} · ${sex.get(s) ?? "?"}`, "speakers"),
      };
    }
    case "sex":
      clips.forEach((clip, i) => {
        const value = clip.source === "librispeech" ? clip.sex : clip.source === "commonvoice" ? clip.gender : undefined;
        if (value) groupOf[i] = value === "F" ? 0 : 1;
      });
      return { by, scope, groupOf, groups: counted(["Female", "Male"], [CATEGORY_COLORS[1], CATEGORY_COLORS[0]]) };
    case "age":
      clips.forEach((clip, i) => {
        if (clip.source !== "commonvoice" || !clip.age) return;
        const group = AGE_GROUPS.findIndex((g) => g.ages.includes(clip.age!));
        groupOf[i] = group >= 0 ? group : AGE_GROUPS.length - 1;
      });
      return { by, scope, groupOf, groups: counted(AGE_GROUPS.map((g) => g.label), AGE_COLORS) };
    case "accent":
      return { by, scope, ...largest(clips, "commonvoice", (c) => c.accent, (a) => a, "accents") };
  }
}

/** The colour a clip is painted in under `colouring`. */
export function colourOf(colouring: Colouring, index: number): string {
  const group = colouring.groupOf[index];
  return group < 0 ? OTHER_COLOR : colouring.groups[group].color;
}
