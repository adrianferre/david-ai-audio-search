"use client";

import { useCallback, useEffect, useState } from "react";

import type { AudioSource, DurationRangeV1, SearchMatchFilterV1 } from "@/lib/api/v1/types";

import { sameDuration } from "./duration-filter";
import type { AudioExample, ClipMatch, ReferenceClip } from "./queries";

/** The search bar offers this many of the latest searches. */
export const MAX_RECENT_SEARCHES = 5;

/**
 * A search the user ran, with what it takes to run it again: the text, the
 * catalog clip "Find similar" was used on, or the user's own file, link or
 * recording (its WAV included). `source` and `duration` are the dataset and
 * length filters it ran with; `duration` is missing from entries saved before
 * the length filter existed (any length).
 */
export type RecentSearch = { id: string; at: number; source: AudioSource | null; duration?: DurationRangeV1 } & (
  | { kind: "text"; q: string; match: SearchMatchFilterV1 }
  | ({ kind: "similar"; reference: ReferenceClip } & ClipSearchState)
  | ({ kind: "audio"; example: AudioExample } & ClipSearchState)
);

/**
 * How a search with a clip last stood. Optional: entries saved before they
 * existed searched by sound.
 */
type ClipSearchState = {
  match?: ClipMatch;
  /** What's said in the clip, once transcribed, when `match` isn't "sound". Empty when nobody speaks. */
  transcript?: string;
};

/**
 * A search offered above the recent ones, always: a slice of the catalog a
 * speech team would ask for, which the sample answers well. Its `label` says
 * what it looks for. Not stored, and Clear leaves it.
 */
export type SuggestedSearch = RecentSearch & { label: string };

export const SUGGESTED_SEARCHES: readonly SuggestedSearch[] = [
  {
    // AudioCaps clips where people talk over other sounds: speech in noisy settings.
    id: "suggested-noisy-speech",
    at: 0,
    label: "People talking in a noisy crowd",
    kind: "text",
    q: "people talking in a noisy crowd",
    match: "all",
    source: "audiocaps",
  },
  {
    // A Common Voice speaker with an Indian accent: half of the 10 clips that sound most like
    // them have that accent too, against 12% of the sample.
    id: "suggested-indian-accent",
    at: 0,
    label: "Indian-accented English, more like this speaker",
    kind: "similar",
    match: "sound",
    source: "commonvoice",
    reference: {
      id: "commonvoice-common_voice_en_17292485",
      source: "commonvoice",
      title: "Speaker b11cb747 · male, twenties, India and South Asia (India, Pakistan, Sri Lanka)",
      text: "Wandering years, in which a journeyman went from place to place after his Lekrjahre, to acquire further experience.",
      durationSeconds: 7.416,
      waveformPeaks: [
        0.021, 0.057, 0.069, 0.089, 0.038, 0.758, 0.86, 0.753, 0.721, 0.816, 0.924, 0.797, 0.319, 0.159, 0.58, 0.702,
        0.39, 0.335, 0.558, 0.943, 0.647, 0.633, 0.492, 0.776, 0.693, 0.366, 0.613, 0.586, 0.644, 0.396, 0.608, 0.738,
        0.534, 0.535, 0.31, 0.643, 0.69, 0.382, 0.2, 0.081, 0.681, 0.927, 0.939, 0.559, 0.331, 0.622, 0.913, 0.978, 1,
        0.769, 0.844, 0.881, 0.762, 0.274, 0.681, 0.716, 0.725, 0.287, 0.139, 0.104, 0.05, 0.04, 0.023, 0.023,
      ],
    },
  },
  {
    // LibriSpeech lines that apologize, found by what they mean: the top results say "I'm not
    // sorry now", "I offer you my humble apologies", "I was wrong", rarely the query's words.
    id: "suggested-apology",
    at: 0,
    label: "Someone apologizing, in other words",
    kind: "text",
    q: "someone apologizing",
    match: "text",
    source: "librispeech",
  },
];

/**
 * Whether `search` is one of the suggestions as offered (same match, dataset
 * and length filters), so it isn't added to the recent searches as well.
 */
export function isSuggested(search: NewRecentSearch | RecentSearch): boolean {
  return SUGGESTED_SEARCHES.some((suggested) => {
    if (suggested.kind !== search.kind || suggested.source !== search.source) return false;
    if (!sameDuration(suggested.duration, search.duration)) return false;
    if (suggested.kind === "text" && search.kind === "text") {
      return suggested.match === search.match && normalize(suggested.q) === normalize(search.q);
    }
    if (suggested.kind === "similar" && search.kind === "similar") {
      return suggested.reference.id === search.reference.id && suggested.match === (search.match ?? "sound");
    }
    return false;
  });
}

/** A search as `remember` takes it: its id and time are added. */
export type NewRecentSearch = RecentSearch extends infer S
  ? S extends RecentSearch
    ? Omit<S, "id" | "at">
    : never
  : never;

/*
 * Kept in IndexedDB, not localStorage: a file or recording search keeps its
 * WAV (32 KB per second, up to ~1 MB), and five of those in base64 would
 * outgrow localStorage's ~5 MB. IndexedDB stores the Blobs as they are.
 */
const DB_NAME = "audio-search";
const STORE = "recent-searches";
const KEY = "entries";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

async function loadEntries(): Promise<RecentSearch[]> {
  const stored = await withStore("readonly", (store) => store.get(KEY));
  return Array.isArray(stored) ? (stored as RecentSearch[]) : [];
}

async function saveEntries(entries: RecentSearch[]): Promise<void> {
  await withStore("readwrite", (store) => store.put(entries, KEY));
}

const normalize = (q: string) => q.trim().toLowerCase();

/**
 * Whether `next` is the same search as `entry`, so the older one goes. A file
 * attached again counts. A search with a clip is one entry whatever its match
 * and filters: it is saved again as they change, and keeps the latest.
 */
function repeats(entry: RecentSearch, next: NewRecentSearch): boolean {
  if (entry.kind !== next.kind) return false;
  switch (next.kind) {
    case "text":
      return (
        entry.kind === "text" &&
        entry.source === next.source &&
        sameDuration(entry.duration, next.duration) &&
        entry.match === next.match &&
        normalize(entry.q) === normalize(next.q)
      );
    case "similar":
      return entry.kind === "similar" && entry.reference.id === next.reference.id;
    case "audio": {
      if (entry.kind !== "audio") return false;
      if (entry.example.id === next.example.id) return true;
      if (next.example.source === "link") {
        return entry.example.source === "link" && entry.example.url === next.example.url;
      }
      return (
        next.example.source === "file" &&
        entry.example.source === "file" &&
        entry.example.name === next.example.name &&
        entry.example.durationSeconds === next.example.durationSeconds
      );
    }
  }
}

/**
 * How soon after the newest search a longer or shorter query counts as typing
 * on, not as a search of its own. Long enough to pause, read a few results and
 * go on; short enough that "dog" today doesn't replace yesterday's "dog barking".
 */
const REFINE_WINDOW_MS = 30_000;

/**
 * Whether `next` refines `latest`, the newest search, so it takes its place:
 * typing on ("dog", "dog bark", "dog barking"), or changing its match,
 * dataset or length right after.
 */
function refines(latest: RecentSearch | undefined, next: NewRecentSearch): boolean {
  if (latest?.kind !== "text" || next.kind !== "text") return false;
  if (Date.now() - latest.at > REFINE_WINDOW_MS) return false;
  const a = normalize(latest.q);
  const b = normalize(next.q);
  return a.startsWith(b) || b.startsWith(a);
}

/**
 * The latest searches, newest first, kept in the browser across reloads. If
 * IndexedDB isn't available (some private modes), they last the session.
 */
export function useRecentSearches(): {
  entries: RecentSearch[];
  remember: (search: NewRecentSearch) => void;
  /** Moves a search run again to the top. */
  promote: (entry: RecentSearch) => void;
  clear: () => void;
} {
  const [entries, setEntries] = useState<RecentSearch[]>([]);
  // Nothing is written until the stored entries are in, so they aren't overwritten.
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadEntries()
      .catch((): RecentSearch[] => [])
      .then((stored) => {
        if (cancelled) return;
        // Searches made while loading come first; stored ones they repeat go.
        setEntries((current) =>
          [
            ...current,
            ...stored.filter((entry) => !current.some((c) => c.id === entry.id || repeats(c, entry))),
          ].slice(0, MAX_RECENT_SEARCHES),
        );
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (loaded) void saveEntries(entries).catch(() => {});
  }, [entries, loaded]);

  const remember = useCallback((search: NewRecentSearch) => {
    // A suggestion stays where it is, above the recent searches.
    if (isSuggested(search)) return;
    setEntries((current) => {
      const entry = { ...search, id: crypto.randomUUID(), at: Date.now() } as RecentSearch;
      const older = refines(current[0], search) ? current.slice(1) : current;
      return [entry, ...older.filter((e) => !repeats(e, search))].slice(0, MAX_RECENT_SEARCHES);
    });
  }, []);

  const promote = useCallback((entry: RecentSearch) => {
    if (isSuggested(entry)) return;
    setEntries((current) => [
      { ...entry, at: Date.now() },
      ...current.filter((e) => e.id !== entry.id && !repeats(e, entry)),
    ]);
  }, []);

  const clear = useCallback(() => setEntries([]), []);

  return { entries, remember, promote, clear };
}
