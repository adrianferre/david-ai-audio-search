import type { NextRequest } from "next/server";
import { z } from "zod";

import type { SimilarAudiosResponseV1 } from "@/lib/api/v1/types";
import { apiError, internalError } from "@/server/api/errors";
import { toSimilarAudioV1 } from "@/server/api/v1/audios";
import { findAudiosNearVector } from "@/server/audios/repository";
import { embedAudioQuery } from "@/server/search/embeddings";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/** About a minute of 16 kHz mono 16-bit WAV; the web app sends at most 30 s. */
const MAX_BYTES = 2 * 1024 * 1024;

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

function isWav(bytes: Uint8Array): boolean {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  return bytes.length > 44 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE";
}

/**
 * POST /api/v1/search/audio?limit=50 with a WAV body (`Content-Type: audio/wav`).
 * Search by an outside example: the audios that sound most like the uploaded
 * clip. The clip is embedded and discarded, never stored.
 */
export async function POST(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return apiError(400, "invalid_request", "Invalid query parameters", z.flattenError(parsed.error).fieldErrors);
  }

  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "audio/wav" && contentType !== "audio/x-wav") {
    return apiError(415, "unsupported_media_type", "Send the audio as a WAV file (Content-Type: audio/wav)");
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (declaredLength > MAX_BYTES) {
    return apiError(413, "payload_too_large", `The audio must be at most ${MAX_BYTES / 1024 / 1024} MB`);
  }
  const wav = new Uint8Array(await request.arrayBuffer());
  if (wav.length > MAX_BYTES) {
    return apiError(413, "payload_too_large", `The audio must be at most ${MAX_BYTES / 1024 / 1024} MB`);
  }
  if (!isWav(wav)) {
    return apiError(400, "invalid_request", "The body is not a WAV file");
  }

  let vector;
  try {
    vector = await embedAudioQuery(wav, request.signal);
  } catch (error) {
    // The embedding model is an external service (Vercel AI Gateway).
    console.error("[api] Audio embedding failed:", error);
    return apiError(503, "search_unavailable", "Search is temporarily unavailable. Try again.");
  }

  let hits;
  try {
    hits = await findAudiosNearVector(vector, parsed.data.limit);
  } catch (error) {
    return internalError(error);
  }
  const body: SimilarAudiosResponseV1 = { data: hits.map(toSimilarAudioV1) };
  return Response.json(body);
}
