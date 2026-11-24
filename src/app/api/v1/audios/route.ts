import type { NextRequest } from "next/server";
import { z } from "zod";

import type { AudioListResponseV1 } from "@/lib/api/v1/types";
import { apiError } from "@/server/api/errors";
import { paginate, paginationQuerySchema } from "@/server/api/pagination";
import { toAudioListItemV1 } from "@/server/api/v1/audios";
import { getCatalog } from "@/server/audios/catalog";

/** GET /api/v1/audios?page=1&pageSize=50 */
export async function GET(request: NextRequest) {
  const parsed = paginationQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return apiError(400, "invalid_request", "Invalid query parameters", z.flattenError(parsed.error).fieldErrors);
  }

  const { items } = await getCatalog();
  const body: AudioListResponseV1 = paginate(items, parsed.data, toAudioListItemV1);
  return Response.json(body);
}
