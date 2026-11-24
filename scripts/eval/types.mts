import type { Relevance } from "./metrics.mts";

export type QuerySet = "caption" | "fragment" | "paraphrase" | "concept" | "example" | "speaker" | "negative";

export type EvalQuery =
  | {
      id: string;
      set: QuerySet;
      kind: "text";
      text: string;
      relevant: Relevance;
      /** The clip whose index must not contain this query (its own caption). */
      heldOut?: { id: string; captions: string[] };
      notes?: Record<string, unknown>;
    }
  | { id: string; set: QuerySet; kind: "example"; exampleId: string; relevant: Relevance };

export type QueryFile = {
  generatedAt: string;
  seed: number;
  paraphraseModel: string;
  catalogSize: number;
  counts: Record<string, number>;
  queries: EvalQuery[];
};
