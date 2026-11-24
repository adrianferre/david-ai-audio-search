import type { NextRequest } from "next/server";
import { z } from "zod";

import type { SimilarAudiosResponseV1 } from "@/lib/api/v1/types";
import { apiError, internalError } from "@/server/api/errors";
import { toSimilarAudioV1 } from "@/server/api/v1/audios";
import { findSimilarAudios } from "@/server/audios/repository";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

/** GET /api/v1/audios/{id}/similar?limit=50 */
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/v1/audios/[id]/similar">,
) {
  const { id } = await ctx.params;
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return apiError(400, "invalid_request", "Invalid query parameters", z.flattenError(parsed.error).fieldErrors);
  }

  let hits;
  try {
    hits = await findSimilarAudios(id, parsed.data.limit);
  } catch (error) {
    return internalError(error);
  }
  if (!hits) {
    return apiError(404, "not_found", `Audio "${id}" not found`);
  }

  const body: SimilarAudiosResponseV1 = { data: hits.map(toSimilarAudioV1) };
  return Response.json(body);
}
