"use client";

import { useCallback, useEffect, useState } from "react";

import type { AudioSource, SearchMatchFilterV1 } from "@/lib/api/v1/types";

import type { AudioExample, ReferenceClip } from "./queries";

/** The search bar offers this many of the latest searches. */
export const MAX_RECENT_SEARCHES = 5;

/**
 * A search the user ran, with what it takes to run it again: the text, the
 * catalog clip "Find similar sound" was used on, or the user's own file or
 * recording (its WAV included). `source` is the dataset filter it ran with.
 */
export type RecentSearch = { id: string; at: number; source: AudioSource | null } & (
  | { kind: "text"; q: string; match: SearchMatchFilterV1 }
  | { kind: "similar"; reference: ReferenceClip }
  | { kind: "audio"; example: AudioExample }
);

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

/** Whether `next` is the same search as `entry`, so the older one goes. A file attached again counts. */
function repeats(entry: RecentSearch, next: NewRecentSearch): boolean {
  if (entry.kind !== next.kind || entry.source !== next.source) return false;
  switch (next.kind) {
    case "text":
      return (
        entry.kind === "text" && entry.match === next.match && normalize(entry.q) === normalize(next.q)
      );
    case "similar":
      return entry.kind === "similar" && entry.reference.id === next.reference.id;
    case "audio": {
      if (entry.kind !== "audio") return false;
      if (entry.example.id === next.example.id) return true;
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
 * typing on ("dog", "dog bark", "dog barking"), or changing its match or
 * dataset right after.
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
    setEntries((current) => {
      const entry = { ...search, id: crypto.randomUUID(), at: Date.now() } as RecentSearch;
      const older = refines(current[0], search) ? current.slice(1) : current;
      return [entry, ...older.filter((e) => !repeats(e, search))].slice(0, MAX_RECENT_SEARCHES);
    });
  }, []);

  const promote = useCallback((entry: RecentSearch) => {
    setEntries((current) => [
      { ...entry, at: Date.now() },
      ...current.filter((e) => e.id !== entry.id && !repeats(e, entry)),
    ]);
  }, []);

  const clear = useCallback(() => setEntries([]), []);

  return { entries, remember, promote, clear };
}
