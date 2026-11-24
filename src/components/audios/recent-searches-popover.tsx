"use client";

import { AudioLinesIcon, FileAudioIcon, MicIcon, SearchIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { SearchMatchFilterV1 } from "@/lib/api/v1/types";
import { cn } from "@/lib/utils";

import { displayText, SOURCE_LABEL } from "./datasets";
import type { RecentSearch } from "./recent-searches";
import { formatClock, Waveform } from "./waveform";

/** The search bar's match options, as a recent text search names them. */
const MATCH_LABEL: Record<SearchMatchFilterV1, string> = {
  all: "All",
  text: "Words",
  sound: "Sound",
};

export const recentOptionId = (listId: string, index: number) => `${listId}-${index}`;

/**
 * The latest searches, under the search bar while its text input has focus.
 * The input keeps focus (it is the combobox): arrow keys move `activeIndex`,
 * Enter or a click picks a search to run again.
 */
export function RecentSearchesPopover({
  id,
  entries,
  activeIndex,
  onActiveIndexChange,
  onPick,
  onClear,
}: {
  id: string;
  entries: readonly RecentSearch[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onPick: (entry: RecentSearch) => void;
  onClear: () => void;
}) {
  return (
    <div
      className="absolute inset-x-0 top-full z-30 mt-1.5 overflow-hidden rounded-[14px] border border-input bg-card py-1.5 shadow-[0_8px_24px_rgba(26,26,25,0.10),0_1px_2px_rgba(26,26,25,0.06)]"
      // Clicking inside mustn't blur the input, which would close this first.
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="flex items-center justify-between px-4 pt-1 pb-1.5">
        <span id={`${id}-label`} className="text-xs font-medium text-muted-foreground">
          Recent searches
        </span>
        <button
          type="button"
          tabIndex={-1}
          onClick={onClear}
          className="rounded-full px-2 py-0.5 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground"
        >
          Clear
        </button>
      </div>
      <ul id={id} role="listbox" aria-labelledby={`${id}-label`}>
        {entries.map((entry, index) => (
          <li
            key={entry.id}
            id={recentOptionId(id, index)}
            role="option"
            aria-selected={index === activeIndex}
            onMouseEnter={() => onActiveIndexChange(index)}
            onClick={() => onPick(entry)}
            className={cn(
              "group mx-1.5 flex h-10 cursor-pointer items-center gap-3 rounded-[10px] px-2.5 text-[0.85rem]",
              index === activeIndex && "bg-muted",
            )}
          >
            <RecentSearchRow entry={entry} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecentSearchRow({ entry }: { entry: RecentSearch }) {
  let icon: ReactNode;
  let label: ReactNode;
  let match: string | null = null;
  let audio: { peaks: readonly number[] | null; durationSeconds: number } | null = null;

  switch (entry.kind) {
    case "text":
      icon = <SearchIcon />;
      label = <>“{entry.q}”</>;
      match = MATCH_LABEL[entry.match];
      break;
    case "similar":
      icon = <AudioLinesIcon />;
      label = (
        <>
          <span className="text-muted-foreground">Similar to </span>“{displayText(entry.reference)}”
        </>
      );
      audio = {
        peaks: entry.reference.waveformPeaks,
        durationSeconds: entry.reference.durationSeconds,
      };
      break;
    case "audio":
      icon = entry.example.source === "recording" ? <MicIcon /> : <FileAudioIcon />;
      label =
        entry.example.source === "recording" ? (
          <>
            <span className="text-muted-foreground">Sounds like </span>your recording
          </>
        ) : (
          <>
            <span className="text-muted-foreground">Sounds like </span>
            {entry.example.name}
          </>
        );
      audio = { peaks: entry.example.peaks, durationSeconds: entry.example.durationSeconds };
      break;
  }


  return (
    <>
      <span
        aria-hidden="true"
        className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {entry.source && (
        <span className="shrink-0 text-xs text-muted-foreground">{SOURCE_LABEL[entry.source]}</span>
      )}
      {match && (
        // Like an unselected option of the search bar's match toggle. On the
        // highlighted row, whose fill is the same muted, it goes a shade darker.
        <span className="flex h-6 shrink-0 items-center rounded-full bg-muted px-2.5 text-xs font-medium text-muted-foreground group-aria-selected:bg-foreground/6">
          {match}
        </span>
      )}
      {audio && (
        <>
          <Waveform peaks={audio.peaks} bars={20} height={14} className="max-sm:hidden" />
          <span className="w-9 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
            {formatClock(audio.durationSeconds)}
          </span>
        </>
      )}
    </>
  );
}
