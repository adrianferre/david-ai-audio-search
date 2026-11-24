"use client";

import {
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
import { type ReactNode, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SearchMatchFilterV1 } from "@/lib/api/v1/types";
import { MAX_EXAMPLE_SECONDS } from "@/lib/audio/to-wav";
import type { LevelMeter, RecorderStatus } from "@/lib/audio/use-microphone-recorder";
import { cn } from "@/lib/utils";

import { displayText } from "./datasets";
import type { AudioExample, ReferenceClip } from "./queries";
import { formatClock, Waveform } from "./waveform";

/** Reading an attached audio file, or why it couldn't be used. */
export type ExampleStatus =
  | { kind: "reading"; name: string }
  | { kind: "error"; message: string }
  | null;

/** The microphone recorder, as the search bar shows and drives it. */
export type RecorderControls = {
  status: RecorderStatus;
  elapsedSeconds: number;
  /** The microphone's loudness, while it records (null if the browser can't tap it). */
  meter: LevelMeter | null;
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
  similarPlayback,
  onToggleSimilar,
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
  /** The reference clip in the player: whether it plays, and the share of it played (0 to 1). */
  similarPlayback: { status: "playing" | "loading" | null; played: number };
  onToggleSimilar: () => void;
  onClearSimilar: () => void;
  /** Set while the list shows the clips that sound like the user's file. */
  example: AudioExample | null;
  exampleStatus: ExampleStatus;
  /** The user's clip in the player: whether it plays, and the share of it played (0 to 1). */
  examplePlayback: { status: "playing" | "loading" | null; played: number };
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
  // A file, a recording, or a "similar to" clip replaces the text input until its X clears it.
  const chip = reading || example !== null || similarTo !== null;

  // The X that cleared the chip unmounts with it, so hand focus to the input that comes back.
  const focusInputWhenShown = useRef(false);
  useEffect(() => {
    if (!chip && focusInputWhenShown.current) {
      focusInputWhenShown.current = false;
      inputRef.current?.focus();
    }
  }, [chip]);

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
                  label={examplePlayback.status ? "Pause your clip" : "Play your clip"}
                  onClick={onToggleExample}
                >
                  {examplePlayback.status === "loading" ? (
                    <LoaderCircleIcon className="animate-spin" />
                  ) : examplePlayback.status === "playing" ? (
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
                <Waveform
                  peaks={example.peaks}
                  bars={32}
                  height={18}
                  played={examplePlayback.played}
                  className="max-lg:hidden"
                />
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {formatClock(example.durationSeconds)}
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
                  onClick={() => {
                    focusInputWhenShown.current = true;
                    onClearExample();
                  }}
                >
                  <XIcon />
                </IconButton>
              </span>
            ) : similarTo ? (
              <span className="flex h-[34px] min-w-0 shrink items-center gap-2 rounded-full bg-muted px-1 text-[0.8rem]">
                <IconButton
                  size="icon-sm"
                  className="size-[26px] shrink-0"
                  label={similarPlayback.status ? "Pause the reference clip" : "Play the reference clip"}
                  onClick={onToggleSimilar}
                >
                  {similarPlayback.status === "loading" ? (
                    <LoaderCircleIcon className="animate-spin" />
                  ) : similarPlayback.status === "playing" ? (
                    <PauseIcon className="size-3 fill-current" />
                  ) : (
                    <PlayIcon className="ml-px size-3 fill-current" />
                  )}
                </IconButton>
                <span className="truncate">
                  <span className="text-muted-foreground">Similar to </span>“{displayText(similarTo)}”
                </span>
                <Waveform
                  peaks={similarTo.waveformPeaks}
                  bars={32}
                  height={18}
                  played={similarPlayback.played}
                  className="max-lg:hidden"
                />
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {formatClock(similarTo.durationSeconds)}
                </span>
                <IconButton
                  variant="outline"
                  size="icon-sm"
                  className="size-[26px] shrink-0 border-transparent"
                  label="Stop showing similar clips"
                  onClick={() => {
                    focusInputWhenShown.current = true;
                    onClearSimilar();
                  }}
                >
                  <XIcon />
                </IconButton>
              </span>
            ) : null}
            {chip ? (
              <span className="flex-1" />
            ) : (
              <>
                <input
                  ref={inputRef}
                  type="search"
                  value={query}
                  onChange={(event) => onQueryChange(event.target.value)}
                  placeholder="Describe a sound or what’s said, like “dog barking”"
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
              </>
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
          <RecordingWaveform
            meter={recorder.meter}
            elapsedSeconds={recorder.elapsedSeconds}
            maxSeconds={recorder.maxSeconds}
          />
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

/** Bars per second of recording: 120 bars for the 30 s limit. */
const BARS_PER_SECOND = 4;

/** Peak amplitude to bar height: −54 dBFS (a quiet room) is flat, 0 dBFS is full. */
function toLevel(peak: number) {
  const db = 20 * Math.log10(Math.max(peak, 1e-6));
  return Math.min(1, Math.max(0, (db + 54) / 54));
}

/**
 * The recording's waveform as it comes in, filling the bar left to right over
 * the time limit, so it doubles as the progress bar. Each bar is the loudest
 * moment of its quarter second. It renders on its own, at the screen's rate.
 */
function RecordingWaveform({
  meter,
  elapsedSeconds,
  maxSeconds,
}: {
  meter: LevelMeter | null;
  elapsedSeconds: number;
  maxSeconds: number;
}) {
  const bars = Math.round(maxSeconds * BARS_PER_SECOND);
  const [levels, setLevels] = useState<number[]>([]);

  useEffect(() => {
    if (!meter) return;
    const { analyser, startedAt } = meter;
    const samples = new Float32Array(analyser.fftSize);
    const collected: number[] = [];
    let frame = 0;
    const draw = () => {
      analyser.getFloatTimeDomainData(samples);
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      const index = Math.min(
        bars - 1,
        Math.floor(((performance.now() - startedAt) / 1000) * BARS_PER_SECOND),
      );
      // Frames skipped while the tab was hidden leave their bars flat.
      while (collected.length <= index) collected.push(0);
      collected[index] = Math.max(collected[index], toLevel(peak));
      setLevels(collected.slice());
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [meter, bars]);

  // Without a meter the bars stay flat but still fill, like a progress bar.
  const recorded = Math.max(levels.length, Math.min(bars, Math.ceil(elapsedSeconds * BARS_PER_SECOND)));

  return (
    <span aria-hidden="true" className="flex h-7 min-w-12 flex-1 items-center justify-between">
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          className={cn(
            "max-w-[3px] min-w-px flex-1 rounded-full",
            i < recorded ? "bg-foreground" : "bg-waveform",
          )}
          style={{ height: `max(2px, ${(levels[i] ?? 0) * 100}%)` }}
        />
      ))}
    </span>
  );
}
