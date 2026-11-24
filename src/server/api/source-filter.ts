import "server-only";

import { z } from "zod";

import { AUDIO_SOURCES, type DurationRangeV1 } from "@/lib/api/v1/types";

/** An absent or empty query parameter: no value. */
const blankToUndefined = (value: unknown) => (value === "" ? undefined : value);

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

/**
 * What every endpoint that lists audios filters by: the dataset and the length.
 * Spread its `shape` into a route's query schema.
 */
export const catalogFilterQuerySchema = sourceQuerySchema.extend(durationQuerySchema.shape);

/** The duration parameters as the repository takes them. */
export function durationRange(query: z.infer<typeof durationQuerySchema>): DurationRangeV1 {
  return { min: query.minDuration ?? null, max: query.maxDuration ?? null };
}
