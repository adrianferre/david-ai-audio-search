"use client";

import { FileAudioIcon } from "lucide-react";
import { type DragEvent, useEffect, useRef, useState } from "react";

import type { SearchMatchFilterV1 } from "@/lib/api/v1/types";
import { MAX_EXAMPLE_SECONDS, toExampleClip, UnreadableAudioError } from "@/lib/audio/to-wav";
import { useMicrophoneRecorder } from "@/lib/audio/use-microphone-recorder";

import { AudioDetailPanel } from "./audio-detail-panel";
import { AudioList } from "./audio-list";
import { AudioSearchBar, type ExampleStatus } from "./audio-search-bar";
import { type AudioExample, type AudioListView, useListView } from "./queries";
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

/** Bigger files are almost surely not a short recording, and decoding them takes a lot of memory. */
const MAX_FILE_BYTES = 100 * 1024 * 1024;

/** "Recording (0:07)", the name a recording goes by in the search bar. */
function recordingName(seconds: number) {
  const s = Math.round(seconds);
  return `Recording (${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")})`;
}

function hasFiles(event: DragEvent) {
  return event.dataTransfer.types.includes("Files");
}

export function AudioBrowser() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [match, setMatch] = useState<SearchMatchFilterV1>("all");
  const [similarTo, setSimilarTo] = useState<{ id: string; title: string } | null>(null);
  const [example, setExample] = useState<AudioExample | null>(null);
  const [exampleStatus, setExampleStatus] = useState<ExampleStatus>(null);
  const [dragging, setDragging] = useState(false);
  // dragenter/dragleave also fire for every child crossed; count them.
  const dragDepth = useRef(0);
  // Only the last file attached wins when several are read at once.
  const attachToken = useRef(0);

  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS).trim();
  // Clearing the box goes back to the full list at once, without the delay.
  const searchQuery = query.trim() === "" ? "" : debouncedQuery;

  const view: AudioListView = example
    ? { kind: "file", example }
    : similarTo
      ? { kind: "similar", id: similarTo.id }
      : searchQuery
        ? { kind: "search", q: searchQuery, match }
        : { kind: "browse" };
  const { rows, summary } = useListView(view);
  const selection = useSelection();

  const clearExample = () => {
    attachToken.current++;
    setExample(null);
    setExampleStatus(null);
  };

  const showSimilar = (audio: { id: string; title: string }) => {
    setQuery("");
    clearExample();
    setSimilarTo(audio);
  };

  /** Converts a file or a recording to WAV and searches with it. */
  const searchWithAudio = async (audio: Blob, name: string, source: AudioExample["source"]) => {
    const token = ++attachToken.current;
    setExampleStatus({ kind: "reading", name });
    try {
      const clip = await toExampleClip(audio);
      if (token !== attachToken.current) return;
      setQuery("");
      setSimilarTo(null);
      setExample({ id: crypto.randomUUID(), name, source, wav: clip.wav, trimmed: clip.trimmed });
      setExampleStatus(null);
    } catch (error) {
      if (token !== attachToken.current) return;
      if (!(error instanceof UnreadableAudioError)) console.error(error);
      const message =
        source === "recording"
          ? "Couldn't read the recording. Try again, or record with another browser."
          : error instanceof UnreadableAudioError
            ? error.message
            : "Couldn't read this audio file.";
      setExampleStatus({ kind: "error", message });
    }
  };

  const recorder = useMicrophoneRecorder({
    maxSeconds: MAX_EXAMPLE_SECONDS,
    onRecorded: (recording, seconds) => void searchWithAudio(recording, recordingName(seconds), "recording"),
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
      setExampleStatus({ kind: "error", message: "This file is too big. Use a recording under 100 MB." });
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

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" {...dropHandlers}>
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
        onClearSimilar={() => setSimilarTo(null)}
        example={example}
        exampleStatus={exampleStatus}
        onAttachFile={attachFile}
        onClearExample={clearExample}
        recorder={{
          status: recorder.status,
          elapsedSeconds: recorder.elapsedSeconds,
          maxSeconds: MAX_EXAMPLE_SECONDS,
          onStart: startRecording,
          onStop: recorder.stop,
          onCancel: recorder.cancel,
        }}
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
      {dragging && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/60 bg-background/90 text-center"
        >
          <FileAudioIcon className="size-8 text-muted-foreground" />
          <p className="text-base font-medium">Drop an audio file</p>
          <p className="text-sm text-muted-foreground">
            to find the clips in the catalog that sound like it
          </p>
        </div>
      )}
    </div>
  );
}
