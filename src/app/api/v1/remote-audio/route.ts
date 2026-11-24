import type { NextRequest } from "next/server";

import { apiError, internalError } from "@/server/api/errors";
import { fetchRemoteAudio, RemoteAudioError } from "@/server/audios/remote";

/**
 * GET /api/v1/remote-audio?url=https://example.com/clip.mp3
 *
 * The audio or video file at a public link, fetched by the server because most
 * sites don't let the browser read their files across origins. The web app
 * decodes it as it does a file the user attaches. Nothing is stored. At most
 * 20 MB; web pages (YouTube, SoundCloud…) are refused.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url) return apiError(400, "invalid_request", "Add the link as the `url` query parameter");

  let file;
  try {
    file = await fetchRemoteAudio(url, request.signal);
  } catch (error) {
    if (error instanceof RemoteAudioError) return apiError(error.status, error.code, error.message);
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return internalError(error);
  }

  // Streamed, so a file over the 4.5 MB function response limit still goes through.
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const CHUNK = 256 * 1024;
      for (let offset = 0; offset < file.bytes.length; offset += CHUNK) {
        controller.enqueue(file.bytes.subarray(offset, offset + CHUNK));
      }
      controller.close();
    },
  });
  return new Response(body, {
    headers: {
      "content-type": file.contentType,
      "cache-control": "private, no-store",
      // Served from this origin: never let the browser render it as a page.
      "content-disposition": "attachment",
      "x-content-type-options": "nosniff",
    },
  });
}
