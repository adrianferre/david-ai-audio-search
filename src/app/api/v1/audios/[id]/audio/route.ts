import type { NextRequest } from "next/server";

import { apiError, internalError } from "@/server/api/errors";
import { getAudio } from "@/server/audios/repository";
import { getAudioFile } from "@/server/audios/storage";

/**
 * GET /api/v1/audios/{id}/audio
 *
 * Streams the audio's FLAC from the private Blob store. Forwards `Range` (so the
 * browser can seek, and Safari can play at all) and `If-None-Match`.
 */
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/v1/audios/[id]/audio">,
) {
  const { id } = await ctx.params;

  let file;
  try {
    const record = await getAudio(id);
    if (!record) {
      return apiError(404, "not_found", `Audio "${id}" not found`);
    }
    file = await getAudioFile(record.blobPathname, {
      range: request.headers.get("range"),
      ifNoneMatch: request.headers.get("if-none-match"),
      signal: request.signal,
    });
  } catch (error) {
    // The browser dropped the request (track switch, seek): nobody gets a reply.
    if (request.signal.aborted) {
      return new Response(null, { status: 499 });
    }
    return internalError(error);
  }
  if (!file) {
    return apiError(404, "not_found", `Audio file for "${id}" not found`);
  }

  return new Response(file.body, { status: file.status, headers: file.headers });
}
