"use client";

import { StarIcon } from "lucide-react";

import type { EmbeddingMapClip } from "@/lib/embedding-map/types";

import { DatasetTag, displayText, SOURCE_LABEL } from "../audios/datasets";
import { formatClock, Waveform } from "../audios/waveform";
import { type Colouring, SOURCE_COLOR } from "./colouring";
import type { MapPoint } from "./scatter";

type Size = { width: number; height: number };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** What a clip is, past its text: its sound family and labels, its book and reader, or its speaker. */
export function clipFacts(clip: EmbeddingMapClip): string {
  switch (clip.source) {
    case "audiocaps": {
      const labels = (clip.soundLabels ?? []).filter((label) => label !== "Speech").slice(0, 2);
      return [clip.soundFamily, labels.join(", ")].filter(Boolean).join(" · ");
    }
    case "librispeech": {
      // As the list and the details panel name the reader: "read by John Rose", "John Rose · male · #1272".
      const sex = clip.sex === "F" ? "female" : clip.sex === "M" ? "male" : null;
      const reader = clip.speakerId && [clip.speakerName ?? "Speaker", sex, `#${clip.speakerId}`].filter(Boolean).join(" · ");
      return [clip.bookTitle, reader].filter(Boolean).join(" · ");
    }
    case "commonvoice":
      return (
        [clip.gender === "F" ? "Female" : clip.gender === "M" ? "Male" : null, clip.age, clip.accent]
          .filter(Boolean)
          .join(" · ") || "Common Voice speaker"
      );
  }
}

/**
 * The white card next to the hovered dot. `text` replaces the clip's own when
 * it is a search result: the caption the list shows for it.
 */
export function HoverCard({
  clip,
  text = clip.text,
  at,
  size,
}: {
  clip: EmbeddingMapClip;
  text?: string;
  at: MapPoint;
  size: Size;
}) {
  const width = 284;
  const left = at[0] + 14 + width > size.width - 8 ? at[0] - width - 14 : at[0] + 14;
  const top = clamp(at[1] - 24, 8, size.height - 170);
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 flex flex-col gap-2.5 rounded-xl border bg-card p-3 shadow-[0_12px_28px_rgba(26,26,25,0.14)]"
      style={{ left, top, width }}
    >
      <div className="flex items-center gap-2">
        <DatasetTag source={clip.source} />
        <span className="ml-auto font-mono text-xs text-muted-foreground tabular-nums">
          {formatClock(clip.durationSeconds)}
        </span>
      </div>
      <Waveform peaks={clip.waveformPeaks} bars={64} height={28} barWidth={2} gap={2} />
      <p className="line-clamp-2 text-[0.85rem] leading-[19px] font-medium">
        {displayText({ source: clip.source, text })}
      </p>
      <p className="line-clamp-2 text-xs leading-[17px] text-muted-foreground">{clipFacts(clip)}</p>
    </div>
  );
}

export type GroupLabel = { text: string; count: number; color: string; x: number; y: number; width: number };

/**
 * One label per colour group, at the centre of its visible dots, nudged down
 * until it overlaps no other label. Only for colourings whose groups form
 * regions (datasets, sound families, books, speakers).
 */
export function groupLabels(
  clips: readonly EmbeddingMapClip[],
  colouring: Colouring,
  hidden: Uint8Array,
  place: (index: number) => MapPoint,
  size: Size,
): GroupLabel[] {
  if (!["dataset", "family", "book", "speaker"].includes(colouring.by)) return [];
  const n = colouring.groups.length;
  const sumX = new Float64Array(n);
  const sumY = new Float64Array(n);
  const count = new Int32Array(n);
  for (let i = 0; i < clips.length; i++) {
    const group = colouring.groupOf[i];
    if (group < 0 || hidden[i] || colouring.groups[group].other) continue;
    const [x, y] = place(i);
    sumX[group] += x;
    sumY[group] += y;
    count[group]++;
  }
  const labels: GroupLabel[] = [];
  colouring.groups.forEach((group, g) => {
    if (!count[g]) return;
    const text = group.label.length > 26 ? `${group.label.slice(0, 24)}…` : group.label;
    const width = text.length * 6.4 + 44 + String(group.count).length * 7;
    const [cx, cy] = [sumX[g] / count[g], sumY[g] / count[g]];
    if (cx < -20 || cy < -20 || cx > size.width + 20 || cy > size.height + 20) return;
    labels.push({ text, count: group.count, color: group.color, width, x: cx - width / 2, y: cy - 12 });
  });
  labels.sort((a, b) => a.y - b.y);
  const placed: GroupLabel[] = [];
  for (const label of labels) {
    label.x = clamp(label.x, 8, size.width - label.width - 8);
    label.y = clamp(label.y, 56, size.height - 40);
    for (let tries = 0; tries < 12; tries++) {
      const overlaps = placed.some(
        (p) => label.x < p.x + p.width + 4 && p.x < label.x + label.width + 4 && label.y < p.y + 28 && p.y < label.y + 28,
      );
      if (!overlaps) break;
      label.y += 28;
    }
    placed.push(label);
  }
  return placed;
}

export function GroupLabels({ labels, faded }: { labels: GroupLabel[]; faded: boolean }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ opacity: faded ? 0.55 : 1 }}>
      {labels.map((label) => (
        <span
          key={label.text}
          className="absolute inline-flex h-6 items-center gap-1.5 rounded-full border bg-card/95 px-2.5 text-[11.5px] font-medium whitespace-nowrap shadow-[0_1px_2px_rgba(26,26,25,0.06)]"
          style={{ left: label.x, top: label.y }}
        >
          <span className="size-[7px] rounded-[2px]" style={{ background: label.color }} />
          {label.text}
          <span className="font-mono font-normal text-muted-foreground tabular-nums">{label.count.toLocaleString()}</span>
        </span>
      ))}
    </div>
  );
}

export function AnchorLabel({ text, at, size }: { text: string; at: MapPoint; size: Size }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inline-flex h-[26px] items-center gap-1.5 rounded-full bg-primary px-2.5 text-xs font-medium whitespace-nowrap text-primary-foreground"
      style={{ left: clamp(at[0] + 26, 8, size.width - 200), top: clamp(at[1] - 40, 56, size.height - 40) }}
    >
      <StarIcon className="size-3 fill-current" />
      {text}
    </span>
  );
}

/** What the colours mean, with each group's size. */
export function Legend({ colouring, outsideCount }: { colouring: Colouring; outsideCount: number }) {
  const title = colouring.scope ?? "Every clip";
  return (
    <div className="absolute top-16 left-3 flex max-w-[250px] flex-col gap-1.5 rounded-xl border bg-card/95 px-3 py-2.5 shadow-[0_2px_6px_rgba(26,26,25,0.05)]">
      <span className="text-[11.5px] font-medium text-muted-foreground">{title}</span>
      <ul className="flex flex-col gap-1.5">
        {colouring.groups.map((group) => (
          <LegendRow key={group.label} label={group.label} color={group.color} count={group.count} />
        ))}
        {outsideCount > 0 && <LegendRow label="Other datasets" color="#e1e2da" count={outsideCount} />}
      </ul>
    </div>
  );
}

function LegendRow({ label, color, count }: { label: string; color: string; count: number }) {
  return (
    <li className="grid grid-cols-[8px_minmax(0,1fr)_auto] items-center gap-2 text-[0.8rem]">
      <span className="size-2 rounded-[2px]" style={{ background: color }} />
      <span className="truncate" title={label}>
        {label}
      </span>
      <span className="font-mono text-[11.5px] text-muted-foreground tabular-nums">{count.toLocaleString()}</span>
    </li>
  );
}

const STOP_WORDS = new Set(
  (
    "the a an and of to in that it was he i his you her she had with as for is on at but not be by my him they me " +
    "this which so all were from have when there their them one or what we would no said been then if could are " +
    "will out up into do more who now very upon some its our your has than only any can over such these those about " +
    "after before did down like just made may most must much other own same see should two us way well where while " +
    "how here why too also each even ever every few still through under again off once both until against between " +
    "because being during further shall mrs mr little know"
  ).split(" "),
);

function top(counts: Map<string, number>, n: number) {
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
}

/**
 * What a drawn selection holds: how many clips of each dataset, its largest
 * sound families and books, and its most common words (or AudioSet labels).
 * The selection bar below it downloads them.
 */
export function SelectionSummary({ clips }: { clips: EmbeddingMapClip[] }) {
  const mix = new Map<EmbeddingMapClip["source"], number>();
  const families = new Map<string, number>();
  const books = new Map<string, number>();
  const words = new Map<string, number>();
  const labels = new Map<string, number>();
  for (const clip of clips) {
    mix.set(clip.source, (mix.get(clip.source) ?? 0) + 1);
    if (clip.soundFamily) families.set(clip.soundFamily, (families.get(clip.soundFamily) ?? 0) + 1);
    if (clip.bookTitle) books.set(clip.bookTitle, (books.get(clip.bookTitle) ?? 0) + 1);
    for (const label of clip.soundLabels ?? []) if (label !== "Speech") labels.set(label, (labels.get(label) ?? 0) + 1);
    if (clip.source !== "audiocaps") {
      for (const word of clip.text.toLowerCase().replace(/[^a-z' ]/g, " ").split(/\s+/)) {
        if (word.length > 2 && !STOP_WORDS.has(word)) words.set(word, (words.get(word) ?? 0) + 1);
      }
    }
  }
  const speech = (mix.get("librispeech") ?? 0) + (mix.get("commonvoice") ?? 0) > (mix.get("audiocaps") ?? 0);
  const groups = [
    { title: "Largest sound families", items: top(families, 3) },
    { title: "Largest books", items: top(books, 3) },
  ].filter((group) => group.items.length > 0);
  const terms = top(speech ? words : labels, 6).map(([term]) => term);
  const sources = (["librispeech", "audiocaps", "commonvoice"] as const).filter((s) => mix.get(s));

  return (
    <section
      aria-label="What the selection holds"
      className="pointer-events-auto flex w-[290px] flex-col gap-3.5 rounded-[14px] border bg-card p-4 shadow-[0_12px_28px_rgba(26,26,25,0.12)]"
    >
      <p className="font-serif text-xl leading-[26px]">
        <span className="font-mono text-[19px] tabular-nums">{clips.length.toLocaleString()}</span> clips in the selection
      </p>
      <div className="flex flex-col gap-1.5">
        <span className="text-[11.5px] font-medium text-muted-foreground">Dataset mix</span>
        <div aria-hidden="true" className="flex h-2 gap-0.5">
          {sources.map((source) => (
            <span
              key={source}
              className="rounded-full"
              style={{ flex: `${mix.get(source)} 1 0`, background: SOURCE_COLOR[source] }}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {sources.map((source) => (
            <span key={source} className="inline-flex items-center gap-1.5 text-xs">
              <span className="size-[7px] rounded-[2px]" style={{ background: SOURCE_COLOR[source] }} />
              {SOURCE_LABEL[source]}
              <span className="font-mono text-muted-foreground tabular-nums">{mix.get(source)}</span>
            </span>
          ))}
        </div>
      </div>
      {groups.map((group) => (
        <div key={group.title} className="flex flex-col gap-1">
          <span className="text-[11.5px] font-medium text-muted-foreground">{group.title}</span>
          {group.items.map(([name, n]) => (
            <span key={name} className="grid grid-cols-[minmax(0,1fr)_64px_26px] items-center gap-2 text-[0.8rem]">
              <span className="truncate" title={name}>
                {name}
              </span>
              <span aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-accent">
                <span className="block h-1 rounded-full bg-foreground" style={{ width: `${(n / clips.length) * 100}%` }} />
              </span>
              <span className="text-right font-mono text-[11.5px] text-muted-foreground tabular-nums">{n}</span>
            </span>
          ))}
        </div>
      ))}
      {terms.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-medium text-muted-foreground">
            {speech ? "Most common words" : "Most common AudioSet labels"}
          </span>
          <div className="flex flex-wrap gap-1">
            {terms.map((term) => (
              <span key={term} className="inline-flex h-[22px] items-center rounded-full bg-muted px-2 text-xs">
                {term}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
