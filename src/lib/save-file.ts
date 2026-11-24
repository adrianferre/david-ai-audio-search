/**
 * Saving a streamed download to disk. Where the browser supports it (Chromium's
 * File System Access API) the stream is written straight to a file the user
 * picks, so it never sits in memory; elsewhere it is collected into a Blob and
 * saved through a temporary link.
 */

/** Where a download is written. */
export type SaveTarget =
  | { kind: "file"; handle: FileSystemFileHandle }
  | { kind: "memory"; fileName: string };

type SaveFilePicker = (options: {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandle>;

/**
 * Asks where to save the file. Call it straight from the click handler: the save
 * dialog needs the user's gesture. Resolves to null when the user cancels.
 */
export async function chooseSaveTarget(
  suggestedName: string,
  type: { description: string; mime: string; extension: string },
): Promise<SaveTarget | null> {
  const picker = (window as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (!picker) return { kind: "memory", fileName: suggestedName };
  try {
    const handle = await picker.call(window, {
      suggestedName,
      types: [{ description: type.description, accept: { [type.mime]: [type.extension] } }],
    });
    return { kind: "file", handle };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null;
    // Not allowed here (e.g. a cross-origin iframe): fall back to a regular download.
    return { kind: "memory", fileName: suggestedName };
  }
}

/** How often `onProgress` is called at most, so it can drive React state. */
const PROGRESS_INTERVAL_MS = 200;

/**
 * Writes the stream to the target. Resolves once the whole file is on disk (or,
 * for "memory", handed to the browser's downloads); rejects if the stream fails,
 * leaving no partial file behind.
 */
export async function saveStream(
  body: ReadableStream<Uint8Array>,
  target: SaveTarget,
  onProgress?: (receivedBytes: number) => void,
): Promise<void> {
  let received = 0;
  let reportedAt = 0;
  const counted = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        const now = performance.now();
        if (now - reportedAt >= PROGRESS_INTERVAL_MS) {
          reportedAt = now;
          onProgress?.(received);
        }
        controller.enqueue(chunk);
      },
      flush() {
        onProgress?.(received);
      },
    }),
  );

  if (target.kind === "file") {
    // Written to a temporary file that replaces the target only on close; a
    // failed stream aborts the writable, which discards it.
    const writable = await target.handle.createWritable();
    await counted.pipeTo(writable);
    return;
  }

  const blob = await new Response(counted).blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = target.fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser time to start the download before freeing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** e.g. 12.3 MB */
export function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}
