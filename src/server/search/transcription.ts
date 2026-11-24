import "server-only";

import { transcribe } from "ai";

/**
 * Vercel AI Gateway model ID. No local speech-to-text library fits a Vercel
 * Function (Whisper on ONNX needs a large runtime and model download), and
 * Whisper also makes up words for clips with no speech ("Thank you for
 * watching."). Tried live on catalog clips (Nov 2026), this model was as
 * accurate as the OpenAI and Google ones on speech, the fastest, and returned
 * nothing for clips where nobody speaks.
 */
export const TRANSCRIPTION_MODEL = "mistral/voxtral-mini-transcribe-3";

/**
 * What's said in an audio clip (WAV, FLAC, MP3…), through the Vercel AI Gateway.
 * Empty when nobody speaks. Auth: the project's OIDC token, like the embeddings.
 */
export async function transcribeAudio(audio: Uint8Array, abortSignal?: AbortSignal): Promise<string> {
  const { text } = await transcribe({ model: TRANSCRIPTION_MODEL, audio, abortSignal });
  return text.trim();
}
