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
export function toTextDocument(text: string): string {
  // LibriSpeech transcripts are upper case; Common Voice sentences are mixed case.
  return `title: none | text: ${text.toLowerCase()}`;
}

/** A search query compared against text vectors (transcripts and captions). */
export function toTextQuery(query: string): string {
  return `task: search result | query: ${query}`;
}

/**
 * A search query compared against audio vectors: the text as typed. The task
 * prefixes above are for text-to-text only.
 */
export function toSoundQuery(query: string): string {
  return query;
}

/** Format of the audio sent to the model, at ingest and at query time. */
export const AUDIO_MIME_TYPE = "audio/wav";

/**
 * The `embed()` input for one audio clip (16 kHz mono WAV, base64). The audio
 * goes in the Google `content` option; the text value stays empty so only the
 * audio is embedded.
 */
export function toAudioInput(base64Wav: string) {
  return {
    value: "",
    providerOptions: {
      google: { content: [[{ inlineData: { mimeType: AUDIO_MIME_TYPE, data: base64Wav } }]] },
    },
  };
}
