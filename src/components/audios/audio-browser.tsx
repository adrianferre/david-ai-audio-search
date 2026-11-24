"use client";

import { useEffect, useState } from "react";

import type { SearchMatchFilterV1 } from "@/lib/api/v1/types";

import { AudioDetailPanel } from "./audio-detail-panel";
import { AudioList } from "./audio-list";
import { AudioSearchBar } from "./audio-search-bar";
import { type AudioListView, useListView } from "./queries";
import { SelectAllCheckbox, SelectionActions, useSelection } from "./selection";

/** Wait for a pause in typing: every search embeds the query on the server. */
const SEARCH_DEBOUNCE_MS = 300;

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timeout);
  }, [value, delayMs]);
  return debounced;
}

export function AudioBrowser() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [match, setMatch] = useState<SearchMatchFilterV1>("all");
  const [similarTo, setSimilarTo] = useState<{ id: string; title: string } | null>(null);

  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS).trim();
  // Clearing the box goes back to the full list at once, without the delay.
  const searchQuery = query.trim() === "" ? "" : debouncedQuery;

  const view: AudioListView = similarTo
    ? { kind: "similar", id: similarTo.id }
    : searchQuery
      ? { kind: "search", q: searchQuery, match }
      : { kind: "browse" };
  const { rows, summary } = useListView(view);
  const selection = useSelection();

  const showSimilar = (audio: { id: string; title: string }) => {
    setQuery("");
    setSimilarTo(audio);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AudioSearchBar
        query={query}
        onQueryChange={(value) => {
          setQuery(value);
          // Typing a query leaves "similar to" mode.
          if (value.trim()) setSimilarTo(null);
        }}
        match={match}
        onMatchChange={setMatch}
        similarTo={similarTo}
        onClearSimilar={() => setSimilarTo(null)}
        summary={summary}
        // The select-all checkbox lines up with the checkboxes of the rows.
        leading={<SelectAllCheckbox className="mr-1" rows={rows} selection={selection} />}
        trailing={<SelectionActions selection={selection} />}
      />
      <div className="flex min-h-0 flex-1">
        <AudioList
          view={view}
          selection={selection}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onFindSimilar={showSimilar}
        />
        {selectedId && (
          <AudioDetailPanel
            id={selectedId}
            onClose={() => setSelectedId(null)}
            onFindSimilar={showSimilar}
          />
        )}
      </div>
    </div>
  );
}
