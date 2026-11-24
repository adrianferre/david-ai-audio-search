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
  signal?: AbortSignal;
}): Promise<AudioSearchResponseV1> {
  const search = new URLSearchParams({ q: params.q, match: params.match });
  return getJson(`${BASE}/search?${search}`, params.signal);
}

/** Search by example: the audios that sound most like `id`. */
export function fetchSimilarAudios(
  id: string,
  signal?: AbortSignal,
): Promise<SimilarAudiosResponseV1> {
  return getJson(`${BASE}/audios/${encodeURIComponent(id)}/similar`, signal);
}

/** URL of the audio's FLAC, streamed by the API. Use it as an <audio> src. */
export function audioFileUrl(id: string): string {
  return `${BASE}/audios/${encodeURIComponent(id)}/audio`;
}

/**
 * Downloads a ZIP with the FLAC and metadata of each audio (one request,
 * whatever the number of ids). Resolves once the whole file has arrived.
 */
export async function exportAudios(
  ids: string[],
  signal?: AbortSignal,
): Promise<{ blob: Blob; fileName: string }> {
  const body: AudioExportRequestV1 = { ids };
  const res = await fetch(`${BASE}/audios/export`, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", accept: "application/zip" },
    body: JSON.stringify(body),
  });
  await ensureOk(res);
  const fileName =
    /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "audios.zip";
  return { blob: await res.blob(), fileName };
}
