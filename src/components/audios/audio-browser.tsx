"use client";

import { AudioLinesIcon, ChartScatterIcon, ListIcon } from "lucide-react";
import { type DragEvent, useEffect, useRef, useState } from "react";

import type { AudioSource, SearchMatchFilterV1 } from "@/lib/api/v1/types";
import { MAX_EXAMPLE_SECONDS, toExampleClip, UnreadableAudioError } from "@/lib/audio/to-wav";
import { useMicrophoneRecorder } from "@/lib/audio/use-microphone-recorder";
import { cn } from "@/lib/utils";

import { EmbeddingMapView } from "../map/embedding-map-view";
import { useViewLayout, type ViewLayout } from "../map/use-view-layout";

import { AudioDetailPanel } from "./audio-detail-panel";
import { AudioList } from "./audio-list";
import { AudioSearchBar, type ExampleStatus } from "./audio-search-bar";
import { SOURCE_LABEL } from "./datasets";
import { type AudioExample, type AudioListView, type ReferenceClip, useListView } from "./queries";
import { SelectionBar, useSelection } from "./selection";
import { Sidebar } from "./sidebar";
import { playbackOf, useAudioPlayer } from "./use-audio-player";

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

/**
 * The whole file is decoded before it is cut to 30 s, and decoded audio is
 * 10–40× its compressed size (float32 at 48 kHz). 20 MB of MP3 is already
 * about 0.5 GB decoded, and far longer than any clip worth searching with.
 */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** The name a recording goes by ("Sounds like your recording"); the search bar shows its length next to it. */
const RECORDING_NAME = "your recording";

function hasFiles(event: DragEvent) {
  return event.dataTransfer.types.includes("Files");
}

export function AudioBrowser() {
  const [source, setSource] = useState<AudioSource | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [match, setMatch] = useState<SearchMatchFilterV1>("all");
  const [similarTo, setSimilarTo] = useState<ReferenceClip | null>(null);
  const [example, setExample] = useState<AudioExample | null>(null);
  const [exampleStatus, setExampleStatus] = useState<ExampleStatus>(null);
  const [dragging, setDragging] = useState(false);
  // dragenter/dragleave also fire for every child crossed; count them.
  const dragDepth = useRef(0);
  // Only the last file attached wins when several are read at once.
  const attachToken = useRef(0);
  // The user's clip as a URL the player can play, made when first played.
  const exampleUrl = useRef<{ id: string; url: string } | null>(null);
  // One player for the list, the details panel and the user's clip.
  const player = useAudioPlayer();
  const [layout, setLayout] = useViewLayout();

  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS).trim();
  // Clearing the box goes back to the full list at once, without the delay.
  const searchQuery = query.trim() === "" ? "" : debouncedQuery;

  const view: AudioListView = example
    ? { kind: "file", example, source }
    : similarTo
      ? { kind: "similar", reference: similarTo, source }
      : searchQuery
        ? { kind: "search", q: searchQuery, match, source }
        : { kind: "browse", source };
  const { summary } = useListView(view);
  const selection = useSelection();

  useEffect(
    () => () => {
      if (exampleUrl.current) URL.revokeObjectURL(exampleUrl.current.url);
    },
    [],
  );

  const clearExample = () => {
    attachToken.current++;
    setExample(null);
    setExampleStatus(null);
  };

  const showSimilar = (clip: ReferenceClip) => {
    setQuery("");
    clearExample();
    setSimilarTo(clip);
  };

  const toggleExample = () => {
    if (!example) return;
    if (exampleUrl.current?.id !== example.id) {
      if (exampleUrl.current) URL.revokeObjectURL(exampleUrl.current.url);
      exampleUrl.current = { id: example.id, url: URL.createObjectURL(example.wav) };
    }
    player.toggle(`example:${example.id}`, exampleUrl.current.url);
  };
  const examplePlayback = example ? playbackOf(player, `example:${example.id}`) : null;
  const similarPlayback = similarTo ? playbackOf(player, similarTo.id) : null;

  /** Converts a file or a recording to WAV and searches with it. */
  const searchWithAudio = async (audio: Blob, name: string, kind: AudioExample["source"]) => {
    const token = ++attachToken.current;
    setExampleStatus({ kind: "reading", name });
    try {
      const clip = await toExampleClip(audio);
      if (token !== attachToken.current) return;
      setQuery("");
      setSimilarTo(null);
      setExample({
        id: crypto.randomUUID(),
        name,
        source: kind,
        wav: clip.wav,
        durationSeconds: clip.durationSeconds,
        peaks: clip.peaks,
        trimmed: clip.trimmed,
      });
      setExampleStatus(null);
    } catch (error) {
      if (token !== attachToken.current) return;
      if (!(error instanceof UnreadableAudioError)) console.error(error);
      const message =
        kind === "recording"
          ? "Couldn’t read the recording. Try again, or record with another browser."
          : error instanceof UnreadableAudioError
            ? `${name}: ${error.message}`
            : `Couldn’t read ${name}. Try a WAV, MP3 or M4A file.`;
      setExampleStatus({ kind: "error", message });
    }
  };

  const recorder = useMicrophoneRecorder({
    maxSeconds: MAX_EXAMPLE_SECONDS,
    onRecorded: (recording) => void searchWithAudio(recording, RECORDING_NAME, "recording"),
    onError: (error) => setExampleStatus({ kind: "error", message: error.message }),
  });

  const startRecording = () => {
    // A file still being read would replace the recording when it is done.
    attachToken.current++;
    setExampleStatus(null);
    void recorder.start();
  };

  const attachFile = (file: File) => {
    // A file dropped while recording wins over the recording.
    recorder.cancel();
    if (file.size > MAX_FILE_BYTES) {
      attachToken.current++;
      setExampleStatus({
        kind: "error",
        message: `${file.name} is too big. Use a file under 20 MB, or record the part you need.`,
      });
      return;
    }
    void searchWithAudio(file, file.name, "file");
  };

  const dropHandlers = {
    onDragEnter: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth.current++;
      setDragging(true);
    },
    onDragOver: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      // Required for the drop event to fire.
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    },
    onDrop: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const file = event.dataTransfer.files[0];
      if (file) attachFile(file);
    },
  };

  const title =
    view.kind === "browse" ? (
      source ? SOURCE_LABEL[source] : "Catalog"
    ) : view.kind === "search" ? (
      <>
        Results for <span className="text-muted-foreground">“{view.q}”</span>
      </>
    ) : view.kind === "similar" ? (
      "Sounds similar"
    ) : view.example.source === "recording" ? (
      "Sounds like your recording"
    ) : (
      "Sounds like your file"
    );
  const scope = source && view.kind !== "browse" ? `${SOURCE_LABEL[source]} only` : null;

  return (
    <div className="relative flex min-h-0 flex-1" {...dropHandlers}>
      <Sidebar source={source} onSourceChange={setSource} />
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 flex-col gap-4 px-6 pt-7 pb-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            {/* truncate clips overflow; the padding keeps Besley's descenders (g, y, p) inside it. */}
            <h1 className="-mb-2 min-w-0 truncate pb-2 font-serif text-[32px] leading-10 tracking-[-0.64px]">{title}</h1>
            <div className="flex items-center gap-4">
              <p aria-live="polite" className="text-[0.8rem] text-muted-foreground tabular-nums">
                {[scope, summary].filter(Boolean).join(" · ")}
              </p>
              <LayoutSwitch layout={layout} onChange={setLayout} />
            </div>
          </div>
          <AudioSearchBar
            query={query}
            onQueryChange={(value) => {
              setQuery(value);
              // Typing a query leaves "similar to" and "sounds like this file" mode.
              if (value.trim()) {
                setSimilarTo(null);
                clearExample();
              }
            }}
            match={match}
            onMatchChange={setMatch}
            similarTo={similarTo}
            similarPlayback={{
              status:
                similarPlayback?.status === "playing" || similarPlayback?.status === "loading"
                  ? similarPlayback.status
                  : null,
              played:
                similarPlayback && similarTo && similarTo.durationSeconds > 0
                  ? similarPlayback.currentTime / similarTo.durationSeconds
                  : 0,
            }}
            onToggleSimilar={() => similarTo && player.toggle(similarTo.id)}
            onClearSimilar={() => setSimilarTo(null)}
            example={example}
            exampleStatus={exampleStatus}
            examplePlayback={{
              status:
                examplePlayback?.status === "playing" || examplePlayback?.status === "loading"
                  ? examplePlayback.status
                  : null,
              played:
                examplePlayback && example && example.durationSeconds > 0
                  ? examplePlayback.currentTime / example.durationSeconds
                  : 0,
            }}
            onToggleExample={toggleExample}
            onAttachFile={attachFile}
            onClearExample={clearExample}
            recorder={{
              status: recorder.status,
              elapsedSeconds: recorder.elapsedSeconds,
              meter: recorder.meter,
              maxSeconds: MAX_EXAMPLE_SECONDS,
              onStart: startRecording,
              onStop: recorder.stop,
              onCancel: recorder.cancel,
            }}
          />
        </header>
        {layout === "map" ? (
          <EmbeddingMapView
            view={view}
            selectedId={selectedId}
            onSelect={setSelectedId}
            selection={selection}
            detailsOpen={selectedId !== null}
            onTryQuery={(q) => {
              setSimilarTo(null);
              clearExample();
              setQuery(q);
            }}
            onClearQuery={() => {
              setSimilarTo(null);
              clearExample();
              setQuery("");
            }}
          />
        ) : (
          <div className="relative flex min-h-0 flex-1 flex-col">
            <AudioList
              view={view}
              selection={selection}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onFindSimilar={showSimilar}
              player={player}
              recovery={{
                onMatchAll: () => setMatch("all"),
                onClearSearch: () => setQuery(""),
                onClearSource: () => setSource(null),
              }}
            />
            <SelectionBar selection={selection} />
          </div>
        )}
      </main>
      {selectedId && (
        <AudioDetailPanel
          id={selectedId}
          player={player}
          onClose={() => setSelectedId(null)}
          onFindSimilar={showSimilar}
        />
      )}
      {dragging && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-3 z-20 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-foreground bg-muted/95 text-center"
        >
          <AudioLinesIcon className="size-7" strokeWidth={1.6} />
          <p className="font-serif text-[22px] leading-7">Drop to search by sound</p>
          <p className="text-[0.8rem] text-muted-foreground">Any audio or video file, up to 20 MB</p>
        </div>
      )}
    </div>
  );
}

const LAYOUTS: { value: ViewLayout; label: string; icon: typeof ListIcon }[] = [
  { value: "list", label: "List", icon: ListIcon },
  { value: "map", label: "Map", icon: ChartScatterIcon },
];

/** List | Map: two views of the same catalog, search and selection. */
function LayoutSwitch({ layout, onChange }: { layout: ViewLayout; onChange: (layout: ViewLayout) => void }) {
  return (
    <div role="group" aria-label="View" className="flex shrink-0 gap-0.5 rounded-full bg-muted p-[3px]">
      {LAYOUTS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={layout === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "inline-flex h-[30px] items-center gap-1.5 rounded-full px-3 text-[0.8rem] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-3.5",
            layout === option.value && "bg-card text-foreground shadow-[0_1px_2px_rgba(26,26,25,0.08)]",
          )}
        >
          <option.icon aria-hidden="true" />
          {option.label}
        </button>
      ))}
    </div>
  );
}
