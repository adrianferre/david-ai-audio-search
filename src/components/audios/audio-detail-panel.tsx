"use client";

import { useQuery } from "@tanstack/react-query";
import { AudioWaveformIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { fetchAudio } from "@/lib/api/v1/client";

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

  return (
    <aside
      className="flex w-[min(40rem,45%)] shrink-0 flex-col border-l"
      aria-label="Audio details"
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b pr-2 pl-4">
        <h2 className="truncate font-mono text-sm">{id}</h2>
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
