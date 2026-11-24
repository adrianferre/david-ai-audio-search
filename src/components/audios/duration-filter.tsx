"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ANY_DURATION, type DurationRangeV1 } from "@/lib/api/v1/types";

/** The slider moves in whole seconds: finer than that isn't a length anyone asks for. */
const STEP_SECONDS = 1;
/** The slider's end before the datasets load, about the catalog's longest clip. */
const FALLBACK_MAX_SECONDS = 35;

export function isAnyDuration(duration: DurationRangeV1): boolean {
  return duration.min === null && duration.max === null;
}

export function sameDuration(a: DurationRangeV1 | undefined, b: DurationRangeV1 | undefined): boolean {
  return (a?.min ?? null) === (b?.min ?? null) && (a?.max ?? null) === (b?.max ?? null);
}

const seconds = (value: number) => `${value.toLocaleString()} s`;

/** The range in words: "5–12 s", "Up to 5 s", "20 s or longer"; null for any length. */
export function describeDuration({ min, max }: DurationRangeV1): string | null {
  if (min !== null && max !== null) return min === max ? seconds(min) : `${min.toLocaleString()}–${seconds(max)}`;
  if (max !== null) return `Up to ${seconds(max)}`;
  if (min !== null) return `${seconds(min)} or longer`;
  return null;
}

/**
 * The sidebar's length filter: a range slider over the catalog's lengths, from
 * 0 s to its longest clip rounded up. A thumb at either end leaves that end
 * open, so "any length" also keeps clips added later that are longer still.
 * The list follows when a thumb is let go, not at every step of a drag.
 */
export function DurationFilter({
  duration,
  longestSeconds,
  onDurationChange,
}: {
  duration: DurationRangeV1;
  /** The catalog's longest clip; undefined until the datasets load. */
  longestSeconds: number | undefined;
  onDurationChange: (duration: DurationRangeV1) => void;
}) {
  const top = Math.max(STEP_SECONDS, Math.ceil(longestSeconds ?? FALLBACK_MAX_SECONDS));
  const committed: [number, number] = [
    Math.min(duration.min ?? 0, top),
    Math.min(duration.max ?? top, top),
  ];
  // The thumbs while one is dragged; null when they show the filter as applied.
  const [dragging, setDragging] = useState<[number, number] | null>(null);
  const [low, high] = dragging ?? committed;
  const shown: DurationRangeV1 = { min: low > 0 ? low : null, max: high < top ? high : null };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <p id="duration-label" className="text-xs font-medium text-muted-foreground">
          Clip length
        </p>
        {!isAnyDuration(duration) && (
          <Button
            variant="ghost"
            size="xs"
            className="-mr-2 text-muted-foreground"
            aria-label="Clear the length filter"
            onClick={() => {
              setDragging(null);
              onDurationChange(ANY_DURATION);
            }}
          >
            Clear
          </Button>
        )}
      </div>
      <p className="-mt-1 text-sm font-medium tabular-nums">
        {describeDuration(shown) ?? <span className="font-normal text-muted-foreground">Any length</span>}
      </p>
      <Slider
        aria-labelledby="duration-label"
        min={0}
        max={top}
        step={STEP_SECONDS}
        largeStep={5}
        value={[low, high]}
        disabled={longestSeconds === undefined}
        getAriaLabel={(index) => (index === 0 ? "Shortest length" : "Longest length")}
        getAriaValueText={(_, value, index) =>
          index === 0
            ? value === 0 ? "No shortest length" : `At least ${seconds(value)}`
            : value === top ? "No longest length" : `At most ${seconds(value)}`
        }
        onValueChange={(value) => {
          if (Array.isArray(value)) setDragging([value[0], value[1]]);
        }}
        onValueCommitted={(value) => {
          if (!Array.isArray(value)) return;
          const [min, max] = value;
          setDragging(null);
          const next: DurationRangeV1 = { min: min > 0 ? min : null, max: max < top ? max : null };
          if (!sameDuration(next, duration)) onDurationChange(next);
        }}
        className="py-1.5"
      />
      <div aria-hidden="true" className="flex justify-between text-[11.5px] text-muted-foreground tabular-nums">
        <span>0 s</span>
        <span>{seconds(top)}</span>
      </div>
    </div>
  );
}
