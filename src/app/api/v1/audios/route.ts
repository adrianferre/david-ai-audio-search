import type { NextRequest } from "next/server";
import { z } from "zod";

import type { AudioListResponseV1 } from "@/lib/api/v1/types";
import { apiError, internalError } from "@/server/api/errors";
import { pageOffset, paginationQuerySchema, toPaginatedResponse } from "@/server/api/pagination";
import { catalogFilter, catalogFilterQuerySchema, queryParams } from "@/server/api/source-filter";
import { toAudioListItemV1 } from "@/server/api/v1/audios";
import { listAudios } from "@/server/audios/repository";

const querySchema = paginationQuerySchema.extend(catalogFilterQuerySchema.shape);

/** GET /api/v1/audios?page=1&pageSize=50&source=audiocaps&minDuration=5&maxDuration=12&label=Dog&label=Cat */
export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(queryParams(request.nextUrl.searchParams));
  if (!parsed.success) {
    return apiError(400, "invalid_request", "Invalid query parameters", z.flattenError(parsed.error).fieldErrors);
  }

  let page;
  try {
    page = await listAudios({
      offset: pageOffset(parsed.data),
      limit: parsed.data.pageSize,
      ...catalogFilter(parsed.data),
    });
  } catch (error) {
    return internalError(error);
  }
  const { items, total } = page;
  const body: AudioListResponseV1 = toPaginatedResponse(items, total, parsed.data, toAudioListItemV1);
  return Response.json(body);
}
