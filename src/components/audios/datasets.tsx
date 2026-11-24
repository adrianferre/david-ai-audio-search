import type { AudioSource } from "@/lib/api/v1/types";
import { cn } from "@/lib/utils";

import { formatClock } from "./waveform";

export const SOURCE_LABEL: Record<AudioSource, string> = {
  librispeech: "LibriSpeech",
  audiocaps: "AudioCaps",
  commonvoice: "Common Voice",
};

/** Each dataset keeps one colour: its swatch, and its tag's fill and text. */
export const SOURCE_SWATCH_CLASS: Record<AudioSource, string> = {
  librispeech: "bg-librispeech",
  audiocaps: "bg-audiocaps",
  commonvoice: "bg-commonvoice",
};

const TAG_CLASS: Record<AudioSource, string> = {
  librispeech: "bg-librispeech-soft text-librispeech-ink",
  audiocaps: "bg-audiocaps-soft text-audiocaps-ink",
  commonvoice: "bg-commonvoice-soft text-commonvoice-ink",
};

export function DatasetTag({ source, className }: { source: AudioSource; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap",
        TAG_CLASS[source],
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-[2px]", SOURCE_SWATCH_CLASS[source])} />
      {SOURCE_LABEL[source]}
    </span>
  );
}

/**
 * The clip's text as a title (list rows, headlines). LibriSpeech
 * transcripts are all capitals; they read better in sentence case, though names
 * lose their capital ("Mister quilter"). Where the transcript is shown as data
 * (the details panel, copy, the export) it is the dataset's, unchanged.
 */
export function displayText(clip: { source: AudioSource; text: string }): string {
  if (clip.source !== "librispeech") return clip.text;
  const lower = clip.text.toLowerCase().replace(/\bi\b/g, "I");
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * The clip's title as the UI shows it. An AudioCaps title is its AudioSet labels
 * then its segment, "Sneeze, Speech · YouTube <id> @ 70s"; the start reads better
 * as a time.
 */
export function displayTitle(clip: { source: AudioSource; title: string }): string {
  const youtube = /^(?:(.+) · )?YouTube (\S+) @ (\d+)s$/.exec(clip.title);
  if (clip.source === "audiocaps" && youtube) {
    const [, labels, id, start] = youtube;
    return [labels, `YouTube ${id} · from ${formatClock(Number(start))}`].filter(Boolean).join(" · ");
  }
  return clip.title;
}

/** The dataset and the split the catalog took from it, e.g. "LibriSpeech dev-clean". */
export function datasetWithSplit(source: AudioSource, split: string | undefined): string {
  return split ? `${SOURCE_LABEL[source]} ${split}` : SOURCE_LABEL[source];
}
