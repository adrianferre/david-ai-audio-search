/** Renders eval/results.json as eval/report.md. Called by run.mts. */

/* eslint-disable @typescript-eslint/no-explicit-any -- the results object is plain JSON built in run.mts */
type Results = Record<string, any>;
type Interval = { mean: number; low: number; high: number };

const pct = (x: number) => (Number.isFinite(x) ? `${(100 * x).toFixed(1)}` : "–");
const ci = (i: Interval) => `${pct(i.mean)} <sub>[${pct(i.low)}–${pct(i.high)}]</sub>`;
const num = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "–");
const diff = (i: Interval) => {
  const sign = (x: number) => `${x >= 0 ? "+" : ""}${(100 * x).toFixed(1)}`;
  const mark = i.low > 0 ? " ▲" : i.high < 0 ? " ▼" : "";
  return `${sign(i.mean)}${mark} <sub>[${sign(i.low)}, ${sign(i.high)}]</sub>`;
};
const table = (head: string[], rows: string[][]) =>
  [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");

const SET_LABEL: Record<string, string> = {
  caption: "Caption → sound clip (AudioCaps, held-out caption)",
  fragment: "Transcript fragment → speech clip",
  paraphrase: "Paraphrase → speech clip",
  concept: "Sound concept → labelled clips (AudioSet label)",
  example: "Clip → clips with a shared sound label",
  speaker: "LibriSpeech clip → same speaker",
  negative: "No answer in the catalog",
};

export function renderReport(r: Results): string {
  const out: string[] = [];
  const counts = Object.entries(r.queryCounts as Record<string, number>).map(([k, v]) => `${v} ${k}`).join(", ");
  out.push(
    `# Retrieval evaluation`,
    ``,
    `Generated ${r.generatedAt} by \`pnpm eval\` (scripts/eval/run.mts). Do not edit by hand.`,
    ``,
    `Catalog: ${Object.entries(r.catalog).map(([k, v]) => `${v} ${k}`).join(", ")}. Model \`${r.model}\`. Ranking: cut-off z ≥ ${r.ranking.minZ}, exact-words bonus ${r.ranking.exactWordsBonus}, limit ${r.ranking.limit}.`,
    `Queries: ${counts}. Method and caveats: [eval/README.md](README.md).`,
    ``,
    `Numbers are percentages, mean over queries, with a 95% bootstrap interval in brackets. R@K = a relevant clip in the top K.`,
    ``,
  );

  if (r.live) {
    const p = r.live.parity;
    out.push(
      `**Parity with the live API:** ${p.queries} text queries, top-10 overlap ${pct(p.top10Overlap)}%, identical lists ${p.identicalLists}/${p.queries}, max score difference ${num(p.maxScoreDiff, 4)}; /similar identical ${p.similarIdentical}/${p.similarChecked}.`,
      ``,
    );
  } else {
    out.push(`**Parity with the live API:** skipped (--skip-live).`, ``);
  }

  out.push(`## 1. Production search, by query set`, ``);
  const prodRows = Object.entries(r.byGroup as Record<string, any>)
    .filter(([, systems]) => systems.production)
    .map(([group, systems]) => {
      const m = systems.production;
      return [group, `${m.n}`, ci(m["R@1"]), ci(m["R@5"]), ci(m["R@10"]), ci(m.MRR), ci(m["nDCG@10"]), num(m.returnedMean, 1), pct(m.emptyShare)];
    });
  out.push(table(["Set", "n", "R@1", "R@5", "R@10", "MRR", "nDCG@10", "Results returned", "% empty"], prodRows), ``);

  out.push(`## 2. Ranking variants vs production (paired difference, nDCG@10 and R@10)`, ``);
  out.push(`▲/▼: the 95% interval of the difference excludes zero.`, ``);
  const systems = (r.systems as { name: string; description: string }[]).filter((s) => s.name !== "production");
  const sets = Object.keys(r.comparisons);
  out.push(
    table(
      ["Variant", ...sets.flatMap((s) => [`${s} ΔnDCG`, `${s} ΔR@10`])],
      systems.map((s) => [s.name, ...sets.flatMap((set) => [diff(r.comparisons[set][s.name].nDCG), diff(r.comparisons[set][s.name].R10)])]),
    ),
    ``,
    ...systems.map((s) => `- **${s.name}**: ${s.description}`),
    ``,
  );

  out.push(`Absolute nDCG@10 / R@10 by variant:`, ``);
  const allSystems = r.systems as { name: string }[];
  out.push(
    table(
      ["Variant", ...sets],
      allSystems.map((s) => [s.name, ...sets.map((set) => `${pct(r.bySet[set][s.name]["nDCG@10"].mean)} / ${pct(r.bySet[set][s.name]["R@10"].mean)}`)]),
    ),
    ``,
  );

  const brief = ["dog barking", "coughing", "someone sneezing", "baby crying", "people laughing"];
  out.push(`The brief's sound queries (relevant = clips with the matching AudioSet label):`, ``);
  out.push(
    table(
      ["Query", "Relevant clips", "Production P@10", "Production nDCG@10", "Sound only P@10", "Sound only nDCG@10"],
      (r.concepts as any[]).filter((c) => brief.includes(c.query)).map((c) => [c.query, `${c.relevant}`, pct(c.production["P@10"]), pct(c.production["nDCG@10"]), pct(c.sound["P@10"]), pct(c.sound["nDCG@10"])]),
    ),
    ``,
  );

  out.push(`## 3. The cut-off: threshold sweep`, ``);
  const sweepSets = ["caption", "fragment", "paraphrase", "concept", "negative"].filter((s) => r.sweep[s]);
  out.push(
    table(
      ["min z", ...sweepSets.map((s) => (s === "negative" ? "negative: results / % empty" : `${s} R@10 / results`))],
      (r.sweep[sweepSets[0]] as any[]).map((_, i) => [
        num(r.sweep[sweepSets[0]][i].minZ, 1),
        ...sweepSets.map((s) => {
          const row = r.sweep[s][i];
          return s === "negative" ? `${num(row.returned, 1)} / ${pct(row.empty)}` : `${pct(row.recall10)} / ${num(row.returned, 1)}`;
        }),
      ]),
    ),
    ``,
    `Answerability: AUC of the top result's score for queries with vs without an answer = **${num(r.answerability.auc, 3)}** (1 = the top score alone tells them apart). Top score p10/p50/p90: with an answer ${num(r.answerability.positive.p10)}/${num(r.answerability.positive.p50)}/${num(r.answerability.positive.p90)}, without ${num(r.answerability.negative.p10)}/${num(r.answerability.negative.p50)}/${num(r.answerability.negative.p90)}.`,
    ``,
    table(
      ["Negative query", "Results", "Top score", "Top results"],
      (r.negatives as any[]).map((n) => [n.query, `${n.returned}`, num(n.topScore), n.top.map((t: any) => `${t.snippet.slice(0, 50)} (${t.score}, ${t.matches})`).join("<br>")]),
    ),
    ``,
  );

  out.push(`## 4. Against published CLAP results (AudioCaps text → audio)`, ``);
  const clapRows = Object.entries(r.clap as Record<string, any>).map(([name, m]) => [`This catalog, ${name}`, ci(m["R@1"]), ci(m["R@5"]), ci(m["R@10"]), ci(m["mAP@10"])]);
  out.push(
    table(["System", "R@1", "R@5", "R@10", "mAP@10"], [
      ...clapRows,
      ["LAION-CLAP HTSAT-RoBERTa (AudioCaps test) ¹", "36.7", "70.9", "83.2", "51.3 ²"],
      ["Microsoft CLAP 2023 (AudioCaps) ³", "35.6", "–", "–", "51.0"],
    ]),
    ``,
    `Not like for like: a different pool (426 val clips, plus 2,903 speech clips in the full catalog), a different model, and CLAP was trained on AudioCaps. Gemini embeddings are general-purpose. Sources: ¹ arXiv 2211.06687 v4, Table 3; ² Table 2 (AudioCaps+Clotho training); ³ arXiv 2309.05767 v2, Table 2.`,
    ``,
  );

  out.push(`## 5. Search by example (audio → audio)`, ``);
  out.push(
    table(
      ["Set", "n", "R@1", "P@10", "mAP@10", "nDCG@10", "Chance P@10"],
      ["example", "speaker"].filter((s) => r.bySet[s]).map((s) => {
        const m = r.bySet[s]["audio nearest neighbours"];
        return [SET_LABEL[s], `${m.n}`, ci(m["R@1"]), ci(m["P@10"]), ci(m["mAP@10"]), ci(m["nDCG@10"]), pct(r.example.chanceP10[s])];
      }),
    ),
    ``,
  );

  const d = r.diagnostics;
  out.push(
    `## 6. Diagnostics for the README's claims`,
    ``,
    `- Raw cosine, text query vs text vectors: p10/p50/p90 = ${num(d.textCosine.p10, 3)}/${num(d.textCosine.p50, 3)}/${num(d.textCosine.p90, 3)}; text query vs audio vectors: ${num(d.soundCosine.p10, 3)}/${num(d.soundCosine.p50, 3)}/${num(d.soundCosine.p90, 3)}.`,
    `- Speech clips in the sound-only top 10 for sound-concept queries: ${pct(d.speechShareInSoundOnlyTop10ForSoundConcepts)}% (speech is ${pct(d.speechShareOfCatalog)}% of the catalog).`,
    `- Paraphrases that share no content word with their transcript (n = ${d.paraphraseNoSharedWords.n}): production R@10 ${ci(d.paraphraseNoSharedWords.production["R@10"])}, MRR ${ci(d.paraphraseNoSharedWords.production.MRR)}.`,
    `- Database time (EXPLAIN ANALYZE, exact scan of ${Object.values(r.catalog as Record<string, number>).reduce((a, b) => a + b, 0)} clips): /similar p50 ${num(r.database.similarMs.p50, 1)} ms (max ${num(r.database.similarMs.max, 1)}), text search p50 ${num(r.database.searchMs.p50, 1)} ms (max ${num(r.database.searchMs.max, 1)}).`,
    ``,
  );

  out.push(`## 7. Failures of production search (relevant clip not in the top 10)`, ``);
  out.push(
    table(
      ["Set", "Failures", "Cut off by z < 3", "Ranked below 10", "Not near the query"],
      Object.entries(r.failures.counts as Record<string, any>).map(([set, c]) => [set, `${c.total}`, `${c["cut off by z < 3"] ?? 0}`, `${c["ranked below 10"] ?? 0}`, `${c["not near the query"] ?? 0}`]),
    ),
    ``,
    `"Cut off": the clip is in the top 10 without the cut-off, but below z = 3. "Not near": not in the top 10 even without it. All cases are in results.json (\`failures.cases\`).`,
    ``,
    `Caption failures: ${pct(r.failures.captionTopSharesSoundLabel)}% have a top result with the same AudioSet sound label as the target (a plausible answer that known-item scoring counts as wrong); in ${pct(r.failures.captionSoundBeatsText)}% the target stands out more on sound than on text. ${r.failures.captionHardClips.clipsWithAFailure} clips fail at least one of their captions; ${r.failures.captionHardClips.clipsFailingAtLeast3Of5} fail 3 or more of 5.`,
    ``,
  );

  out.push(`## 8. Latency and cost`, ``);
  if (r.live) {
    out.push(
      table(
        ["Endpoint (client-side, from this machine)", "n", "p50 ms", "p95 ms", "errors"],
        Object.entries(r.live.latency as Record<string, any>).map(([k, v]) => [k, `${v.n}`, num(v.p50, 0), num(v.p95, 0), `${v.errors}`]),
      ),
      ``,
    );
  }
  const c = r.cost;
  out.push(
    `- Query embedding through the AI Gateway (2 vectors, one request): p50 ${num(c.queryEmbeddingMs.p50, 0)} ms, p95 ${num(c.queryEmbeddingMs.p95, 0)} ms.`,
    `- A text search embeds ${c.textSearchTokens} tokens: $${(c.textSearchUsd * 1e6).toFixed(2)} per million searches. A 10 s audio search embeds ${c.audioSearchTokensPer10s} tokens: $${(c.audioSearchUsdPer10s * 1000).toFixed(2)} per thousand. (Gateway list prices: ${JSON.stringify(c.pricing)}.)`,
    `- This run embedded ${c.evalRunEmbeddingTokens} new tokens.`,
    ``,
  );
  return out.join("\n");
}
