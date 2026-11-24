"use client";

import { AudioWaveformIcon, SearchIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
}: {
  query: string;
  onQueryChange: (query: string) => void;
  match: SearchMatchFilterV1;
  onMatchChange: (match: SearchMatchFilterV1) => void;
  /** Set while the list shows the audios similar to this one. */
  similarTo: { id: string; title: string } | null;
  onClearSimilar: () => void;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
      <div className="relative min-w-64 flex-1">
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search by words or by sound: “thank you”, “dog barking”"
          aria-label="Search audios"
          maxLength={200}
          autoComplete="off"
          spellCheck={false}
          className="h-9 w-full rounded-lg border bg-background pr-9 pl-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute top-1/2 right-1 -translate-y-1/2"
            aria-label="Clear search"
            onClick={() => onQueryChange("")}
          >
            <XIcon />
          </Button>
        )}
      </div>

      {similarTo ? (
        <div className="flex h-9 max-w-full min-w-0 items-center gap-1.5 rounded-lg border bg-muted pr-1 pl-2.5 text-sm">
          <AudioWaveformIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">
            <span className="text-muted-foreground">Similar to </span>
            {similarTo.title}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Stop showing similar audios"
            onClick={onClearSimilar}
          >
            <XIcon />
          </Button>
        </div>
      ) : (
        <TooltipProvider delay={300}>
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
        </TooltipProvider>
      )}
    </div>
  );
}
