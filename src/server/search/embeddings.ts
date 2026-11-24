import "server-only";

import { embedMany } from "ai";

import type { SearchMatch } from "@/server/audios/types";

import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  toSoundQuery,
  toTextQuery,
} from "./embedding-config";

/** The query as a vector, once per signal it is compared against. */
export type QueryVectors = Partial<Record<SearchMatch, number[]>>;

const FORMAT: Record<SearchMatch, (query: string) => string> = {
  text: toTextQuery,
  sound: toSoundQuery,
};

/**
 * Embeds a text query through the Vercel AI Gateway, in one request. Auth is the
 * project's OIDC token (or `AI_GATEWAY_API_KEY` when set), read by the AI SDK.
 */
export async function embedQuery(
  query: string,
  signals: readonly SearchMatch[],
  abortSignal?: AbortSignal,
): Promise<QueryVectors> {
  const { embeddings } = await embedMany({
    model: EMBEDDING_MODEL,
    values: signals.map((signal) => FORMAT[signal](query)),
    dimensions: EMBEDDING_DIMENSIONS,
    abortSignal,
  });
  return Object.fromEntries(signals.map((signal, i) => [signal, embeddings[i]]));
}
