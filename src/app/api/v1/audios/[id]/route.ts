import type { NextRequest } from "next/server";

import type { AudioDetailResponseV1 } from "@/lib/api/v1/types";
import { apiError, internalError } from "@/server/api/errors";
import { toAudioDetailV1 } from "@/server/api/v1/audios";
import { getAudio, getDatasets } from "@/server/audios/repository";

/** GET /api/v1/audios/{id} */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/v1/audios/[id]">,
) {
  const { id } = await ctx.params;
  let record, datasets;
  try {
    [record, datasets] = await Promise.all([getAudio(id), getDatasets()]);
  } catch (error) {
    return internalError(error);
  }
  if (!record) {
    return apiError(404, "not_found", `Audio "${id}" not found`);
  }

  // Every audio has its dataset's row (foreign key on audios.source).
  const body: AudioDetailResponseV1 = { data: toAudioDetailV1(record, datasets.get(record.source)!) };
  return Response.json(body);
}
