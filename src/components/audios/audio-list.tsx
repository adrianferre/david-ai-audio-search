"use client";

import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AudioWaveformIcon,
  CircleAlertIcon,
  DownloadIcon,
  LoaderCircleIcon,
  PauseIcon,
  PlayIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ApiError,
  exportAudios,
  fetchAudios,
  fetchSimilarAudios,
  searchAudios,
} from "@/lib/api/v1/client";
import {
  type AudioListItemV1,
  type AudioSource,
  exportFileName,
  MAX_EXPORT_IDS,
  type SearchMatchFilterV1,
  type SearchMatchV1,
} from "@/lib/api/v1/types";
import { chooseSaveTarget, formatBytes, type SaveTarget, saveStream } from "@/lib/save-file";
import { cn } from "@/lib/utils";

import { type PlayerStatus, useAudioPlayer } from "./use-audio-player";

const PAGE_SIZE = 50;
const ROW_HEIGHT = 72;

const SOURCE_LABEL: Record<AudioSource, string> = {
  librispeech: "LibriSpeech",
  audiocaps: "AudioCaps",
};

/** A text match is on the transcript (LibriSpeech) or on the captions (AudioCaps). */
const TEXT_MATCH_LABEL: Record<AudioSource, { label: string; title: string }> = {
  librispeech: { label: "Said", title: "Matches what is said (the transcript)" },
  audiocaps: { label: "Caption", title: "Matches the captions that describe the audio" },
};
const SOUND_MATCH_LABEL = { label: "Sounds like", title: "Matches what the audio sounds like" };

function matchLabel(match: SearchMatchV1, source: AudioSource) {
  return match === "text" ? TEXT_MATCH_LABEL[source] : SOUND_MATCH_LABEL;
}

const FILTER_LABEL: Record<SearchMatchV1, string> = { text: "Words", sound: "Sound" };

/** What the list shows: the whole catalog, a text search, or the audios similar to one. */
export type AudioListView =
  | { kind: "browse" }
  | { kind: "search"; q: string; match: SearchMatchFilterV1 }
  | { kind: "similar"; id: string };

/** A list item, plus why it is in the results when it comes from a search. */
type Row = AudioListItemV1 & { matches?: SearchMatchV1[]; similarity?: number };

/** Rows checked for download, by id: they stay checked across pages and views. */
type Selection = {
  checked: ReadonlySet<string>;
  /** While a download runs the selection can't change, so it matches the ZIP. */
  locked: boolean;
  setChecked: (next: ReadonlySet<string>) => void;
  download: {
    /** From choosing where to save until the whole ZIP is written. */
    isPending: boolean;
    /** Bytes of the ZIP received so far, null until it starts arriving. */
    receivedBytes: number | null;
    error: Error | null;
    start: () => void;
  };
};

type RowActions = {
  selection: Selection;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onFindSimilar: (audio: { id: string; title: string }) => void;
  player: ReturnType<typeof useAudioPlayer>;
};

function formatDuration(seconds: number) {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** True when the click that changed a checkbox had Shift held. */
function withShift(event: Event) {
  return "shiftKey" in event && event.shiftKey === true;
}

export function AudioList({
  view,
  selectedId,
  onSelect,
  onFindSimilar,
}: {
  view: AudioListView;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onFindSimilar: (audio: { id: string; title: string }) => void;
}) {
  // Lives here, above the views, so playback continues when the view changes.
  const player = useAudioPlayer();

  // Also above the views, so checked rows survive searching and browsing.
  const [checked, setCheckedState] = useState<ReadonlySet<string>>(() => new Set());
  // The save dialog is open: no download yet, but the selection is already in use.
  const [choosingTarget, setChoosingTarget] = useState(false);
  const [receivedBytes, setReceivedBytes] = useState<number | null>(null);
  const download = useMutation({
    // Pending until the ZIP is fully written, not just until the response starts.
    mutationFn: async ({ ids, target }: { ids: string[]; target: SaveTarget }) => {
      const { body } = await exportAudios(ids);
      await saveStream(body, target, setReceivedBytes);
    },
  });
  const busy = choosingTarget || download.isPending;

  const startDownload = async () => {
    const ids = [...checked];
    setChoosingTarget(true);
    let target;
    try {
      target = await chooseSaveTarget(exportFileName(ids.length), {
        description: "ZIP archive",
        mime: "application/zip",
        extension: ".zip",
      });
    } finally {
      setChoosingTarget(false);
    }
    if (!target) return; // Save dialog cancelled.
    setReceivedBytes(null);
    download.mutate({ ids, target });
  };

  const selection: Selection = {
    checked,
    locked: busy,
    setChecked: (next) => {
      if (busy) return;
      setCheckedState(next);
      download.reset();
    },
    download: {
      isPending: busy,
      receivedBytes: download.isPending ? receivedBytes : null,
      error: download.error,
      start: () => void startDownload(),
    },
  };

  const actions: RowActions = { selection, selectedId, onSelect, onFindSimilar, player };

  return (
    <section
      className="flex min-w-0 flex-1 flex-col"
      aria-label="Audios"
      onKeyDown={(event) => {
        if (event.key === "Escape" && checked.size > 0) selection.setChecked(new Set());
      }}
    >
      {view.kind === "browse" && <BrowseList actions={actions} />}
      {view.kind === "search" && (
        <SearchResults q={view.q} match={view.match} actions={actions} />
      )}
      {view.kind === "similar" && <SimilarResults id={view.id} actions={actions} />}
    </section>
  );
}

function BrowseList({ actions }: { actions: RowActions }) {
  const {
    data,
    status,
    error,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: ["v1", "audios", { pageSize: PAGE_SIZE }],
    queryFn: ({ pageParam, signal }) =>
      fetchAudios({ page: pageParam, pageSize: PAGE_SIZE, signal }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.pagination.nextPage ?? undefined,
  });

  const rows: Row[] = data?.pages.flatMap((p) => p.data) ?? [];
  const total = data?.pages[0]?.pagination.total ?? 0;

  // Infinite scroll: load the next page once the loader row comes into view.
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  return (
    <>
      <ListSummary rows={rows} selection={actions.selection}>
        {data
          ? `${rows.length.toLocaleString()} of ${total.toLocaleString()} audios`
          : "Loading audios…"}
      </ListSummary>
      {status === "pending" && <ListMessage>Loading…</ListMessage>}
      {/* A failed next page keeps `data`, so only show this when nothing loaded. */}
      {status === "error" && !data && (
        <ListError message={error.message} onRetry={() => refetch()} />
      )}
      {data && (
        <AudioRows
          rows={rows}
          actions={actions}
          onEndReached={loadMore}
          tail={
            !hasNextPage ? null : isFetchNextPageError ? (
              <div className="flex h-full items-center gap-3 px-4 text-sm">
                <span className="text-destructive">
                  {error instanceof ApiError && error.status === 429
                    ? error.message
                    : "Couldn't load more audios."}
                </span>
                <Button variant="outline" size="sm" onClick={() => fetchNextPage()}>
                  Retry
                </Button>
              </div>
            ) : (
              <div className="flex h-full items-center px-4 text-sm text-muted-foreground">
                Loading more…
              </div>
            )
          }
        />
      )}
    </>
  );
}

function SearchResults({
  q,
  match,
  actions,
}: {
  q: string;
  match: SearchMatchFilterV1;
  actions: RowActions;
}) {
  const { data, status, error, refetch, isPlaceholderData } = useQuery({
    queryKey: ["v1", "search", { q, match }],
    queryFn: ({ signal }) => searchAudios({ q, match, signal }),
    // Keep the previous results on screen while the next query loads.
    placeholderData: keepPreviousData,
  });
  const rows = data?.data;
  const searching = status === "pending" || isPlaceholderData;

  return (
    <>
      <ListSummary rows={rows ?? []} selection={actions.selection}>
        {searching || !rows
          ? status === "error"
            ? "Search failed"
            : "Searching…"
          : `${rows.length.toLocaleString()} ${rows.length === 1 ? "result" : "results"} for “${q}”`}
      </ListSummary>
      {status === "pending" && <ListMessage>Searching…</ListMessage>}
      {status === "error" && <ListError message={error.message} onRetry={() => refetch()} />}
      {rows && rows.length === 0 && !searching && (
        <ListMessage>
          Nothing in the catalog matches “{q}”
          {match === "all" ? "." : ` under “${FILTER_LABEL[match]}”. Try “All”.`} Search by words, or
          describe a sound.
        </ListMessage>
      )}
      {/* Keyed by the search so the scroll position resets with it. */}
      {rows && rows.length > 0 && (
        <AudioRows key={`${match}:${q}`} rows={rows} actions={actions} dimmed={searching} />
      )}
    </>
  );
}

function SimilarResults({ id, actions }: { id: string; actions: RowActions }) {
  const { data, status, error, refetch } = useQuery({
    queryKey: ["v1", "audio", id, "similar"],
    queryFn: ({ signal }) => fetchSimilarAudios(id, signal),
  });
  const rows = data?.data;

  return (
    <>
      <ListSummary rows={rows ?? []} selection={actions.selection}>
        {status === "pending"
          ? "Finding similar audios…"
          : status === "error"
            ? "Search failed"
            : rows?.length === 0
              ? "No similar audios"
              : `The ${rows?.length.toLocaleString()} audios that sound most like it, most similar first`}
      </ListSummary>
      {status === "pending" && <ListMessage>Loading…</ListMessage>}
      {status === "error" && <ListError message={error.message} onRetry={() => refetch()} />}
      {rows && rows.length === 0 && (
        <ListMessage>This audio can&apos;t be compared yet.</ListMessage>
      )}
      {/* Keyed by the example so the scroll position resets with it. */}
      {rows && rows.length > 0 && <AudioRows key={id} rows={rows} actions={actions} />}
    </>
  );
}

/**
 * The bar above the rows: what the list shows, a checkbox for all of its rows,
 * and the download controls once some rows are checked.
 */
function ListSummary({
  rows,
  selection,
  children,
}: {
  rows: Row[];
  selection: Selection;
  children: ReactNode;
}) {
  const { checked, setChecked, download } = selection;
  const checkedHere = rows.filter((row) => checked.has(row.id)).length;
  const allChecked = rows.length > 0 && checkedHere === rows.length;
  const tooMany = checked.size > MAX_EXPORT_IDS;

  const checkAll = (value: boolean) => {
    const next = new Set(checked);
    for (const row of rows) {
      if (value) next.add(row.id);
      else next.delete(row.id);
    }
    setChecked(next);
  };

  return (
    <div className="flex h-10 shrink-0 items-center gap-3 border-b pr-2 pl-4 text-sm text-muted-foreground">
      <Checkbox
        aria-label="Select all audios in the list"
        checked={allChecked}
        indeterminate={checkedHere > 0 && !allChecked}
        disabled={rows.length === 0 || selection.locked}
        onCheckedChange={checkAll}
      />
      <span aria-live="polite" className="min-w-0 truncate">
        {children}
      </span>
      {checked.size > 0 && (
        <div className="ml-auto flex min-w-0 shrink-0 items-center gap-3">
          {download.error ? (
            <span className="truncate text-destructive" role="alert">
              {download.error.message}
            </span>
          ) : tooMany ? (
            <span className="truncate">Up to {MAX_EXPORT_IDS} at a time</span>
          ) : null}
          <span className="shrink-0 text-foreground">
            {checked.size.toLocaleString()} selected
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={selection.locked}
            onClick={() => setChecked(new Set())}
          >
            Clear
          </Button>
          <Button
            size="sm"
            disabled={tooMany || download.isPending}
            onClick={download.start}
          >
            {download.isPending ? (
              <>
                <LoaderCircleIcon className="animate-spin" />
                {download.receivedBytes === null
                  ? "Preparing ZIP…"
                  : `Downloading… ${formatBytes(download.receivedBytes)}`}
              </>
            ) : (
              <>
                <DownloadIcon />
                {download.error ? "Retry download" : `Download (${checked.size})`}
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

function ListMessage({ children }: { children: ReactNode }) {
  return <p className="p-4 text-sm text-muted-foreground">{children}</p>;
}

function ListError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center gap-3 p-4 text-sm">
      <span className="text-destructive">{message}</span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

/** The virtualized rows. `tail` is an extra last row (loader or error). */
function AudioRows({
  rows,
  actions,
  tail = null,
  onEndReached,
  dimmed = false,
}: {
  rows: Row[];
  actions: RowActions;
  tail?: ReactNode;
  onEndReached?: () => void;
  /** The rows are stale: newer results are loading. */
  dimmed?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { selection, selectedId, onSelect, onFindSimilar, player } = actions;
  // Last row toggled by hand: the other end of a Shift+click range.
  const anchorRef = useRef<number | null>(null);

  const toggleRow = (index: number, value: boolean, shift: boolean) => {
    const anchor = anchorRef.current;
    const [from, to] =
      shift && anchor !== null ? [Math.min(anchor, index), Math.max(anchor, index)] : [index, index];
    const next = new Set(selection.checked);
    for (const row of rows.slice(from, to + 1)) {
      if (value) next.add(row.id);
      else next.delete(row.id);
    }
    anchorRef.current = index;
    selection.setChecked(next);
  };

  // eslint-disable-next-line react-hooks/incompatible-library -- known TanStack Virtual limitation; nothing here memoizes its return value.
  const virtualizer = useVirtualizer({
    count: tail ? rows.length + 1 : rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const lastIndex = virtualItems.at(-1)?.index ?? -1;

  useEffect(() => {
    if (lastIndex >= rows.length - 1) onEndReached?.();
  }, [lastIndex, rows.length, onEndReached]);

  return (
    <div
      ref={scrollRef}
      className={cn("min-h-0 flex-1 overflow-y-auto transition-opacity", dimmed && "opacity-60")}
    >
      <ul className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualItems.map((item) => {
          const row = rows[item.index];
          return (
            <li
              key={row?.id ?? "tail"}
              className="absolute top-0 left-0 w-full"
              style={{ height: item.size, transform: `translateY(${item.start}px)` }}
            >
              {row ? (
                <AudioRow
                  audio={row}
                  checked={selection.checked.has(row.id)}
                  checkDisabled={selection.locked}
                  onCheckedChange={(value, shift) => toggleRow(item.index, value, shift)}
                  selected={row.id === selectedId}
                  onSelect={onSelect}
                  onFindSimilar={onFindSimilar}
                  playback={
                    player.state.id === row.id
                      ? { status: player.state.status, currentTime: player.state.currentTime }
                      : null
                  }
                  onTogglePlay={player.toggle}
                />
              ) : (
                tail
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function AudioRow({
  audio,
  checked,
  checkDisabled,
  onCheckedChange,
  selected,
  onSelect,
  onFindSimilar,
  playback,
  onTogglePlay,
}: {
  audio: Row;
  /** Picked for download. */
  checked: boolean;
  /** A download is running: the selection is locked. */
  checkDisabled: boolean;
  onCheckedChange: (checked: boolean, shift: boolean) => void;
  /** Open in the detail panel. */
  selected: boolean;
  onSelect: (id: string) => void;
  onFindSimilar: (audio: { id: string; title: string }) => void;
  /** Set when this row is the player's current audio. */
  playback: { status: PlayerStatus; currentTime: number } | null;
  onTogglePlay: (id: string) => void;
}) {
  return (
    <div
      className={cn(
        "flex h-full w-full items-center border-b hover:bg-muted/60 has-[>[data-row-select]:focus-visible]:bg-muted",
        checked && "bg-primary/5 dark:bg-primary/10",
        selected && "bg-muted",
      )}
    >
      <Checkbox
        className="ml-4"
        aria-label={`Select ${audio.title}`}
        checked={checked}
        disabled={checkDisabled}
        // Shift+click selects a range of rows, not the text between them.
        onMouseDown={(event) => event.shiftKey && event.preventDefault()}
        onCheckedChange={(value, details) => onCheckedChange(value, withShift(details.event))}
      />
      <PlayButton
        title={audio.title}
        status={playback?.status ?? null}
        onClick={() => onTogglePlay(audio.id)}
      />
      <button
        type="button"
        data-row-select
        onClick={() => onSelect(audio.id)}
        aria-current={selected || undefined}
        className="flex h-full min-w-0 flex-1 flex-col justify-center gap-1 pr-2 pl-2 text-left outline-none"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "shrink-0 rounded px-1.5 py-0.5 text-[0.7rem] font-medium",
              audio.source === "librispeech"
                ? "bg-sky-500/15 text-sky-700 dark:text-sky-300"
                : "bg-amber-500/15 text-amber-700 dark:text-amber-300",
            )}
          >
            {SOURCE_LABEL[audio.source]}
          </span>
          <span className="truncate text-sm font-medium">{audio.title}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {audio.matches?.map((match) => {
              const { label, title } = matchLabel(match, audio.source);
              return (
                <span
                  key={match}
                  title={title}
                  className="rounded border px-1.5 py-0.5 text-[0.7rem] font-medium text-muted-foreground"
                >
                  {label}
                </span>
              );
            })}
            {audio.similarity !== undefined && (
              <span className="rounded border px-1.5 py-0.5 text-[0.7rem] font-medium text-muted-foreground tabular-nums">
                {Math.round(audio.similarity * 100)}% similar
              </span>
            )}
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              {playback && playback.status !== "error"
                ? `${formatDuration(playback.currentTime)} / ${formatDuration(audio.durationSeconds)}`
                : formatDuration(audio.durationSeconds)}
            </span>
          </span>
        </div>
        <p className="truncate text-sm text-muted-foreground">{audio.text}</p>
      </button>
      <Button
        variant="ghost"
        size="icon"
        className="mr-3 text-muted-foreground"
        aria-label={`Find audios that sound like ${audio.title}`}
        title="Find similar audios"
        onClick={() => onFindSimilar({ id: audio.id, title: audio.title })}
      >
        <AudioWaveformIcon />
      </Button>
    </div>
  );
}

function PlayButton({
  title,
  status,
  onClick,
}: {
  title: string;
  status: PlayerStatus | null;
  onClick: () => void;
}) {
  const playing = status === "playing" || status === "loading";
  const label =
    status === "error"
      ? `Couldn't play ${title}. Try again`
      : playing
        ? `Pause ${title}`
        : `Play ${title}`;

  return (
    <Button
      variant={status === "error" ? "destructive" : "outline"}
      size="icon"
      className="ml-3 rounded-full"
      aria-label={label}
      title={status === "error" ? "Couldn't load this audio. Click to retry." : undefined}
      onClick={onClick}
    >
      {status === "loading" ? (
        <LoaderCircleIcon className="animate-spin" />
      ) : status === "playing" ? (
        <PauseIcon />
      ) : status === "error" ? (
        <CircleAlertIcon />
      ) : (
        <PlayIcon />
      )}
    </Button>
  );
}
