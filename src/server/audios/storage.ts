import "server-only";

import { BlobError, get } from "@vercel/blob";

import { env } from "@/env";

/** Response headers worth passing from the Blob store to the browser. */
const FORWARDED_HEADERS = ["content-length", "content-range", "etag", "last-modified"];

export type AudioFileResponse = {
  /** 200, 206 (partial content), 304 (not modified) or 416 (bad range). */
  status: 200 | 206 | 304 | 416;
  body: ReadableStream<Uint8Array> | null;
  headers: Headers;
};

/**
 * Reads a FLAC from the private Blob store, for streaming to the browser.
 * Auth: `BLOB_STORE_ID` plus the Vercel OIDC token (`VERCEL_OIDC_TOKEN` locally,
 * the request's OIDC token on Vercel). Returns null when the blob doesn't exist.
 */
export async function getAudioFile(
  pathname: string,
  options: { range?: string | null; ifNoneMatch?: string | null; signal?: AbortSignal },
): Promise<AudioFileResponse | null> {
  if (!env.BLOB_STORE_ID) {
    throw new Error("BLOB_STORE_ID is not set. Run `vercel env pull .env.local` to read the Blob store.");
  }
  let result;
  try {
    result = await get(pathname, {
      access: "private",
      storeId: env.BLOB_STORE_ID,
      ifNoneMatch: options.ifNoneMatch ?? undefined,
      headers: options.range ? { range: options.range } : undefined,
      abortSignal: options.signal,
    });
  } catch (error) {
    // get() throws on any non-OK status; an unsatisfiable Range is the client's fault.
    if (error instanceof BlobError && /\b416\b/.test(error.message)) {
      return { status: 416, body: null, headers: new Headers({ "accept-ranges": "bytes" }) };
    }
    throw error;
  }
  if (!result) return null;

  const headers = new Headers({
    "accept-ranges": "bytes",
    // Every file in the store is FLAC; don't trust the stored type.
    "content-type": "audio/flac",
    // Behind Deployment Protection, so keep it out of shared caches.
    "cache-control": "private, max-age=3600",
  });
  for (const name of FORWARDED_HEADERS) {
    const value = result.headers.get(name);
    if (value) headers.set(name, value);
  }

  if (result.statusCode === 304) {
    return { status: 304, body: null, headers };
  }
  return {
    status: headers.has("content-range") ? 206 : 200,
    body: result.stream,
    headers,
  };
}
