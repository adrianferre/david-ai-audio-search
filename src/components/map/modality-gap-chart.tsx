import type { EmbeddingMapV1 } from "@/lib/embedding-map/types";

/** Series colours: slots 1 and 2 of the map's validated palette. */
export const TEXT_COLOR = "#1f4e99";
export const AUDIO_COLOR = "#e0502a";

const W = 300;
const PLOT_H = 96;
const TOP = 14;
const X0 = 0.25;
const X1 = 0.8;

/**
 * Two overlaid histograms of a query's cosine similarity: against every text
 * vector and against every audio vector. They barely overlap, which is why
 * search compares each signal as a z-score rather than as a raw similarity.
 */
export function ModalityGapChart({ gap }: { gap: EmbeddingMapV1["modalityGap"] }) {
  const { binStarts, binWidth, examples } = gap;
  const x = (v: number) => (Math.max(0, Math.min(1, (v - X0) / (X1 - X0))) * W);
  const max = Math.max(1, ...examples.text.counts, ...examples.audio.counts);
  const y = (count: number) => PLOT_H - (count / max) * (PLOT_H - TOP);
  const path = (counts: number[], closed: boolean) => {
    let d = `M${x(binStarts[0]).toFixed(1)} ${PLOT_H}`;
    counts.forEach((count, i) => {
      d += ` L${x(binStarts[i]).toFixed(1)} ${y(count).toFixed(1)} L${x(binStarts[i] + binWidth).toFixed(1)} ${y(count).toFixed(1)}`;
    });
    d += ` L${x(binStarts[binStarts.length - 1] + binWidth).toFixed(1)} ${PLOT_H}`;
    return closed ? `${d} Z` : d;
  };
  const textMedian = x(examples.text.p50);
  const audioMedian = x(examples.audio.p50);
  let textLabel = Math.min(textMedian + 6, W - 40);
  let audioLabel = Math.max(audioMedian - 50, 0);
  if (Math.abs(textLabel - audioLabel) < 52) audioLabel = textLabel - 56;
  if (audioLabel < 0) [audioLabel, textLabel] = [0, 56];

  return (
    <figure className="m-0 flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <figcaption className="text-xs font-medium text-muted-foreground">Modality gap</figcaption>
        <span className="ml-auto font-mono text-[11.5px] text-muted-foreground tabular-nums">
          gap at median {(examples.text.p50 - examples.audio.p50).toFixed(2)}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} 150`}
        role="img"
        aria-label={`Cosine similarity of the example queries. Against text vectors the median is ${examples.text.p50.toFixed(2)}; against audio vectors it is ${examples.audio.p50.toFixed(2)}.`}
        className="h-auto w-full overflow-visible"
      >
        <path d={path(examples.audio.counts, true)} fill={AUDIO_COLOR} fillOpacity={0.14} />
        <path d={path(examples.text.counts, true)} fill={TEXT_COLOR} fillOpacity={0.14} />
        <path d={path(examples.audio.counts, false)} fill="none" stroke={AUDIO_COLOR} strokeWidth={1.75} strokeLinejoin="round" />
        <path d={path(examples.text.counts, false)} fill="none" stroke={TEXT_COLOR} strokeWidth={1.75} strokeLinejoin="round" />
        <line x1={0} y1={PLOT_H} x2={W} y2={PLOT_H} stroke="var(--color-input)" />
        {[0.3, 0.4, 0.5, 0.6, 0.7, 0.8].map((tick) => (
          <text key={tick} x={x(tick)} y={110} textAnchor="middle" className="fill-muted-foreground font-mono text-[10px]">
            {tick.toFixed(1)}
          </text>
        ))}
        {[textMedian, audioMedian].map((median, i) => (
          <line key={i} x1={median} y1={10} x2={median} y2={PLOT_H} stroke="var(--color-foreground)" strokeDasharray="2 3" />
        ))}
        <SeriesLabel x={textLabel} color={TEXT_COLOR} label="Text" />
        <SeriesLabel x={audioLabel} color={AUDIO_COLOR} label="Audio" />
        <Interval y={125} label="text" color={TEXT_COLOR} p={examples.text} x={x} />
        <Interval y={141} label="audio" color={AUDIO_COLOR} p={examples.audio} x={x} />
      </svg>
      <p className="text-xs leading-[17px] text-muted-foreground">
        Cosine similarity of the {examples.queries.length} example queries against all text and audio vectors. Bars
        run p10 to p90; the dot is the median.
      </p>
    </figure>
  );
}

function SeriesLabel({ x, color, label }: { x: number; color: string; label: string }) {
  return (
    <>
      <rect x={x} y={1} width={8} height={8} rx={2} fill={color} />
      <text x={x + 12} y={8.5} className="fill-foreground text-[10.5px] font-medium">
        {label}
      </text>
    </>
  );
}

function Interval({
  y,
  label,
  color,
  p,
  x,
}: {
  y: number;
  label: string;
  color: string;
  p: { p10: number; p50: number; p90: number };
  x: (v: number) => number;
}) {
  return (
    <>
      <text x={0} y={y + 3} className="fill-muted-foreground text-[10px]">
        {label}
      </text>
      <line x1={x(p.p10)} y1={y} x2={x(p.p90)} y2={y} stroke={color} strokeWidth={3} strokeLinecap="round" />
      <circle cx={x(p.p50)} cy={y} r={4} fill={color} stroke="var(--color-card)" strokeWidth={2} />
    </>
  );
}
