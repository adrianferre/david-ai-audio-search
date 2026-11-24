import type {
  ApiErrorBody,
  AudioDetailResponseV1,
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

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: { accept: "application/json" } });
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

/** URL of the audio's FLAC, streamed by the API. Use it as an <audio> src. */
export function audioFileUrl(id: string): string {
  return `${BASE}/audios/${encodeURIComponent(id)}/audio`;
}
