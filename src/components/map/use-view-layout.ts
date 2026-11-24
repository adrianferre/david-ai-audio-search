"use client";

import { useSyncExternalStore } from "react";

/** How the catalog is shown: the embedding map (the default), or the list. */
export type ViewLayout = "map" | "list";

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
  return new URLSearchParams(window.location.search).get(PARAM) === "list" ? "list" : "map";
}

/**
 * The layout lives in the URL (`?view=list`; the map has no param) so a view can
 * be linked to and reloaded. The server renders the map, the default; a list
 * link switches to the list after hydration.
 */
export function useViewLayout(): [ViewLayout, (layout: ViewLayout) => void] {
  const layout = useSyncExternalStore(subscribe, current, () => "map" as const);
  const setLayout = (next: ViewLayout) => {
    const url = new URL(window.location.href);
    if (next === "list") url.searchParams.set(PARAM, "list");
    else url.searchParams.delete(PARAM);
    window.history.replaceState(window.history.state, "", url);
    listeners.forEach((listener) => listener());
  };
  return [layout, setLayout];
}
