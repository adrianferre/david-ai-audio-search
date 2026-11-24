import { connection } from "next/server";

import { AUDIO_SOURCES, type DatasetsResponseV1 } from "@/lib/api/v1/types";
import { internalError } from "@/server/api/errors";
import { countAudiosBySource } from "@/server/audios/repository";

/** GET /api/v1/datasets: every dataset of the catalog with its number of audios. */
export async function GET() {
  // Counted at request time: the catalog changes without a redeploy.
  await connection();
  let counts;
  try {
    counts = await countAudiosBySource();
  } catch (error) {
    return internalError(error);
  }
  const bySource = new Map(counts.map(({ source, count }) => [source, count]));
  const body: DatasetsResponseV1 = {
    data: AUDIO_SOURCES.map((source) => ({ source, count: bySource.get(source) ?? 0 })),
  };
  return Response.json(body);
}
