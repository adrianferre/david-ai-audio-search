import type { NextRequest } from "next/server";
import { z } from "zod";

import { type AudioSearchResponseV1, MAX_SEARCH_QUERY_LENGTH } from "@/lib/api/v1/types";
import { apiError, internalError } from "@/server/api/errors";
import { sourceQuerySchema } from "@/server/api/source-filter";
import { toAudioSearchResultV1 } from "@/server/api/v1/audios";
import { readWavBody } from "@/server/api/wav-body";
import { getAudio, searchAudios, searchAudiosByExactWords } from "@/server/audios/repository";
import type { SearchMatch } from "@/server/audios/types";
import { embedAudioQuery, embedQuery } from "@/server/search/embeddings";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const querySchema = z.object({
  // Optional only with an example's sound (`soundOf`, or a WAV body) and `match=all` or `sound`.
  q: z.string().trim().max(MAX_SEARCH_QUERY_LENGTH).optional(),
  match: z.enum(["all", "text", "sound", "exact"]).default("all"),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  soundOf: z.string().min(1).optional(),
  // An audio to leave out: the clip searched with, which would come first.
  exclude: z.string().min(1).optional(),
}).extend(sourceQuerySchema.shape);

/** The sound the `sound` signal compares with, instead of the query's text. */
type SoundExample = { kind: "audio"; id: string } | { kind: "wav"; wav: Uint8Array };

/**
 * GET /api/v1/search?q=dog+barking&match=all&limit=50&source=audiocaps
 *
 * With `soundOf={id}`, the sound signal compares with that audio's sound
 * instead of the text of `q`: search with an example, by its sound and its words.
 * With `exclude={id}`, that audio is left out of the results (and of the best
 * score the others are cut against): the clip searched with.
 */
export async function GET(request: NextRequest) {
  const soundOf = request.nextUrl.searchParams.get("soundOf");
  return search(request, soundOf ? { kind: "audio", id: soundOf } : null);
}

/**
 * POST /api/v1/search?q=…&match=all with a WAV body (`Content-Type: audio/wav`):
 * as GET with `soundOf`, for a clip outside the catalog. Embedded and discarded.
 */
export async function POST(request: NextRequest) {
  if (request.nextUrl.searchParams.has("soundOf")) {
    return apiError(400, "invalid_request", "Send either a WAV body or soundOf, not both");
  }
  const upload = await readWavBody(request);
  if (upload.error) return upload.error;
  return search(request, { kind: "wav", wav: upload.wav });
}

async function search(request: NextRequest, example: SoundExample | null) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return apiError(400, "invalid_request", "Invalid query parameters", z.flattenError(parsed.error).fieldErrors);
  }
  const { match, limit, source, exclude = null } = parsed.data;
  const q = parsed.data.q ?? "";
  if (q === "" && !(example && (match === "all" || match === "sound"))) {
    return apiError(400, "invalid_request", "Invalid query parameters", {
      q: [example ? "Required unless match is all or sound" : "Required"],
    });
  }

  // Exact words need no model call: only the full-text match.
  if (match === "exact") {
    let hits;
    try {
      hits = await searchAudiosByExactWords({ query: q, limit, source, exclude });
    } catch (error) {
      return internalError(error);
    }
    // Every result has the words as typed: each is a clear match.
    const body: AudioSearchResponseV1 = { data: hits.map(toAudioSearchResultV1), strongMatch: hits.length > 0 };
    return Response.json(body);
  }

  if (example?.kind === "audio") {
    let found;
    try {
      found = await getAudio(example.id);
    } catch (error) {
      return internalError(error);
    }
    if (!found) return apiError(404, "not_found", `Audio "${example.id}" not found`);
  }

  const signals: SearchMatch[] = match === "all" ? ["text", "sound"] : [match];
  // The text of `q` is embedded for each signal it serves: not for the sound
  // when an example gives it, and not at all when `q` is empty.
  const fromText = signals.filter((signal) => q !== "" && !(signal === "sound" && example));

  let vectors;
  try {
    const [textVectors, exampleSound] = await Promise.all([
      fromText.length > 0 ? embedQuery(q, fromText, request.signal) : {},
      example?.kind === "wav" && signals.includes("sound")
        ? embedAudioQuery(example.wav, request.signal)
        : undefined,
    ]);
    vectors = { ...textVectors, ...(exampleSound && { sound: exampleSound }) };
  } catch (error) {
    // The embedding model is an external service (Vercel AI Gateway).
    console.error("[api] Query embedding failed:", error);
    return apiError(503, "search_unavailable", "Search is temporarily unavailable. Try again.");
  }

  let result;
  try {
    result = await searchAudios({
      query: q,
      vectors,
      soundOf: example?.kind === "audio" && signals.includes("sound") ? example.id : null,
      // Only when the example's sound is searched with: with Meaning alone it is a typed search.
      soundIsExample: example !== null && signals.includes("sound"),
      limit,
      source,
      exclude,
    });
  } catch (error) {
    return internalError(error);
  }
  const body: AudioSearchResponseV1 = { data: result.hits.map(toAudioSearchResultV1), strongMatch: result.strongMatch };
  return Response.json(body);
}
