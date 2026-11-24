"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AudioWaveformIcon,
  CircleAlertIcon,
  LoaderCircleIcon,
  PauseIcon,
  PlayIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { ApiError } from "@/lib/api/v1/client";
import type {
  AudioListItemV1,
  AudioSource,
  SearchMatchFilterV1,
  SearchMatchV1,
} from "@/lib/api/v1/types";
import { cn } from "@/lib/utils";

import { type AudioListView, catalogQuery, searchQuery, similarQuery } from "./queries";
import { type PlayerStatus, useAudioPlayer } from "./use-audio-player";

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

/** A list item, plus why it is in the results when it comes from a search. */
type Row = AudioListItemV1 & { matches?: SearchMatchV1[]; similarity?: number };

type RowActions = {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onFindSimilar: (audio: { id: string; title: string }) => void;
  player: ReturnType<typeof useAudioPlayer>;
};

function formatDuration(seconds: number) {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
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
  const actions: RowActions = { selectedId, onSelect, onFindSimilar, player };

  return (
    <section className="flex min-w-0 flex-1 flex-col" aria-label="Audios">
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
  } = useInfiniteQuery(catalogQuery());

  const rows: Row[] = data?.pages.flatMap((p) => p.data) ?? [];

  // Infinite scroll: load the next page once the loader row comes into view.
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  return (
    <>
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
  const { data, status, error, refetch, isPlaceholderData } = useQuery(searchQuery(q, match));
  const rows = data?.data;
  const searching = status === "pending" || isPlaceholderData;

  return (
    <>
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
  const { data, status, error, refetch } = useQuery(similarQuery(id));
  const rows = data?.data;

  return (
    <>
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
  const { selectedId, onSelect, onFindSimilar, player } = actions;

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
  selected,
  onSelect,
  onFindSimilar,
  playback,
  onTogglePlay,
}: {
  audio: Row;
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
        selected && "bg-muted",
      )}
    >
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
      <IconButton
        variant="ghost"
        className="mr-3 text-muted-foreground"
        label="Find similar sound"
        aria-label={`Find audios that sound like ${audio.title}`}
        onClick={() => onFindSimilar({ id: audio.id, title: audio.title })}
      >
        <AudioWaveformIcon />
      </IconButton>
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
  const [label, ariaLabel] =
    status === "error"
      ? ["Couldn't load this audio. Click to retry", `Couldn't play ${title}. Try again`]
      : playing
        ? ["Pause", `Pause ${title}`]
        : ["Play", `Play ${title}`];

  return (
    <IconButton
      variant={status === "error" ? "destructive" : "outline"}
      className="ml-4 rounded-full"
      label={label}
      aria-label={ariaLabel}
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
    </IconButton>
  );
}
