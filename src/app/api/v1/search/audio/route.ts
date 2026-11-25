import type { NextRequest } from "next/server";
import { z } from "zod";

import type { SimilarAudiosResponseV1 } from "@/lib/api/v1/types";
import { apiError, internalError } from "@/server/api/errors";
import { catalogFilter, catalogFilterQuerySchema, queryParams } from "@/server/api/source-filter";
import { toSimilarAudioV1 } from "@/server/api/v1/audios";
import { readWavBody } from "@/server/api/wav-body";
import { findAudiosNearVector } from "@/server/audios/repository";
import { embedAudioQuery } from "@/server/search/embeddings";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
}).extend(catalogFilterQuerySchema.shape);

/**
 * POST /api/v1/search/audio?limit=50&source=commonvoice&minDuration=5&accent=us with a WAV body (`Content-Type: audio/wav`).
 * Search by an outside example: the audios that sound most like the uploaded
 * clip. The clip is embedded and discarded, never stored.
 */
export async function POST(request: NextRequest) {
  const parsed = querySchema.safeParse(queryParams(request.nextUrl.searchParams));
  if (!parsed.success) {
    return apiError(400, "invalid_request", "Invalid query parameters", z.flattenError(parsed.error).fieldErrors);
  }

  const upload = await readWavBody(request);
  if (upload.error) return upload.error;

  let vector;
  try {
    vector = await embedAudioQuery(upload.wav, request.signal);
  } catch (error) {
    // The embedding model is an external service (Vercel AI Gateway).
    console.error("[api] Audio embedding failed:", error);
    return apiError(503, "search_unavailable", "Search is temporarily unavailable. Try again.");
  }

  let hits;
  try {
    hits = await findAudiosNearVector(vector, parsed.data.limit, catalogFilter(parsed.data));
  } catch (error) {
    return internalError(error);
  }
  const body: SimilarAudiosResponseV1 = { data: hits.map(toSimilarAudioV1) };
  return Response.json(body);
}
