"use client";

import { useQuery } from "@tanstack/react-query";
import { AudioLinesIcon } from "lucide-react";

import { DavidAiLogo } from "@/components/david-ai-logo";
import { AUDIO_SOURCES, type AudioSource } from "@/lib/api/v1/types";
import { cn } from "@/lib/utils";

import { SOURCE_LABEL, SOURCE_SWATCH_CLASS } from "./datasets";
import { datasetsQuery } from "./queries";

/**
 * The left rail: the product, the dataset filter, and how to search by sound.
 * The filter applies to every view: browsing, text search and sound search.
 */
export function Sidebar({
  source,
  onSourceChange,
}: {
  source: AudioSource | null;
  onSourceChange: (source: AudioSource | null) => void;
}) {
  const { data } = useQuery(datasetsQuery());
  const counts = new Map(data?.data.map((dataset) => [dataset.source, dataset.count]));
  const total = data?.data.reduce((sum, dataset) => sum + dataset.count, 0);

  const items: { value: AudioSource | null; label: string; swatch: string; count?: number }[] = [
    { value: null, label: "All clips", swatch: "bg-foreground", count: total },
    ...AUDIO_SOURCES.map((value) => ({
      value,
      label: SOURCE_LABEL[value],
      swatch: SOURCE_SWATCH_CLASS[value],
      count: counts.get(value),
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
          Datasets
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
                  "-ml-px flex h-[34px] items-center gap-2.5 border-l-2 pr-1 pl-3.5 text-left text-sm font-medium outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                  active ? "border-foreground text-foreground" : "border-transparent text-muted-foreground",
                )}
              >
                <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-[2px]", item.swatch)} />
                <span className="flex-1">{item.label}</span>
                <span className="text-[0.8rem] font-normal text-muted-foreground tabular-nums">
                  {item.count?.toLocaleString()}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2.5 rounded-[14px] border bg-background p-4">
        <p className="flex items-center gap-2 text-sm font-medium">
          <AudioLinesIcon aria-hidden="true" className="size-4" />
          Search by sound
        </p>
        <p className="text-[0.8rem] leading-[19px] text-muted-foreground">
          Record up to 30 s, or drop any audio file on the page, to find the clips that sound like
          it.
        </p>
      </div>
    </nav>
  );
}
