import { connection } from "next/server";

import { AUDIO_SOURCES, type DatasetsResponseV1 } from "@/lib/api/v1/types";
import { internalError } from "@/server/api/errors";
import { listDatasets } from "@/server/audios/repository";

/**
 * GET /api/v1/datasets: every dataset of the catalog (the `datasets` table) with
 * its number of audios, its split and its original format, in the list's order.
 */
export async function GET() {
  // Counted at request time: the catalog changes without a redeploy.
  await connection();
  let datasets;
  try {
    datasets = await listDatasets();
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
