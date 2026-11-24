"use client";

import { useMutation } from "@tanstack/react-query";
import { DownloadIcon, LoaderCircleIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { exportAudios } from "@/lib/api/v1/client";
import { exportFileName, MAX_EXPORT_IDS } from "@/lib/api/v1/types";
import { chooseSaveTarget, formatBytes, type SaveTarget, saveStream } from "@/lib/save-file";

/** Rows checked for download, by id: they stay checked across pages and views. */
export type Selection = {
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

/**
 * The checked rows and their ZIP download. Lives above the list and the search
 * bar, so checked rows survive searching and browsing and both can use them.
 */
export function useSelection(): Selection {
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

/** Checks or unchecks every row the list shows; mixed when only some are checked. */
export function SelectAllCheckbox({
  rows,
  selection,
  className,
}: {
  rows: readonly { id: string }[];
  selection: Selection;
  className?: string;
}) {
  const { checked, setChecked } = selection;
  const checkedHere = rows.filter((row) => checked.has(row.id)).length;
  const allChecked = rows.length > 0 && checkedHere === rows.length;

  const checkAll = (value: boolean) => {
    const next = new Set(checked);
    for (const row of rows) {
      if (value) next.add(row.id);
      else next.delete(row.id);
    }
    setChecked(next);
  };

  return (
    <Checkbox
      className={className}
      aria-label="Select all audios in the list"
      checked={allChecked}
      indeterminate={checkedHere > 0 && !allChecked}
      disabled={rows.length === 0 || selection.locked}
      onCheckedChange={checkAll}
    />
  );
}

/** The count of checked rows and the download controls; nothing while none are checked. */
export function SelectionActions({ selection }: { selection: Selection }) {
  const { checked, setChecked, download } = selection;
  if (checked.size === 0) return null;
  const tooMany = checked.size > MAX_EXPORT_IDS;

  return (
    <div className="flex min-w-0 shrink-0 items-center gap-3 text-sm text-muted-foreground">
      {download.error ? (
        <span className="truncate text-destructive" role="alert">
          {download.error.message}
        </span>
      ) : tooMany ? (
        <span className="truncate">Up to {MAX_EXPORT_IDS} at a time</span>
      ) : null}
      <span className="shrink-0 text-foreground">{checked.size.toLocaleString()} selected</span>
      <Button
        variant="ghost"
        size="sm"
        disabled={selection.locked}
        onClick={() => setChecked(new Set())}
      >
        Clear
      </Button>
      <Button size="sm" disabled={tooMany || download.isPending} onClick={download.start}>
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
  );
}
