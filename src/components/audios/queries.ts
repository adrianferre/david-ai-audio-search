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
  type DurationRangeV1,
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
export const catalogQuery = (source: AudioSource | null, duration: DurationRangeV1) =>
  infiniteQueryOptions({
    queryKey: ["v1", "audios", { pageSize: PAGE_SIZE, source, duration }],
    queryFn: ({ pageParam, signal }) =>
      fetchAudios({ page: pageParam, pageSize: PAGE_SIZE, source, duration, signal }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.pagination.nextPage ?? undefined,
  });

/**
 * Every dataset with its number of audios (of `duration`'s length) and its
 * shortest and longest one, for the sidebar.
 */
export const datasetsQuery = (duration: DurationRangeV1) =>
  queryOptions({
    queryKey: ["v1", "datasets", { duration }],
    queryFn: ({ signal }) => fetchDatasets(duration, signal),
    staleTime: 10 * 60 * 1000,
    // The counts of the previous length stay on screen while the new ones load.
    placeholderData: keepPreviousData,
  });

/**
 * The clip whose own sound a search compares with (All on a clip), instead of
 * the text of the query: one of the catalog, or the user's own.
 */
export type ClipSound = { kind: "audio"; id: string } | { kind: "file"; example: AudioExample };

/**
 * A text search. `excludeId` leaves out one audio: the clip whose transcript
 * is the query, which would otherwise come first (and set the bar the others
 * are cut against). With `sound`, the sound signal is that clip's sound, and
 * `q` may be empty.
 */
export const searchQuery = (
  q: string,
  match: SearchMatchFilterV1,
  source: AudioSource | null,
  duration: DurationRangeV1,
  excludeId: string | null = null,
  sound: ClipSound | null = null,
) => {
  // One more than shown.
  const limit = RESULTS_LIMIT + 1;
  const soundOf = sound?.kind === "audio" ? sound.id : null;
  const wav = sound?.kind === "file" ? sound.example : null;
  return queryOptions({
    queryKey: [
      "v1",
      "search",
      {
        q,
        match,
        source,
        duration,
        limit,
        ...(sound && { sound: soundOf ?? `file:${wav!.id}` }),
        ...(excludeId && { exclude: excludeId }),
      },
    ],
    queryFn: ({ signal }) =>
      searchAudios({ q, match, source, duration, limit, soundOf, wav: wav?.wav ?? null, exclude: excludeId, signal }),
    // Keep the previous results on screen while the next query loads.
    placeholderData: keepPreviousData,
    select: cutToLimit,
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

export const similarQuery = (id: string, source: AudioSource | null, duration: DurationRangeV1) =>
  queryOptions({
    queryKey: ["v1", "audio", id, "similar", { limit: RESULTS_LIMIT, source, duration }],
    queryFn: ({ signal }) => fetchSimilarAudios({ id, source, duration, limit: RESULTS_LIMIT, signal }),
  });

/**
 * An audio file the user brought, or a recording they made from the
 * microphone, converted to the WAV the search API takes.
 */
export type AudioExample = {
  /** New for every file attached, so attaching the same file again searches again. */
  id: string;
  name: string;
  source: "file" | "recording" | "link";
  /** The link it was downloaded from, for `source: "link"`. */
  url?: string;
  wav: Blob;
  /** Of the part that is searched. */
  durationSeconds: number;
  peaks: Peaks;
  /** The file was longer than the part that is searched. */
  trimmed: boolean;
};

export const fileQuery = (
  example: AudioExample | null,
  source: AudioSource | null,
  duration: DurationRangeV1,
) =>
  queryOptions({
    queryKey: ["v1", "search", "audio", example?.id ?? "", { limit: RESULTS_LIMIT, source, duration }],
    queryFn: ({ signal }) =>
      searchByAudioFile({ wav: example!.wav, source, duration, limit: RESULTS_LIMIT, signal }),
    enabled: example !== null,
    // The result for a given file never changes.
    staleTime: Infinity,
  });

/** The clip "Find similar" was used on, as the list and its header show it. */
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
 * from one dataset when `source` is set, and of `duration`'s length (the
 * sidebar's filters).
 *
 * A search with a clip compares its sound (`match: "sound"`, the default) or
 * what's said in it: its transcript, searched like typed text by its exact
 * words (`"exact"`) or its meaning (`"text"`).
 */
export type AudioListView = { source: AudioSource | null; duration: DurationRangeV1 } & (
  | { kind: "browse" }
  | { kind: "search"; q: string; match: SearchMatchFilterV1 }
  | { kind: "similar"; reference: ReferenceClip; match: ClipMatch }
  | { kind: "file"; example: AudioExample; match: ClipMatch }
);

/** What a search with a clip compares, as the text search's `match`. */
export type ClipMatch = SearchMatchFilterV1;

/** Whether the view searches with what's said in a clip (All, Words or Meaning), not only its sound. */
export function searchesTranscript(view: AudioListView): view is ClipView & { match: "all" | "exact" | "text" } {
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

/** A hyphen that isn't inside a word ("-well", " - "): web-search syntax for "not". */
const LOOSE_HYPHENS = /(?<![\p{L}\p{N}])-+|-+(?![\p{L}\p{N}])/gu;
/** "or" as a word of its own, in any case and next to any punctuation ("OR", "or,", "(or"). */
const OR_WORD = /(?:^|[^\p{L}\p{N}])or(?:$|[^\p{L}\p{N}])/iu;

/**
 * The transcript as a search query, said as plain words. The search reads `q`
 * as web-search syntax (`websearch_to_tsquery`), where what's said would act as
 * operators: quotes make a phrase, a loose hyphen excludes the next word, and
 * "or" splits the query in two. Those are dropped, and "or" is quoted so it's a
 * word to match ("go or stay" needs all three words). A clip of at most 30 s
 * says far less than the length limit; anything past it is cut at a word.
 */
export function transcriptToQuery(transcript: string): string {
  const words = transcript
    .replace(/"/g, " ")
    .replace(LOOSE_HYPHENS, " ")
    .split(/\s+/)
    .filter((word) => word !== "")
    .map((word) => (OR_WORD.test(word) ? `"${word}"` : word));
  let query = "";
  for (const word of words) {
    const next = query === "" ? word : `${query} ${word}`;
    if (next.length > MAX_SEARCH_QUERY_LENGTH) return query === "" ? word.slice(0, MAX_SEARCH_QUERY_LENGTH) : query;
    query = next;
  }
  return query;
}

/**
 * A search by what's said in a clip: its transcript first, then a text search
 * with it, as the view's `match` (All, Words or Meaning). All also compares the
 * clip's own sound. The search waits for the transcript; when nobody speaks in
 * the clip, only All runs (on the sound alone). Both are idle while the view
 * searches by sound only.
 */
export function useTranscriptSearch(view: AudioListView): {
  transcript: UseQueryResult<TranscriptV1>;
  search: UseQueryResult<SearchResultsData>;
  /** The query searched with: the transcript, cut to the API's limit. Empty when there's none yet. */
  q: string;
  /** The catalog clip searched with, left out of its own results. */
  excludeId: string | null;
  /** The clip whose sound the search compares with (All only). */
  sound: ClipSound | null;
  /** Whether there's a search to run: the transcript is in, and has words or the match is All. */
  searchable: boolean;
} {
  const clip = searchesTranscript(view) ? view : null;
  const transcript = useQuery(transcriptQuery(clip));
  const q = transcriptToQuery(transcript.data?.text ?? "");
  const excludeId = clip?.kind === "similar" ? clip.reference.id : null;
  const sound: ClipSound | null =
    clip?.match !== "all"
      ? null
      : clip.kind === "similar"
        ? { kind: "audio", id: clip.reference.id }
        : { kind: "file", example: clip.example };
  const searchable = clip !== null && transcript.isSuccess && (q !== "" || clip.match === "all");
  const search = useQuery({
    ...searchQuery(q, clip?.match ?? "text", view.source, view.duration, excludeId, sound),
    enabled: searchable,
  });
  return { transcript, search, q, excludeId, sound, searchable };
}

/**
 * The current view as the header and the select-all checkbox need it: the rows
 * the list shows, a short count of them, and whether they are still loading.
 */
export function useListView(view: AudioListView): {
  rows: readonly { id: string; durationSeconds: number }[];
  summary: string;
} {
  const { source, duration } = view;
  const catalog = useInfiniteQuery({ ...catalogQuery(source, duration), enabled: view.kind === "browse" });
  const search = useQuery({
    ...searchQuery(
      view.kind === "search" ? view.q : "",
      view.kind === "search" ? view.match : "all",
      source,
      duration,
    ),
    enabled: view.kind === "search",
  });
  const similar = useQuery({
    ...similarQuery(view.kind === "similar" ? view.reference.id : "", source, duration),
    enabled: view.kind === "similar" && view.match === "sound",
  });
  const file = useQuery(
    fileQuery(view.kind === "file" && view.match === "sound" ? view.example : null, source, duration),
  );
  const words = useTranscriptSearch(view);
  const byWords = searchesTranscript(view);

  const rows =
    view.kind === "browse"
      ? (catalog.data?.pages.flatMap((page) => page.data) ?? [])
      : view.kind === "search"
        ? (search.data?.data ?? [])
        : byWords
          ? words.searchable && !words.search.isPlaceholderData
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
    // Nobody speaks in the clip: nothing to search with, but its sound for All.
    if (!words.searchable) return "";
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
