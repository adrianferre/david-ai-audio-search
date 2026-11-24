import type { NextRequest } from "next/server";
import { z } from "zod";

import type { AudioListResponseV1 } from "@/lib/api/v1/types";
import { apiError, internalError } from "@/server/api/errors";
import { pageOffset, paginationQuerySchema, toPaginatedResponse } from "@/server/api/pagination";
import { toAudioListItemV1 } from "@/server/api/v1/audios";
import { listAudios } from "@/server/audios/repository";

/** GET /api/v1/audios?page=1&pageSize=50 */
export async function GET(request: NextRequest) {
  const parsed = paginationQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return apiError(400, "invalid_request", "Invalid query parameters", z.flattenError(parsed.error).fieldErrors);
  }

  let page;
  try {
    page = await listAudios({
      offset: pageOffset(parsed.data),
      limit: parsed.data.pageSize,
    });
  } catch (error) {
    return internalError(error);
  }
  const { items, total } = page;
  const body: AudioListResponseV1 = toPaginatedResponse(items, total, parsed.data, toAudioListItemV1);
  return Response.json(body);
}
