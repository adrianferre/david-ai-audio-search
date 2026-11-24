import type {
  ApiErrorBody,
  AudioDetailResponseV1,
  AudioListResponseV1,
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

/** URL of the audio's FLAC, streamed by the API. Use it as an <audio> src. */
export function audioFileUrl(id: string): string {
  return `${BASE}/audios/${encodeURIComponent(id)}/audio`;
}
