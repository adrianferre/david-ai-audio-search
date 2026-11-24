"use client";

import {
  type InfiniteData,
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions,
  type UseInfiniteQueryResult,
  type UseQueryResult,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";

import {
  fetchAudios,
  fetchDatasets,
  fetchSimilarAudios,
  searchAudios,
  searchByAudioFile,
} from "@/lib/api/v1/client";
import type {
  AudioListResponseV1,
  AudioSearchResponseV1,
  AudioSource,
  SearchMatchFilterV1,
  SimilarAudiosResponseV1,
} from "@/lib/api/v1/types";
import type { Peaks } from "@/lib/audio/peaks";

export const PAGE_SIZE = 50;
/** Search and "similar" show at most this many audios. */
export const RESULTS_LIMIT = 50;

/**
 * A search's results, cut to `RESULTS_LIMIT`. The query asks for one more, so
 * `hasMore` tells exactly 50 matches from more than 50 ("50+ results").
 */
export type SearchResultsData = AudioSearchResponseV1 & { hasMore: boolean };

/**
 * The queries behind the audio list. Shared with the search bar (its count and
 * select-all checkbox),
 * so both read the same cache entries instead of fetching twice.
 */
export const catalogQuery = (source: AudioSource | null) =>
  infiniteQueryOptions({
    queryKey: ["v1", "audios", { pageSize: PAGE_SIZE, source }],
    queryFn: ({ pageParam, signal }) =>
      fetchAudios({ page: pageParam, pageSize: PAGE_SIZE, source, signal }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.pagination.nextPage ?? undefined,
  });

/** Every dataset with its number of audios, for the sidebar. */
export const datasetsQuery = () =>
  queryOptions({
    queryKey: ["v1", "datasets"],
    queryFn: ({ signal }) => fetchDatasets(signal),
    staleTime: 10 * 60 * 1000,
  });

export const searchQuery = (q: string, match: SearchMatchFilterV1, source: AudioSource | null) =>
  queryOptions({
    queryKey: ["v1", "search", { q, match, source, limit: RESULTS_LIMIT + 1 }],
    queryFn: ({ signal }) =>
      searchAudios({ q, match, source, limit: RESULTS_LIMIT + 1, signal }),
    // Keep the previous results on screen while the next query loads.
    placeholderData: keepPreviousData,
    select: cutToLimit,
  });

// Module-level, so React Query can reuse its result between renders.
function cutToLimit(response: AudioSearchResponseV1): SearchResultsData {
  return {
    ...response,
    data: response.data.slice(0, RESULTS_LIMIT),
    hasMore: response.data.length > RESULTS_LIMIT,
  };
}

export const similarQuery = (id: string, source: AudioSource | null) =>
  queryOptions({
    queryKey: ["v1", "audio", id, "similar", { limit: RESULTS_LIMIT, source }],
    queryFn: ({ signal }) => fetchSimilarAudios({ id, source, limit: RESULTS_LIMIT, signal }),
  });

/**
 * An audio file the user brought, or a recording they made from the
 * microphone, converted to the WAV the search API takes.
 */
export type AudioExample = {
  /** New for every file attached, so attaching the same file again searches again. */
  id: string;
  name: string;
  source: "file" | "recording";
  wav: Blob;
  /** Of the part that is searched. */
  durationSeconds: number;
  peaks: Peaks;
  /** The file was longer than the part that is searched. */
  trimmed: boolean;
};

export const fileQuery = (example: AudioExample | null, source: AudioSource | null) =>
  queryOptions({
    queryKey: ["v1", "search", "audio", example?.id ?? "", { limit: RESULTS_LIMIT, source }],
    queryFn: ({ signal }) =>
      searchByAudioFile({ wav: example!.wav, source, limit: RESULTS_LIMIT, signal }),
    enabled: example !== null,
    // The result for a given file never changes.
    staleTime: Infinity,
  });

/** The clip "Find similar sound" was used on, as the list and its header show it. */
export type ReferenceClip = {
  id: string;
  source: AudioSource;
  title: string;
  text: string;
  durationSeconds: number;
  waveformPeaks: number[] | null;
};

/**
 * What the list shows: the whole catalog, a text search, the audios similar to
 * one of the catalog, or the audios that sound like the user's own file. Each
 * from one dataset when `source` is set (the sidebar's filter).
 */
export type AudioListView = { source: AudioSource | null } & (
  | { kind: "browse" }
  | { kind: "search"; q: string; match: SearchMatchFilterV1 }
  | { kind: "similar"; reference: ReferenceClip }
  | { kind: "file"; example: AudioExample }
);

/**
 * The current view as the header and the select-all checkbox need it: the rows
 * the list shows, a short count of them, and whether they are still loading.
 */
export function useListView(view: AudioListView): {
  rows: readonly { id: string; durationSeconds: number }[];
  summary: string;
} {
  const { source } = view;
  const catalog = useInfiniteQuery({ ...catalogQuery(source), enabled: view.kind === "browse" });
  const search = useQuery({
    ...searchQuery(view.kind === "search" ? view.q : "", view.kind === "search" ? view.match : "all", source),
    enabled: view.kind === "search",
  });
  const similar = useQuery({
    ...similarQuery(view.kind === "similar" ? view.reference.id : "", source),
    enabled: view.kind === "similar",
  });
  const file = useQuery(fileQuery(view.kind === "file" ? view.example : null, source));

  const rows =
    view.kind === "browse"
      ? (catalog.data?.pages.flatMap((page) => page.data) ?? [])
      : view.kind === "search"
        ? (search.data?.data ?? [])
        : view.kind === "similar"
          ? (similar.data?.data ?? [])
          : (file.data?.data ?? []);

  return { rows, summary: summarize(view, { catalog, search, similar, file }) };
}

/**
 * A short count for the view's header, e.g. "3,329 clips", "12 clips · best
 * match first". A list cut off at `RESULTS_LIMIT` says so ("50+ clips", "50
 * closest clips"), since its length is the cap, not the number of matches.
 */
function summarize(
  view: AudioListView,
  {
    catalog,
    search,
    similar,
    file,
  }: {
    catalog: UseInfiniteQueryResult<InfiniteData<AudioListResponseV1>>;
    search: UseQueryResult<SearchResultsData>;
    similar: UseQueryResult<SimilarAudiosResponseV1>;
    file: UseQueryResult<SimilarAudiosResponseV1>;
  },
): string {
  const clips = (count: number) => `${count.toLocaleString()} ${count === 1 ? "clip" : "clips"}`;

  switch (view.kind) {
    case "browse": {
      const total = catalog.data?.pages[0]?.pagination.total;
      if (total === undefined) return catalog.status === "error" ? "" : "Loading…";
      return clips(total);
    }
    case "search": {
      if (search.status === "error") return "";
      if (search.status === "pending" || search.isPlaceholderData) return "Searching…";
      const count = search.data.data.length;
      if (count === 0) return "";
      return `${search.data.hasMore ? `${count.toLocaleString()}+ clips` : clips(count)} · best match first`;
    }
    case "similar":
    case "file": {
      const result = view.kind === "similar" ? similar : file;
      if (result.status === "error") return "";
      if (result.status === "pending") return view.kind === "file" ? "Listening…" : "Finding similar…";
      // Ranked by distance with no cutoff, so a full list is the top N, not
      // the only N that are similar.
      const count = result.data.data.length;
      if (count === 0) return "";
      const what = count >= RESULTS_LIMIT ? `${count.toLocaleString()} closest clips` : clips(count);
      return `${what} · most similar first`;
    }
  }
}
