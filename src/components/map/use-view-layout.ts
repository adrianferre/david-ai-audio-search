"use client";

import { useSyncExternalStore } from "react";

/** How the catalog is shown: the list, or the embedding map. */
export type ViewLayout = "list" | "map";

const PARAM = "view";
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("popstate", onChange);
  };
}

function current(): ViewLayout {
  return new URLSearchParams(window.location.search).get(PARAM) === "map" ? "map" : "list";
}

/**
 * The layout lives in the URL (`?view=map`) so a map view can be linked to and
 * reloaded. The server always renders the list; the map takes over after hydration.
 */
export function useViewLayout(): [ViewLayout, (layout: ViewLayout) => void] {
  const layout = useSyncExternalStore(subscribe, current, () => "list" as const);
  const setLayout = (next: ViewLayout) => {
    const url = new URL(window.location.href);
    if (next === "map") url.searchParams.set(PARAM, "map");
    else url.searchParams.delete(PARAM);
    window.history.replaceState(window.history.state, "", url);
    listeners.forEach((listener) => listener());
  };
  return [layout, setLayout];
}
