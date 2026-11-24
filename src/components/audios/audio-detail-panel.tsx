"use client";

import { Menu } from "@base-ui/react/menu";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AudioWaveformIcon,
  CheckIcon,
  ChevronDownIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  PauseIcon,
  PlayIcon,
  RotateCwIcon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { downloadAudioFile, exportAudios, fetchAudio } from "@/lib/api/v1/client";
import type { AudioDetailV1 } from "@/lib/api/v1/types";
import { chooseSaveTarget, formatBytes, type SaveTarget, saveStream } from "@/lib/save-file";

import { DatasetTag, displayText, displayTitle, SOURCE_KIND } from "./datasets";
import type { ReferenceClip } from "./queries";
import { type AudioPlayer, playbackOf } from "./use-audio-player";
import { formatClock, SeekableWaveform, useWaveform } from "./waveform";

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
    label: "Audio + details (ZIP)",
    hint: "FLAC and metadata.json",
    extension: ".zip",
    type: { description: "ZIP archive", mime: "application/zip" },
    // The list's export with one audio: metadata.json and audio/<id>.flac.
    open: async (id) => (await exportAudios([id])).body,
  },
  audio: {
    label: "Audio only (FLAC)",
    hint: "16 kHz mono",
    extension: ".flac",
    type: { description: "FLAC audio", mime: "audio/flac" },
    open: (id) => downloadAudioFile(id),
  },
};

/** Saves one audio as a ZIP or as its FLAC, one download at a time. */
function useAudioDownload() {
  // The save dialog is open: no download yet, but the button is already busy.
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

/** The headline quotes the clip's text, cut at a word when it runs long. */
function headline(text: string, max = 110) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max / 2)).replace(/[,.;:]$/, "")}…`;
}

export function AudioDetailPanel({
  id,
  player,
  onClose,
  onFindSimilar,
}: {
  id: string;
  player: AudioPlayer;
  onClose: () => void;
  onFindSimilar: (clip: ReferenceClip) => void;
}) {
  const { data, status, error, refetch } = useQuery({
    queryKey: ["v1", "audio", id],
    queryFn: ({ signal }) => fetchAudio(id, signal),
  });
  const download = useAudioDownload();
  // An error from a download of another audio stays with that audio.
  const downloadError = download.error?.id === id ? download.error.message : null;
  const audio = data?.data;

  return (
    <aside
      className="flex w-[min(28rem,42%)] shrink-0 flex-col border-l bg-card"
      aria-label="Clip details"
    >
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b pr-3 pl-6">
        {audio && (
          <>
            <DatasetTag source={audio.source} />
            <span className="truncate text-[0.8rem] text-muted-foreground">{SOURCE_KIND[audio.source]}</span>
          </>
        )}
        <IconButton
          variant="ghost"
          className="ml-auto"
          label="Close details"
          tooltipSide="bottom"
          onClick={onClose}
        >
          <XIcon />
        </IconButton>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6">
        {status === "pending" && (
          <div role="status" aria-label="Loading the clip" className="flex animate-pulse flex-col gap-3">
            <span className="h-6 w-4/5 rounded bg-border" />
            <span className="h-6 w-3/5 rounded bg-border" />
            <span className="h-3 w-1/3 rounded bg-accent" />
            <span className="mt-3 h-28 rounded-2xl bg-accent" />
          </div>
        )}
        {status === "error" && (
          <div role="alert" className="flex flex-col items-start gap-3">
            <p className="font-serif text-xl">This clip didn’t load</p>
            <p className="text-sm text-muted-foreground">{error.message}</p>
            <Button variant="outline" onClick={() => refetch()}>
              <RotateCwIcon />
              Try again
            </Button>
          </div>
        )}
        {audio && (
          <>
            <ClipHeading audio={audio} />
            <ClipPlayer audio={audio} player={player} />

            <div className="flex flex-wrap gap-2">
              <Button
                size="lg"
                onClick={() =>
                  onFindSimilar({
                    id: audio.id,
                    source: audio.source,
                    title: audio.title,
                    text: audio.text,
                    durationSeconds: audio.durationSeconds,
                  })
                }
              >
                <AudioWaveformIcon />
                Find similar sound
              </Button>
              <DownloadMenu id={audio.id} download={download} />
            </div>
            {downloadError && (
              <p role="alert" className="-mt-3 text-[0.8rem] text-destructive">
                Download failed: {downloadError}
              </p>
            )}

            <ClipText audio={audio} />
            <ClipFacts audio={audio} />

            <details className="group">
              <summary className="-ml-2.5 inline-flex h-8 cursor-pointer list-none items-center gap-2 rounded-lg px-2.5 text-[0.8rem] text-muted-foreground outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                <CodeIcon aria-hidden="true" className="size-4" />
                <span className="group-open:hidden">View raw record (JSON)</span>
                <span className="hidden group-open:inline">Hide raw record</span>
              </summary>
              <pre className="mt-2 overflow-x-auto rounded-xl bg-background p-4 font-mono text-xs leading-5 break-words whitespace-pre-wrap">
                {JSON.stringify(data, null, 2)}
              </pre>
            </details>
          </>
        )}
      </div>
    </aside>
  );
}

function ClipHeading({ audio }: { audio: AudioDetailV1 }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timeout);
  }, [copied]);

  return (
    <div className="flex flex-col gap-2.5">
      <h2 className="font-serif text-2xl leading-8 tracking-[-0.3px]">“{headline(displayText(audio))}”</h2>
      <p className="text-[0.8rem] text-muted-foreground">{displayTitle(audio)}</p>
      <Button
        variant="ghost"
        size="xs"
        className="-ml-2 self-start rounded-lg font-mono text-xs font-normal text-muted-foreground"
        aria-label={copied ? "Clip ID copied" : `Copy the clip ID, ${audio.id}`}
        onClick={() => {
          void navigator.clipboard.writeText(audio.id).then(() => setCopied(true));
        }}
      >
        {audio.id}
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </div>
  );
}

function ClipPlayer({ audio, player }: { audio: AudioDetailV1; player: AudioPlayer }) {
  const waveform = useWaveform(audio.id);
  const playback = playbackOf(player, audio.id);
  const playing = playback?.status === "playing" || playback?.status === "loading";
  const { sampleRate, channels } = audio.metadata;

  return (
    <div className="flex flex-col gap-3.5 rounded-2xl border border-hairline bg-background p-[18px]">
      <SeekableWaveform
        peaks={waveform.data}
        loading={waveform.isFetching}
        bars={64}
        height={64}
        currentTime={playback?.currentTime ?? 0}
        duration={audio.durationSeconds}
        onSeek={(seconds) => player.seek(audio.id, seconds)}
        label="Playback position"
      />
      <div className="flex items-center gap-3">
        <IconButton
          size="icon-lg"
          className="size-10"
          label={playback?.status === "error" ? "Couldn’t load this clip. Click to retry" : playing ? "Pause" : "Play"}
          onClick={() => player.toggle(audio.id)}
        >
          {playback?.status === "loading" ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : playing ? (
            <PauseIcon className="fill-current" />
          ) : (
            <PlayIcon className="ml-0.5 fill-current" />
          )}
        </IconButton>
        <span className="text-[0.8rem] tabular-nums">
          {formatClock(playback?.currentTime ?? 0)}
          <span className="text-muted-foreground"> / {formatClock(audio.durationSeconds)}</span>
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {sampleRate / 1000} kHz · {channels === 1 ? "mono" : `${channels} channels`} · FLAC
        </span>
      </div>
    </div>
  );
}

function DownloadMenu({ id, download }: { id: string; download: ReturnType<typeof useAudioDownload> }) {
  const busy = download.running !== null;
  return (
    <Menu.Root>
      <Menu.Trigger
        render={<Button variant="outline" size="lg" disabled={busy} className="pr-3.5" />}
      >
        {busy ? <LoaderCircleIcon className="animate-spin" /> : <DownloadIcon />}
        {busy
          ? download.receivedBytes === null
            ? "Preparing…"
            : formatBytes(download.receivedBytes)
          : "Download"}
        <ChevronDownIcon aria-hidden="true" className="text-muted-foreground" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="start" className="z-50 outline-none">
          <Menu.Popup className="w-72 origin-(--transform-origin) rounded-[14px] border bg-popover p-1.5 shadow-[0_12px_28px_rgba(26,26,25,0.12)] outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95">
            {(["zip", "audio"] as const).map((kind) => (
              <Menu.Item
                key={kind}
                onClick={() => download.start(id, kind)}
                className="flex cursor-pointer flex-col gap-0.5 rounded-[10px] px-3 py-2.5 outline-none select-none data-highlighted:bg-row-hover"
              >
                <span className="text-sm font-medium">{DOWNLOADS[kind].label}</span>
                <span className="text-xs text-muted-foreground">{DOWNLOADS[kind].hint}</span>
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function ClipText({ audio }: { audio: AudioDetailV1 }) {
  if (audio.source === "audiocaps") {
    return (
      <Section title={`Captions (${audio.metadata.captions.length})`}>
        <ol className="flex flex-col text-[0.95rem] leading-6">
          {audio.metadata.captions.map((caption, i) => (
            <li key={i} className="flex gap-3 border-t border-hairline py-2 first:border-t-0 first:pt-0">
              <span className="w-4 shrink-0 text-[0.8rem] leading-6 text-muted-foreground tabular-nums">
                {i + 1}
              </span>
              {caption}
            </li>
          ))}
        </ol>
      </Section>
    );
  }
  return (
    <Section title="Transcript">
      <p className="text-[0.95rem] leading-6">{displayText(audio)}</p>
    </Section>
  );
}

function ClipFacts({ audio }: { audio: AudioDetailV1 }) {
  const facts: { label: string; value: ReactNode }[] = [];
  switch (audio.source) {
    case "librispeech": {
      const { speaker, chapter, utteranceId } = audio.metadata;
      const sex = speaker.sex === "M" ? "male" : speaker.sex === "F" ? "female" : null;
      facts.push(
        { label: "Speaker", value: [speaker.name, sex, `#${speaker.id}`].filter(Boolean).join(" · ") },
        { label: "Book", value: chapter.bookTitle ?? "—" },
        { label: "Chapter", value: [chapter.title, `#${chapter.id}`].filter(Boolean).join(" · ") },
        { label: "Utterance", value: utteranceId },
      );
      break;
    }
    case "audiocaps": {
      const { youtubeUrl, youtubeId, startTime, audiocapIds } = audio.metadata;
      facts.push(
        {
          label: "Source",
          value: (
            <a
              href={youtubeUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 underline decoration-input underline-offset-4 hover:decoration-foreground"
            >
              YouTube {youtubeId}
              <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          ),
        },
        { label: "Starts at", value: formatClock(startTime) },
        { label: "AudioCaps ids", value: audiocapIds.join(", ") },
      );
      break;
    }
    case "commonvoice": {
      const { speaker, upVotes, downVotes, locale, clipId } = audio.metadata;
      const gender = speaker.gender?.split("_")[0] ?? null;
      facts.push(
        { label: "Speaker", value: `Anonymous ${speaker.clientId.slice(0, 8)}` },
        { label: "About", value: [gender, speaker.age].filter(Boolean).join(" · ") || "—" },
        { label: "Accent", value: speaker.accent ?? "—" },
        { label: "Votes", value: `${upVotes} up · ${downVotes} down` },
        { label: "Language", value: locale },
        { label: "Clip", value: clipId },
      );
      break;
    }
  }
  facts.push(
    { label: "Length", value: `${audio.durationSeconds.toFixed(1)} s` },
    { label: "File", value: audio.metadata.fileName },
  );

  return (
    <Section title="Details">
      <dl className="grid grid-cols-[7rem_minmax(0,1fr)] text-[0.8rem] leading-[18px]">
        {facts.map((fact) => (
          <div key={fact.label} className="contents">
            <dt className="border-t border-hairline py-2.5 text-muted-foreground">{fact.label}</dt>
            <dd className="truncate border-t border-hairline py-2.5">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}
