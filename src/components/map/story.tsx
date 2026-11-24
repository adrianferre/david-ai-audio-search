"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { IconButton } from "@/components/ui/icon-button";
import type { EmbeddingMapV1 } from "@/lib/embedding-map/types";
import { cn } from "@/lib/utils";

import type { ColourBy } from "./colouring";
import { AUDIO_COLOR, TEXT_COLOR } from "./modality-gap-chart";

export const STORY_STEPS = [
  "Speech and sounds",
  "Sound families",
  "Speech content",
  "Modality gap",
  "Where a query lands",
] as const;

const pct = (value: number) => `${Number(value.toFixed(1))}%`;
const whole = (value: number) => `${Math.round(value)}%`;
const two = (value: number) => value.toFixed(2);

/**
 * What the map shows, in five steps. Stepping sets the map up for the step
 * (colouring, zoom, an example search); every number is measured on the
 * 768-d vectors and comes with the map's data.
 */
export function Story({
  step,
  onStep,
  colourBy,
  onColourBy,
  data,
  activeQuery,
  onTryQuery,
}: {
  step: number;
  onStep: (step: number) => void;
  colourBy: ColourBy;
  onColourBy: (by: ColourBy) => void;
  data: EmbeddingMapV1;
  activeQuery: string | null;
  onTryQuery: (query: string) => void;
}) {
  const { stats } = data;
  const evaluation = data.modalityGap.evaluation;

  return (
    <section aria-label="What the map shows" className="flex flex-col gap-3 rounded-[14px] border border-hairline bg-background p-4">
      <div className="flex items-center gap-1">
        <span className="text-xs font-medium text-muted-foreground">What the map shows</span>
        <span className="ml-auto font-mono text-xs tabular-nums">{step + 1} of {STORY_STEPS.length}</span>
        <IconButton label="Previous step" variant="ghost" size="icon-sm" disabled={step === 0} onClick={() => onStep(step - 1)}>
          <ChevronLeftIcon />
        </IconButton>
        <IconButton
          label="Next step"
          variant="ghost"
          size="icon-sm"
          disabled={step === STORY_STEPS.length - 1}
          onClick={() => onStep(step + 1)}
        >
          <ChevronRightIcon />
        </IconButton>
      </div>

      {step === 0 && (
        <Card title="Speech and sounds live in different regions.">
          <Lead>The audio map of every clip, coloured by dataset. Share of a clip’s 10 nearest neighbours from its own dataset:</Lead>
          <Figures
            rows={[
              [pct(stats.sameDatasetNeighbors.librispeech), "LibriSpeech"],
              [pct(stats.sameDatasetNeighbors.audiocaps), "AudioCaps"],
              [whole(stats.sameDatasetNeighbors.commonvoice), "Common Voice. It blends into the speech region, because it is speech too."],
            ]}
          />
        </Card>
      )}

      {step === 1 && (
        <Card title="Sounds cluster by what they are.">
          <Lead>AudioCaps, coloured by a sound family drawn from its AudioSet labels.</Lead>
          <Figures
            rows={[
              [whole(stats.soundFamily.agreement), `of a sound’s neighbours share its family (chance ${whole(stats.soundFamily.chance)})`],
              [
                pct(stats.hasSpeech.withSpeech),
                `of the neighbours of clips that also have speech are speech, vs ${pct(stats.hasSpeech.withoutSpeech)} without. Turn on Has speech to see them.`,
              ],
            ]}
          />
        </Card>
      )}

      {step === 2 && (
        <Card title="Speech clusters by what is said, not by who says it.">
          <div role="group" aria-label="Colour LibriSpeech by" className="flex gap-0.5 self-start rounded-full bg-accent p-[3px]">
            {(
              [
                ["book", "Book"],
                ["speaker", "Speaker"],
                ["sex", "Sex"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={colourBy === value}
                onClick={() => onColourBy(value)}
                className={cn(
                  "h-[28px] rounded-full px-3 text-[0.8rem] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                  colourBy === value && "bg-card text-foreground shadow-[0_1px_2px_rgba(26,26,25,0.08)]",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <table className="w-full border-collapse text-[0.8rem]">
            <thead>
              <tr className="text-[11.5px] text-muted-foreground">
                <th className="pb-1.5 text-left font-normal">Share of 10 nearest neighbours</th>
                <th className="w-12 pb-1.5 text-right font-normal">audio</th>
                <th className="w-12 pb-1.5 text-right font-normal">text</th>
              </tr>
            </thead>
            <tbody>
              <Row label="Same chapter" audio={pct(stats.librispeech.sameChapter.audio)} text={pct(stats.librispeech.sameChapter.text)} />
              <Row
                label="Same speaker, another chapter"
                audio={pct(stats.librispeech.sameSpeakerOtherChapter.audio)}
                text={pct(stats.librispeech.sameSpeakerOtherChapter.text)}
              />
              <Row
                label="Same sex, other speakers"
                note={`chance ${whole(stats.librispeech.sameSexOtherSpeakers.chance)}`}
                audio={whole(stats.librispeech.sameSexOtherSpeakers.audio)}
                text={whole(stats.librispeech.sameSexOtherSpeakers.text)}
              />
              <Row
                label="Common Voice, same gender"
                note={`chance ${whole(stats.commonvoiceSameGender.chance)}`}
                audio={whole(stats.commonvoiceSameGender.audio)}
                text={whole(stats.commonvoiceSameGender.text)}
              />
            </tbody>
          </table>
          <p className="text-[0.8rem] leading-[19px]">
            The audio vector mostly encodes content: “Find similar sound” on speech finds similar words, not similar
            voices. Speaker search would need a speaker-embedding model.
          </p>
        </Card>
      )}

      {step === 3 && (
        <Card title="Text and audio vectors don’t sit on the same scale.">
          <Lead>
            The modality gap: a text query is closer to every text vector than to most audio vectors. Its cosine
            similarity against every clip, p10 / p50 / p90, from the retrieval evaluation:
          </Lead>
          <ul className="flex flex-col text-[0.8rem]">
            {[
              { label: "Against text vectors", color: TEXT_COLOR, p: evaluation.text },
              { label: "Against audio vectors", color: AUDIO_COLOR, p: evaluation.audio },
            ].map(({ label, color, p }) => (
              <li key={label} className="grid grid-cols-[8px_minmax(0,1fr)_auto] items-center gap-2 border-t border-hairline py-[7px]">
                <span className="size-2 rounded-[2px]" style={{ background: color }} />
                {label}
                <span className="font-mono tabular-nums">
                  {two(p.p10)} / {two(p.p50)} / {two(p.p90)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[0.8rem] leading-[19px]">
            That’s why search turns each signal into a z-score before combining them. The chart below shows the gap.
          </p>
        </Card>
      )}

      {step === 4 && (
        <Card title="Where does a query land?">
          <Lead>
            Search with the bar above. The star is the query, lines join it to its top 10, and every clip under the
            z ≥ 3 cut-off is dimmed. In Sound mode only the audio map applies.
          </Lead>
          <div className="flex flex-wrap gap-1.5">
            {data.examples.map(({ query, precisionAt10 }) => (
              <button
                key={query}
                type="button"
                aria-pressed={activeQuery === query}
                onClick={() => onTryQuery(query)}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-full border border-input bg-card px-2.5 text-[0.8rem] font-medium outline-none hover:bg-row-hover focus-visible:ring-3 focus-visible:ring-ring/50",
                  activeQuery === query && "border-foreground bg-foreground text-background hover:bg-foreground",
                )}
              >
                {query}
                {precisionAt10 !== null && (
                  <span className={cn("font-mono text-[11px] tabular-nums", activeQuery === query ? "text-input" : "text-muted-foreground")}>
                    {Math.round(precisionAt10 * 100)}%
                  </span>
                )}
              </button>
            ))}
          </div>
          <p className="text-xs leading-[17px] text-muted-foreground">
            Percentages are precision@10 from the retrieval evaluation. The star sits at the score-weighted centre of
            the top 10.
          </p>
        </Card>
      )}

      <div className="flex items-center gap-1.5">
        {STORY_STEPS.map((title, i) => (
          <button
            key={title}
            type="button"
            aria-label={`Step ${i + 1}: ${title}`}
            aria-current={step === i ? "step" : undefined}
            onClick={() => onStep(i)}
            className={cn(
              "h-2 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              step === i ? "w-5 bg-foreground" : "w-2 bg-input hover:bg-muted-foreground",
            )}
          />
        ))}
      </div>
    </section>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <h2 className="font-serif text-[19px] leading-[25px] font-medium tracking-[-0.2px]">{title}</h2>
      {children}
    </div>
  );
}

function Lead({ children }: { children: ReactNode }) {
  return <p className="text-[0.8rem] leading-[19px] text-muted-foreground">{children}</p>;
}

function Figures({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="flex flex-col">
      {rows.map(([figure, label]) => (
        <div key={label} className="grid grid-cols-[58px_minmax(0,1fr)] items-baseline gap-2.5 border-t border-hairline py-[7px]">
          <dt className="font-mono text-lg tabular-nums">{figure}</dt>
          <dd className="text-[0.8rem] leading-[17px]">{label}</dd>
        </div>
      ))}
    </dl>
  );
}

function Row({ label, note, audio, text }: { label: string; note?: string; audio: string; text: string }) {
  return (
    <tr className="border-t border-hairline">
      <td className="py-[7px]">
        {label} {note && <span className="text-muted-foreground">({note})</span>}
      </td>
      <td className="py-[7px] text-right font-mono tabular-nums">{audio}</td>
      <td className="py-[7px] text-right font-mono tabular-nums">{text}</td>
    </tr>
  );
}
