/**
 * Embedding settings shared by the app (query time) and scripts/embed-catalog.mts
 * (ingest). Stored vectors and query vectors must come from the same model, size
 * and text formats, so both sides read them from here.
 *
 * No imports and no `server-only`: plain Node loads this file from the script.
 */

/** Vercel AI Gateway model ID. Text and audio share one vector space. */
export const EMBEDDING_MODEL = "google/gemini-embedding-2";

/** Must match the `vector(768)` columns in src/server/db/schema.sql. */
export const EMBEDDING_DIMENSIONS = 768;

/**
 * Text formats Google documents for text-to-text retrieval with this model
 * (it has no `taskType` setting; the task goes in the text).
 * https://ai.google.dev/gemini-api/docs/embeddings
 */
export function toTranscriptDocument(transcript: string): string {
  // LibriSpeech transcripts are upper case.
  return `title: none | text: ${transcript.toLowerCase()}`;
}

/** A search query compared against transcript vectors. */
export function toTranscriptQuery(query: string): string {
  return `task: search result | query: ${query}`;
}

/**
 * A search query compared against audio vectors: the text as typed. The task
 * prefixes above are for text-to-text only.
 */
export function toSoundQuery(query: string): string {
  return query;
}
