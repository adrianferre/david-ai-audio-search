import "server-only";

import type { NextRequest } from "next/server";

import { apiError } from "./errors";

/** About a minute of 16 kHz mono 16-bit WAV; the web app sends at most 30 s. */
const MAX_BYTES = 2 * 1024 * 1024;

function isWav(bytes: Uint8Array): boolean {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  return bytes.length > 44 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE";
}

/**
 * The WAV clip a request carries as its body (`Content-Type: audio/wav`), or
 * the error response to send when it carries something else.
 */
export async function readWavBody(
  request: NextRequest,
): Promise<{ wav: Uint8Array; error?: never } | { wav?: never; error: Response }> {
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "audio/wav" && contentType !== "audio/x-wav") {
    return { error: apiError(415, "unsupported_media_type", "Send the audio as a WAV file (Content-Type: audio/wav)") };
  }
  const tooLarge = () => ({
    error: apiError(413, "payload_too_large", `The audio must be at most ${MAX_BYTES / 1024 / 1024} MB`),
  });
  if (Number(request.headers.get("content-length")) > MAX_BYTES) return tooLarge();
  const wav = new Uint8Array(await request.arrayBuffer());
  if (wav.length > MAX_BYTES) return tooLarge();
  if (!isWav(wav)) {
    return { error: apiError(400, "invalid_request", "The body is not a WAV file") };
  }
  return { wav };
}
