# Embedding Map: design prompt and data

Everything a designer (or Claude Design) needs to design the "Embedding Map" view with the real
catalog, not mock data.

| File | What it is |
| --- | --- |
| [`PROMPT.md`](PROMPT.md) | The design prompt. Every number in it is in `summary.json`. |
| `points.json` | One entry per clip (3,329): text, captions, duration, the 64-bar waveform, its position on the audio map and on the text map, its 10 nearest neighbours (audio cosine), and the dataset's fields (AudioSet labels and sound family; book, chapter, speaker and sex; gender, age and accent). Compact JSON, ~4.5 MB. |
| `queries.json` | 5 example queries: where each lands on both maps, its real top 10 results from `GET /api/v1/search`, and the distribution of its cosine similarity against every text vector and every audio vector (p10/p50/p90 and a 20-bin histogram). |
| `summary.json` | The numbers the prompt quotes and the checks behind them, including how much of the 768-d structure the 2D maps keep. |

## How they were made

[`scripts/export-embedding-map.mts`](../../scripts/export-embedding-map.mts) regenerates all three
JSON files (`PROMPT.md` is written by hand from `summary.json`):

```bash
pnpm export-embedding-map                     # downloads the AudioSet labels (~100 MB, streamed)
pnpm export-embedding-map --labels <file>     # or reuses a JSON of shape { labels: { [clipId]: string[] } }
```

It needs `.env.local` (database and AI Gateway, see the root README) and takes about a minute.
Then `pnpm build-embedding-map` rebuilds `public/embedding-map.json`, the file the app's Map view
loads, from these files.

1. Reads every clip and both of its vectors from Neon, in read-only transactions. It never
   writes to the database or the Blob store.
2. Exact cosine nearest neighbours over the full catalog (the clip itself excluded).
3. UMAP to 2D (`umap-js`, cosine distance, 15 neighbours, `minDist` 0.1, seed 42, exact kNN),
   once on the audio vectors and once on the text vectors. Each map is scaled into [0, 1] with
   the same scale on both axes. The same data and seed give the same maps.
4. AudioSet labels for the AudioCaps clips (matched on YouTube id and start second). The sound
   family is the first of Vehicles, Animals, Water & weather, Human sounds, Tools & machines
   whose pattern matches one of the clip's labels (the patterns are in the script and in
   `summary.json`); anything else is "Household & other".
5. Embeds the 5 queries through the AI Gateway (one request, as the app does), places them on
   the maps with UMAP `transform`, and fetches their results from the production search API.

The files hold ids, text, labels and numbers only: no audio, no Blob paths and no Common
Voice contributor ids. `summary.json`'s `fromEvaluation` numbers are quoted from
the retrieval evaluation, not recomputed.

## Licenses

- LibriSpeech transcripts and metadata: CC BY 4.0 ([OpenSLR 12](https://www.openslr.org/12))
- AudioCaps captions: MIT ([AudioCaps](https://github.com/cdjkim/audiocaps)); the audio itself is not here
- Common Voice sentences and demographics: CC0 ([Mozilla Common Voice](https://commonvoice.mozilla.org))
- AudioSet labels: CC BY 4.0 (Google, [AudioSet](https://research.google.com/audioset/))
