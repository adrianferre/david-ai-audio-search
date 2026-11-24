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
  fetchAudioTranscript,
  fetchDatasets,
  fetchSimilarAudios,
  searchAudios,
  searchByAudioFile,
  transcribeAudioFile,
} from "@/lib/api/v1/client";
import {
  type AudioListResponseV1,
  type AudioSearchResponseV1,
  type AudioSource,
  MAX_SEARCH_QUERY_LENGTH,
  type SearchMatchFilterV1,
  type SimilarAudiosResponseV1,
  type TranscriptResponseV1,
  type TranscriptV1,
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

/**
 * A text search. `excludeId` leaves out one audio: the clip whose transcript
 * is the query, which would otherwise come first.
 */
export const searchQuery = (
  q: string,
  match: SearchMatchFilterV1,
  source: AudioSource | null,
  excludeId: string | null = null,
) => {
  // One more than shown, and one more again for the audio left out.
  const limit = RESULTS_LIMIT + 1 + (excludeId ? 1 : 0);
  return queryOptions({
    queryKey: ["v1", "search", { q, match, source, limit }],
    queryFn: ({ signal }) => searchAudios({ q, match, source, limit, signal }),
    // Keep the previous results on screen while the next query loads.
    placeholderData: keepPreviousData,
    select: excludeId
      ? (response: AudioSearchResponseV1) =>
          cutToLimit({ ...response, data: response.data.filter((hit) => hit.id !== excludeId) })
      : cutToLimit,
  });
};

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
 * one of the catalog, or the audios like the user's own file or recording. Each
 * from one dataset when `source` is set (the sidebar's filter).
 *
 * A search with a clip compares its sound (`match: "sound"`, the default) or
 * what's said in it: its transcript, searched like typed text by its exact
 * words (`"exact"`) or its meaning (`"text"`).
 */
export type AudioListView = { source: AudioSource | null } & (
  | { kind: "browse" }
  | { kind: "search"; q: string; match: SearchMatchFilterV1 }
  | { kind: "similar"; reference: ReferenceClip; match: ClipMatch }
  | { kind: "file"; example: AudioExample; match: ClipMatch }
);

/** What a search with a clip compares, as the text search's `match`; all but "all". */
export type ClipMatch = Exclude<SearchMatchFilterV1, "all">;

/** Whether the view searches with what's said in a clip (Words or Meaning), not its sound. */
export function searchesTranscript(view: AudioListView): view is ClipView & { match: "exact" | "text" } {
  return (view.kind === "similar" || view.kind === "file") && view.match !== "sound";
}
/** A view that searches with a clip: one of the catalog, or the user's own. */
export type ClipView = Extract<AudioListView, { kind: "similar" | "file" }>;

/**
 * What's said in the clip: the dataset's transcript, or one made by a
 * speech-to-text model (AudioCaps clips, the user's clips). Fetched only when
 * the view searches by words, since it can cost a model call.
 */
export const transcriptQuery = (view: ClipView | null) =>
  queryOptions({
    queryKey:
      view?.kind === "file"
        ? ["v1", "transcriptions", view.example.id]
        : ["v1", "audio", view?.reference.id ?? "", "transcript"],
    queryFn: ({ signal }): Promise<TranscriptResponseV1> => {
      if (view?.kind === "file") return transcribeAudioFile({ wav: view.example.wav, signal });
      return fetchAudioTranscript(view!.reference.id, signal);
    },
    enabled: view !== null && view.match !== "sound",
    // A clip's transcript never changes.
    staleTime: Infinity,
    select: (response) => response.data,
  });

/**
 * The transcript as a search query. A clip of at most 30 s says far less than
 * the limit; anything past it is cut at a word.
 */
export function transcriptToQuery(transcript: string): string {
  const text = transcript.trim();
  if (text.length <= MAX_SEARCH_QUERY_LENGTH) return text;
  const cut = text.slice(0, MAX_SEARCH_QUERY_LENGTH + 1);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), 1)).trim();
}

/**
 * A search by what's said in a clip: its transcript first, then a text search
 * with it (Words or Meaning, as the view's `match`). The search waits for the
 * transcript, and doesn't run when nobody speaks in the clip. Both are idle
 * while the view searches by sound.
 */
export function useTranscriptSearch(view: AudioListView): {
  transcript: UseQueryResult<TranscriptV1>;
  search: UseQueryResult<SearchResultsData>;
  /** The query searched with: the transcript, cut to the API's limit. Empty when there's none yet. */
  q: string;
  /** The catalog clip searched with, left out of its own results. */
  excludeId: string | null;
} {
  const clip = searchesTranscript(view) ? view : null;
  const transcript = useQuery(transcriptQuery(clip));
  const q = transcriptToQuery(transcript.data?.text ?? "");
  const excludeId = clip?.kind === "similar" ? clip.reference.id : null;
  const search = useQuery({
    ...searchQuery(q, clip?.match ?? "text", view.source, excludeId),
    enabled: clip !== null && q !== "",
  });
  return { transcript, search, q, excludeId };
}

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
    enabled: view.kind === "similar" && view.match === "sound",
  });
  const file = useQuery(fileQuery(view.kind === "file" && view.match === "sound" ? view.example : null, source));
  const words = useTranscriptSearch(view);
  const byWords = searchesTranscript(view);

  const rows =
    view.kind === "browse"
      ? (catalog.data?.pages.flatMap((page) => page.data) ?? [])
      : view.kind === "search"
        ? (search.data?.data ?? [])
        : byWords
          ? words.q !== "" && !words.search.isPlaceholderData
            ? (words.search.data?.data ?? [])
            : []
          : view.kind === "similar"
            ? (similar.data?.data ?? [])
            : (file.data?.data ?? []);

  return { rows, summary: summarize(view, { catalog, search, similar, file, words }) };
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
    words,
  }: {
    catalog: UseInfiniteQueryResult<InfiniteData<AudioListResponseV1>>;
    search: UseQueryResult<SearchResultsData>;
    similar: UseQueryResult<SimilarAudiosResponseV1>;
    file: UseQueryResult<SimilarAudiosResponseV1>;
    words: ReturnType<typeof useTranscriptSearch>;
  },
): string {
  const clips = (count: number) => `${count.toLocaleString()} ${count === 1 ? "clip" : "clips"}`;
  const ranked = (result: UseQueryResult<SearchResultsData>) => {
    if (result.status === "error") return "";
    if (result.status === "pending" || result.isPlaceholderData) return "Searching…";
    const count = result.data.data.length;
    if (count === 0) return "";
    return `${result.data.hasMore ? `${count.toLocaleString()}+ clips` : clips(count)} · best match first`;
  };

  if (searchesTranscript(view)) {
    if (words.transcript.status === "error") return "";
    if (words.transcript.status === "pending") return "Transcribing…";
    // Nobody speaks in the clip: nothing to search with.
    if (words.q === "") return "";
    return ranked(words.search);
  }

  switch (view.kind) {
    case "browse": {
      const total = catalog.data?.pages[0]?.pagination.total;
      if (total === undefined) return catalog.status === "error" ? "" : "Loading…";
      return clips(total);
    }
    case "search":
      return ranked(search);
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
