"use client";

import { useQuery } from "@tanstack/react-query";
import { AudioLinesIcon } from "lucide-react";

import { DavidAiLogo } from "@/components/david-ai-logo";
import type { AudioSource, DurationRangeV1, FacetFiltersV1 } from "@/lib/api/v1/types";
import { cn } from "@/lib/utils";

import { SOURCE_LABEL, SOURCE_SWATCH_CLASS } from "./datasets";
import { DurationFilter } from "./duration-filter";
import { FacetFilters } from "./facet-filters";
import { datasetsQuery } from "./queries";

/** The speech datasets first, then the sound one. */
const FILTER_ORDER: readonly AudioSource[] = ["librispeech", "commonvoice", "audiocaps"];

/**
 * The left rail: the product, the dataset, length and metadata filters, and
 * how to search by sound. The filters apply to every view: browsing, text
 * search and sound search. Each dataset's count is of the clips of the chosen
 * length and metadata.
 */
export function Sidebar({
  source,
  onSourceChange,
  duration,
  onDurationChange,
  facets,
  onFacetsChange,
}: {
  source: AudioSource | null;
  onSourceChange: (source: AudioSource | null) => void;
  duration: DurationRangeV1;
  onDurationChange: (duration: DurationRangeV1) => void;
  facets: FacetFiltersV1;
  onFacetsChange: (facets: FacetFiltersV1) => void;
}) {
  const { data } = useQuery(datasetsQuery(duration, facets));
  const datasets = new Map(data?.data.map((dataset) => [dataset.source, dataset]));
  const total = data?.data.reduce((sum, dataset) => sum + dataset.count, 0);
  const lengths = data?.data.flatMap((dataset) => (dataset.durationSeconds ? [dataset.durationSeconds.max] : []));
  const longestSeconds = lengths && lengths.length > 0 ? Math.max(...lengths) : undefined;

  const items: { value: AudioSource | null; label: string; split?: string; swatch: string; count?: number }[] = [
    { value: null, label: "All", swatch: "bg-foreground", count: total },
    ...FILTER_ORDER.map((value) => ({
      value,
      label: SOURCE_LABEL[value],
      // Which split the catalog holds: a lab checks it against its own eval sets.
      split: datasets.get(value)?.split,
      swatch: SOURCE_SWATCH_CLASS[value],
      count: datasets.get(value)?.count,
    })),
  ];

  return (
    <nav
      aria-label="Catalog"
      className="flex w-60 shrink-0 flex-col gap-8 overflow-y-auto border-r bg-sidebar px-5 pt-7 pb-6"
    >
      <div className="flex flex-col gap-2.5">
        <DavidAiLogo className="h-6 w-auto self-start" />
        <p className="font-serif text-[22px] leading-7 tracking-[-0.3px]">Audio Search</p>
      </div>

      <div className="flex flex-col gap-2.5">
        <p id="datasets-label" className="text-xs font-medium text-muted-foreground">
          Search datasets
        </p>
        <div role="group" aria-labelledby="datasets-label" className="flex flex-col border-l border-input">
          {items.map((item) => {
            const active = item.value === source;
            return (
              <button
                key={item.label}
                type="button"
                aria-pressed={active}
                onClick={() => onSourceChange(item.value)}
                className={cn(
                  "-ml-px flex min-h-[34px] items-center py-1 gap-2.5 border-l-2 pr-1 pl-3.5 text-left text-sm font-medium outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                  active ? "border-foreground text-foreground" : "border-transparent text-muted-foreground",
                )}
              >
                <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-[2px]", item.swatch)} />
                <span className="flex min-w-0 flex-1 flex-col">
                  {item.label}
                  {item.split && (
                    <span className="text-[11.5px] leading-[14px] font-normal text-muted-foreground">
                      {item.split} split
                    </span>
                  )}
                </span>
                <span className="text-[0.8rem] font-normal text-muted-foreground tabular-nums">
                  {item.count?.toLocaleString()}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <DurationFilter duration={duration} longestSeconds={longestSeconds} onDurationChange={onDurationChange} />

      <FacetFilters source={source} duration={duration} facets={facets} onFacetsChange={onFacetsChange} />

      <div className="flex flex-col gap-2.5 rounded-[14px] border bg-background p-4">
        <p className="flex items-center gap-2 text-sm font-medium">
          <AudioLinesIcon aria-hidden="true" className="size-4" />
          Search by sound
        </p>
        <p className="text-[0.8rem] leading-[19px] text-muted-foreground">
          Record up to 30 s, drop any audio file on the page, or paste a link to one, to find the
          clips that sound like it.
        </p>
      </div>
    </nav>
  );
}
