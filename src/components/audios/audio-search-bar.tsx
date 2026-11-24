"use client";

import { AudioWaveformIcon, SearchIcon, XIcon } from "lucide-react";
import { useRef } from "react";

import { IconButton } from "@/components/ui/icon-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SearchMatchFilterV1 } from "@/lib/api/v1/types";
import { cn } from "@/lib/utils";

const MATCH_OPTIONS: { value: SearchMatchFilterV1; label: string; hint: string }[] = [
  { value: "all", label: "All", hint: "Matches the words and the sound" },
  { value: "text", label: "Words", hint: "Matches the transcript or the captions" },
  { value: "sound", label: "Sound", hint: "Matches what the audio itself sounds like" },
];

export function AudioSearchBar({
  query,
  onQueryChange,
  match,
  onMatchChange,
  similarTo,
  onClearSimilar,
  summary,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  match: SearchMatchFilterV1;
  onMatchChange: (match: SearchMatchFilterV1) => void;
  /** Set while the list shows the audios similar to this one. */
  similarTo: { id: string; title: string } | null;
  onClearSimilar: () => void;
  /** The count of the list below, shown at the end of the input. */
  summary: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
      {/* Styled as one input: the icon, the text, the count and the clear button. */}
      <div
        className="flex h-9 min-w-64 flex-1 items-center rounded-lg border bg-background focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30"
        // Clicks on the icon or the count focus the text, like a plain input.
        onClick={(event) => {
          if (event.target === event.currentTarget) inputRef.current?.focus();
        }}
      >
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none ml-2.5 size-4 shrink-0 text-muted-foreground"
        />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search by words or by sound: “thank you”, “dog barking”"
          aria-label="Search audios"
          maxLength={200}
          autoComplete="off"
          spellCheck={false}
          className="h-full min-w-0 flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
        {summary && (
          <span
            aria-live="polite"
            className={cn(
              "pointer-events-none shrink-0 text-sm whitespace-nowrap text-muted-foreground tabular-nums",
              !query && "pr-3",
            )}
          >
            {summary}
          </span>
        )}
        {query && (
          <IconButton
            variant="ghost"
            size="icon-sm"
            className="mx-1 shrink-0"
            label="Clear search"
            onClick={() => onQueryChange("")}
          >
            <XIcon />
          </IconButton>
        )}
      </div>

      {similarTo ? (
        <div className="flex h-9 max-w-full min-w-0 items-center gap-1.5 rounded-lg border bg-muted pr-1 pl-2.5 text-sm">
          <AudioWaveformIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">
            <span className="text-muted-foreground">Similar to </span>
            {similarTo.title}
          </span>
          <IconButton
            variant="ghost"
            size="icon-sm"
            label="Stop showing similar audios"
            onClick={onClearSimilar}
          >
            <XIcon />
          </IconButton>
        </div>
      ) : (
        <div
          role="group"
          aria-label="Match on"
          className="flex h-9 items-center gap-0.5 rounded-lg border p-0.5"
        >
          {MATCH_OPTIONS.map((option) => (
            <Tooltip key={option.value}>
              <TooltipTrigger
                type="button"
                aria-pressed={match === option.value}
                aria-description={option.hint}
                onClick={() => onMatchChange(option.value)}
                className={cn(
                  "h-full rounded-md px-2.5 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                  match === option.value && "bg-muted text-foreground",
                )}
              >
                {option.label}
              </TooltipTrigger>
              <TooltipContent side="bottom">{option.hint}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  );
}
