"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  CircleAlertIcon,
  LoaderCircleIcon,
  PauseIcon,
  PlayIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { ApiError, fetchAudios } from "@/lib/api/v1/client";
import type { AudioListItemV1, AudioSource } from "@/lib/api/v1/types";
import { cn } from "@/lib/utils";

import { type PlayerStatus, useAudioPlayer } from "./use-audio-player";

const PAGE_SIZE = 50;
const ROW_HEIGHT = 72;

const SOURCE_LABEL: Record<AudioSource, string> = {
  librispeech: "LibriSpeech",
  audiocaps: "AudioCaps",
};

function formatDuration(seconds: number) {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function AudioList({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const player = useAudioPlayer();

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

  const rows: AudioListItemV1[] = data?.pages.flatMap((p) => p.data) ?? [];
  const total = data?.pages[0]?.pagination.total ?? 0;

  // eslint-disable-next-line react-hooks/incompatible-library -- known TanStack Virtual limitation; nothing here memoizes its return value.
  const virtualizer = useVirtualizer({
    count: hasNextPage ? rows.length + 1 : rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const lastIndex = virtualItems.at(-1)?.index ?? -1;

  // Infinite scroll: load the next page once the loader row comes into view.
  useEffect(() => {
    if (
      lastIndex >= rows.length - 1 &&
      hasNextPage &&
      !isFetchingNextPage &&
      !isFetchNextPageError
    ) {
      void fetchNextPage();
    }
  }, [lastIndex, rows.length, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  return (
    <section className="flex min-w-0 flex-1 flex-col" aria-label="Audios">
      <div className="flex h-10 shrink-0 items-center border-b px-4 text-sm text-muted-foreground">
        {data
          ? `${rows.length.toLocaleString()} of ${total.toLocaleString()} audios`
          : "Loading audios…"}
      </div>

      {status === "pending" && (
        <p className="p-4 text-sm text-muted-foreground">Loading…</p>
      )}

      {/* A failed next page keeps `data`, so only show this when nothing loaded. */}
      {status === "error" && !data && (
        <div className="flex items-center gap-3 p-4 text-sm">
          <span className="text-destructive">{error.message}</span>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {data && (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <ul
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualItems.map((item) => {
              const row = rows[item.index];
              return (
                <li
                  key={row?.id ?? "loader"}
                  className="absolute top-0 left-0 w-full"
                  style={{
                    height: item.size,
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  {row ? (
                    <AudioRow
                      audio={row}
                      selected={row.id === selectedId}
                      onSelect={onSelect}
                      playback={
                        player.state.id === row.id
                          ? {
                              status: player.state.status,
                              currentTime: player.state.currentTime,
                            }
                          : null
                      }
                      onTogglePlay={player.toggle}
                    />
                  ) : isFetchNextPageError ? (
                    <div className="flex h-full items-center gap-3 px-4 text-sm">
                      <span className="text-destructive">
                        {error instanceof ApiError && error.status === 429
                          ? error.message
                          : "Couldn't load more audios."}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fetchNextPage()}
                      >
                        Retry
                      </Button>
                    </div>
                  ) : (
                    <div className="flex h-full items-center px-4 text-sm text-muted-foreground">
                      Loading more…
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function AudioRow({
  audio,
  selected,
  onSelect,
  playback,
  onTogglePlay,
}: {
  audio: AudioListItemV1;
  selected: boolean;
  onSelect: (id: string) => void;
  /** Set when this row is the player's current audio. */
  playback: { status: PlayerStatus; currentTime: number } | null;
  onTogglePlay: (id: string) => void;
}) {
  return (
    <div
      className={cn(
        "flex h-full w-full items-center border-b hover:bg-muted/60 has-[>button:last-child:focus-visible]:bg-muted",
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
        onClick={() => onSelect(audio.id)}
        aria-current={selected || undefined}
        className="flex h-full min-w-0 flex-1 flex-col justify-center gap-1 pr-4 pl-2 text-left outline-none"
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
          <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
            {playback && playback.status !== "error"
              ? `${formatDuration(playback.currentTime)} / ${formatDuration(audio.durationSeconds)}`
              : formatDuration(audio.durationSeconds)}
          </span>
        </div>
        <p className="truncate text-sm text-muted-foreground">{audio.text}</p>
      </button>
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
      className="ml-4 rounded-full"
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
