"use client";

import {
  AudioWaveformIcon,
  CircleAlertIcon,
  LoaderCircleIcon,
  MicIcon,
  PauseIcon,
  PlayIcon,
  SearchIcon,
  SquareIcon,
  UploadIcon,
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

import { displayText } from "./datasets";
import type { AudioExample, ReferenceClip } from "./queries";
import { formatClock } from "./waveform";

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

const MATCH_OPTIONS: { value: SearchMatchFilterV1; label: string; hint: string }[] = [
  { value: "all", label: "All", hint: "Matches what’s said, the captions, and the sound" },
  { value: "text", label: "Words", hint: "Matches the transcripts and the captions only" },
  { value: "sound", label: "Sound", hint: "Matches what the clips sound like only" },
];

const MATCH_EXPLANATION: Record<SearchMatchFilterV1, ReactNode> = {
  all: (
    <>
      <b className="font-medium text-foreground">All</b> matches what’s said, the captions, and what
      the clip sounds like. Use <b className="font-medium text-foreground">Words</b> or{" "}
      <b className="font-medium text-foreground">Sound</b> to narrow it.
    </>
  ),
  text: (
    <>
      <b className="font-medium text-foreground">Words</b> matches the transcripts and the captions,
      not the sound.
    </>
  ),
  sound: (
    <>
      <b className="font-medium text-foreground">Sound</b> matches what the clips sound like, not
      their words.
    </>
  ),
};

export function AudioSearchBar({
  query,
  onQueryChange,
  match,
  onMatchChange,
  similarTo,
  onClearSimilar,
  example,
  exampleStatus,
  examplePlayback,
  onToggleExample,
  onAttachFile,
  onClearExample,
  recorder,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  match: SearchMatchFilterV1;
  onMatchChange: (match: SearchMatchFilterV1) => void;
  /** Set while the list shows the clips similar to this one. */
  similarTo: ReferenceClip | null;
  onClearSimilar: () => void;
  /** Set while the list shows the clips that sound like the user's file. */
  example: AudioExample | null;
  exampleStatus: ExampleStatus;
  /** The user's clip is playing (or loading) in the player. */
  examplePlayback: "playing" | "loading" | null;
  onToggleExample: () => void;
  onAttachFile: (file: File) => void;
  onClearExample: () => void;
  recorder: RecorderControls;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reading = exampleStatus?.kind === "reading";
  const recording = recorder.status !== "idle";
  const error = exampleStatus?.kind === "error" ? exampleStatus.message : null;
  const chip = reading || example !== null || similarTo !== null;

  return (
    <div className="flex flex-col gap-2">
      <div
        className={cn(
          "flex h-13 items-center gap-2 rounded-[14px] border bg-card pr-1.5 pl-4 shadow-[0_1px_2px_rgba(26,26,25,0.04)] transition-shadow",
          recording
            ? "border-foreground shadow-[0_0_0_4px_rgba(26,26,25,0.06)]"
            : "border-input focus-within:border-foreground focus-within:shadow-[0_0_0_4px_rgba(26,26,25,0.06)]",
          error && "border-destructive",
        )}
        // Clicks on the icon or the empty space focus the text, like a plain input.
        onClick={(event) => {
          if (event.target === event.currentTarget) inputRef.current?.focus();
        }}
      >
        {recording ? (
          <RecordingControls recorder={recorder} />
        ) : (
          <>
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none size-[18px] shrink-0 text-muted-foreground"
            />
            {reading ? (
              <span
                role="status"
                className="flex h-[34px] min-w-0 shrink items-center gap-2 rounded-full bg-muted pr-3.5 pl-3 text-[0.8rem]"
              >
                <LoaderCircleIcon aria-hidden="true" className="size-4 shrink-0 animate-spin" />
                <span className="truncate">
                  <span className="text-muted-foreground">Reading </span>
                  {exampleStatus.name}…
                </span>
              </span>
            ) : example ? (
              <span className="flex h-[34px] min-w-0 shrink items-center gap-2 rounded-full bg-muted px-1 text-[0.8rem]">
                <IconButton
                  size="icon-sm"
                  className="size-[26px] shrink-0"
                  label={examplePlayback ? "Pause your clip" : "Play your clip"}
                  onClick={onToggleExample}
                >
                  {examplePlayback === "loading" ? (
                    <LoaderCircleIcon className="animate-spin" />
                  ) : examplePlayback === "playing" ? (
                    <PauseIcon className="size-3 fill-current" />
                  ) : (
                    <PlayIcon className="ml-px size-3 fill-current" />
                  )}
                </IconButton>
                <span className="truncate">
                  <span className="text-muted-foreground">Sounds like </span>
                  {example.name}
                  {example.trimmed && (
                    <span className="text-muted-foreground"> · first {MAX_EXAMPLE_SECONDS} s</span>
                  )}
                </span>
                <IconButton
                  variant="outline"
                  size="icon-sm"
                  className="size-[26px] shrink-0 border-transparent"
                  label={
                    example.source === "recording"
                      ? "Stop searching with this recording"
                      : "Stop searching with this file"
                  }
                  onClick={onClearExample}
                >
                  <XIcon />
                </IconButton>
              </span>
            ) : similarTo ? (
              <span className="flex h-[34px] max-w-[70%] min-w-0 shrink items-center gap-2 rounded-full bg-muted pr-1 pl-3 text-[0.8rem]">
                <AudioWaveformIcon aria-hidden="true" className="size-4 shrink-0" />
                <span className="truncate">
                  <span className="text-muted-foreground">Similar to </span>“{displayText(similarTo)}”
                </span>
                <IconButton
                  variant="outline"
                  size="icon-sm"
                  className="size-[26px] shrink-0 border-transparent"
                  label="Stop showing similar clips"
                  onClick={onClearSimilar}
                >
                  <XIcon />
                </IconButton>
              </span>
            ) : null}
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder={
                chip
                  ? "Or type to search instead"
                  : "Describe a sound or what’s said, like “dog barking”"
              }
              aria-label="Search the catalog"
              maxLength={200}
              autoComplete="off"
              spellCheck={false}
              className="h-full min-w-20 flex-1 bg-transparent text-[0.95rem] outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <IconButton
                variant="ghost"
                size="icon"
                className="shrink-0 text-muted-foreground"
                label="Clear search"
                onClick={() => {
                  onQueryChange("");
                  inputRef.current?.focus();
                }}
              >
                <XIcon />
              </IconButton>
            )}
            {!chip && (
              <div
                role="group"
                aria-label="Match on"
                className="flex shrink-0 gap-0.5 rounded-full bg-muted p-[3px]"
              >
                {MATCH_OPTIONS.map((option) => (
                  <Tooltip key={option.value}>
                    <TooltipTrigger
                      type="button"
                      aria-pressed={match === option.value}
                      aria-description={option.hint}
                      onClick={() => onMatchChange(option.value)}
                      className={cn(
                        "h-[30px] rounded-full px-3 text-[0.8rem] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                        match === option.value &&
                          "bg-card text-foreground shadow-[0_1px_2px_rgba(26,26,25,0.08)]",
                      )}
                    >
                      {option.label}
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{option.hint}</TooltipContent>
                  </Tooltip>
                ))}
              </div>
            )}
            <span aria-hidden="true" className="mx-0.5 h-6 w-px shrink-0 bg-border" />
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
                    variant="ghost"
                    size="lg"
                    className="h-[38px] shrink-0 px-3 text-[0.8rem]"
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
                that sound like it
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="lg"
                    className="h-[38px] shrink-0 px-3 text-[0.8rem]"
                    disabled={reading}
                    onClick={() => fileInputRef.current?.click()}
                  />
                }
              >
                <UploadIcon aria-hidden="true" />
                Upload
              </TooltipTrigger>
              <TooltipContent side="bottom">
                Find the clips that sound like your own audio file. You can also drop it anywhere on
                the page.
              </TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
      {error ? (
        <p role="alert" className="flex items-center gap-2 pl-1 text-[0.8rem] text-destructive">
          <CircleAlertIcon aria-hidden="true" className="size-4 shrink-0" />
          {error}
        </p>
      ) : (
        !chip &&
        !recording &&
        query.trim() !== "" && (
          <p className="pl-1 text-[0.8rem] text-muted-foreground">{MATCH_EXPLANATION[match]}</p>
        )
      )}
    </div>
  );
}

/** Fills the search bar while the microphone is on. */
function RecordingControls({ recorder }: { recorder: RecorderControls }) {
  const starting = recorder.status === "starting";
  const progress = Math.min(1, recorder.elapsedSeconds / recorder.maxSeconds);

  return (
    <div
      role="group"
      aria-label="Recording"
      className="flex h-full min-w-0 flex-1 items-center gap-3"
      onKeyDown={(event) => {
        if (event.key === "Escape") recorder.onCancel();
      }}
    >
      {starting ? (
        <>
          <LoaderCircleIcon aria-hidden="true" className="size-4 shrink-0 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Waiting for the microphone…</span>
          <span className="flex-1" />
        </>
      ) : (
        <>
          <span aria-hidden="true" className="relative flex size-2.5 shrink-0">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#c2410c] opacity-60" />
            <span className="relative inline-flex size-2.5 rounded-full bg-[#c2410c]" />
          </span>
          <span className="text-sm font-medium">Listening</span>
          <span className="text-sm tabular-nums" aria-live="off">
            {formatClock(recorder.elapsedSeconds)}
            <span className="text-muted-foreground"> / {formatClock(recorder.maxSeconds)}</span>
          </span>
          <span aria-hidden="true" className="h-1 min-w-12 flex-1 overflow-hidden rounded-full bg-accent">
            <span
              className="block h-full rounded-full bg-foreground transition-[width] duration-200"
              style={{ width: `${progress * 100}%` }}
            />
          </span>
        </>
      )}
      <IconButton
        variant="ghost"
        className="shrink-0 text-muted-foreground"
        label="Cancel recording"
        onClick={recorder.onCancel}
      >
        <XIcon />
      </IconButton>
      <Button
        size="lg"
        className="h-[38px] shrink-0 px-4 text-[0.8rem]"
        disabled={starting}
        // Focused at once, so Enter or Space stops and searches.
        autoFocus
        onClick={recorder.onStop}
      >
        <SquareIcon aria-hidden="true" className="size-3 fill-current" />
        Stop and search
      </Button>
    </div>
  );
}
