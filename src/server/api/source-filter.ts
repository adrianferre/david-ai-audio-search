import "server-only";

import { z } from "zod";

import { AUDIO_SOURCES } from "@/lib/api/v1/types";

/**
 * The `source` query parameter: only the audios of that dataset. Absent (or
 * empty) means every dataset.
 */
export const sourceQuerySchema = z.object({
  source: z.preprocess((value) => (value === "" ? undefined : value), z.enum(AUDIO_SOURCES).optional()),
});
