"use client";

import {
  AudioWaveformIcon,
  FileAudioIcon,
  LoaderCircleIcon,
  MicIcon,
  SearchIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useRef } from "react";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SearchMatchFilterV1 } from "@/lib/api/v1/types";
import { MAX_EXAMPLE_SECONDS } from "@/lib/audio/to-wav";
import type { RecorderStatus } from "@/lib/audio/use-microphone-recorder";
import { cn } from "@/lib/utils";

import type { AudioExample } from "./queries";

/** Reading an attached audio file, or why it couldn't be used. */
export type ExampleStatus =
  | { kind: "reading"; name: string }
  | { kind: "error"; message: string }
  | null;

/** The microphone recorder, as the search bar shows and drives it. */
export type RecorderControls = {
  status: RecorderStatus;
  elapsedSeconds: number;
  maxSeconds: number;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
};

function formatClock(seconds: number) {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

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
  example,
  exampleStatus,
  onAttachFile,
  onClearExample,
  recorder,
  summary,
  leading,
  trailing,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  match: SearchMatchFilterV1;
  onMatchChange: (match: SearchMatchFilterV1) => void;
  /** Set while the list shows the audios similar to this one. */
  similarTo: { id: string; title: string } | null;
  onClearSimilar: () => void;
  /** Set while the list shows the audios that sound like the user's file. */
  example: AudioExample | null;
  exampleStatus: ExampleStatus;
  onAttachFile: (file: File) => void;
  onClearExample: () => void;
  recorder: RecorderControls;
  /** The count of the list below, shown at the end of the input. */
  summary: string;
  /** Before the input, e.g. the select-all checkbox. */
  leading?: ReactNode;
  /** At the end of the bar, e.g. the download controls. */
  trailing?: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reading = exampleStatus?.kind === "reading";
  const recording = recorder.status !== "idle";

  return (
    <div className="flex shrink-0 flex-col border-b">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2">
        {leading}
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
            placeholder="Search by words or by sound: “thank you”, “dog barking”, or drop an audio file"
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

        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,video/mp4,video/webm,video/quicktime"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onAttachFile(file);
            // Choosing the same file again should search again.
            event.target.value = "";
          }}
        />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="outline"
                size="lg"
                className="h-9"
                disabled={reading || recording}
                onClick={() => fileInputRef.current?.click()}
              />
            }
          >
            {reading ? (
              <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
            ) : (
              <FileAudioIcon aria-hidden="true" />
            )}
            Search with a file
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Find the clips that sound like your own recording. You can also drop the file anywhere
            on the page.
          </TooltipContent>
        </Tooltip>

        {recording ? (
          <RecordingControls recorder={recorder} />
        ) : (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="lg"
                  className="h-9"
                  disabled={reading}
                  onClick={recorder.onStart}
                />
              }
            >
              <MicIcon aria-hidden="true" />
              Record
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Record a sound with your microphone, up to {recorder.maxSeconds} s, and find the clips
              that sound like it.
            </TooltipContent>
          </Tooltip>
        )}

        {example ? (
          <div className="flex h-9 max-w-full min-w-0 items-center gap-1.5 rounded-lg border bg-muted pr-1 pl-2.5 text-sm">
            {example.source === "recording" ? (
              <MicIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <FileAudioIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">
              <span className="text-muted-foreground">Sounds like </span>
              {example.name}
              {example.trimmed && (
                <span className="text-muted-foreground"> (first {MAX_EXAMPLE_SECONDS} s)</span>
              )}
            </span>
            <IconButton
              variant="ghost"
              size="icon-sm"
              label={
                example.source === "recording"
                  ? "Stop searching with this recording"
                  : "Stop searching with this file"
              }
              onClick={onClearExample}
            >
              <XIcon />
            </IconButton>
          </div>
        ) : similarTo ? (
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
        {trailing}
      </div>
      {exampleStatus && (
        <p
          role="status"
          className={cn(
            "px-4 pb-2 text-sm",
            exampleStatus.kind === "error" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {exampleStatus.kind === "error"
            ? exampleStatus.message
            : `Reading “${exampleStatus.name}”…`}
        </p>
      )}
    </div>
  );
}

/** Shown in place of the Record button while the microphone is on. */
function RecordingControls({ recorder }: { recorder: RecorderControls }) {
  const starting = recorder.status === "starting";

  return (
    <div
      role="group"
      aria-label="Recording"
      className="flex h-9 items-center gap-1.5 rounded-lg border border-destructive/40 bg-destructive/5 pr-1 pl-2.5 text-sm"
      onKeyDown={(event) => {
        if (event.key === "Escape") recorder.onCancel();
      }}
    >
      {starting ? (
        <>
          <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground">Waiting for the microphone…</span>
        </>
      ) : (
        <>
          <span aria-hidden="true" className="relative flex size-2.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive opacity-60" />
            <span className="relative inline-flex size-2.5 rounded-full bg-destructive" />
          </span>
          <span className="tabular-nums" aria-live="off">
            {formatClock(recorder.elapsedSeconds)}
            <span className="text-muted-foreground"> / {formatClock(recorder.maxSeconds)}</span>
          </span>
          <Button
            variant="outline"
            size="sm"
            className="ml-1"
            // Focused at once, so Enter or Space stops and searches.
            autoFocus
            onClick={recorder.onStop}
          >
            <SquareIcon aria-hidden="true" className="fill-current" />
            Stop and search
          </Button>
        </>
      )}
      <IconButton variant="ghost" size="icon-sm" label="Cancel recording" onClick={recorder.onCancel}>
        <XIcon />
      </IconButton>
    </div>
  );
}
