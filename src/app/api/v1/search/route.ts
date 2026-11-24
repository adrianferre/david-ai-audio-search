import type { NextRequest } from "next/server";
import { z } from "zod";

import type { AudioSearchResponseV1 } from "@/lib/api/v1/types";
import { apiError, internalError } from "@/server/api/errors";
import { sourceQuerySchema } from "@/server/api/source-filter";
import { toAudioSearchResultV1 } from "@/server/api/v1/audios";
import { searchAudios } from "@/server/audios/repository";
import type { SearchMatch } from "@/server/audios/types";
import { embedQuery } from "@/server/search/embeddings";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const querySchema = z.object({
  q: z.string().trim().min(1).max(200),
  match: z.enum(["all", "text", "sound"]).default("all"),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
}).extend(sourceQuerySchema.shape);

/** GET /api/v1/search?q=dog+barking&match=all&limit=50&source=audiocaps */
export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return apiError(400, "invalid_request", "Invalid query parameters", z.flattenError(parsed.error).fieldErrors);
  }
  const { q, match, limit, source } = parsed.data;
  const signals: SearchMatch[] = match === "all" ? ["text", "sound"] : [match];

  let vectors;
  try {
    vectors = await embedQuery(q, signals, request.signal);
  } catch (error) {
    // The embedding model is an external service (Vercel AI Gateway).
    console.error("[api] Query embedding failed:", error);
    return apiError(503, "search_unavailable", "Search is temporarily unavailable. Try again.");
  }

  let hits;
  try {
    hits = await searchAudios({ query: q, vectors, limit, source });
  } catch (error) {
    return internalError(error);
  }
  const body: AudioSearchResponseV1 = { data: hits.map(toAudioSearchResultV1) };
  return Response.json(body);
}
