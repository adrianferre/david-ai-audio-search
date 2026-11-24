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

import { fetchAudios, fetchSimilarAudios, searchAudios } from "@/lib/api/v1/client";
import type {
  AudioListResponseV1,
  AudioSearchResponseV1,
  SearchMatchFilterV1,
  SimilarAudiosResponseV1,
} from "@/lib/api/v1/types";

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
export const catalogQuery = () =>
  infiniteQueryOptions({
    queryKey: ["v1", "audios", { pageSize: PAGE_SIZE }],
    queryFn: ({ pageParam, signal }) =>
      fetchAudios({ page: pageParam, pageSize: PAGE_SIZE, signal }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.pagination.nextPage ?? undefined,
  });

export const searchQuery = (q: string, match: SearchMatchFilterV1) =>
  queryOptions({
    queryKey: ["v1", "search", { q, match, limit: RESULTS_LIMIT + 1 }],
    queryFn: ({ signal }) => searchAudios({ q, match, limit: RESULTS_LIMIT + 1, signal }),
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

export const similarQuery = (id: string) =>
  queryOptions({
    queryKey: ["v1", "audio", id, "similar", { limit: RESULTS_LIMIT }],
    queryFn: ({ signal }) => fetchSimilarAudios({ id, limit: RESULTS_LIMIT, signal }),
  });

/** What the list shows: the whole catalog, a text search, or the audios similar to one. */
export type AudioListView =
  | { kind: "browse" }
  | { kind: "search"; q: string; match: SearchMatchFilterV1 }
  | { kind: "similar"; id: string };

/**
 * The current view as the search bar needs it: the rows the list shows, for
 * the select-all checkbox, and a short count of them.
 */
export function useListView(view: AudioListView): {
  rows: readonly { id: string }[];
  summary: string;
} {
  const catalog = useInfiniteQuery(catalogQuery());
  const search = useQuery({
    ...searchQuery(view.kind === "search" ? view.q : "", view.kind === "search" ? view.match : "all"),
    enabled: view.kind === "search",
  });
  const similar = useQuery({
    ...similarQuery(view.kind === "similar" ? view.id : ""),
    enabled: view.kind === "similar",
  });

  const rows =
    view.kind === "browse"
      ? (catalog.data?.pages.flatMap((page) => page.data) ?? [])
      : view.kind === "search"
        ? (search.data?.data ?? [])
        : (similar.data?.data ?? []);

  return { rows, summary: summarize(view, { catalog, search, similar }) };
}

/**
 * A short count for the view, e.g. "50 of 3,129 audios" or "12 results of
 * 3,129": what's shown, out of the whole catalog searched. A list cut off at
 * `RESULTS_LIMIT` says so ("50+ results", "50 most similar"), since its length
 * is the cap, not the number of matches.
 */
function summarize(
  view: AudioListView,
  {
    catalog,
    search,
    similar,
  }: {
    catalog: UseInfiniteQueryResult<InfiniteData<AudioListResponseV1>>;
    search: UseQueryResult<SearchResultsData>;
    similar: UseQueryResult<SimilarAudiosResponseV1>;
  },
): string {
  const total = catalog.data?.pages[0]?.pagination.total;
  const ofTotal = total === undefined ? "" : ` of ${total.toLocaleString()}`;

  switch (view.kind) {
    case "browse": {
      if (!catalog.data) return catalog.status === "error" ? "" : "Loading…";
      const loaded = catalog.data.pages.reduce((sum, page) => sum + page.data.length, 0);
      return `${loaded.toLocaleString()}${ofTotal} audios`;
    }
    case "search": {
      if (search.status === "error") return "Search failed";
      if (search.status === "pending" || search.isPlaceholderData) return "Searching…";
      const count = search.data.data.length;
      if (search.data.hasMore) return `${count.toLocaleString()}+ results${ofTotal}`;
      return `${count.toLocaleString()} ${count === 1 ? "result" : "results"}${ofTotal}`;
    }
    case "similar": {
      if (similar.status === "error") return "Search failed";
      if (similar.status === "pending") return "Finding similar…";
      // Ranked by distance with no cutoff, so a full list is the top N, not
      // the only N that are similar.
      const count = similar.data.data.length;
      if (count >= RESULTS_LIMIT) return `${count.toLocaleString()} most similar${ofTotal}`;
      return `${count.toLocaleString()} similar${ofTotal}`;
    }
  }
}
