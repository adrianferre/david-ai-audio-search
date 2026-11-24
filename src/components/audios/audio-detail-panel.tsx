"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { AudioWaveformIcon, DownloadIcon, LoaderCircleIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { downloadAudioFile, exportAudios, fetchAudio } from "@/lib/api/v1/client";
import { chooseSaveTarget, formatBytes, type SaveTarget, saveStream } from "@/lib/save-file";

type DownloadKind = "zip" | "audio";

const DOWNLOADS: Record<
  DownloadKind,
  {
    label: string;
    hint: string;
    extension: string;
    type: { description: string; mime: string };
    open: (id: string) => Promise<ReadableStream<Uint8Array>>;
  }
> = {
  zip: {
    label: "ZIP",
    hint: "Download the audio and all its details (ZIP), like the list's Download",
    extension: ".zip",
    type: { description: "ZIP archive", mime: "application/zip" },
    // The list's export with one audio: metadata.json and audio/<id>.flac.
    open: async (id) => (await exportAudios([id])).body,
  },
  audio: {
    label: "Audio",
    hint: "Download only the audio file (FLAC)",
    extension: ".flac",
    type: { description: "FLAC audio", mime: "audio/flac" },
    open: (id) => downloadAudioFile(id),
  },
};

/** Saves one audio as a ZIP or as its FLAC, one download at a time. */
function useAudioDownload() {
  // The save dialog is open: no download yet, but the buttons are already busy.
  const [choosing, setChoosing] = useState<DownloadKind | null>(null);
  const [receivedBytes, setReceivedBytes] = useState<number | null>(null);
  const download = useMutation({
    // Pending until the file is fully written, not just until the response starts.
    mutationFn: async ({ id, kind, target }: { id: string; kind: DownloadKind; target: SaveTarget }) => {
      const body = await DOWNLOADS[kind].open(id);
      await saveStream(body, target, setReceivedBytes);
    },
  });

  const start = async (id: string, kind: DownloadKind) => {
    const { extension, type } = DOWNLOADS[kind];
    setChoosing(kind);
    let target;
    try {
      target = await chooseSaveTarget(`${id}${extension}`, { ...type, extension });
    } finally {
      setChoosing(null);
    }
    if (!target) return; // Save dialog cancelled.
    setReceivedBytes(null);
    download.mutate({ id, kind, target });
  };

  return {
    /** The download running (or being set up), if any. */
    running: choosing ?? (download.isPending ? download.variables.kind : null),
    receivedBytes: download.isPending ? receivedBytes : null,
    /** The last download's error, with the audio it was for. */
    error: download.error ? { id: download.variables?.id, message: download.error.message } : null,
    start: (id: string, kind: DownloadKind) => void start(id, kind),
  };
}

export function AudioDetailPanel({
  id,
  onClose,
  onFindSimilar,
}: {
  id: string;
  onClose: () => void;
  onFindSimilar: (audio: { id: string; title: string }) => void;
}) {
  const { data, status, error, refetch } = useQuery({
    queryKey: ["v1", "audio", id],
    queryFn: ({ signal }) => fetchAudio(id, signal),
  });
  const download = useAudioDownload();
  // An error from a download of another audio stays with that audio.
  const downloadError = download.error?.id === id ? download.error.message : null;

  return (
    <aside
      className="flex w-[min(40rem,45%)] shrink-0 flex-col border-l"
      aria-label="Audio details"
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b pr-2 pl-4">
        <h2 className="truncate font-mono text-sm" title={id}>
          {id}
        </h2>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          // The title labels the "Similar to" chip, so wait for it.
          disabled={!data}
          onClick={() => data && onFindSimilar({ id, title: data.data.title })}
        >
          <AudioWaveformIcon />
          Find similar sound
        </Button>
        {(["zip", "audio"] as const).map((kind) => (
          <Tooltip key={kind}>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  disabled={download.running !== null}
                  onClick={() => download.start(id, kind)}
                />
              }
            >
              {download.running === kind ? (
                <>
                  <LoaderCircleIcon className="animate-spin" />
                  {download.receivedBytes === null
                    ? DOWNLOADS[kind].label
                    : formatBytes(download.receivedBytes)}
                </>
              ) : (
                <>
                  <DownloadIcon />
                  {DOWNLOADS[kind].label}
                </>
              )}
            </TooltipTrigger>
            <TooltipContent side="bottom">{DOWNLOADS[kind].hint}</TooltipContent>
          </Tooltip>
        ))}
        <IconButton
          variant="ghost"
          size="icon-sm"
          label="Close details"
          tooltipSide="bottom"
          onClick={onClose}
        >
          <XIcon />
        </IconButton>
      </div>
      {downloadError && (
        <p role="alert" className="border-b px-4 py-2 text-sm text-destructive">
          Download failed: {downloadError}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {status === "pending" && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
        {status === "error" && (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-destructive">{error.message}</span>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        )}
        {status === "success" && (
          <pre className="font-mono text-xs break-words whitespace-pre-wrap">
            {JSON.stringify(data, null, 2)}
          </pre>
        )}
      </div>
    </aside>
  );
}
