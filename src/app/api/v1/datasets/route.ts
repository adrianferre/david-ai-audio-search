import { connection, type NextRequest } from "next/server";
import { z } from "zod";

import { AUDIO_SOURCES, type DatasetsResponseV1 } from "@/lib/api/v1/types";
import { apiError, internalError } from "@/server/api/errors";
import { durationQuerySchema, durationRange, facetFilters, facetQuerySchema, queryParams } from "@/server/api/source-filter";
import { listDatasets } from "@/server/audios/repository";

const querySchema = durationQuerySchema.extend(facetQuerySchema.shape);

/**
 * GET /api/v1/datasets?minDuration=5&maxDuration=12&gender=female: every
 * dataset of the catalog (the `datasets` table) with its number of audios (of
 * that length and with those facets, when given), its shortest and longest
 * audio, its split and its original format, in the list's order.
 */
export async function GET(request: NextRequest) {
  // Counted at request time: the catalog changes without a redeploy.
  await connection();
  const parsed = querySchema.safeParse(queryParams(request.nextUrl.searchParams));
  if (!parsed.success) {
    return apiError(400, "invalid_request", "Invalid query parameters", z.flattenError(parsed.error).fieldErrors);
  }
  let datasets;
  try {
    datasets = await listDatasets({ duration: durationRange(parsed.data), facets: facetFilters(parsed.data) });
  } catch (error) {
    return internalError(error);
  }
  const bySource = new Map(datasets.map((dataset) => [dataset.source, dataset]));
  const body: DatasetsResponseV1 = {
    data: AUDIO_SOURCES.flatMap((source) => {
      const dataset = bySource.get(source);
      return dataset ? [dataset] : [];
    }),
  };
  return Response.json(body);
}
