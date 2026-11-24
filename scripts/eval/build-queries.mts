/**
 * Builds eval/queries.json: the query sets and their relevance judgments.
 *
 *   node --env-file=.env.local scripts/eval/build-queries.mts
 *
 * The ground truth comes from the datasets, not from the search system:
 *  - caption:     each AudioCaps caption is a query for its own clip. The eval
 *                 holds that caption out of the clip's index (see run.mts).
 *  - fragment:    a 4-7 word span of a LibriSpeech / Common Voice transcript; every
 *                 clip whose transcript contains it is relevant.
 *  - paraphrase:  an LLM rewrite of a transcript that avoids its words (the
 *                 "question about pricing" kind of query); the source clip is relevant.
 *  - concept:     an AudioSet label name ("dog", "rain"); clips with that label are relevant.
 *  - example:     an AudioCaps clip as the query (search by example); clips sharing
 *                 a sound label are relevant, graded by label overlap.
 *  - speaker:     a LibriSpeech clip as the query; clips by the same speaker are
 *                 relevant. A diagnostic: what "Find similar" does on speech.
 *  - negative:    queries with no answer in the catalog (checked against every
 *                 transcript, caption and label below).
 *
 * Read-only on the database. The paraphrases call an LLM through the AI Gateway
 * (a few cents); the output is committed so the sets don't change between runs.
 */
import { writeFile } from "node:fs/promises";

import { neon } from "@neondatabase/serverless";
import { generateText, Output } from "ai";
import { z } from "zod";

import { seededRandom } from "./metrics.mts";
import type { EvalQuery, QueryFile } from "./types.mts";

const SEED = 20261124;
const PARAPHRASE_MODEL = "anthropic/claude-sonnet-5.5";
const COUNTS = { fragmentLibri: 150, fragmentCv: 100, paraphraseLibri: 80, paraphraseCv: 50, speaker: 300 };

const LABELS_FILE = new URL("../../eval/data/audioset-labels.json", import.meta.url);
const OUT = new URL("../../eval/queries.json", import.meta.url);

/** Labels about speech or the recording place: not sounds a user searches for. */
const NON_SOUND_LABEL = /speech|speaking|conversation|narration|babbling|^inside,|^outside,|silence/i;

const NEGATIVES: { text: string; absentWords: string[] }[] = [
  { text: "customer asking for a refund", absentWords: ["refund", "refunds", "customer"] },
  { text: "how do I reset my password", absentWords: ["password", "passwords"] },
  { text: "quarterly earnings call", absentWords: ["earnings", "quarterly", "revenue"] },
  { text: "podcast about cryptocurrency", absentWords: ["podcast", "crypto", "cryptocurrency", "bitcoin"] },
  { text: "vacuum cleaner running", absentWords: ["vacuum", "hoover"] },
  { text: "skateboard rolling on concrete", absentWords: ["skateboard", "skateboarding", "skate"] },
  { text: "zipper being pulled", absentWords: ["zip", "zipper", "zips"] },
  { text: "drum solo", absentWords: ["drum", "drums", "drummer", "drumming"] },
  { text: "electric toothbrush buzzing", absentWords: ["toothbrush"] },
  { text: "someone tap dancing", absentWords: ["tap dancing", "tap dance", "tap dancer"] },
  { text: "dial-up modem connecting", absentWords: ["modem", "dial-up"] },
];

/** Sound queries from the brief, mapped to the AudioSet labels that answer them. */
const BRIEF_CONCEPTS: { text: string; labels: string[] }[] = [
  { text: "dog barking", labels: ["Dog", "Bark", "Bow-wow", "Yip"] },
  { text: "coughing", labels: ["Cough"] },
  { text: "someone sneezing", labels: ["Sneeze"] },
  { text: "baby crying", labels: ["Baby cry, infant cry"] },
  { text: "people laughing", labels: ["Laughter", "Baby laughter", "Giggle", "Chuckle, chortle", "Belly laugh"] },
];

const sql = neon(process.env.DATABASE_URL ?? "");
const random = seededRandom(SEED);

function sample<T>(items: readonly T[], count: number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

/** Lower case, punctuation to spaces, single spaces: how fragments are matched. */
function normalize(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

type Row = {
  id: string;
  source: "librispeech" | "audiocaps" | "commonvoice";
  transcript: string | null;
  captions: string[] | null;
  speaker: string | null;
  chapter: string | null;
};

const [rows] = (await sql.transaction(
  [
    sql`SELECT id, source, metadata->>'transcript' AS transcript, metadata->'captions' AS captions,
               coalesce(metadata->'speaker'->>'id', metadata->'speaker'->>'clientId') AS speaker,
               metadata->'chapter'->>'id' AS chapter
        FROM audios ORDER BY id`,
  ],
  { readOnly: true },
)) as Row[][];

const labelFile = JSON.parse(await (await import("node:fs/promises")).readFile(LABELS_FILE, "utf8")) as {
  labels: Record<string, string[]>;
};
const labels = labelFile.labels;
const soundLabels = (id: string) => (labels[id] ?? []).filter((l) => !NON_SOUND_LABEL.test(l));

const speech = rows.filter((r) => r.transcript);
const normalizedTranscripts = speech.map((r) => [r.id, normalize(r.transcript ?? "")] as const);
const queries: EvalQuery[] = [];

// --- negative: nothing in the catalog answers these (checked first: it is cheap) ---
const everyText = rows.map((r) => (r.transcript ?? (r.captions ?? []).join(" ")).toLowerCase());
const everyLabel = Object.values(labels).flat().map((l) => l.toLowerCase());
for (const { text, absentWords } of NEGATIVES) {
  const pattern = new RegExp(`\\b(${absentWords.join("|")})\\b`, "i");
  const hit = [...everyText, ...everyLabel].find((t) => pattern.test(t));
  if (hit) throw new Error(`Negative query "${text}" is answered in the catalog: "${hit.slice(0, 120)}"`);
  queries.push({ id: `negative:${text}`, set: "negative", kind: "text", text, relevant: {} });
}


// --- caption: every caption of every AudioCaps clip ---------------------------
for (const row of rows.filter((r) => r.source === "audiocaps")) {
  (row.captions ?? []).forEach((caption, i) => {
    queries.push({
      id: `caption:${row.id}:${i}`,
      set: "caption",
      kind: "text",
      text: caption,
      relevant: { [row.id]: 1 },
      heldOut: { id: row.id, captions: (row.captions ?? []).filter((_, j) => j !== i) },
    });
  });
}

// --- fragment: a contiguous span of a transcript ------------------------------
function fragmentOf(transcript: string): string | null {
  const words = transcript.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
  const length = 4 + Math.floor(random() * 4);
  if (words.length < length + 2) return null;
  const start = Math.floor(random() * (words.length - length + 1));
  return words.slice(start, start + length).join(" ");
}
for (const [source, count] of [
  ["librispeech", COUNTS.fragmentLibri],
  ["commonvoice", COUNTS.fragmentCv],
] as const) {
  const pool = sample(
    speech.filter((r) => r.source === source),
    speech.length,
  );
  let added = 0;
  for (const row of pool) {
    if (added === count) break;
    const fragment = fragmentOf(row.transcript ?? "");
    if (!fragment) continue;
    const needle = normalize(fragment);
    const relevant = Object.fromEntries(
      normalizedTranscripts.filter(([, text]) => text.includes(needle)).map(([id]) => [id, 1]),
    );
    queries.push({ id: `fragment:${row.id}`, set: "fragment", kind: "text", text: fragment, relevant });
    added++;
  }
}

// --- paraphrase: an LLM rewrite of a transcript --------------------------------
const paraphraseSources = [
  ...sample(
    speech.filter((r) => r.source === "librispeech" && (r.transcript ?? "").split(/\s+/).length >= 10),
    COUNTS.paraphraseLibri,
  ),
  ...sample(
    speech.filter((r) => r.source === "commonvoice" && (r.transcript ?? "").split(/\s+/).length >= 6),
    COUNTS.paraphraseCv,
  ),
];

const STOPWORDS = new Set(
  "a an the and or but of to in on at for with by from as is are was were be been it its this that these those i you he she we they me him her us them my your his our their not no so do did does have has had will would can could should what which who whom how when where why there here than then into out up down over about".split(
    " ",
  ),
);
const contentWords = (text: string) =>
  new Set(
    normalize(text)
      .trim()
      .split(" ")
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
      .map((w) => w.replace(/(ing|ed|es|s)$/, "")),
  );

const paraphraseSchema = z.object({
  queries: z.array(z.object({ n: z.number().int(), query: z.string() })),
});
for (let batchStart = 0; batchStart < paraphraseSources.length; batchStart += 10) {
  const batch = paraphraseSources.slice(batchStart, batchStart + 10);
  const { output } = await generateText({
    model: PARAPHRASE_MODEL,
    maxRetries: 3,
    output: Output.object({ schema: paraphraseSchema }),
    prompt: `You write search queries for an evaluation of a spoken-audio search engine.
For each numbered transcript, write the query a person would type to find that recording
when they remember what it was ABOUT but not its words: 3 to 10 words, lower case,
no quotes. Describe the meaning or topic. Do NOT reuse any noun, verb or adjective from
the transcript (use synonyms or a description instead); names may not be reused either.

${batch.map((row, i) => `${i + 1}. ${row.transcript?.toLowerCase()}`).join("\n")}

Return one query per transcript, with n set to the transcript's number.`,
  });
  for (const { n, query } of output.queries) {
    const row = batch[n - 1];
    if (!row) continue;
    const source = contentWords(row.transcript ?? "");
    const shared = [...contentWords(query)].filter((w) => source.has(w));
    queries.push({
      id: `paraphrase:${row.id}`,
      set: "paraphrase",
      kind: "text",
      text: query,
      relevant: { [row.id]: 1 },
      notes: { transcript: row.transcript, sharedWords: shared },
    });
  }
  console.log(`paraphrases ${Math.min(batchStart + 10, paraphraseSources.length)}/${paraphraseSources.length}`);
}

// --- concept: AudioSet label names and the brief's sound queries ---------------
const labelCounts = new Map<string, number>();
for (const id of Object.keys(labels)) for (const l of soundLabels(id)) labelCounts.set(l, (labelCounts.get(l) ?? 0) + 1);
const conceptQueries = new Map<string, string[]>();
for (const [label, count] of labelCounts) {
  if (count < 3) continue;
  const text = label.split(",")[0].replace(/\(.*?\)/g, "").trim().toLowerCase();
  conceptQueries.set(text, [...(conceptQueries.get(text) ?? []), label]);
}
for (const { text, labels: wanted } of BRIEF_CONCEPTS) conceptQueries.set(text, wanted);
for (const [text, wanted] of [...conceptQueries].sort(([a], [b]) => (a < b ? -1 : 1))) {
  const relevant = Object.fromEntries(
    Object.keys(labels)
      .filter((id) => soundLabels(id).some((l) => wanted.includes(l)))
      .map((id) => [id, 1]),
  );
  if (Object.keys(relevant).length === 0) continue;
  queries.push({ id: `concept:${text}`, set: "concept", kind: "text", text, relevant, notes: { labels: wanted } });
}

// --- example: an AudioCaps clip as the query (search by example) --------------
for (const id of Object.keys(labels).sort()) {
  const mine = new Set(soundLabels(id));
  if (mine.size === 0) continue;
  const relevant: Record<string, number> = {};
  for (const other of Object.keys(labels)) {
    if (other === id) continue;
    const theirs = new Set(soundLabels(other));
    const shared = [...mine].filter((l) => theirs.has(l)).length;
    if (shared > 0) relevant[other] = shared / new Set([...mine, ...theirs]).size;
  }
  if (Object.keys(relevant).length === 0) continue;
  queries.push({ id: `example:${id}`, set: "example", kind: "example", exampleId: id, relevant });
}

// --- speaker: a LibriSpeech clip as the query ----------------------------------
for (const row of sample(
  rows.filter((r) => r.source === "librispeech"),
  COUNTS.speaker,
)) {
  const relevant = Object.fromEntries(
    rows.filter((r) => r.source === "librispeech" && r.speaker === row.speaker && r.id !== row.id).map((r) => [r.id, 1]),
  );
  queries.push({ id: `speaker:${row.id}`, set: "speaker", kind: "example", exampleId: row.id, relevant });
}

const file: QueryFile = {
  generatedAt: new Date().toISOString(),
  seed: SEED,
  paraphraseModel: PARAPHRASE_MODEL,
  catalogSize: rows.length,
  counts: Object.fromEntries(
    [...new Set(queries.map((q) => q.set))].map((set) => [set, queries.filter((q) => q.set === set).length]),
  ),
  queries,
};
await writeFile(OUT, `${JSON.stringify(file, null, 1)}\n`);
console.log("Wrote eval/queries.json", file.counts);
