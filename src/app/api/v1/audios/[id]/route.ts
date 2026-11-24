import type { NextRequest } from "next/server";

import type { AudioDetailResponseV1 } from "@/lib/api/v1/types";
import { apiError } from "@/server/api/errors";
import { toAudioDetailV1 } from "@/server/api/v1/audios";
import { getCatalog } from "@/server/audios/catalog";

/** GET /api/v1/audios/{id} */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/v1/audios/[id]">,
) {
  const { id } = await ctx.params;
  const { byId } = await getCatalog();
  const record = byId.get(id);
  if (!record) {
    return apiError(404, "not_found", `Audio "${id}" not found`);
  }

  const body: AudioDetailResponseV1 = { data: toAudioDetailV1(record) };
  return Response.json(body);
}
