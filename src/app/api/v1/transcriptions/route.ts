import type { NextRequest } from "next/server";

import type { TranscriptResponseV1 } from "@/lib/api/v1/types";
import { apiError } from "@/server/api/errors";
import { readWavBody } from "@/server/api/wav-body";
import { transcribeAudio } from "@/server/search/transcription";

/**
 * POST /api/v1/transcriptions with a WAV body (`Content-Type: audio/wav`).
 * What's said in the clip, to search the catalog by its words. The clip is
 * transcribed and discarded, never stored.
 */
export async function POST(request: NextRequest) {
  const upload = await readWavBody(request);
  if (upload.error) return upload.error;

  let text;
  try {
    text = await transcribeAudio(upload.wav, request.signal);
  } catch (error) {
    // The speech-to-text model is an external service (Vercel AI Gateway).
    console.error("[api] Transcription failed:", error);
    return apiError(503, "transcription_unavailable", "Transcription is temporarily unavailable. Try again.");
  }
  const body: TranscriptResponseV1 = { data: { text, generated: true } };
  return Response.json(body);
}
