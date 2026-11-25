import "server-only";

import { z } from "zod";

import {
  ACCENTS,
  AGES,
  AUDIO_SOURCES,
  type DurationRangeV1,
  type FacetFiltersV1,
  GENDERS,
  MAX_FACET_VALUES,
} from "@/lib/api/v1/types";

/** An absent or empty query parameter: no value. */
const blankToUndefined = (value: unknown) => (value === "" ? undefined : value);

/**
 * The query parameters as an object for a zod schema: a parameter given once
 * is a string, one given several times (`gender=female&gender=male`) an array
 * of its values, so a single-valued parameter repeated fails validation.
 */
export function queryParams(params: URLSearchParams): Record<string, string | string[]> {
  const object: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    object[key] = values.length === 1 ? values[0] : values;
  }
  return object;
}

/**
 * The `source` query parameter: only the audios of that dataset. Absent (or
 * empty) means every dataset.
 */
export const sourceQuerySchema = z.object({
  source: z.preprocess(blankToUndefined, z.enum(AUDIO_SOURCES).optional()),
});

const seconds = z.preprocess(blankToUndefined, z.coerce.number().min(0).max(3600).optional());

/**
 * The `minDuration` and `maxDuration` query parameters: only the audios at
 * least / at most that many seconds long. Either may be absent (an open end).
 */
export const durationQuerySchema = z.object({ minDuration: seconds, maxDuration: seconds });

/** A repeatable parameter: absent is none, once is one value; empty values are dropped. */
const valuesOf = <T extends z.ZodType<string>>(value: T) =>
  z.preprocess(
    (raw) => (raw === undefined ? [] : Array.isArray(raw) ? raw : [raw]).filter((v) => v !== ""),
    z.array(value).max(MAX_FACET_VALUES),
  );

/**
 * The facet query parameters (FacetFiltersV1): `gender`, `age`, `accent` and
 * `label`, each repeatable. Use with `queryParams`, which keeps the repeats.
 */
export const facetQuerySchema = z.object({
  gender: valuesOf(z.enum(GENDERS)),
  age: valuesOf(z.enum(AGES)),
  accent: valuesOf(z.enum(ACCENTS)),
  label: valuesOf(z.string().max(200)),
});

/**
 * What every endpoint that lists audios filters by: the dataset, the length
 * and the facets. Spread its `shape` into a route's query schema, and parse
 * `queryParams(searchParams)`.
 */
export const catalogFilterQuerySchema = sourceQuerySchema
  .extend(durationQuerySchema.shape)
  .extend(facetQuerySchema.shape);

/** The duration parameters as the repository takes them. */
export function durationRange(query: z.infer<typeof durationQuerySchema>): DurationRangeV1 {
  return { min: query.minDuration ?? null, max: query.maxDuration ?? null };
}

/** The facet parameters as the repository takes them. */
export function facetFilters(query: z.infer<typeof facetQuerySchema>): FacetFiltersV1 {
  return { gender: query.gender, age: query.age, accent: query.accent, label: query.label };
}

/** The dataset, length and facet parameters as the repository takes them. */
export function catalogFilter(query: z.infer<typeof catalogFilterQuerySchema>) {
  return { source: query.source ?? null, duration: durationRange(query), facets: facetFilters(query) };
}
