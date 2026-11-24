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
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SearchMatchFilterV1 } from "@/lib/api/v1/types";
import { MAX_EXAMPLE_SECONDS } from "@/lib/audio/to-wav";
import type { LevelMeter, RecorderStatus } from "@/lib/audio/use-microphone-recorder";
import { cn } from "@/lib/utils";

import { displayText } from "./datasets";
import type { AudioExample, ClipMatch, ReferenceClip } from "./queries";
import type { RecentSearch } from "./recent-searches";
import { recentOptionId, RecentSearchesPopover } from "./recent-searches-popover";
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

// The filters, in this order. `exact` and `text` keep their API names (see `SearchMatchFilterV1`).
const MATCH_OPTIONS: { value: SearchMatchFilterV1; label: string; hint: string }[] = [
  { value: "all", label: "All", hint: "Matches the words, their meaning, and the sound" },
  { value: "exact", label: "Words", hint: "Matches the exact words in the transcripts and captions" },
  { value: "text", label: "Meaning", hint: "Matches the meaning of the transcripts and captions" },
  { value: "sound", label: "Sound", hint: "Matches what the clips sound like" },
];

/**
 * What a search with a clip (a file, a recording, a "similar to" clip)
 * compares, in the order of the text search's options. Sound is the default.
 * Words and Meaning search with what's said in the clip, as the text filters of
 * the same names do; All adds the clip's own sound.
 */
const CLIP_MATCH_OPTIONS: { value: ClipMatch; label: string; hint: string }[] = [
  {
    value: "all",
    label: "All",
    hint: "Finds the clips that sound like this one, or whose transcripts or captions say what’s said in it",
  },
  {
    value: "exact",
    label: "Words",
    hint: "Finds the clips whose transcripts or captions contain the exact words said in this one",
  },
  {
    value: "text",
    label: "Meaning",
    hint: "Finds the clips whose transcripts or captions mean what’s said in this one",
  },
  { value: "sound", label: "Sound", hint: "Finds the clips that sound like this one" },
];

/** What's said in the clip searched by its words, as its chip shows it. */
export type TranscriptLine = { status: "pending" } | { status: "error" } | { status: "success"; text: string };

const MATCH_EXPLANATION: Record<SearchMatchFilterV1, ReactNode> = {
  all: (
    <>
      <b className="font-medium text-foreground">All</b> matches the words, their meaning, and what the clip
      sounds like. Use <b className="font-medium text-foreground">Words</b>,{" "}
      <b className="font-medium text-foreground">Meaning</b> or{" "}
      <b className="font-medium text-foreground">Sound</b> to narrow it.
    </>
  ),
  exact: (
    <>
      <b className="font-medium text-foreground">Words</b> finds the transcripts and captions that contain every
      word as typed. Use “quotes” for a phrase, <i>or</i> for either word, and -word to leave one out.
    </>
  ),
  text: (
    <>
      <b className="font-medium text-foreground">Meaning</b> matches what the transcripts and captions mean, even
      in other words, not the sound.
    </>
  ),
  sound: (
    <>
      <b className="font-medium text-foreground">Sound</b> matches what the clips sound like, not their
      words.
    </>
  ),
};

export function AudioSearchBar({
  query,
  onQueryChange,
  match,
  onMatchChange,
  clipMatch,
  onClipMatchChange,
  transcript,
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
  recentSearches,
  onPickRecent,
  onClearRecent,
  onCommitQuery,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  match: SearchMatchFilterV1;
  onMatchChange: (match: SearchMatchFilterV1) => void;
  /** What a search with a clip compares: its sound, or what's said in it (exact words or meaning). */
  clipMatch: ClipMatch;
  onClipMatchChange: (match: ClipMatch) => void;
  /** The clip's transcript, while a clip is searched by what's said in it (All, Words, Meaning). */
  transcript: TranscriptLine | null;
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
  /** The latest searches, newest first, offered while the empty input has focus. */
  recentSearches: readonly RecentSearch[];
  onPickRecent: (entry: RecentSearch) => void;
  onClearRecent: () => void;
  /** The typed query is done (Enter, or leaving the input): worth keeping as a recent search. */
  onCommitQuery: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [inputFocused, setInputFocused] = useState(false);
  // Escape hides the recent searches until the input is focused or typed in again.
  const [recentDismissed, setRecentDismissed] = useState(false);
  const [activeRecent, setActiveRecent] = useState(-1);
  const recentListId = useId();
  // The input unmounts without a blur event when a chip or the recorder replaces
  // it. Read the real focus: Strict Mode detaches and reattaches refs on mount.
  const setInputNode = useCallback((node: HTMLInputElement | null) => {
    inputRef.current = node;
    setInputFocused(node !== null && node === document.activeElement);
  }, []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reading = exampleStatus?.kind === "reading";
  const recording = recorder.status !== "idle";
  const error = exampleStatus?.kind === "error" ? exampleStatus.message : null;
  // A file, a recording, or a "similar to" clip replaces the text input until its X clears it.
  const chip = reading || example !== null || similarTo !== null;
  // Searched by what's said in it, the chip names the clip by its words, once they're known.
  const byWords = clipMatch !== "sound" && transcript !== null;
  const spoken = byWords && transcript.status === "success" && transcript.text !== "" ? transcript.text : null;
  const transcribing = byWords && transcript.status === "pending";
  const nobodySpeaks = byWords && transcript.status === "success" && transcript.text === "";
  const recentOpen =
    inputFocused && !recentDismissed && query === "" && recentSearches.length > 0;
  const activeIndex = recentOpen && activeRecent < recentSearches.length ? activeRecent : -1;

  const pickRecent = (entry: RecentSearch) => {
    setActiveRecent(-1);
    onPickRecent(entry);
  };

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
          "relative flex h-13 items-center gap-2 rounded-[14px] border bg-card pr-1.5 pl-4 shadow-[0_1px_2px_rgba(26,26,25,0.04)] transition-shadow",
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
                <span className="truncate" title={spoken ?? undefined}>
                  {spoken ? (
                    <>
                      <span className="text-muted-foreground">Similar to </span>“{spoken}”
                    </>
                  ) : (
                    <>
                      <span className="text-muted-foreground">
                        {transcribing ? "Transcribing " : clipMatch === "sound" ? "Sounds like " : "Similar to "}
                      </span>
                      {example.name}
                      {transcribing && "…"}
                      {example.trimmed && (
                        <span className="text-muted-foreground"> · first {MAX_EXAMPLE_SECONDS} s</span>
                      )}
                    </>
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
                <span className="truncate" title={spoken ?? undefined}>
                  <span className="text-muted-foreground">{transcribing ? "Transcribing " : "Similar to "}</span>“
                  {spoken ?? displayText(similarTo)}”{transcribing && "…"}
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
                  ref={setInputNode}
                  type="search"
                  role="combobox"
                  aria-expanded={recentOpen}
                  aria-controls={recentOpen ? recentListId : undefined}
                  aria-autocomplete="none"
                  aria-activedescendant={
                    activeIndex >= 0 ? recentOptionId(recentListId, activeIndex) : undefined
                  }
                  value={query}
                  onChange={(event) => {
                    setRecentDismissed(false);
                    setActiveRecent(-1);
                    onQueryChange(event.target.value);
                  }}
                  onFocus={() => {
                    setInputFocused(true);
                    setRecentDismissed(false);
                    setActiveRecent(-1);
                  }}
                  onBlur={() => {
                    setInputFocused(false);
                    if (query.trim()) onCommitQuery();
                  }}
                  onKeyDown={(event) => {
                    if (recentOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                      event.preventDefault();
                      const count = recentSearches.length;
                      setActiveRecent(
                        event.key === "ArrowDown"
                          ? (activeIndex + 1) % count
                          : activeIndex <= 0
                            ? count - 1
                            : activeIndex - 1,
                      );
                    } else if (event.key === "Enter") {
                      if (activeIndex >= 0) {
                        event.preventDefault();
                        pickRecent(recentSearches[activeIndex]);
                      } else if (query.trim()) {
                        onCommitQuery();
                      }
                    } else if (event.key === "Escape" && recentOpen) {
                      event.preventDefault();
                      setRecentDismissed(true);
                    }
                  }}
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
              <MatchToggle label="Match on" options={MATCH_OPTIONS} value={match} onChange={onMatchChange} />
            )}
            {!reading && (example !== null || similarTo !== null) && (
              <MatchToggle
                label="Search by"
                options={CLIP_MATCH_OPTIONS}
                value={clipMatch}
                onChange={onClipMatchChange}
              />
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
        {recentOpen && !recording && (
          <RecentSearchesPopover
            id={recentListId}
            entries={recentSearches}
            activeIndex={activeIndex}
            onActiveIndexChange={setActiveRecent}
            onPick={pickRecent}
            onClear={onClearRecent}
          />
        )}
      </div>
      {error ? (
        <p role="alert" className="flex items-center gap-2 pl-1 text-[0.8rem] text-destructive">
          <CircleAlertIcon aria-hidden="true" className="size-4 shrink-0" />
          {error}
        </p>
      ) : chip ? (
        // Words and Meaning have nothing to search with then; the list says so.
        !reading &&
        clipMatch === "all" &&
        nobodySpeaks && (
          <p className="pl-1 text-[0.8rem] text-muted-foreground">
            Nobody speaks in the clip, so <b className="font-medium text-foreground">All</b> matches its
            sound only.
          </p>
        )
      ) : (
        !recording &&
        query.trim() !== "" && (
          <p className="pl-1 text-[0.8rem] text-muted-foreground">{MATCH_EXPLANATION[match]}</p>
        )
      )}
    </div>
  );
}

/** A segmented control: one pressed button per option, with its hint as the tooltip. */
function MatchToggle<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string; hint: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex shrink-0 gap-0.5 rounded-full bg-muted p-[3px]">
      {options.map((option) => (
        <Tooltip key={option.value}>
          <TooltipTrigger
            type="button"
            aria-pressed={value === option.value}
            aria-description={option.hint}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-[30px] rounded-full px-3 text-[0.8rem] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
              value === option.value && "bg-card text-foreground shadow-[0_1px_2px_rgba(26,26,25,0.08)]",
            )}
          >
            {option.label}
          </TooltipTrigger>
          <TooltipContent side="bottom">{option.hint}</TooltipContent>
        </Tooltip>
      ))}
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
