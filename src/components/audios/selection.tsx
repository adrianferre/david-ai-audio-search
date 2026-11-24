"use client";

import { useMutation } from "@tanstack/react-query";
import { DownloadIcon, LoaderCircleIcon } from "lucide-react";
import { type KeyboardEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { exportAudios } from "@/lib/api/v1/client";
import { exportFileName, MAX_EXPORT_IDS } from "@/lib/api/v1/types";
import { chooseSaveTarget, formatBytes, type SaveTarget, saveStream } from "@/lib/save-file";

import { formatClock } from "./waveform";

/** A row the selection needs: its id, and its length for the total. */
export type SelectableRow = { id: string; durationSeconds: number };

/**
 * Rows checked for download, by id, with their length in seconds: they stay
 * checked across pages and views.
 */
export type Selection = {
  checked: ReadonlyMap<string, number>;
  /** While a download runs the selection can't change, so it matches the ZIP. */
  locked: boolean;
  setChecked: (next: ReadonlyMap<string, number>) => void;
  download: {
    /** From choosing where to save until the whole ZIP is written. */
    isPending: boolean;
    /** Bytes of the ZIP received so far, null until it starts arriving. */
    receivedBytes: number | null;
    error: Error | null;
    start: () => void;
  };
};

/** `checked` with `rows` checked (or unchecked when `value` is false). */
export function withRows(
  checked: ReadonlyMap<string, number>,
  rows: readonly SelectableRow[],
  value: boolean,
): Map<string, number> {
  const next = new Map(checked);
  for (const row of rows) {
    if (value) next.set(row.id, row.durationSeconds);
    else next.delete(row.id);
  }
  return next;
}

/**
 * The checked rows and their ZIP download. Lives above the list and the search
 * bar, so checked rows survive searching and browsing and both can use them.
 */
export function useSelection(): Selection {
  const [checked, setCheckedState] = useState<ReadonlyMap<string, number>>(() => new Map());
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
    const ids = [...checked.keys()];
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

  return {
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
}

/**
 * Escape unchecks every row. For the list and for the selection bar, so it
 * works wherever the focus is after checking rows, but not in the search input
 * or the details panel.
 */
export function clearOnEscape(selection: Selection) {
  return (event: KeyboardEvent) => {
    if (event.key === "Escape" && selection.checked.size > 0) selection.setChecked(new Map());
  };
}

/** Checks or unchecks every row the list shows; mixed when only some are checked. */
export function SelectAllCheckbox({
  rows,
  selection,
  className,
}: {
  rows: readonly SelectableRow[];
  selection: Selection;
  className?: string;
}) {
  const { checked, setChecked } = selection;
  const checkedHere = rows.filter((row) => checked.has(row.id)).length;
  const allChecked = rows.length > 0 && checkedHere === rows.length;

  return (
    <Checkbox
      className={className}
      aria-label="Select all clips in the list"
      checked={allChecked}
      indeterminate={checkedHere > 0 && !allChecked}
      disabled={rows.length === 0 || selection.locked}
      onCheckedChange={(value) => setChecked(withRows(checked, rows, value))}
      onKeyDown={clearOnEscape(selection)}
    />
  );
}

/**
 * Floats at the bottom of the list while rows are checked: how many, how much
 * audio, and the ZIP download. Its own progress while the ZIP is written.
 */
export function SelectionBar({ selection }: { selection: Selection }) {
  const { checked, setChecked, download } = selection;
  if (checked.size === 0) return null;
  const tooMany = checked.size > MAX_EXPORT_IDS;
  let seconds = 0;
  for (const duration of checked.values()) seconds += duration;
  const count = checked.size.toLocaleString();

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-2 px-4 pb-3">
      <div
        role="region"
        aria-label="Selection"
        className="pointer-events-auto flex max-w-full items-center gap-1.5 rounded-full bg-primary py-2 pr-2 pl-5 text-primary-foreground shadow-[0_12px_32px_rgba(26,26,25,0.22),0_2px_6px_rgba(26,26,25,0.12)]"
        onKeyDown={clearOnEscape(selection)}
      >
        <span className="text-sm font-medium whitespace-nowrap">
          {count} {checked.size === 1 ? "clip" : "clips"} selected
        </span>
        <span className="mr-2 text-[0.8rem] whitespace-nowrap text-[#b5b6ae] tabular-nums">
          · {formatClock(seconds)} of audio
        </span>
        <Button
          variant="ghost"
          size="lg"
          className="text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
          disabled={selection.locked}
          onClick={() => setChecked(new Map())}
        >
          Clear
        </Button>
        <Button
          variant="outline"
          size="lg"
          className="border-transparent text-foreground hover:text-foreground"
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
              {download.error ? "Retry download" : "Download ZIP"}
            </>
          )}
        </Button>
      </div>
      <p
        role={download.error || tooMany ? "alert" : undefined}
        className="pointer-events-auto rounded-full bg-background/90 px-2 text-xs text-muted-foreground"
      >
        {download.error ? (
          <span className="text-destructive">{download.error.message}</span>
        ) : tooMany ? (
          <span className="text-destructive">
            Up to {MAX_EXPORT_IDS} clips per ZIP. Uncheck {(checked.size - MAX_EXPORT_IDS).toLocaleString()} to
            download.
          </span>
        ) : (
          "FLAC audio + metadata.json for each clip · up to 200 clips per ZIP · Esc clears"
        )}
      </p>
    </div>
  );
}
