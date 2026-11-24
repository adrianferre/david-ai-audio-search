"use client";

import { queryOptions, useQuery } from "@tanstack/react-query";
import { type ReactNode, useMemo, useState } from "react";

import type { SearchMatchV1 } from "@/lib/api/v1/types";
import { EMBEDDING_MAP_URL, type EmbeddingMapClip, type EmbeddingMapV1 } from "@/lib/embedding-map/types";
import { cn } from "@/lib/utils";

import { matchLabel, RelevanceMeter, relevanceLevel } from "../audios/audio-list";
import { displayText } from "../audios/datasets";
import {
  type AudioListView,
  fileQuery,
  searchesTranscript,
  searchQuery,
  similarQuery,
  useTranscriptSearch,
} from "../audios/queries";
import { type Selection, SelectionBar } from "../audios/selection";
import { type ColourBy, COLOUR_BY_OPTIONS, colourOf, colouringOf } from "./colouring";
import { AnchorLabel, GroupLabels, groupLabels, HoverCard, Legend, SelectionSummary } from "./map-overlays";
import { ModalityGapChart } from "./modality-gap-chart";
import { clipsInside, type MapKind, type MapPoint, Scatter, type ScatterStyle, type Tool } from "./scatter";
import { Story } from "./story";

/** Lines and rank numbers go to this many results; every result is highlighted. */
const LINKED_RESULTS = 10;

async function fetchEmbeddingMap(signal: AbortSignal): Promise<EmbeddingMapV1> {
  const response = await fetch(EMBEDDING_MAP_URL, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/** The map's points never change between deploys: fetched once. */
const embeddingMapQuery = () =>
  queryOptions({
    queryKey: ["embedding-map", EMBEDDING_MAP_URL],
    queryFn: ({ signal }) => fetchEmbeddingMap(signal),
    staleTime: Infinity,
  });

/** A result of the current view (a search, or a search with a clip) as a point of the map. */
type Hit = { index: number; id: string; score?: number; similarity?: number; matches?: SearchMatchV1[] };

/**
 * The results of the list's current view, from the same queries (and cache
 * entries) as `useListView`, so switching between List and Map fetches nothing.
 */
function useViewHits(view: AudioListView, indexOf: ReadonlyMap<string, number>): Hit[] {
  const { source } = view;
  const search = useQuery({
    ...searchQuery(view.kind === "search" ? view.q : "", view.kind === "search" ? view.match : "all", source),
    enabled: view.kind === "search",
  });
  const similar = useQuery({
    ...similarQuery(view.kind === "similar" ? view.reference.id : "", source),
    enabled: view.kind === "similar" && view.match === "sound",
  });
  const file = useQuery(fileQuery(view.kind === "file" && view.match === "sound" ? view.example : null, source));
  const words = useTranscriptSearch(view);

  const scored = (data: { id: string; score: number; matches: SearchMatchV1[] }[] | undefined) =>
    data?.map((hit) => ({ id: hit.id, score: hit.score, matches: hit.matches })) ?? [];
  const raw: Omit<Hit, "index">[] =
    view.kind === "browse"
      ? []
      : view.kind === "search"
        ? scored(search.data?.data)
        : searchesTranscript(view)
          ? words.searchable && !words.search.isPlaceholderData
            ? scored(words.search.data?.data)
            : []
          : ((view.kind === "similar" ? similar.data : file.data)?.data.map((hit) => ({
              id: hit.id,
              similarity: hit.similarity,
            })) ?? []);
  return raw.flatMap((hit) => {
    const index = indexOf.get(hit.id);
    return index === undefined ? [] : [{ ...hit, index }];
  });
}

/**
 * Where the query goes on each map: the score-weighted centre of its top
 * results. UMAP's own `transform` starts a new point from the same weighted
 * average of its neighbours; the maps were computed offline, so the app can't
 * run it.
 */
function centreOf(hits: Hit[], positions: { audio: Float32Array; text: Float32Array }) {
  let [weight, ax, ay, tx, ty] = [0, 0, 0, 0, 0];
  for (const hit of hits) {
    const w = Math.max(hit.score ?? hit.similarity ?? 1, 1e-3);
    weight += w;
    ax += positions.audio[2 * hit.index] * w;
    ay += positions.audio[2 * hit.index + 1] * w;
    tx += positions.text[2 * hit.index] * w;
    ty += positions.text[2 * hit.index + 1] * w;
  }
  return {
    audio: [ax / weight, ay / weight] as MapPoint,
    text: [tx / weight, ty / weight] as MapPoint,
  };
}

/**
 * The catalog as a map of its embeddings: every clip placed by its audio
 * vector (or its text vector), coloured by dataset or by what it is, with the
 * current search drawn on it. A second view of the same catalog: it reads the
 * list's view, opens the same details panel and fills the same selection.
 */
type EmbeddingMapViewProps = {
  view: AudioListView;
  selectedId: string | null;
  onSelect: (id: string) => void;
  selection: Selection;
  /** The details panel takes the right rail's place. */
  detailsOpen: boolean;
  onTryQuery: (query: string) => void;
  /** Leaves search, "similar" and file search, back to the whole catalog. */
  onClearQuery: () => void;
};

export function EmbeddingMapView(props: EmbeddingMapViewProps) {
  const { data, status, error, refetch } = useQuery(embeddingMapQuery());

  if (status === "pending") {
    return (
      <MapShell>
        <p role="status" className="m-auto text-[0.8rem] text-muted-foreground">
          Loading the map…
        </p>
      </MapShell>
    );
  }
  if (status === "error") {
    return (
      <MapShell>
        <div role="alert" className="m-auto flex flex-col items-center gap-2 text-center">
          <p className="font-serif text-xl">The map didn’t load</p>
          <p className="text-[0.8rem] text-muted-foreground">{error.message}</p>
          <button type="button" className="text-[0.8rem] underline underline-offset-4" onClick={() => refetch()}>
            Try again
          </button>
        </div>
      </MapShell>
    );
  }
  return <LoadedMap data={data} {...props} />;
}

function MapShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 px-6 pb-6">
      <div className="relative flex min-h-[480px] flex-1 rounded-[14px] border bg-background">{children}</div>
    </div>
  );
}

function LoadedMap({
  data,
  view,
  selectedId,
  onSelect,
  selection,
  detailsOpen,
  onTryQuery,
  onClearQuery,
}: EmbeddingMapViewProps & { data: EmbeddingMapV1 }) {
  const { clips } = data;
  const [mapKind, setMapKind] = useState<MapKind>("audio");
  const [colourBy, setColourBy] = useState<ColourBy>("dataset");
  const [tool, setTool] = useState<Tool>("pan");
  const [speechOnly, setSpeechOnly] = useState(false);
  const [step, setStep] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  const [outline, setOutline] = useState<{ map: MapKind; polygon: MapPoint[]; count: number } | null>(null);

  const { positions, indexOf } = useMemo(() => {
    const audio = new Float32Array(clips.length * 2);
    const text = new Float32Array(clips.length * 2);
    clips.forEach((clip, i) => {
      audio.set(clip.audioMap, 2 * i);
      text.set(clip.textMap, 2 * i);
    });
    return { positions: { audio, text }, indexOf: new Map(clips.map((clip, i) => [clip.id, i])) };
  }, [clips]);

  const hidden = useMemo(() => {
    const out = new Uint8Array(clips.length);
    if (view.source) clips.forEach((clip, i) => (out[i] = clip.source === view.source ? 0 : 1));
    return out;
  }, [clips, view.source]);

  const colouring = useMemo(() => colouringOf(clips, colourBy), [clips, colourBy]);
  const hits = useViewHits(view, indexOf);
  const linked = hits.slice(0, LINKED_RESULTS);
  const selectedIndex = selectedId ? (indexOf.get(selectedId) ?? null) : null;

  // The selected clip's nearest neighbours: the same request as "Find similar sound".
  const neighbours = useQuery({
    ...similarQuery(selectedId ?? "", view.source),
    enabled: selectedId !== null,
  });
  const neighbourIndices = (neighbours.data?.data ?? [])
    .slice(0, LINKED_RESULTS)
    .flatMap((hit) => indexOf.get(hit.id) ?? []);

  // Sound search compares audio vectors only: the text map would place it wrongly.
  const audioOnly = view.kind !== "browse" && view.match === "sound" && view.kind !== "similar";
  const shownMap: MapKind = audioOnly ? "audio" : mapKind;

  const referenceIndex = view.kind === "similar" ? (indexOf.get(view.reference.id) ?? null) : null;
  const anchor = (view.kind === "search" || view.kind === "file") && linked.length > 0 ? centreOf(linked, positions) : null;
  const anchorText =
    view.kind === "search" ? `“${view.q}”` : view.kind === "file" ? (view.example.source === "recording" ? "Your recording" : view.example.name) : "";

  const checkedIndices = useMemo(
    () => [...selection.checked.keys()].flatMap((id) => indexOf.get(id) ?? []),
    [selection.checked, indexOf],
  );

  const focus = useMemo(() => {
    if (hits.length > 0) return new Set(hits.map((hit) => hit.index));
    if (checkedIndices.length > 0) return new Set(checkedIndices);
    if (speechOnly) return new Set(clips.flatMap((clip, i) => (clip.hasSpeech ? [i] : [])));
    return null;
  }, [hits, checkedIndices, speechOnly, clips]);

  const style = useMemo<ScatterStyle>(() => {
    const n = clips.length;
    const colors = new Array<string>(n);
    const alpha = new Float32Array(n);
    const layer = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const group = colouring.groupOf[i];
      const grey = group < 0 || colouring.groups[group].other === true;
      colors[i] = colourOf(colouring, i);
      if (hidden[i]) {
        layer[i] = 0;
        alpha[i] = 0.07;
        continue;
      }
      layer[i] = grey ? 1 : 2;
      alpha[i] = group < 0 ? 0.4 : grey ? 0.6 : 0.72;
      if (focus) {
        if (focus.has(i)) {
          layer[i] = 3;
          alpha[i] = 1;
          if (grey) colors[i] = "#9a9b93";
        } else {
          alpha[i] = group < 0 ? 0.08 : 0.15;
        }
      } else if (selectedIndex !== null) {
        alpha[i] *= 0.55;
      }
    }
    return { colors, alpha, layer };
  }, [clips.length, colouring, hidden, focus, selectedIndex]);

  // Results hang from the query's star, or from the clip "Find similar sound" started from.
  const linkFrom = referenceIndex ?? (anchor ? ("anchor" as const) : null);
  const links =
    linked.length > 0 && linkFrom !== null
      ? { from: linkFrom, to: linked.map((hit) => hit.index) }
      : selectedIndex !== null && neighbourIndices.length > 0
        ? { from: selectedIndex, to: neighbourIndices }
        : null;

  const at = (index: number, map: MapKind): MapPoint => {
    const source = map === "text" ? positions.text : positions.audio;
    return [source[2 * index], source[2 * index + 1]];
  };
  const fit =
    linked.length > 0
      ? {
          key: `hits:${linked.map((hit) => hit.id).join(",")}`,
          maxZoom: 5,
          points: (map: MapKind) => [
            ...(anchor ? [anchor[map]] : []),
            ...(referenceIndex !== null ? [at(referenceIndex, map)] : []),
            ...linked.map((hit) => at(hit.index, map)),
          ],
        }
      : step === 1 || step === 2
        ? {
            key: `story:${step}`,
            maxZoom: step === 1 ? 8 : 4,
            points: (map: MapKind) =>
              clips.flatMap((clip, i) => (clip.source === (step === 1 ? "audiocaps" : "librispeech") ? [at(i, map)] : [])),
          }
        : { key: "all", maxZoom: 1, points: () => [] };

  const goToStep = (next: number) => {
    setStep(next);
    setSpeechOnly(false);
    setColourBy(next === 1 ? "family" : next === 2 ? "book" : "dataset");
    if (next < 3) setMapKind("audio");
    if (next === 4) {
      if (view.kind !== "search") onTryQuery(data.examples[0].query);
    } else if (view.kind !== "browse") {
      onClearQuery();
    }
  };

  const select = (id: string) => {
    setHovered(null);
    onSelect(id);
  };

  const selectedClips = checkedIndices.map((i) => clips[i]);
  const showOutline = outline && selection.checked.size === outline.count ? outline : null;
  const outsideCount = colouring.groupOf.reduce((sum, group) => sum + (group < 0 ? 1 : 0), 0);
  const mapLabel = shownMap === "audio" ? "Audio map" : "Text map";
  const focusNote =
    hits.length > 0 && hits[0].score !== undefined
      ? `${hits.length} results over the z ≥ 3 cut-off · the rest dimmed`
      : hits.length > 0
        ? `${hits.length} closest clips · the rest dimmed`
        : checkedIndices.length > 0
          ? "Selection · the rest dimmed"
          : selectedIndex !== null && neighbourIndices.length > 0
            ? "Lines join the 10 nearest neighbours (audio cosine)"
            : speechOnly
              ? "AudioCaps clips with speech"
              : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 pb-6 xl:overflow-hidden">
      <StatTiles data={data} />
      <div className="flex flex-col gap-4 xl:min-h-0 xl:flex-1 xl:flex-row">
        <div className="relative h-[600px] shrink-0 overflow-hidden rounded-[14px] border bg-background xl:h-auto xl:min-h-[420px] xl:flex-1">
          <Scatter
            audio={positions.audio}
            text={positions.text}
            mapKind={shownMap}
            style={style}
            hidden={hidden}
            anchor={anchor}
            links={links}
            ranks={linked.map((hit) => hit.index)}
            selected={selectedIndex}
            hovered={hovered}
            outline={showOutline}
            fit={fit}
            tool={tool}
            onToolChange={setTool}
            onHover={setHovered}
            onPick={(i) => select(clips[i].id)}
            onArea={(polygon, map) => {
              const inside = clipsInside(positions, hidden, polygon, map);
              if (inside.length === 0) return;
              selection.setChecked(new Map(inside.map((i) => [clips[i].id, clips[i].durationSeconds])));
              setOutline({ map, polygon, count: inside.length });
            }}
            label={`${mapLabel} of ${clips.length.toLocaleString()} clips, coloured by ${COLOUR_BY_OPTIONS.find((o) => o.value === colourBy)?.label.toLowerCase()}. Hover a dot to see its clip; click it for details.`}
            overlay={(place, size) => (
              <>
                <GroupLabels
                  labels={groupLabels(clips, colouring, hidden, place.clip, size)}
                  faded={focus !== null || selectedIndex !== null}
                />
                {place.anchor && anchorText && <AnchorLabel text={anchorText} at={place.anchor} size={size} />}
                {hovered !== null && hovered !== selectedIndex && (
                  <HoverCard clip={clips[hovered]} at={place.clip(hovered)} size={size} />
                )}
              </>
            )}
          />
          <Legend colouring={colouring} outsideCount={outsideCount} />
          <div className="pointer-events-none absolute top-3 right-3 flex flex-col items-end gap-1.5">
            <span className="inline-flex h-7 items-center gap-2 rounded-full border bg-card/95 px-3 text-xs font-medium">
              {mapLabel}
              <span className="font-normal text-muted-foreground">
                UMAP of the {shownMap} vectors · {data.model}
              </span>
            </span>
            {focusNote && (
              <span className="inline-flex h-[26px] items-center rounded-full border bg-card/95 px-2.5 text-xs text-muted-foreground">
                {focusNote}
              </span>
            )}
            {selectedClips.length > 0 && <SelectionSummary clips={selectedClips} />}
          </div>
          {selection.checked.size === 0 && (
            <span className="pointer-events-none absolute right-3.5 bottom-3 text-[11.5px] text-muted-foreground">
              Scroll to zoom · drag to pan · click a dot for details
            </span>
          )}
          <SelectionBar selection={selection} />
        </div>

        {!detailsOpen && (
          <aside aria-label="Map controls" className="flex flex-col gap-[22px] xl:w-[320px] xl:shrink-0 xl:overflow-y-auto xl:pr-1">
            <Control label="Map">
              <Segmented
                label="Which vector places the clips"
                value={shownMap}
                onChange={(kind) => {
                  // The hovered dot is about to move away from the pointer.
                  setHovered(null);
                  setMapKind(kind);
                }}
                options={[
                  { value: "audio", label: "Audio" },
                  { value: "text", label: "Text", disabled: audioOnly },
                ]}
              />
              <p className="text-xs leading-[17px] text-muted-foreground">
                {audioOnly
                  ? "Sound search compares audio vectors, so only the audio map applies."
                  : shownMap === "audio"
                    ? "Each clip placed by its audio vector, computed from the waveform."
                    : "Each clip placed by its text vector: the transcript, or the captions joined."}
              </p>
            </Control>

            <Control label="Colour by">
              <div role="group" aria-label="Colour by" className="flex flex-wrap gap-1.5">
                {COLOUR_BY_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={colourBy === option.value}
                    onClick={() => setColourBy(option.value)}
                    className={cn(
                      "inline-flex h-7 items-center rounded-full border border-input bg-card px-2.5 text-[0.8rem] font-medium outline-none hover:bg-row-hover focus-visible:ring-3 focus-visible:ring-ring/50",
                      colourBy === option.value && "border-foreground bg-foreground text-background hover:bg-foreground",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </Control>

            <div className="flex items-center gap-3">
              <div className="flex flex-1 flex-col gap-0.5">
                <span id="map-speech-label" className="text-[0.85rem] font-medium">
                  Has speech
                </span>
                <span className="text-xs leading-[17px] text-muted-foreground">
                  Only the {clips.filter((clip) => clip.hasSpeech).length} AudioCaps clips where someone also speaks
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={speechOnly}
                aria-labelledby="map-speech-label"
                disabled={view.source !== null && view.source !== "audiocaps"}
                onClick={() => setSpeechOnly(!speechOnly)}
                className={cn(
                  "relative h-5 w-[34px] shrink-0 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-45",
                  speechOnly ? "bg-foreground" : "bg-input",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 size-4 rounded-full bg-card shadow-[0_1px_2px_rgba(26,26,25,0.25)] transition-[left]",
                    speechOnly ? "left-4" : "left-0.5",
                  )}
                />
              </button>
            </div>

            {linked.length > 0 && (
              <MapResults
                view={view}
                hits={linked}
                total={hits.length}
                clips={clips}
                hovered={hovered}
                onHover={setHovered}
                onSelect={select}
              />
            )}

            <Story
              step={step}
              onStep={goToStep}
              colourBy={colourBy}
              onColourBy={setColourBy}
              data={data}
              activeQuery={view.kind === "search" ? view.q : null}
              onTryQuery={onTryQuery}
            />

            <ModalityGapChart gap={data.modalityGap} />
          </aside>
        )}
      </div>
    </div>
  );
}

function StatTiles({ data }: { data: EmbeddingMapV1 }) {
  const example = data.examples.find((e) => e.precisionAt10 !== null);
  const tiles: [string, string][] = [
    [data.clips.length.toLocaleString(), `clips · ${data.totalDurationHours.toFixed(1)} h of audio`],
    [`${data.dimensions}-d`, "one space for text and audio"],
    ["3", "datasets · speech and sounds"],
    [`${Math.round(data.stats.speechNeighborsOfSpeech)}%`, "of a speech clip’s neighbours are speech"],
    ...(example ? [[`${Math.round(example.precisionAt10! * 100)}%`, `P@10 for “${example.query}”`] as [string, string]] : []),
  ];
  return (
    <dl className="grid shrink-0 grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
      {tiles.map(([figure, label]) => (
        <div key={label} className="flex flex-col-reverse gap-0.5 rounded-xl border bg-card px-3.5 py-2.5">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="font-mono text-xl leading-[26px] font-medium tabular-nums">{figure}</dd>
        </div>
      ))}
    </dl>
  );
}

function Control({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; disabled?: boolean }[];
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-0.5 self-start rounded-full bg-muted p-[3px]">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-[30px] rounded-full px-3 text-[0.8rem] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-45",
            value === option.value && "bg-card text-foreground shadow-[0_1px_2px_rgba(26,26,25,0.08)]",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** The view's top results, next to the map: hover one to find it, click to open it. */
function MapResults({
  view,
  hits,
  total,
  clips,
  hovered,
  onHover,
  onSelect,
}: {
  view: AudioListView;
  hits: Hit[];
  total: number;
  clips: readonly EmbeddingMapClip[];
  hovered: number | null;
  onHover: (index: number | null) => void;
  onSelect: (id: string) => void;
}) {
  const best = hits[0]?.score ?? 0;
  const title =
    view.kind === "search"
      ? `Top ${hits.length} for “${view.q}”`
      : view.kind === "similar"
        ? view.match === "sound"
          ? `${hits.length} most similar sounds`
          : `Top ${hits.length} for what the clip says`
        : view.kind === "file" && view.match === "sound"
          ? `${hits.length} closest to your ${view.example.source === "recording" ? "recording" : "file"}`
          : `Top ${hits.length} for what your clip says`;
  return (
    <section aria-label="Results on the map" className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">{title}</span>
        {total > hits.length && (
          <span className="ml-auto shrink-0 text-[11.5px] text-muted-foreground tabular-nums">{total} on the map</span>
        )}
      </div>
      <ol>
        {hits.map((hit, rank) => {
          const clip = clips[hit.index];
          return (
            <li key={hit.id}>
              <button
                type="button"
                onClick={() => onSelect(hit.id)}
                onMouseEnter={() => onHover(hit.index)}
                onMouseLeave={() => onHover(null)}
                onFocus={() => onHover(hit.index)}
                onBlur={() => onHover(null)}
                className={cn(
                  "grid w-full grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2.5 border-t border-hairline px-1.5 py-2 text-left outline-none hover:bg-row-hover focus-visible:bg-row-hover",
                  hovered === hit.index && "bg-row-hover",
                )}
              >
                <span className="font-mono text-[11.5px] text-muted-foreground tabular-nums">{rank + 1}</span>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="truncate text-[0.8rem] leading-[18px] font-medium">{displayText(clip)}</span>
                  {hit.matches && (
                    <span className="flex gap-1">
                      {hit.matches.map((match) => {
                        const { label, title } = matchLabel(match, clip.source);
                        return (
                          <span
                            key={match}
                            title={title}
                            className="inline-flex h-5 items-center rounded-full border border-input bg-card px-1.5 text-[11.5px] whitespace-nowrap"
                          >
                            {label}
                          </span>
                        );
                      })}
                    </span>
                  )}
                </span>
                {hit.score !== undefined ? (
                  <RelevanceMeter level={relevanceLevel(hit.score, best)} />
                ) : (
                  <span className="font-mono text-xs tabular-nums" title="Cosine similarity of the sound, at most 1">
                    {hit.similarity?.toFixed(3)}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
