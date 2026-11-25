import { connection, type NextRequest } from "next/server";
import { z } from "zod";

import { ACCENTS, type FacetCountV1, type FacetsResponseV1, GENDERS } from "@/lib/api/v1/types";
import { apiError, internalError } from "@/server/api/errors";
import { catalogFilter, catalogFilterQuerySchema, queryParams } from "@/server/api/source-filter";
import { countFacets, type FacetCount } from "@/server/audios/repository";

/** Every value of `values`, in its order, with its count (0 when no clip has it). */
function everyValue<T extends string>(values: readonly T[], counts: FacetCount[]): FacetCountV1<T>[] {
  const byValue = new Map(counts.map((count) => [count.value, count.count]));
  return values.map((value) => ({ value, count: byValue.get(value) ?? 0 }));
}

/**
 * GET /api/v1/facets?source=commonvoice&minDuration=5&gender=female&accent=us:
 * how many clips have each speaker gender and accent, of that dataset and
 * length. Each facet's counts apply the other
 * facets given, not its own (FacetsV1).
 */
export async function GET(request: NextRequest) {
  // Counted at request time: the catalog changes without a redeploy.
  await connection();
  const parsed = catalogFilterQuerySchema.safeParse(queryParams(request.nextUrl.searchParams));
  if (!parsed.success) {
    return apiError(400, "invalid_request", "Invalid query parameters", z.flattenError(parsed.error).fieldErrors);
  }
  let counts;
  try {
    counts = await countFacets(catalogFilter(parsed.data));
  } catch (error) {
    return internalError(error);
  }
  const body: FacetsResponseV1 = {
    data: {
      gender: everyValue(GENDERS, counts.gender),
      accent: everyValue(ACCENTS, counts.accent),
    },
  };
  return Response.json(body);
}
