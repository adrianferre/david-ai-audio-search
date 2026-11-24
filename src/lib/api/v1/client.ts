import type {
  ApiErrorBody,
  AudioDetailResponseV1,
  AudioExportRequestV1,
  AudioListResponseV1,
  AudioSearchResponseV1,
  SearchMatchFilterV1,
  SimilarAudiosResponseV1,
} from "./types";

const BASE = "/api/v1";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Throws an ApiError for any non-2xx response. */
async function ensureOk(res: Response): Promise<void> {
  if (res.status === 429) {
    // Rate limited by the Vercel firewall, which answers with its own body.
    throw new ApiError(429, "rate_limited", "Too many requests. Wait a minute and try again.");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(
      res.status,
      body?.error.code ?? "http_error",
      body?.error.message ?? `Request failed with status ${res.status}`,
    );
  }
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: { accept: "application/json" } });
  await ensureOk(res);
  return res.json() as Promise<T>;
}

export function fetchAudios(params: {
  page: number;
  pageSize: number;
  signal?: AbortSignal;
}): Promise<AudioListResponseV1> {
  const search = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  return getJson(`${BASE}/audios?${search}`, params.signal);
}

export function fetchAudio(
  id: string,
  signal?: AbortSignal,
): Promise<AudioDetailResponseV1> {
  return getJson(`${BASE}/audios/${encodeURIComponent(id)}`, signal);
}

/** Text search over each audio's text, its sound, or both (`match: "all"`). */
export function searchAudios(params: {
  q: string;
  match: SearchMatchFilterV1;
  /** At most this many results; the API defaults to 50. */
  limit?: number;
  signal?: AbortSignal;
}): Promise<AudioSearchResponseV1> {
  const search = new URLSearchParams({ q: params.q, match: params.match });
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  return getJson(`${BASE}/search?${search}`, params.signal);
}

/** Search by example: the audios that sound most like `id`. */
export function fetchSimilarAudios(params: {
  id: string;
  /** At most this many audios; the API defaults to 50. */
  limit?: number;
  signal?: AbortSignal;
}): Promise<SimilarAudiosResponseV1> {
  const search = new URLSearchParams();
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  const query = search.size > 0 ? `?${search}` : "";
  return getJson(`${BASE}/audios/${encodeURIComponent(params.id)}/similar${query}`, params.signal);
}

/** Search by an outside example: the audios that sound most like a WAV clip. */
export async function searchByAudioFile(params: {
  wav: Blob;
  /** At most this many audios; the API defaults to 50. */
  limit?: number;
  signal?: AbortSignal;
}): Promise<SimilarAudiosResponseV1> {
  const search = new URLSearchParams();
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  const query = search.size > 0 ? `?${search}` : "";
  const res = await fetch(`${BASE}/search/audio${query}`, {
    method: "POST",
    body: params.wav,
    headers: { accept: "application/json", "content-type": "audio/wav" },
    signal: params.signal,
  });
  await ensureOk(res);
  return res.json() as Promise<SimilarAudiosResponseV1>;
}

/** The audio's FLAC as a stream, to save to disk. */
export async function downloadAudioFile(
  id: string,
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const res = await fetch(audioFileUrl(id), { signal, headers: { accept: "audio/flac" } });
  await ensureOk(res);
  if (!res.body) throw new ApiError(res.status, "empty_response", "The audio came back empty");
  return res.body;
}

/** URL of the audio's FLAC, streamed by the API. Use it as an <audio> src. */
export function audioFileUrl(id: string): string {
  return `${BASE}/audios/${encodeURIComponent(id)}/audio`;
}

/**
 * Starts downloading a ZIP with the FLAC and metadata of each audio (one
 * request, whatever the number of ids). Resolves as soon as the response
 * starts, with the ZIP still streaming in `body`.
 */
export async function exportAudios(
  ids: string[],
  signal?: AbortSignal,
): Promise<{ body: ReadableStream<Uint8Array>; fileName: string }> {
  const body: AudioExportRequestV1 = { ids };
  const res = await fetch(`${BASE}/audios/export`, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", accept: "application/zip" },
    body: JSON.stringify(body),
  });
  await ensureOk(res);
  if (!res.body) throw new ApiError(res.status, "empty_response", "The export came back empty");
  const fileName =
    /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "audios.zip";
  return { body: res.body, fileName };
}
