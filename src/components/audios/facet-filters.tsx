"use client";

import { useQuery } from "@tanstack/react-query";
import { SearchIcon } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ACCENTS,
  type AccentV1,
  AGES,
  type AgeV1,
  type AudioSource,
  type DurationRangeV1,
  FACETS,
  type FacetCountV1,
  type FacetFiltersV1,
  type FacetV1,
  GENDERS,
  type GenderV1,
  NO_FACETS,
} from "@/lib/api/v1/types";
import { cn } from "@/lib/utils";

import { SOURCE_LABEL } from "./datasets";
import { facetsQuery } from "./queries";

export const GENDER_LABEL: Record<GenderV1, string> = { female: "Female", male: "Male" };

export const AGE_LABEL: Record<AgeV1, string> = {
  teens: "Teens",
  twenties: "20s",
  thirties: "30s",
  fourties: "40s",
  fifties: "50s",
  sixties: "60s",
  seventies: "70s",
  eighties: "80s",
  nineties: "90s",
};

export const ACCENT_LABEL: Record<AccentV1, string> = {
  us: "United States",
  england: "England",
  "south-asia": "India & South Asia",
  canada: "Canada",
  australia: "Australia",
  ireland: "Ireland",
  "southern-africa": "Southern Africa",
  "hong-kong": "Hong Kong",
  "new-zealand": "New Zealand",
  philippines: "Philippines",
  malaysia: "Malaysia",
  wales: "Wales",
  "west-indies": "West Indies & Bermuda",
  singapore: "Singapore",
  scotland: "Scotland",
  other: "Other",
};

/** The datasets that record each facet: with values picked, only their clips can match. */
const FACET_SOURCES: Record<FacetV1, readonly AudioSource[]> = {
  gender: ["librispeech", "commonvoice"],
  age: ["commonvoice"],
  accent: ["commonvoice"],
  label: ["audiocaps"],
};

const FACET_TITLE: Record<FacetV1, string> = {
  gender: "Speaker gender",
  age: "Speaker age",
  accent: "Accent",
  label: "Sound type",
};

/** A value as the sidebar, the header and the recent searches name it. */
function valueLabel(facet: FacetV1, value: string): string {
  switch (facet) {
    case "gender":
      return GENDER_LABEL[value as GenderV1] ?? value;
    case "age":
      return AGE_LABEL[value as AgeV1] ?? value;
    case "accent":
      return ACCENT_LABEL[value as AccentV1] ?? value;
    case "label":
      return value;
  }
}

/** Plural nouns for a facet with many values picked: "3 accents". */
const MANY: Record<FacetV1, string> = { gender: "genders", age: "ages", accent: "accents", label: "sound types" };

export function isNoFacets(facets: FacetFiltersV1 | undefined): boolean {
  return !facets || FACETS.every((facet) => facets[facet].length === 0);
}

/** Same values picked; a missing `facets` (a recent search saved before them) picks none. */
export function sameFacets(a: FacetFiltersV1 | undefined, b: FacetFiltersV1 | undefined): boolean {
  const x = a ?? NO_FACETS;
  const y = b ?? NO_FACETS;
  return FACETS.every(
    (facet) => x[facet].length === y[facet].length && x[facet].every((value, i) => value === y[facet][i]),
  );
}

/**
 * The facets picked, in words: "Female · 20s, 30s · 3 accents"; null when none.
 * More than two values of a facet are counted rather than listed.
 */
export function describeFacets(facets: FacetFiltersV1 | undefined): string | null {
  if (!facets) return null;
  const parts = FACETS.flatMap((facet) => {
    const values = facets[facet];
    if (values.length === 0) return [];
    if (values.length > 2) return [`${values.length} ${MANY[facet]}`];
    return [values.map((value) => valueLabel(facet, value)).join(" or ")];
  });
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * The datasets whose clips can pass the facets picked, of `source` when set:
 * those that record every facet with values. Empty when none can.
 */
export function sourcesFor(source: AudioSource | null, facets: FacetFiltersV1): AudioSource[] {
  const all: AudioSource[] = source ? [source] : ["librispeech", "audiocaps", "commonvoice"];
  return all.filter((each) =>
    FACETS.every((facet) => facets[facet].length === 0 || FACET_SOURCES[facet].includes(each)),
  );
}

/** `values` with `value` added or removed, in a fixed order so equal filters share a cache entry. */
function toggled<T extends string>(values: readonly T[], value: T, order: readonly T[] | null): T[] {
  const next = values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
  return order ? order.filter((v) => next.includes(v)) : next.toSorted((a, b) => a.localeCompare(b));
}

/** How many options a list shows before "Show all". */
const COLLAPSED_OPTIONS = 6;

/**
 * The sidebar's metadata filters: the speaker's gender, age and accent, and
 * the AudioSet labels of the sound. Each lists its values with how many clips
 * of the other filters have each; picking several of one facet widens it
 * (any of them), and facets narrow each other. A facet only shows while some
 * clip it describes can still be listed: Accent hides with LibriSpeech picked,
 * or with a sound type, unless it has values picked (to clear them).
 */
export function FacetFilters({
  source,
  duration,
  facets,
  onFacetsChange,
}: {
  source: AudioSource | null;
  duration: DurationRangeV1;
  facets: FacetFiltersV1;
  onFacetsChange: (facets: FacetFiltersV1) => void;
}) {
  const { data } = useQuery(facetsQuery(source, duration, facets));
  const reachable = sourcesFor(source, facets);
  const shown = (facet: FacetV1) =>
    facets[facet].length > 0 || FACET_SOURCES[facet].some((each) => reachable.includes(each));

  const set = <F extends FacetV1>(facet: F, values: FacetFiltersV1[F]) =>
    onFacetsChange({ ...facets, [facet]: values });

  return (
    <>
      {shown("gender") && (
        <FacetSection facet="gender" picked={facets.gender.length} onClear={() => set("gender", [])}>
          {(labelId) => (
            <Chips
              labelId={labelId}
              options={data?.gender ?? []}
              picked={facets.gender}
              label={(value) => GENDER_LABEL[value]}
              onToggle={(value) => set("gender", toggled(facets.gender, value, GENDERS))}
            />
          )}
        </FacetSection>
      )}
      {shown("age") && (
        <FacetSection facet="age" picked={facets.age.length} onClear={() => set("age", [])}>
          {(labelId) => (
            <Chips
              labelId={labelId}
              // Decades no clip of the catalog has (the nineties) would only be noise.
              options={(data?.age ?? []).filter((option) => option.count > 0 || facets.age.includes(option.value))}
              picked={facets.age}
              label={(value) => AGE_LABEL[value]}
              onToggle={(value) => set("age", toggled(facets.age, value, AGES))}
            />
          )}
        </FacetSection>
      )}
      {shown("accent") && (
        <FacetSection facet="accent" picked={facets.accent.length} onClear={() => set("accent", [])}>
          {(labelId) => (
            <OptionList
              labelId={labelId}
              facet="accent"
              options={accentOptions(data?.accent ?? [])}
              picked={facets.accent}
              label={(value) => ACCENT_LABEL[value]}
              onToggle={(value) => set("accent", toggled(facets.accent, value, ACCENTS))}
            />
          )}
        </FacetSection>
      )}
      {shown("label") && (
        <FacetSection facet="label" picked={facets.label.length} onClear={() => set("label", [])}>
          {(labelId) => (
            <OptionList
              labelId={labelId}
              facet="label"
              options={data?.label ?? []}
              picked={facets.label}
              label={(value) => value}
              onToggle={(value) => set("label", toggled(facets.label, value, null))}
              searchable
            />
          )}
        </FacetSection>
      )}
    </>
  );
}

/** The accent groups with most clips first, and Other last. */
function accentOptions(options: FacetCountV1<AccentV1>[]): FacetCountV1<AccentV1>[] {
  const named = options.filter((option) => option.value !== "other").toSorted((a, b) => b.count - a.count);
  return [...named, ...options.filter((option) => option.value === "other")];
}

function FacetSection({
  facet,
  picked,
  onClear,
  children,
}: {
  facet: FacetV1;
  picked: number;
  onClear: () => void;
  /** The options, labelled by the section's title. */
  children: (labelId: string) => ReactNode;
}) {
  const labelId = useId();
  const sources = FACET_SOURCES[facet].map((source) => SOURCE_LABEL[source]).join(", ");
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col">
        <div className="flex min-h-6 items-center justify-between gap-2">
          <p id={labelId} className="text-xs font-medium text-muted-foreground">
            {FACET_TITLE[facet]}
          </p>
          {picked > 0 && (
            <Button
              variant="ghost"
              size="xs"
              className="-mr-2 text-muted-foreground"
              aria-label={`Clear the ${FACET_TITLE[facet].toLowerCase()} filter`}
              onClick={onClear}
            >
              Clear
            </Button>
          )}
        </div>
        {/* Which datasets record it: picking a value leaves the others out. */}
        <p className="-mt-0.5 text-[11.5px] leading-[14px] text-muted-foreground">{sources}</p>
      </div>
      {children(labelId)}
    </div>
  );
}

/** Few values, each a toggle button with its count, wrapping. */
function Chips<T extends string>({
  labelId,
  options,
  picked,
  label,
  onToggle,
}: {
  labelId: string;
  options: FacetCountV1<T>[];
  picked: readonly T[];
  label: (value: T) => string;
  onToggle: (value: T) => void;
}) {
  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const on = picked.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            disabled={option.count === 0 && !on}
            onClick={() => onToggle(option.value)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border px-2 text-[0.8rem] font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
              on
                ? "border-foreground bg-foreground text-background"
                : "border-input bg-background text-foreground hover:bg-muted",
            )}
          >
            {label(option.value)}
            <span className={cn("font-normal tabular-nums", on ? "text-background/70" : "text-muted-foreground")}>
              {option.count.toLocaleString()}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Many values, as checkboxes with their counts: the first few, then "Show all".
 * The values picked always show, first. With `searchable`, a box narrows the
 * list by name.
 */
function OptionList<T extends string>({
  labelId,
  facet,
  options,
  picked,
  label,
  onToggle,
  searchable = false,
}: {
  labelId: string;
  facet: FacetV1;
  options: FacetCountV1<T>[];
  picked: readonly T[];
  label: (value: T) => string;
  onToggle: (value: T) => void;
  searchable?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  // A value picked that no clip of the other filters has still shows, to unpick it.
  const missing = picked
    .filter((value) => !options.some((option) => option.value === value))
    .map((value) => ({ value, count: 0 }));
  const all = [...options, ...missing];
  const ordered = [
    ...picked.flatMap((value) => all.filter((option) => option.value === value)),
    ...all.filter((option) => !picked.includes(option.value)),
  ];
  const matching = needle
    ? ordered.filter((option) => label(option.value).toLowerCase().includes(needle))
    : ordered;
  const visible =
    expanded || needle ? matching : matching.slice(0, Math.max(COLLAPSED_OPTIONS, picked.length));
  const hidden = matching.length - visible.length;

  return (
    <div className="flex flex-col gap-1.5">
      {searchable && options.length > COLLAPSED_OPTIONS && (
        <label className="flex h-8 items-center gap-2 rounded-full border border-input bg-background px-3 focus-within:ring-3 focus-within:ring-ring/50">
          <SearchIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={`Find among ${options.length.toLocaleString()}`}
            aria-label={`Find a ${FACET_TITLE[facet].toLowerCase()}`}
            className="min-w-0 flex-1 bg-transparent text-[0.8rem] outline-none placeholder:text-muted-foreground"
          />
        </label>
      )}
      <div role="group" aria-labelledby={labelId} className="flex flex-col">
        {visible.map((option) => {
          const on = picked.includes(option.value);
          return (
            <label
              key={option.value}
              className={cn(
                "flex min-h-[30px] cursor-pointer items-center gap-2.5 py-1 text-sm",
                option.count === 0 && !on && "cursor-not-allowed opacity-50",
              )}
            >
              <Checkbox
                checked={on}
                disabled={option.count === 0 && !on}
                onCheckedChange={() => onToggle(option.value)}
              />
              <span className={cn("min-w-0 flex-1 truncate", on ? "text-foreground" : "text-muted-foreground")}>
                {label(option.value)}
              </span>
              <span className="text-[0.8rem] text-muted-foreground tabular-nums">
                {option.count.toLocaleString()}
              </span>
            </label>
          );
        })}
        {matching.length === 0 && (
          <p className="py-1 text-[0.8rem] text-muted-foreground">
            {needle ? `No ${FACET_TITLE[facet].toLowerCase()} matches “${filter.trim()}”` : "None with the other filters"}
          </p>
        )}
      </div>
      {!needle && (hidden > 0 || expanded) && (
        <Button
          variant="ghost"
          size="xs"
          className="-ml-2 self-start text-muted-foreground"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show fewer" : `Show all ${matching.length.toLocaleString()}`}
        </Button>
      )}
    </div>
  );
}
