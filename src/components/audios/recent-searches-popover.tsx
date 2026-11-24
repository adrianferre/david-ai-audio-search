"use client";

import { AudioLinesIcon, FileAudioIcon, LinkIcon, MicIcon, SearchIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { SearchMatchFilterV1 } from "@/lib/api/v1/types";
import { cn } from "@/lib/utils";

import { displayText, SOURCE_LABEL } from "./datasets";
import { describeDuration, isAnyDuration } from "./duration-filter";
import type { RecentSearch, SuggestedSearch } from "./recent-searches";
import { formatClock, Waveform } from "./waveform";

/** The search bar's match options, as a recent text search names them. */
const MATCH_LABEL: Record<SearchMatchFilterV1, string> = {
  all: "All",
  exact: "Words",
  text: "Meaning",
  sound: "Sound",
};

/** The transcript a search with a clip searched with, when it searched by what's said and someone speaks. */
function spokenText(entry: { match?: SearchMatchFilterV1; transcript?: string }): string | null {
  return entry.match && entry.match !== "sound" && entry.transcript ? entry.transcript : null;
}

export const recentOptionId = (listId: string, index: number) => `${listId}-${index}`;

/**
 * The suggested searches, then the latest ones, under the search bar while its
 * text input has focus. The input keeps focus (it is the combobox): arrow keys
 * move `activeIndex` over both lists (suggestions first), Enter or a click
 * picks a search to run.
 */
export function RecentSearchesPopover({
  id,
  suggested,
  entries,
  activeIndex,
  onActiveIndexChange,
  onPick,
  onClear,
}: {
  id: string;
  suggested: readonly SuggestedSearch[];
  entries: readonly RecentSearch[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onPick: (entry: RecentSearch) => void;
  onClear: () => void;
}) {
  const option = (entry: RecentSearch, index: number, label?: string) => (
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
      <RecentSearchRow entry={entry} label={label} />
    </li>
  );

  return (
    <div
      className="absolute inset-x-0 top-full z-30 mt-1.5 overflow-hidden rounded-[14px] border border-input bg-card py-1.5 shadow-[0_8px_24px_rgba(26,26,25,0.10),0_1px_2px_rgba(26,26,25,0.06)]"
      // Clicking inside mustn't blur the input, which would close this first.
      onMouseDown={(event) => event.preventDefault()}
    >
      {/* One listbox, as the input's aria-controls names it, with a group per section. */}
      <div id={id} role="listbox" aria-label="Searches">
        {suggested.length > 0 && (
          <div role="group" aria-labelledby={`${id}-suggested-label`}>
            <div className="px-4 pt-1 pb-1.5">
              <span id={`${id}-suggested-label`} className="text-xs font-medium text-muted-foreground">
                Suggested
              </span>
            </div>
            <ul role="presentation">{suggested.map((entry, index) => option(entry, index, entry.label))}</ul>
          </div>
        )}
        {entries.length > 0 && (
          <div role="group" aria-labelledby={`${id}-label`} className={cn(suggested.length > 0 && "mt-1.5")}>
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
            <ul role="presentation">{entries.map((entry, index) => option(entry, suggested.length + index))}</ul>
          </div>
        )}
      </div>
    </div>
  );
}

function RecentSearchRow({ entry, label: suggestionLabel }: { entry: RecentSearch; label?: string }) {
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
    case "similar": {
      icon = <AudioLinesIcon />;
      // Searched by what's said in it, the clip goes by its transcript, as in the search bar.
      const said = spokenText(entry);
      label = (
        <>
          <span className="text-muted-foreground">Similar to </span>“
          {displayText({ source: entry.reference.source, text: said ?? entry.reference.text })}”
        </>
      );
      match = MATCH_LABEL[entry.match ?? "sound"];
      audio = {
        peaks: entry.reference.waveformPeaks,
        durationSeconds: entry.reference.durationSeconds,
      };
      break;
    }
    case "audio": {
      icon =
        entry.example.source === "recording" ? (
          <MicIcon />
        ) : entry.example.source === "link" ? (
          <LinkIcon />
        ) : (
          <FileAudioIcon />
        );
      const said = spokenText(entry);
      const name = entry.example.source === "recording" ? "your recording" : entry.example.name;
      label = said ? (
        <>
          <span className="text-muted-foreground">Similar to </span>“{said}”
        </>
      ) : (
        <>
          <span className="text-muted-foreground">
            {(entry.match ?? "sound") === "sound" ? "Sounds like " : "Similar to "}
          </span>
          {name}
        </>
      );
      match = MATCH_LABEL[entry.match ?? "sound"];
      audio = { peaks: entry.example.peaks, durationSeconds: entry.example.durationSeconds };
      break;
    }
  }
  if (suggestionLabel) label = suggestionLabel;

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
      {entry.duration && !isAnyDuration(entry.duration) && (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{describeDuration(entry.duration)}</span>
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
