# Retrieval evaluation

Generated 2026-11-24T21:58:49.503Z by `pnpm eval` (scripts/eval/run.mts). Do not edit by hand.

Catalog: 426 audiocaps, 200 commonvoice, 2703 librispeech. Model `google/gemini-embedding-2`. Ranking: cut-off z ≥ 3 (typed sound next to text: 4), exact-words bonus 3 (+1.5 for the phrase as typed), results under 0.5 × the best dropped, strong match from 5, limit 50.
Queries: 11 negative, 2130 caption, 250 fragment, 130 paraphrase, 101 concept, 419 example, 300 speaker. Method and caveats: [eval/README.md](README.md).

Numbers are percentages, mean over queries, with a 95% bootstrap interval in brackets. R@K = a relevant clip in the top K.

**Parity with the live API:** 20 text queries, top-10 overlap 100.0%, identical lists 20/20, max score difference 0.0000; /similar identical 20/20.

## 1. Production search, by query set

| Set | n | R@1 | R@5 | R@10 | MRR | nDCG@10 | Results returned | % empty |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| negative | 11 | 0.0 <sub>[0.0–0.0]</sub> | 0.0 <sub>[0.0–0.0]</sub> | 0.0 <sub>[0.0–0.0]</sub> | 0.0 <sub>[0.0–0.0]</sub> | 0.0 <sub>[0.0–0.0]</sub> | 12.5 | 0.0 |
| caption | 2130 | 52.0 <sub>[50.0–54.1]</sub> | 82.0 <sub>[80.4–83.6]</sub> | 89.6 <sub>[88.3–90.9]</sub> | 64.9 <sub>[63.4–66.6]</sub> | 70.7 <sub>[69.3–72.2]</sub> | 23.8 | 0.0 |
| fragment · librispeech | 150 | 98.7 <sub>[96.7–100.0]</sub> | 100.0 <sub>[100.0–100.0]</sub> | 100.0 <sub>[100.0–100.0]</sub> | 99.3 <sub>[98.3–100.0]</sub> | 99.5 <sub>[98.8–100.0]</sub> | 2.4 | 0.0 |
| fragment · commonvoice | 100 | 100.0 <sub>[100.0–100.0]</sub> | 100.0 <sub>[100.0–100.0]</sub> | 100.0 <sub>[100.0–100.0]</sub> | 100.0 <sub>[100.0–100.0]</sub> | 100.0 <sub>[100.0–100.0]</sub> | 1.2 | 0.0 |
| paraphrase · librispeech | 80 | 95.0 <sub>[90.0–98.8]</sub> | 98.8 <sub>[96.3–100.0]</sub> | 98.8 <sub>[96.3–100.0]</sub> | 96.7 <sub>[92.9–99.4]</sub> | 97.2 <sub>[93.8–99.5]</sub> | 6.7 | 0.0 |
| paraphrase · commonvoice | 50 | 98.0 <sub>[94.0–100.0]</sub> | 100.0 <sub>[100.0–100.0]</sub> | 100.0 <sub>[100.0–100.0]</sub> | 98.5 <sub>[95.5–100.0]</sub> | 98.9 <sub>[96.6–100.0]</sub> | 3.2 | 0.0 |
| concept | 101 | 73.3 <sub>[64.4–81.2]</sub> | 95.0 <sub>[90.1–99.0]</sub> | 98.0 <sub>[95.0–100.0]</sub> | 83.4 <sub>[77.8–88.7]</sub> | 69.5 <sub>[64.6–74.7]</sub> | 14.7 | 0.0 |

Result lists: how many results each ranking returns, and the share of them that are relevant (precision of the whole list, over queries that return any). Recall can't see filler; this can. Caption queries have one relevant clip, so their precision is at most 1 / results.

| Ranking | caption: results / precision | fragment: results / precision | paraphrase: results / precision | concept: results / precision | negative: results |
| --- | --- | --- | --- | --- | --- |
| production | 23.8 / 11.3 | 1.9 / 84.7 | 5.3 / 39.0 | 14.7 / 54.4 | 12.5 |
| previous production | 47.2 / 2.1 | 11.1 / 17.8 | 16.4 / 8.4 | 37.4 / 19.6 | 21.8 |
| no relative cut-off | 40.3 / 2.7 | 8.7 / 23.5 | 12.5 / 11.1 | 28.7 / 26.6 | 12.5 |
| typed sound z ≥ 3 | 26.4 / 11.0 | 2.0 / 83.8 | 6.5 / 36.8 | 15.1 / 54.3 | 21.8 |
| no phrase bonus | 24.2 / 10.4 | 2.7 / 73.5 | 5.3 / 39.0 | 16.0 / 50.1 | 12.5 |
| production · sound | 30.5 / 1.6 | 4.0 / 41.0 | 6.7 / 32.5 | 20.2 / 15.7 | 11.9 |
| previous · sound | 30.8 / 1.6 | 5.7 / 26.5 | 9.5 / 16.5 | 20.4 / 15.5 | 11.9 |

## 2. Ranking variants vs production (paired difference, nDCG@10 and R@10)

▲/▼: the 95% interval of the difference excludes zero.

| Variant | caption ΔnDCG | caption ΔR@10 | fragment ΔnDCG | fragment ΔR@10 | paraphrase ΔnDCG | paraphrase ΔR@10 | concept ΔnDCG | concept ΔR@10 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| production · text | +0.1 <sub>[-0.1, +0.2]</sub> | +0.0 <sub>[-0.3, +0.4]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.1 <sub>[+0.0, +0.3]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.0 <sub>[-0.4, +0.3]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> |
| production · sound | -52.4 ▼ <sub>[-54.3, -50.6]</sub> | -57.2 ▼ <sub>[-59.5, -55.0]</sub> | -19.5 ▼ <sub>[-24.2, -15.4]</sub> | -13.2 ▼ <sub>[-17.6, -9.2]</sub> | -8.7 ▼ <sub>[-12.9, -4.9]</sub> | -4.6 ▼ <sub>[-8.5, -1.5]</sub> | -41.7 ▼ <sub>[-46.9, -36.3]</sub> | -20.8 ▼ <sub>[-29.7, -11.9]</sub> |
| previous production | +0.3 ▲ <sub>[+0.1, +0.6]</sub> | +0.8 ▲ <sub>[+0.4, +1.3]</sub> | -1.9 ▼ <sub>[-3.1, -0.9]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.5 <sub>[-1.1, +1.9]</sub> | +2.0 <sub>[+0.0, +5.0]</sub> |
| previous · sound | -52.4 ▼ <sub>[-54.2, -50.6]</sub> | -57.2 ▼ <sub>[-59.5, -54.9]</sub> | -19.5 ▼ <sub>[-24.2, -15.4]</sub> | -13.2 ▼ <sub>[-17.6, -9.2]</sub> | -8.7 ▼ <sub>[-12.9, -4.9]</sub> | -4.6 ▼ <sub>[-8.5, -1.5]</sub> | -41.7 ▼ <sub>[-46.9, -36.3]</sub> | -20.8 ▼ <sub>[-29.7, -11.9]</sub> |
| no relative cut-off | +0.3 ▲ <sub>[+0.2, +0.4]</sub> | +0.9 ▲ <sub>[+0.5, +1.3]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +1.3 ▲ <sub>[+0.5, +2.2]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> |
| share of best 0.4 | +0.3 ▲ <sub>[+0.2, +0.4]</sub> | +0.8 ▲ <sub>[+0.5, +1.3]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.9 ▲ <sub>[+0.2, +1.7]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> |
| share of best 0.6 | -0.9 ▼ <sub>[-1.2, -0.7]</sub> | -2.3 ▼ <sub>[-3.0, -1.7]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | -2.0 ▼ <sub>[-3.4, -0.8]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> |
| share of best 0.7 | -2.7 ▼ <sub>[-3.1, -2.2]</sub> | -6.3 ▼ <sub>[-7.3, -5.4]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | -4.7 ▼ <sub>[-6.7, -2.9]</sub> | -1.0 <sub>[-3.0, +0.0]</sub> |
| typed sound z ≥ 3 | -0.0 <sub>[-0.1, +0.0]</sub> | -0.0 <sub>[-0.2, +0.1]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.2 <sub>[+0.0, +0.6]</sub> | +1.0 <sub>[+0.0, +3.0]</sub> |
| typed sound z ≥ 3.5 | -0.0 <sub>[-0.1, +0.0]</sub> | -0.0 <sub>[-0.2, +0.1]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.2 <sub>[+0.0, +0.6]</sub> | +1.0 <sub>[+0.0, +3.0]</sub> |
| no phrase bonus | +0.2 <sub>[-0.0, +0.5]</sub> | +0.4 ▲ <sub>[+0.2, +0.7]</sub> | -1.9 ▼ <sub>[-3.1, -0.9]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | -0.6 <sub>[-1.8, +0.6]</sub> | +1.0 <sub>[+0.0, +3.0]</sub> |
| no cut-off | +0.3 ▲ <sub>[+0.1, +0.4]</sub> | +0.8 ▲ <sub>[+0.4, +1.3]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.3 <sub>[+0.0, +0.8]</sub> | +0.8 <sub>[+0.0, +2.3]</sub> | +1.4 ▲ <sub>[+0.5, +2.4]</sub> | +1.0 <sub>[+0.0, +3.0]</sub> |
| no exact-words bonus | +1.1 ▲ <sub>[+0.6, +1.7]</sub> | +1.1 ▲ <sub>[+0.6, +1.6]</sub> | -11.6 ▼ <sub>[-15.4, -8.2]</sub> | -8.0 ▼ <sub>[-11.6, -4.8]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | -4.5 ▼ <sub>[-7.1, -2.0]</sub> | -1.0 <sub>[-4.0, +2.0]</sub> |
| z-sum | -10.1 ▼ <sub>[-11.3, -8.8]</sub> | -6.5 ▼ <sub>[-7.8, -5.2]</sub> | -12.9 ▼ <sub>[-16.7, -9.3]</sub> | -8.0 ▼ <sub>[-11.6, -4.8]</sub> | -0.0 <sub>[-1.4, +1.5]</sub> | +0.8 <sub>[+0.0, +2.3]</sub> | -11.6 ▼ <sub>[-15.4, -8.2]</sub> | -3.0 <sub>[-7.9, +2.0]</sub> |
| RRF | -33.0 ▼ <sub>[-34.8, -31.1]</sub> | -30.3 ▼ <sub>[-32.5, -28.1]</sub> | -13.7 ▼ <sub>[-17.6, -10.0]</sub> | -8.4 ▼ <sub>[-12.0, -5.2]</sub> | -3.9 ▼ <sub>[-6.8, -1.1]</sub> | -0.8 <sub>[-3.1, +1.5]</sub> | -20.6 ▼ <sub>[-25.5, -16.1]</sub> | -8.9 ▼ <sub>[-15.8, -2.0]</sub> |
| raw cosine max | +1.3 ▲ <sub>[+0.7, +1.8]</sub> | +1.4 ▲ <sub>[+0.8, +2.0]</sub> | -10.4 ▼ <sub>[-14.0, -7.2]</sub> | -6.8 ▼ <sub>[-10.0, -4.0]</sub> | +0.4 <sub>[+0.0, +1.0]</sub> | +0.8 <sub>[+0.0, +2.3]</sub> | -3.8 ▼ <sub>[-6.4, -1.5]</sub> | +0.0 <sub>[-3.0, +3.0]</sub> |
| keyword (all words) | -49.2 ▼ <sub>[-50.9, -47.4]</sub> | -63.1 ▼ <sub>[-65.2, -61.1]</sub> | -3.9 ▼ <sub>[-6.2, -1.9]</sub> | -2.0 ▼ <sub>[-4.0, -0.4]</sub> | -97.8 ▼ <sub>[-99.6, -95.5]</sub> | -99.2 ▼ <sub>[-100.0, -97.7]</sub> | +0.0 <sub>[-4.5, +4.1]</sub> | -4.0 <sub>[-8.9, +0.0]</sub> |
| keyword (any word) | -20.8 ▼ <sub>[-22.2, -19.5]</sub> | -17.7 ▼ <sub>[-19.4, -15.9]</sub> | -4.3 ▼ <sub>[-6.6, -2.3]</sub> | -2.0 ▼ <sub>[-4.0, -0.4]</sub> | -86.0 ▼ <sub>[-91.2, -80.6]</sub> | -83.1 ▼ <sub>[-89.2, -76.2]</sub> | +3.2 <sub>[-0.1, +6.4]</sub> | +0.0 <sub>[-4.0, +4.0]</sub> |

- **production · text**: Production `match=text`
- **production · sound**: Production `match=sound` (audio vector only)
- **previous production**: The ranking before this change: one cut-off z ≥ 3 for both signals, no phrase bonus, no relative cut-off
- **previous · sound**: Previous `match=sound`: audio vector, z ≥ 3, no relative cut-off
- **no relative cut-off**: Production without the share-of-best cut-off
- **share of best 0.4**: Production, results under 0.4 × the best dropped
- **share of best 0.6**: Production, results under 0.6 × the best dropped
- **share of best 0.7**: Production, results under 0.7 × the best dropped
- **typed sound z ≥ 3**: Production with the typed-sound cut-off at 3, like text
- **typed sound z ≥ 3.5**: Production with the typed-sound cut-off at 3.5
- **no phrase bonus**: Production without the exact-phrase bonus
- **no cut-off**: Production scores with no cut-off at all (z or share of best)
- **no exact-words bonus**: Production without the full-text bonuses
- **z-sum**: Sum of text and sound z-scores instead of the max (no cut-off)
- **RRF**: Reciprocal rank fusion of the text and sound rankings, k = 60 (no cut-off)
- **raw cosine max**: Max of the raw cosine similarities, no normalisation (no cut-off)
- **keyword (all words)**: Baseline: Postgres full-text search, every word required, ts_rank
- **keyword (any word)**: Baseline: Postgres full-text search, any word, ts_rank

Absolute nDCG@10 / R@10 by variant:

| Variant | caption | fragment | paraphrase | concept |
| --- | --- | --- | --- | --- |
| production | 70.7 / 89.6 | 99.7 / 100.0 | 97.8 / 99.2 | 69.5 / 98.0 |
| production · text | 70.8 / 89.7 | 99.7 / 100.0 | 97.9 / 99.2 | 69.5 / 98.0 |
| production · sound | 18.3 / 32.4 | 80.2 / 86.8 | 89.1 / 94.6 | 27.8 / 77.2 |
| previous production | 71.0 / 90.5 | 97.8 / 100.0 | 97.8 / 99.2 | 70.0 / 100.0 |
| previous · sound | 18.3 / 32.4 | 80.2 / 86.8 | 89.1 / 94.6 | 27.8 / 77.2 |
| no relative cut-off | 71.0 / 90.5 | 99.7 / 100.0 | 97.8 / 99.2 | 70.8 / 98.0 |
| share of best 0.4 | 71.0 / 90.5 | 99.7 / 100.0 | 97.8 / 99.2 | 70.4 / 98.0 |
| share of best 0.6 | 69.8 / 87.3 | 99.7 / 100.0 | 97.8 / 99.2 | 67.5 / 98.0 |
| share of best 0.7 | 68.0 / 83.3 | 99.7 / 100.0 | 97.8 / 99.2 | 64.8 / 97.0 |
| typed sound z ≥ 3 | 70.7 / 89.6 | 99.7 / 100.0 | 97.8 / 99.2 | 69.7 / 99.0 |
| typed sound z ≥ 3.5 | 70.7 / 89.6 | 99.7 / 100.0 | 97.8 / 99.2 | 69.7 / 99.0 |
| no phrase bonus | 70.9 / 90.0 | 97.8 / 100.0 | 97.8 / 99.2 | 68.9 / 99.0 |
| no cut-off | 71.0 / 90.5 | 99.7 / 100.0 | 98.1 / 100.0 | 70.9 / 99.0 |
| no exact-words bonus | 71.8 / 90.7 | 88.1 / 92.0 | 97.8 / 99.2 | 65.0 / 97.0 |
| z-sum | 60.6 / 83.1 | 86.8 / 92.0 | 97.8 / 100.0 | 57.9 / 95.0 |
| RRF | 37.7 / 59.3 | 86.1 / 91.6 | 94.0 / 98.5 | 48.8 / 89.1 |
| raw cosine max | 72.0 / 91.0 | 89.3 / 93.2 | 98.2 / 100.0 | 65.7 / 98.0 |
| keyword (all words) | 21.5 / 26.5 | 95.8 / 98.0 | 0.0 / 0.0 | 69.5 / 94.1 |
| keyword (any word) | 49.9 / 72.0 | 95.4 / 98.0 | 11.9 / 16.2 | 72.7 / 98.0 |

The brief's sound queries (relevant = clips with the matching AudioSet label):

| Query | Relevant clips | Production P@10 | Production nDCG@10 | Sound only P@10 | Sound only nDCG@10 |
| --- | --- | --- | --- | --- | --- |
| baby crying | 10 | 90.0 | 93.1 | 50.0 | 49.5 |
| dog barking | 10 | 70.0 | 64.7 | 50.0 | 62.8 |
| people laughing | 8 | 10.0 | 12.6 | 0.0 | 0.0 |
| someone sneezing | 3 | 30.0 | 94.7 | 20.0 | 53.1 |

## 3. The cut-offs: threshold sweeps

One z cut-off for both signals, on the previous ranking (no relative cut-off, no phrase bonus):

| min z | caption R@10 / results | fragment R@10 / results | paraphrase R@10 / results | concept R@10 / results | negative: results / % empty |
| --- | --- | --- | --- | --- | --- |
| 0.0 | 90.5 / 50.0 | 100.0 / 50.0 | 100.0 / 50.0 | 100.0 / 50.0 | 50.0 / 0.0 |
| 1.0 | 90.5 / 50.0 | 100.0 / 50.0 | 100.0 / 50.0 | 100.0 / 50.0 | 50.0 / 0.0 |
| 1.5 | 90.5 / 50.0 | 100.0 / 50.0 | 100.0 / 50.0 | 100.0 / 50.0 | 50.0 / 0.0 |
| 2.0 | 90.5 / 50.0 | 100.0 / 49.4 | 100.0 / 49.9 | 100.0 / 50.0 | 50.0 / 0.0 |
| 2.5 | 90.5 / 50.0 | 100.0 / 29.8 | 100.0 / 38.2 | 100.0 / 50.0 | 48.6 / 0.0 |
| 3.0 | 90.5 / 47.2 | 100.0 / 11.1 | 99.2 / 16.4 | 100.0 / 37.4 | 21.8 / 0.0 |
| 3.5 | 90.5 / 32.9 | 100.0 / 5.3 | 98.5 / 7.4 | 100.0 / 24.3 | 6.8 / 0.0 |
| 4.0 | 89.9 / 18.1 | 100.0 / 3.4 | 97.7 / 3.7 | 99.0 / 18.8 | 1.8 / 36.4 |
| 5.0 | 82.8 / 6.1 | 100.0 / 2.4 | 93.8 / 1.4 | 98.0 / 14.6 | 0.1 / 90.9 |

The share-of-best cut-off on production (results under share × the best result dropped):

| share | caption R@10 / results | fragment R@10 / results | paraphrase R@10 / results | concept R@10 / results | negative: results / % empty |
| --- | --- | --- | --- | --- | --- |
| 0.0 | 90.5 / 40.3 | 100.0 / 8.7 | 99.2 / 12.5 | 98.0 / 28.7 | 12.5 / 0.0 |
| 0.3 | 90.5 / 38.3 | 100.0 / 5.6 | 99.2 / 11.9 | 98.0 / 25.8 | 12.5 / 0.0 |
| 0.4 | 90.5 / 31.9 | 100.0 / 3.0 | 99.2 / 9.2 | 98.0 / 18.7 | 12.5 / 0.0 |
| 0.5 | 89.6 / 23.8 | 100.0 / 1.9 | 99.2 / 5.3 | 98.0 / 14.7 | 12.5 / 0.0 |
| 0.6 | 87.3 / 15.6 | 100.0 / 1.4 | 99.2 / 3.0 | 98.0 / 12.3 | 11.7 / 0.0 |
| 0.7 | 83.3 / 8.9 | 100.0 / 1.2 | 99.2 / 1.7 | 97.0 / 10.0 | 10.2 / 0.0 |
| 0.8 | 78.5 / 4.5 | 100.0 / 1.1 | 99.2 / 1.3 | 96.0 / 6.8 | 6.6 / 0.0 |

Answerability: AUC of the top result's score for queries with vs without an answer = **0.985** (1 = the top score alone tells them apart). Top score p10/p50/p90: with an answer 5.51/7.83/12.06, without 3.65/4.26/4.70.

"Nothing clearly matches" (the API's `strongMatch: false`, top score under the threshold), share of queries flagged:

| Top score under | Negative queries | Queries with an answer | caption | fragment | paraphrase | concept |
| --- | --- | --- | --- | --- | --- | --- |
| 4.0 | 36.4 | 0.2 | 0.2 | 0.0 | 1.5 | 0.0 |
| 4.5 | 72.7 | 1.0 | 1.0 | 0.0 | 3.1 | 0.0 |
| 5.0 (production) | 90.9 | 3.5 | 3.9 | 0.0 | 6.2 | 0.0 |
| 5.5 | 90.9 | 9.9 | 11.2 | 0.4 | 13.1 | 2.0 |
| 6.0 | 100.0 | 18.6 | 21.1 | 1.6 | 21.5 | 3.0 |

| Negative query | Results | Top score | Top results |
| --- | --- | --- | --- |
| customer asking for a refund | 10 | 3.65 | WHAT DO YOU MEAN SIR (3.65, text)<br>SWEETWATER HELP ME OUT OF THIS (3.39, text)<br>WE CAN'T DO ANYTHING WITHOUT EVIDENCE COMPLAIN (3.27, text) |
| how do I reset my password | 19 | 4.70 | How did it happen? (4.7, text)<br>That'll close my account. (3.79, text)<br>SWEETWATER HELP ME OUT OF THIS (3.78, text) |
| quarterly earnings call | 9 | 3.60 | THAT'S MACKLEWAIN'S BUSINESS (3.6, text)<br>WE SHALL MAKE MORE MONEY UP HERE THIS WINTER THAN  (3.58, text)<br>The company elected to expand globally, and acquir (3.22, text) |
| podcast about cryptocurrency | 10 | 4.29 | Opus is a state-of-the-art loyalty-free audio code (4.29, sound)<br>WHAT ARE YOU TALKING ABOUT MAN (4.24, text)<br>HOW WOULD THE PAPERS TALK ABOUT IT (3.39, text) |
| vacuum cleaner running | 14 | 4.26 | Continuous buzzing and hissing (4.26, text+sound)<br>A clock ticktocks then rings three times (4.05, sound)<br>A machine runs continuously (4.01, text+sound) |
| skateboard rolling on concrete | 15 | 4.19 | Water is sprayed across a hard surface (4.19, text)<br>Rain falls on a hard surface (4.01, text)<br>A vehicle engine accelerates and wind blows (3.74, text) |
| zipper being pulled | 7 | 3.81 | HE PULLED UP A WINDOW AS IF THE AIR WERE HEAVY (3.81, text)<br>WHEN THE BUZZER SOUNDED HE PULLED HIS FOIL FROM HI (3.47, text)<br>WHO IS TOUCHING ME AND UNTRUSSING ME (3.26, text) |
| drum solo | 7 | 3.90 | THE MUSIC WAS BROKEN AND JOSEPH LEFT ALONE WITH TH (3.9, text)<br>I'M ALONE DO YOU HEAR THAT ALONE (3.41, text)<br>TEN SECONDS (3.36, text) |
| electric toothbrush buzzing | 14 | 4.57 | A power toll is at work while it buzzes (4.57, text)<br>Continuous buzzing and hissing (4.41, text)<br>A machine hums followed by a buzz (4.41, text) |
| someone tap dancing | 15 | 5.60 | HER LITTLE FOOT TAPPED THE GRAVEL IMPATIENTLY (5.6, text)<br>People speak and tapping occurs (4.9, text)<br>WHEN SHE BEGAN TO DANCE BY WAY OF SHOWING THE GOSS (4.19, text) |
| dial-up modem connecting | 17 | 4.33 | A music is played followed by a frog croaking and  (4.33, sound)<br>A machine beeping followed by a kid screaming (4.24, sound)<br>An adult male speaks and dials a rotary phone (4.13, text) |

## 4. Against published CLAP results (AudioCaps text → audio)

| System | R@1 | R@5 | R@10 | mAP@10 |
| --- | --- | --- | --- | --- |
| This catalog, sound · full catalog | 7.5 <sub>[6.4–8.6]</sub> | 22.8 <sub>[21.0–24.6]</sub> | 32.7 <sub>[30.6–34.7]</sub> | 14.0 <sub>[12.8–15.2]</sub> |
| This catalog, sound · AudioCaps clips only | 8.3 <sub>[7.2–9.5]</sub> | 24.5 <sub>[22.6–26.2]</sub> | 34.4 <sub>[32.3–36.5]</sub> | 15.2 <sub>[13.9–16.4]</sub> |
| LAION-CLAP HTSAT-RoBERTa (AudioCaps test) ¹ | 36.7 | 70.9 | 83.2 | 51.3 ² |
| Microsoft CLAP 2023 (AudioCaps) ³ | 35.6 | – | – | 51.0 |

Not like for like: a different pool (426 val clips, plus 2,903 speech clips in the full catalog), a different model, and CLAP was trained on AudioCaps. Gemini embeddings are general-purpose. Sources: ¹ arXiv 2211.06687 v4, Table 3; ² Table 2 (AudioCaps+Clotho training); ³ arXiv 2309.05767 v2, Table 2.

## 5. Search by example (audio → audio)

| Set | n | R@1 | P@10 | mAP@10 | nDCG@10 | Chance P@10 |
| --- | --- | --- | --- | --- | --- | --- |
| Clip → clips with a shared sound label | 419 | 45.8 <sub>[41.1–50.6]</sub> | 33.4 <sub>[30.5–36.5]</sub> | 28.1 <sub>[25.2–31.1]</sub> | 26.7 <sub>[24.3–29.2]</sub> | 1.0 |
| LibriSpeech clip → same speaker | 300 | 61.7 <sub>[56.0–67.0]</sub> | 38.4 <sub>[35.1–41.6]</sub> | 30.8 <sub>[27.5–34.1]</sub> | 43.1 <sub>[39.6–46.4]</sub> | 2.1 |

## 6. Diagnostics for the README's claims

- Raw cosine, text query vs text vectors: p10/p50/p90 = 0.537/0.587/0.640; text query vs audio vectors: 0.328/0.481/0.566.
- Speech clips in the sound-only top 10 for sound-concept queries: 24.4% (speech is 87.2% of the catalog).
- Paraphrases that share no content word with their transcript (n = 76): production R@10 98.7 <sub>[96.1–100.0]</sub>, MRR 97.0 <sub>[93.1–100.0]</sub>.
- Database time (EXPLAIN ANALYZE, exact scan of 3329 clips): /similar p50 16.5 ms (max 17.5), text search p50 106.9 ms (max 118.7).

## 7. Failures of production search (relevant clip not in the top 10)

| Set | Failures | Cut off | Ranked below 10 | Not near the query |
| --- | --- | --- | --- | --- |
| caption | 221 | 20 | 111 | 90 |
| fragment | 0 | 0 | 0 | 0 |
| paraphrase | 1 | 1 | 0 | 0 |
| concept | 2 | 0 | 2 | 0 |

"Cut off": the clip is in the top 10 without the cut-offs (z, typed sound, share of best), but one of them drops it. "Not near": not in the top 10 even without them. All cases are in results.json (`failures.cases`).

Caption failures: 48.4% have a top result with the same AudioSet sound label as the target (a plausible answer that known-item scoring counts as wrong); in 18.1% the target stands out more on sound than on text. 146 clips fail at least one of their captions; 14 fail 3 or more of 5.

## 8. Latency and cost

| Endpoint (client-side, from this machine) | n | p50 ms | p95 ms | errors |
| --- | --- | --- | --- | --- |
| GET /api/v1/search (text, match=all) | 20 | 884 | 978 | 0 |
| GET /api/v1/audios/{id}/similar | 20 | 220 | 257 | 0 |
| POST /api/v1/search/audio (5 s WAV) | 8 | 1362 | 1604 | 0 |

- Query embedding through the AI Gateway (2 vectors, one request): p50 560 ms, p95 821 ms.
- A text search embeds 10 tokens: $2.00 per million searches. A 10 s audio search embeds 320 tokens: $2.08 per thousand. (Gateway list prices: {"input":"0.0000002","audio_input_token_cost":"0.0000065"}.)
- This run embedded 0 new tokens.
