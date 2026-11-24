"use client";

import type { KeyboardEvent, PointerEvent } from "react";

import { type Peaks, resamplePeaks } from "@/lib/audio/peaks";
import { cn } from "@/lib/utils";

/** The colour bars of withdavid.ai, for the played part of the player's waveform. */
const SPECTRUM = ["#E8833A", "#E9C46A", "#B9A27E", "#6C63B5", "#3B3FD1", "#9B3FA0"];

function mix(a: string, b: string, t: number) {
  const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [x, y] = [channels(a), channels(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(",")})`;
}

function spectrumAt(t: number) {
  const scaled = t * (SPECTRUM.length - 1);
  const i = Math.min(SPECTRUM.length - 2, Math.floor(scaled));
  return mix(SPECTRUM[i], SPECTRUM[i + 1], scaled - i);
}

/** The player's mark line under the bars, and the room it takes. */
const MARK_LINE_HEIGHT = 3;
const MARK_LINE_SPACE = 9;

type WaveformProps = {
  /** From the API (`waveformPeaks`). Null when not computed yet: flat bars. */
  peaks: Peaks | null;
  bars: number;
  /** Share of the clip played, 0 to 1. */
  played?: number;
  /** "row": ink and grey. "player": the played part in the colour bars. */
  variant?: "row" | "player";
  /**
   * Parts of the clip to point at (where a search's words are said), as shares of it from 0 to 1.
   * "row": their bars are orange. "player": an orange line under them (the played bars are in colour already).
   */
  marks?: readonly { start: number; end: number }[];
  height: number;
  barWidth?: number;
  gap?: number;
  className?: string;
};

/** Vertical bars, centred, like the motif of withdavid.ai. Decorative. */
export function Waveform({
  peaks,
  bars,
  played = 0,
  variant = "row",
  marks = [],
  height,
  barWidth = 2,
  gap = 2,
  className,
}: WaveformProps) {
  const levels = peaks ? resamplePeaks(peaks, bars) : null;
  const width = bars * barWidth + (bars - 1) * gap;
  const minHeight = Math.max(2, barWidth);
  const underline = variant === "player" && marks.length > 0;
  const svgHeight = underline ? height + MARK_LINE_SPACE : height;

  return (
    <svg
      aria-hidden="true"
      width={width}
      height={svgHeight}
      viewBox={`0 0 ${width} ${svgHeight}`}
      className={cn("shrink-0", className)}
    >
      {underline &&
        marks.map((mark, i) => {
          // From the first bar the mark touches to the last, at least one bar wide.
          const first = Math.min(bars - 1, Math.floor(mark.start * bars));
          const last = Math.max(first, Math.min(bars - 1, Math.ceil(mark.end * bars) - 1));
          return (
            <rect
              key={`mark-${i}`}
              x={first * (barWidth + gap)}
              y={svgHeight - MARK_LINE_HEIGHT}
              width={(last - first) * (barWidth + gap) + barWidth}
              height={MARK_LINE_HEIGHT}
              rx={MARK_LINE_HEIGHT / 2}
              fill="var(--color-waveform-match)"
            />
          );
        })}
      {Array.from({ length: bars }, (_, i) => {
        const level = levels ? levels[i] : 0;
        const h = Math.max(minHeight, Math.round(level * height));
        const isPlayed = played > 0 && (i + 0.5) / bars <= played;
        const isMarked = !underline && marks.some((mark) => mark.start < (i + 1) / bars && mark.end > i / bars);
        const fill = isMarked
          ? "var(--color-waveform-match)"
          : isPlayed
          ? variant === "player"
            ? spectrumAt(i / Math.max(1, bars - 1))
            : "var(--color-foreground)"
          : variant === "player"
            ? "var(--color-waveform-muted)"
            : "var(--color-waveform)";
        return (
          <rect
            key={i}
            x={i * (barWidth + gap)}
            y={(height - h) / 2}
            width={barWidth}
            height={h}
            rx={barWidth / 2}
            fill={fill}
          />
        );
      })}
    </svg>
  );
}

/**
 * The player's waveform, which is also its seek bar: click or drag to move,
 * arrow keys step 5 s (Home and End jump to the ends).
 */
export function SeekableWaveform({
  peaks,
  bars,
  height,
  currentTime,
  duration,
  onSeek,
  label,
  marks,
}: {
  peaks: Peaks | null;
  bars: number;
  height: number;
  currentTime: number;
  duration: number;
  onSeek: (seconds: number) => void;
  label: string;
  /** Spans of the clip to point at, in seconds. */
  marks?: readonly { start: number; end: number }[];
}) {
  const played = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  const seekToPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const share = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    onSeek(share * duration);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5 }[event.key];
    if (step !== undefined) onSeek(Math.min(duration, Math.max(0, currentTime + step)));
    else if (event.key === "Home") onSeek(0);
    else if (event.key === "End") onSeek(duration);
    else return;
    event.preventDefault();
  };

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(currentTime)}
      aria-valuetext={`${formatClock(currentTime)} of ${formatClock(duration)}`}
      className="flex cursor-pointer touch-none items-center justify-between rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        seekToPointer(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) seekToPointer(event);
      }}
      onKeyDown={onKeyDown}
    >
      <Waveform
        peaks={peaks}
        bars={bars}
        height={height}
        barWidth={3}
        gap={2.6}
        played={played}
        variant="player"
        marks={duration > 0 ? marks?.map((m) => ({ start: m.start / duration, end: m.end / duration })) : undefined}
        className="w-full"
      />
    </div>
  );
}

/** "0:07" */
export function formatClock(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "0:03, 0:12": where each span starts. */
export function formatSaidAt(spans: readonly { start: number }[]) {
  return spans.map((span) => formatClock(span.start)).join(", ");
}
