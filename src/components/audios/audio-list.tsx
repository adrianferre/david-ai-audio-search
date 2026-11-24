"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AudioWaveformIcon,
  CircleAlertIcon,
  LoaderCircleIcon,
  PauseIcon,
  PlayIcon,
  RotateCwIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { IconButton } from "@/components/ui/icon-button";
import { ApiError } from "@/lib/api/v1/client";
import type { AudioListItemV1, AudioSource, SearchMatchFilterV1, SearchMatchV1 } from "@/lib/api/v1/types";
import { cn } from "@/lib/utils";

import { DatasetTag, displayText, displayTitle, SOURCE_LABEL } from "./datasets";
import {
  type AudioListView,
  catalogQuery,
  fileQuery,
  type ReferenceClip,
  searchQuery,
  similarQuery,
} from "./queries";
import { clearOnEscape, SelectAllCheckbox, type Selection, withRows } from "./selection";
import { type AudioPlayer, type PlayerStatus, playbackOf } from "./use-audio-player";
import { formatClock, Waveform } from "./waveform";

const ROW_HEIGHT = 68;
/** Room under the last row for the floating selection bar. */
const SELECTION_BAR_SPACE = 112;

const SAID_MATCH_LABEL = { label: "Said", title: "Matches what is said (the transcript)" };

/** A text match is on the transcript (LibriSpeech, Common Voice) or on the captions (AudioCaps). */
const TEXT_MATCH_LABEL: Record<AudioSource, { label: string; title: string }> = {
  librispeech: SAID_MATCH_LABEL,
  audiocaps: { label: "Caption", title: "Matches the captions that describe the clip" },
  commonvoice: SAID_MATCH_LABEL,
};
const SOUND_MATCH_LABEL = { label: "Sounds like", title: "Matches what the clip itself sounds like" };

function matchLabel(match: SearchMatchV1, source: AudioSource) {
  return match === "text" ? TEXT_MATCH_LABEL[source] : SOUND_MATCH_LABEL;
}

const FILTER_LABEL: Record<Exclude<SearchMatchFilterV1, "all">, string> = {
  exact: "Words",
  text: "Meaning",
  sound: "Sound",
};

const EMPTY_HINT: Record<SearchMatchFilterV1, string> = {
  all: "Try other words, describe the sound, or search with an audio file.",
  exact: "Words only finds the words as typed, in transcripts and captions. Meaning also finds other ways of saying it.",
  text: "Meaning only looks at transcripts and captions. The sound itself may still match.",
  sound: "Sound only looks at what the clips sound like. Their words may still match.",
};

const RELEVANCE_WORDS = ["low", "fair", "good", "high", "very high"];

/** A list item, plus why it is in the results when it comes from a search. */
type Row = AudioListItemV1 & {
  matches?: SearchMatchV1[];
  /** 1 to 5, relative to the best result of the same search. */
  relevance?: number;
  similarity?: number;
};

type RowActions = {
  selection: Selection;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onFindSimilar: (clip: ReferenceClip) => void;
  player: AudioPlayer;
};

/** Ways out of an empty result, offered by the "nothing matches" message. */
export type ListRecovery = {
  onMatchAll: () => void;
  onClearSearch: () => void;
  onClearSource: () => void;
};

/** True when the click that changed a checkbox had Shift held. */
function withShift(event: Event) {
  return "shiftKey" in event && event.shiftKey === true;
}

export function AudioList({
  view,
  selection,
  selectedId,
  onSelect,
  onFindSimilar,
  player,
  recovery,
}: {
  view: AudioListView;
  /** Checked rows, shared with the selection bar. */
  selection: Selection;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onFindSimilar: (clip: ReferenceClip) => void;
  /** Lives above the list, so playback continues when the view changes. */
  player: AudioPlayer;
  recovery: ListRecovery;
}) {
  const actions: RowActions = { selection, selectedId, onSelect, onFindSimilar, player };

  return (
    <section
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      aria-label="Clips"
      onKeyDown={clearOnEscape(selection)}
    >
      {view.kind === "browse" && <BrowseList source={view.source} actions={actions} />}
      {view.kind === "search" && (
        <SearchResults
          q={view.q}
          match={view.match}
          source={view.source}
          actions={actions}
          recovery={recovery}
        />
      )}
      {view.kind === "similar" && (
        <SimilarResults
          rowsQuery={similarQuery(view.reference.id, view.source)}
          pendingMessage="Finding the clips that sound like this one…"
          source={view.source}
          actions={actions}
          recovery={recovery}
        />
      )}
      {view.kind === "file" && (
        <SimilarResults
          rowsQuery={fileQuery(view.example, view.source)}
          pendingMessage={
            view.example.source === "recording"
              ? "Finding the clips that sound like your recording…"
              : `Finding the clips that sound like “${view.example.name}”…`
          }
          source={view.source}
          actions={actions}
          recovery={recovery}
        />
      )}
    </section>
  );
}

function BrowseList({ source, actions }: { source: AudioSource | null; actions: RowActions }) {
  const {
    data,
    status,
    error,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  } = useInfiniteQuery(catalogQuery(source));

  const rows: Row[] = data?.pages.flatMap((p) => p.data) ?? [];

  // Infinite scroll: load the next page once the loader row comes into view.
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  if (status === "pending") return <LoadingRows label="Loading the catalog" />;
  // A failed next page keeps `data`, so only show this when nothing loaded.
  if (status === "error" && !data) {
    return (
      <ListProblem title="The catalog didn’t load" message={error.message} onRetry={() => refetch()} />
    );
  }
  return (
    <AudioTable
      key={source ?? "all"}
      kind="browse"
      rows={rows}
      actions={actions}
      onEndReached={loadMore}
      tail={
        !hasNextPage ? null : isFetchNextPageError ? (
          <div className="flex h-full items-center gap-3 px-6 text-sm">
            <span className="text-destructive">
              {error instanceof ApiError && error.status === 429
                ? error.message
                : "Couldn’t load more clips."}
            </span>
            <Button variant="outline" size="sm" onClick={() => fetchNextPage()}>
              Try again
            </Button>
          </div>
        ) : (
          <div className="flex h-full items-center gap-2 px-6 text-sm text-muted-foreground">
            <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
            Loading more clips…
          </div>
        )
      }
    />
  );
}

function SearchResults({
  q,
  match,
  source,
  actions,
  recovery,
}: {
  q: string;
  match: SearchMatchFilterV1;
  source: AudioSource | null;
  actions: RowActions;
  recovery: ListRecovery;
}) {
  const { data, status, error, refetch, isPlaceholderData } = useQuery(searchQuery(q, match, source));
  const searching = status === "pending" || isPlaceholderData;

  if (status === "pending") return <LoadingRows label="Searching" />;
  if (status === "error") {
    return (
      <ListProblem title="The search didn’t go through" message={error.message} onRetry={() => refetch()} />
    );
  }
  const best = data.data[0]?.score ?? 0;
  const rows: Row[] = data.data.map((hit) => ({
    ...hit,
    relevance: best > 0 ? Math.min(5, Math.max(1, Math.round((hit.score / best) * 5))) : 1,
  }));

  if (rows.length === 0 && !searching) {
    const where = source ? ` in ${SOURCE_LABEL[source]}` : "";
    return (
      <EmptyResults
        title={`Nothing matches “${q}”${match === "all" ? "" : ` under ${FILTER_LABEL[match]}`}${where}`}
        message={EMPTY_HINT[match]}
      >
        {match !== "all" && <Button onClick={recovery.onMatchAll}>Search All instead</Button>}
        {source && (
          <Button variant={match === "all" ? "default" : "outline"} onClick={recovery.onClearSource}>
            Search every dataset
          </Button>
        )}
        <Button variant="outline" onClick={recovery.onClearSearch}>
          Clear search
        </Button>
      </EmptyResults>
    );
  }
  // Keyed by the search so the scroll position resets with it.
  return (
    <AudioTable
      key={`${match}:${source}:${q}`}
      kind="search"
      rows={rows}
      actions={actions}
      dimmed={searching}
    />
  );
}

function SimilarResults({
  rowsQuery,
  pendingMessage,
  source,
  actions,
  recovery,
}: {
  rowsQuery: ReturnType<typeof similarQuery> | ReturnType<typeof fileQuery>;
  pendingMessage: string;
  source: AudioSource | null;
  actions: RowActions;
  recovery: ListRecovery;
}) {
  const { data, status, error, refetch } = useQuery(rowsQuery);

  if (status === "pending") return <LoadingRows label={pendingMessage} />;
  if (status === "error") {
    return (
      <ListProblem title="The search didn’t go through" message={error.message} onRetry={() => refetch()} />
    );
  }
  if (data.data.length === 0) {
    return (
      <EmptyResults
        title={source ? `No clip in ${SOURCE_LABEL[source]} to compare with` : "No clip can be compared yet"}
        message="Clips are compared by their sound once they are embedded."
      >
        {source && <Button onClick={recovery.onClearSource}>Search every dataset</Button>}
      </EmptyResults>
    );
  }
  // Keyed by the query so the scroll position resets with it.
  return (
    <AudioTable key={JSON.stringify(rowsQuery.queryKey)} kind="similar" rows={data.data} actions={actions} />
  );
}

/** Placeholder rows while the first results load. */
function LoadingRows({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="flex min-h-0 flex-1 flex-col border-t">
      <p className="sr-only">{label}…</p>
      {Array.from({ length: 7 }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="flex h-[68px] shrink-0 animate-pulse items-center gap-3.5 border-b border-hairline px-6"
          style={{ animationDelay: `${i * 80}ms` }}
        >
          <span className="size-4 rounded-[4px] bg-accent" />
          <span className="size-9 rounded-full bg-accent" />
          <span className="flex flex-1 flex-col gap-2">
            <span className="h-2.5 rounded bg-border" style={{ width: `${70 - (i % 3) * 12}%` }} />
            <span className="h-2 w-1/3 rounded bg-accent" />
          </span>
          <span className="h-5 w-24 rounded-full bg-accent" />
        </div>
      ))}
    </div>
  );
}

function ListProblem({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 border-t px-6 py-10">
      <h2 className="font-serif text-2xl leading-8 tracking-[-0.3px]">{title}</h2>
      <p className="max-w-prose text-sm text-muted-foreground">{message}</p>
      <Button variant="outline" onClick={onRetry}>
        <RotateCwIcon />
        Try again
      </Button>
    </div>
  );
}

function EmptyResults({ title, message, children }: { title: string; message: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 border-t px-6 py-10">
      <h2 className="font-serif text-2xl leading-8 tracking-[-0.3px]">{title}</h2>
      <p className="max-w-prose text-sm text-muted-foreground">{message}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

type TableKind = "browse" | "search" | "similar";

/** The columns the table shows at this width, as a grid template and flags. */
function useColumns(kind: TableKind, width: number) {
  const matched = kind === "search" && width >= 920;
  const waveform = width >= 700;
  const score = kind !== "browse";
  const tracks = [
    "16px", // checkbox
    "36px", // play
    "minmax(0,1fr)", // clip
    ...(matched ? ["168px"] : []),
    ...(waveform ? ["128px"] : []),
    "112px", // dataset
    ...(score ? ["64px"] : []),
    "40px", // length
    "32px", // find similar
  ];
  return { template: tracks.join(" "), matched, waveform, score };
}

/** The table's width, to choose its columns. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/** The column headers and the virtualized rows. `tail` is an extra last row (loader or error). */
function AudioTable({
  kind,
  rows,
  actions,
  tail = null,
  onEndReached,
  dimmed = false,
}: {
  kind: TableKind;
  rows: Row[];
  actions: RowActions;
  tail?: ReactNode;
  onEndReached?: () => void;
  /** The rows are stale: newer results are loading. */
  dimmed?: boolean;
}) {
  const { ref: tableRef, width } = useWidth();
  const columns = useColumns(kind, width);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { selection, selectedId, onSelect, onFindSimilar, player } = actions;
  // Last row toggled by hand: the other end of a Shift+click range.
  const anchorRef = useRef<number | null>(null);

  const toggleRow = (index: number, value: boolean, shift: boolean) => {
    const anchor = anchorRef.current;
    const [from, to] =
      shift && anchor !== null ? [Math.min(anchor, index), Math.max(anchor, index)] : [index, index];
    anchorRef.current = index;
    selection.setChecked(withRows(selection.checked, rows.slice(from, to + 1), value));
  };

  // eslint-disable-next-line react-hooks/incompatible-library -- known TanStack Virtual limitation; nothing here memoizes its return value.
  const virtualizer = useVirtualizer({
    count: tail ? rows.length + 1 : rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    paddingEnd: selection.checked.size > 0 ? SELECTION_BAR_SPACE : 0,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const lastIndex = virtualItems.at(-1)?.index ?? -1;

  useEffect(() => {
    if (lastIndex >= rows.length - 1) onEndReached?.();
  }, [lastIndex, rows.length, onEndReached]);

  return (
    <div ref={tableRef} className="flex min-h-0 flex-1 flex-col">
      <div
        className="grid h-9 shrink-0 items-center gap-3.5 border-y px-6 text-xs font-medium text-muted-foreground"
        style={{ gridTemplateColumns: columns.template }}
      >
        <SelectAllCheckbox rows={rows} selection={selection} />
        <span />
        <span>Clip</span>
        {columns.matched && <span>Matched on</span>}
        {columns.waveform && <span>Waveform</span>}
        <span>Dataset</span>
        {columns.score && <span>{kind === "search" ? "Relevance" : "Similarity"}</span>}
        <span className="text-right">Length</span>
        <span />
      </div>
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
                    columns={columns}
                    kind={kind}
                    checked={selection.checked.has(row.id)}
                    checkDisabled={selection.locked}
                    onCheckedChange={(value, shift) => toggleRow(item.index, value, shift)}
                    selected={row.id === selectedId}
                    onSelect={onSelect}
                    onFindSimilar={onFindSimilar}
                    playback={playbackOf(player, row.id)}
                    onTogglePlay={(id) => player.toggle(id)}
                  />
                ) : (
                  tail
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function AudioRow({
  audio,
  columns,
  kind,
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
  columns: ReturnType<typeof useColumns>;
  kind: TableKind;
  /** Picked for download. */
  checked: boolean;
  /** A download is running: the selection is locked. */
  checkDisabled: boolean;
  onCheckedChange: (checked: boolean, shift: boolean) => void;
  /** Open in the detail panel. */
  selected: boolean;
  onSelect: (id: string) => void;
  onFindSimilar: (clip: ReferenceClip) => void;
  /** Set when this row is the player's current audio. */
  playback: { status: PlayerStatus; currentTime: number } | null;
  onTogglePlay: (id: string) => void;
}) {
  const text = displayText(audio);

  return (
    <div
      className={cn(
        "group relative grid h-full w-full items-center gap-3.5 border-b border-hairline px-6 hover:bg-row-hover has-[[data-row-select]:focus-visible]:bg-row-hover",
        checked && "bg-muted hover:bg-muted",
        selected && "bg-muted shadow-[inset_2px_0_0_var(--color-foreground)] hover:bg-muted",
      )}
      style={{ gridTemplateColumns: columns.template }}
    >
      <Checkbox
        className="relative z-10"
        aria-label={`Select “${text}”`}
        checked={checked}
        disabled={checkDisabled}
        // Shift+click selects a range of rows, not the text between them.
        onMouseDown={(event) => event.shiftKey && event.preventDefault()}
        onCheckedChange={(value, details) => onCheckedChange(value, withShift(details.event))}
      />
      <PlayButton
        name={text}
        status={playback?.status ?? null}
        onClick={() => onTogglePlay(audio.id)}
      />
      <button
        type="button"
        data-row-select
        onClick={() => onSelect(audio.id)}
        aria-current={selected || undefined}
        className="flex min-w-0 flex-col gap-0.5 text-left outline-none after:absolute after:inset-0 after:content-['']"
      >
        <span className="truncate text-sm leading-5 font-medium">{text}</span>
        <span className="truncate text-[0.8rem] leading-[18px] text-muted-foreground">
          {displayTitle(audio)}
        </span>
      </button>
      {columns.matched && (
        <span className="flex min-w-0 gap-1.5">
          {audio.matches?.map((match) => {
            const { label, title } = matchLabel(match, audio.source);
            return (
              <span
                key={match}
                title={title}
                className="relative z-10 inline-flex h-[22px] items-center rounded-full border border-input bg-card px-2 text-xs whitespace-nowrap"
              >
                {label}
              </span>
            );
          })}
        </span>
      )}
      {columns.waveform && (
        <Waveform
          peaks={audio.waveformPeaks}
          bars={32}
          height={26}
          played={playback && audio.durationSeconds > 0 ? playback.currentTime / audio.durationSeconds : 0}
        />
      )}
      <DatasetTag source={audio.source} className="justify-self-start" />
      {columns.score &&
        (kind === "search" ? (
          <RelevanceMeter level={audio.relevance ?? 1} />
        ) : (
          <span className="text-[0.8rem] tabular-nums" title="Cosine similarity of the sound, at most 1">
            {audio.similarity?.toFixed(3)}
          </span>
        ))}
      <span className="text-right text-[0.8rem] text-muted-foreground tabular-nums">
        {formatClock(audio.durationSeconds)}
      </span>
      <IconButton
        variant="ghost"
        size="icon-sm"
        className="relative z-10 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        label="Find similar sound"
        aria-label={`Find clips that sound like “${text}”`}
        onClick={() =>
          onFindSimilar({
            id: audio.id,
            source: audio.source,
            title: audio.title,
            text: audio.text,
            durationSeconds: audio.durationSeconds,
            waveformPeaks: audio.waveformPeaks,
          })
        }
      >
        <AudioWaveformIcon />
      </IconButton>
    </div>
  );
}

/** Five bars, filled by how this result ranks next to the best one. */
function RelevanceMeter({ level }: { level: number }) {
  return (
    <span
      role="img"
      aria-label={`Relevance: ${RELEVANCE_WORDS[level - 1]}`}
      title="How well it matches, next to the best result"
      className="relative z-10 flex h-4 items-end gap-[3px]"
    >
      {[6, 8, 10, 12, 14].map((height, i) => (
        <span
          key={height}
          className={cn("w-1 rounded-[1px]", i < level ? "bg-foreground" : "bg-waveform-muted")}
          style={{ height }}
        />
      ))}
    </span>
  );
}

function PlayButton({
  name,
  status,
  onClick,
}: {
  name: string;
  status: PlayerStatus | null;
  onClick: () => void;
}) {
  const playing = status === "playing" || status === "loading";
  const [label, ariaLabel] =
    status === "error"
      ? ["Couldn’t load this clip. Click to retry", `Couldn’t play “${name}”. Try again`]
      : playing
        ? ["Pause", `Pause “${name}”`]
        : ["Play", `Play “${name}”`];

  return (
    <IconButton
      variant={status === "error" ? "destructive" : playing ? "default" : "outline"}
      size="icon-lg"
      className="relative z-10"
      label={label}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {status === "loading" ? (
        <LoaderCircleIcon className="animate-spin" />
      ) : status === "playing" ? (
        <PauseIcon className="fill-current" />
      ) : status === "error" ? (
        <CircleAlertIcon />
      ) : (
        <PlayIcon className="ml-0.5 size-3.5 fill-current" />
      )}
    </IconButton>
  );
}
