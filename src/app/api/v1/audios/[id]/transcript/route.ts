import type { NextRequest } from "next/server";

import type { TranscriptResponseV1, TranscriptV1 } from "@/lib/api/v1/types";
import { apiError, internalError } from "@/server/api/errors";
import { getAudio } from "@/server/audios/repository";
import { readAudioFile } from "@/server/audios/storage";
import { transcribeAudio } from "@/server/search/transcription";

/**
 * GET /api/v1/audios/{id}/transcript
 *
 * What's said in the audio: the dataset's transcript (LibriSpeech, Common
 * Voice), or one made on the spot by a speech-to-text model (AudioCaps, whose
 * clips come with captions of the sound instead).
 */
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/v1/audios/[id]/transcript">,
) {
  const { id } = await ctx.params;

  let record;
  try {
    record = await getAudio(id);
  } catch (error) {
    return internalError(error);
  }
  if (!record) {
    return apiError(404, "not_found", `Audio "${id}" not found`);
  }

  let transcript: TranscriptV1;
  if (record.source !== "audiocaps") {
    transcript = { text: record.transcript, generated: false };
  } else {
    let audio;
    try {
      audio = await readAudioFile(record.blobPathname, request.signal);
    } catch (error) {
      return internalError(error);
    }
    if (!audio) {
      return apiError(404, "not_found", `Audio file for "${id}" not found`);
    }
    try {
      transcript = { text: await transcribeAudio(audio, request.signal), generated: true };
    } catch (error) {
      // The speech-to-text model is an external service (Vercel AI Gateway).
      console.error("[api] Transcription failed:", error);
      return apiError(503, "transcription_unavailable", "Transcription is temporarily unavailable. Try again.");
    }
  }

  const body: TranscriptResponseV1 = { data: transcript };
  // A clip's transcript doesn't change; spare the model a second call for the same clip.
  return Response.json(body, { headers: { "cache-control": "private, max-age=86400" } });
}
