# Retrieval evaluation

Generated 2026-11-24T18:06:40.814Z by `pnpm eval` (scripts/eval/run.mts). Do not edit by hand.

Catalog: 426 audiocaps, 200 commonvoice, 2703 librispeech. Model `google/gemini-embedding-2`. Ranking: cut-off z ≥ 3, exact-words bonus 3, limit 50.
Queries: 11 negative, 2130 caption, 250 fragment, 130 paraphrase, 101 concept, 419 example, 300 speaker. Method and caveats: [eval/README.md](README.md).

Numbers are percentages, mean over queries, with a 95% bootstrap interval in brackets. R@K = a relevant clip in the top K.

**Parity with the live API:** 20 text queries, top-10 overlap 100.0%, identical lists 20/20, max score difference 0.0000; /similar identical 20/20.

## 1. Production search, by query set

| Set | n | R@1 | R@5 | R@10 | MRR | nDCG@10 | Results returned | % empty |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| negative | 11 | 0.0 <sub>[0.0–0.0]</sub> | 0.0 <sub>[0.0–0.0]</sub> | 0.0 <sub>[0.0–0.0]</sub> | 0.0 <sub>[0.0–0.0]</sub> | 0.0 <sub>[0.0–0.0]</sub> | 21.8 | 0.0 |
| caption | 2130 | 51.9 <sub>[49.9–54.0]</sub> | 82.3 <sub>[80.7–83.9]</sub> | 90.5 <sub>[89.2–91.7]</sub> | 65.2 <sub>[63.7–66.8]</sub> | 71.0 <sub>[69.7–72.5]</sub> | 47.2 | 0.0 |
| fragment · librispeech | 150 | 92.7 <sub>[88.0–96.7]</sub> | 99.3 <sub>[98.0–100.0]</sub> | 100.0 <sub>[100.0–100.0]</sub> | 95.6 <sub>[92.9–98.0]</sub> | 96.7 <sub>[94.6–98.5]</sub> | 10.6 | 0.0 |
| fragment · commonvoice | 100 | 99.0 <sub>[97.0–100.0]</sub> | 100.0 <sub>[100.0–100.0]</sub> | 100.0 <sub>[100.0–100.0]</sub> | 99.5 <sub>[98.5–100.0]</sub> | 99.6 <sub>[98.9–100.0]</sub> | 11.9 | 0.0 |
| paraphrase · librispeech | 80 | 95.0 <sub>[90.0–98.8]</sub> | 98.8 <sub>[96.3–100.0]</sub> | 98.8 <sub>[96.3–100.0]</sub> | 96.7 <sub>[92.9–99.4]</sub> | 97.2 <sub>[93.8–99.5]</sub> | 16.5 | 0.0 |
| paraphrase · commonvoice | 50 | 98.0 <sub>[94.0–100.0]</sub> | 100.0 <sub>[100.0–100.0]</sub> | 100.0 <sub>[100.0–100.0]</sub> | 98.5 <sub>[95.5–100.0]</sub> | 98.9 <sub>[96.6–100.0]</sub> | 16.3 | 0.0 |
| concept | 101 | 70.3 <sub>[61.4–79.2]</sub> | 96.0 <sub>[92.1–99.0]</sub> | 100.0 <sub>[100.0–100.0]</sub> | 81.6 <sub>[75.8–87.2]</sub> | 70.0 <sub>[65.1–75.0]</sub> | 37.4 | 0.0 |

## 2. Ranking variants vs production (paired difference, nDCG@10 and R@10)

▲/▼: the 95% interval of the difference excludes zero.

| Variant | caption ΔnDCG | caption ΔR@10 | fragment ΔnDCG | fragment ΔR@10 | paraphrase ΔnDCG | paraphrase ΔR@10 | concept ΔnDCG | concept ΔR@10 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| production · text | +0.1 <sub>[-0.1, +0.3]</sub> | +0.1 <sub>[-0.2, +0.5]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.1 <sub>[+0.0, +0.3]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | -0.0 <sub>[-0.7, +0.5]</sub> | -1.0 <sub>[-3.0, +0.0]</sub> |
| production · sound | -52.7 ▼ <sub>[-54.6, -51.0]</sub> | -58.0 ▼ <sub>[-60.3, -55.8]</sub> | -17.6 ▼ <sub>[-22.0, -13.9]</sub> | -13.2 ▼ <sub>[-17.6, -9.2]</sub> | -8.7 ▼ <sub>[-12.9, -4.9]</sub> | -4.6 ▼ <sub>[-8.5, -1.5]</sub> | -42.2 ▼ <sub>[-47.4, -37.0]</sub> | -22.8 ▼ <sub>[-30.7, -14.9]</sub> |
| no cut-off | +0.0 <sub>[+0.0, +0.0]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.3 <sub>[+0.0, +0.8]</sub> | +0.8 <sub>[+0.0, +2.3]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> |
| no exact-words bonus | +0.8 ▲ <sub>[+0.3, +1.3]</sub> | +0.2 <sub>[-0.1, +0.6]</sub> | -9.9 ▼ <sub>[-13.2, -6.7]</sub> | -8.4 ▼ <sub>[-12.0, -5.2]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | +0.0 <sub>[+0.0, +0.0]</sub> | -5.0 ▼ <sub>[-6.9, -3.2]</sub> | -1.0 <sub>[-3.0, +0.0]</sub> |
| z-sum | -10.4 ▼ <sub>[-11.7, -9.2]</sub> | -7.3 ▼ <sub>[-8.7, -6.1]</sub> | -11.0 ▼ <sub>[-14.4, -8.0]</sub> | -8.0 ▼ <sub>[-11.6, -4.8]</sub> | -0.0 <sub>[-1.4, +1.5]</sub> | +0.8 <sub>[+0.0, +2.3]</sub> | -12.1 ▼ <sub>[-15.5, -8.8]</sub> | -5.0 ▼ <sub>[-9.9, -1.0]</sub> |
| RRF | -33.3 ▼ <sub>[-35.2, -31.5]</sub> | -31.2 ▼ <sub>[-33.3, -29.1]</sub> | -11.8 ▼ <sub>[-15.2, -8.6]</sub> | -8.4 ▼ <sub>[-12.0, -5.2]</sub> | -3.9 ▼ <sub>[-6.8, -1.1]</sub> | -0.8 <sub>[-3.1, +1.5]</sub> | -21.1 ▼ <sub>[-25.9, -16.6]</sub> | -10.9 ▼ <sub>[-16.8, -5.0]</sub> |
| raw cosine max | +0.9 ▲ <sub>[+0.4, +1.4]</sub> | +0.5 ▲ <sub>[+0.0, +1.0]</sub> | -8.6 ▼ <sub>[-11.7, -5.9]</sub> | -6.8 ▼ <sub>[-10.0, -4.0]</sub> | +0.4 <sub>[+0.0, +1.0]</sub> | +0.8 <sub>[+0.0, +2.3]</sub> | -4.3 ▼ <sub>[-6.3, -2.5]</sub> | -2.0 <sub>[-5.0, +0.0]</sub> |
| keyword (all words) | -49.5 ▼ <sub>[-51.2, -47.8]</sub> | -64.0 ▼ <sub>[-66.0, -61.9]</sub> | -2.0 ▼ <sub>[-4.0, -0.4]</sub> | -2.0 ▼ <sub>[-4.0, -0.4]</sub> | -97.8 ▼ <sub>[-99.6, -95.5]</sub> | -99.2 ▼ <sub>[-100.0, -97.7]</sub> | -0.5 <sub>[-5.2, +4.2]</sub> | -5.9 ▼ <sub>[-10.9, -2.0]</sub> |
| keyword (any word) | -21.2 ▼ <sub>[-22.6, -19.8]</sub> | -18.5 ▼ <sub>[-20.2, -16.7]</sub> | -2.5 ▼ <sub>[-4.4, -0.8]</sub> | -2.0 ▼ <sub>[-4.0, -0.4]</sub> | -86.0 ▼ <sub>[-91.2, -80.6]</sub> | -83.1 ▼ <sub>[-89.2, -76.2]</sub> | +2.7 <sub>[-0.9, +6.4]</sub> | -2.0 <sub>[-5.0, +0.0]</sub> |

- **production · text**: Production `match=text`
- **production · sound**: Production `match=sound` (audio vector only)
- **no cut-off**: Production scores without the z ≥ 3 cut-off
- **no exact-words bonus**: Production without the full-text bonus
- **z-sum**: Sum of text and sound z-scores instead of the max (no cut-off)
- **RRF**: Reciprocal rank fusion of the text and sound rankings, k = 60 (no cut-off)
- **raw cosine max**: Max of the raw cosine similarities, no normalisation (no cut-off)
- **keyword (all words)**: Baseline: Postgres full-text search, every word required, ts_rank
- **keyword (any word)**: Baseline: Postgres full-text search, any word, ts_rank

Absolute nDCG@10 / R@10 by variant:

| Variant | caption | fragment | paraphrase | concept |
| --- | --- | --- | --- | --- |
| production | 71.0 / 90.5 | 97.8 / 100.0 | 97.8 / 99.2 | 70.0 / 100.0 |
| production · text | 71.2 / 90.6 | 97.8 / 100.0 | 97.9 / 99.2 | 69.9 / 99.0 |
| production · sound | 18.3 / 32.4 | 80.2 / 86.8 | 89.1 / 94.6 | 27.8 / 77.2 |
| no cut-off | 71.0 / 90.5 | 97.8 / 100.0 | 98.1 / 100.0 | 70.0 / 100.0 |
| no exact-words bonus | 71.8 / 90.7 | 88.0 / 91.6 | 97.8 / 99.2 | 65.0 / 99.0 |
| z-sum | 60.6 / 83.1 | 86.8 / 92.0 | 97.8 / 100.0 | 57.9 / 95.0 |
| RRF | 37.7 / 59.3 | 86.1 / 91.6 | 94.0 / 98.5 | 48.8 / 89.1 |
| raw cosine max | 72.0 / 91.0 | 89.3 / 93.2 | 98.2 / 100.0 | 65.7 / 98.0 |
| keyword (all words) | 21.5 / 26.5 | 95.8 / 98.0 | 0.0 / 0.0 | 69.5 / 94.1 |
| keyword (any word) | 49.9 / 72.0 | 95.4 / 98.0 | 11.9 / 16.2 | 72.7 / 98.0 |

The brief's sound queries (relevant = clips with the matching AudioSet label):

| Query | Relevant clips | Production P@10 | Production nDCG@10 | Sound only P@10 | Sound only nDCG@10 |
| --- | --- | --- | --- | --- | --- |
| baby crying | 10 | 90.0 | 93.1 | 50.0 | 49.5 |
| dog barking | 10 | 70.0 | 77.5 | 50.0 | 62.8 |
| people laughing | 8 | 10.0 | 25.3 | 0.0 | 0.0 |
| someone sneezing | 3 | 30.0 | 94.7 | 20.0 | 53.1 |

## 3. The cut-off: threshold sweep

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

Answerability: AUC of the top result's score for queries with vs without an answer = **0.984** (1 = the top score alone tells them apart). Top score p10/p50/p90: with an answer 5.47/7.72/11.25, without 3.65/4.26/4.70.

| Negative query | Results | Top score | Top results |
| --- | --- | --- | --- |
| customer asking for a refund | 12 | 3.65 | WHAT DO YOU MEAN SIR (3.65, text)<br>SWEETWATER HELP ME OUT OF THIS (3.39, text)<br>WE CAN'T DO ANYTHING WITHOUT EVIDENCE COMPLAIN (3.39, text+sound) |
| how do I reset my password | 19 | 4.70 | How did it happen? (4.7, text+sound)<br>What did you say? (3.86, text+sound)<br>That'll close my account. (3.79, text) |
| quarterly earnings call | 9 | 3.60 | THAT'S MACKLEWAIN'S BUSINESS (3.6, text)<br>WE SHALL MAKE MORE MONEY UP HERE THIS WINTER THAN  (3.58, text)<br>The company elected to expand globally, and acquir (3.54, text+sound) |
| podcast about cryptocurrency | 16 | 4.29 | Opus is a state-of-the-art loyalty-free audio code (4.29, sound)<br>WHAT ARE YOU TALKING ABOUT MAN (4.24, text)<br>THE DAILY NEWSCASTS FROM TERRA SHOWED A CORRESPOND (3.67, sound) |
| vacuum cleaner running | 40 | 4.26 | Continuous buzzing and hissing (4.26, text+sound)<br>A clock ticktocks then rings three times (4.05, sound)<br>A machine runs continuously (4.01, text+sound) |
| skateboard rolling on concrete | 29 | 4.19 | Water is sprayed across a hard surface (4.19, text)<br>Rain falls on a hard surface (4.01, text)<br>A vehicle engine accelerates and wind blows (3.74, text) |
| zipper being pulled | 12 | 3.81 | HE PULLED UP A WINDOW AS IF THE AIR WERE HEAVY (3.81, text+sound)<br>WHEN THE BUZZER SOUNDED HE PULLED HIS FOIL FROM HI (3.47, text)<br>WHO IS TOUCHING ME AND UNTRUSSING ME (3.26, text) |
| drum solo | 24 | 3.90 | THE MUSIC WAS BROKEN AND JOSEPH LEFT ALONE WITH TH (3.9, text)<br>An airplane engine roars increasingly louder (3.79, sound)<br>Multiple ducks quack continuously (3.77, sound) |
| electric toothbrush buzzing | 30 | 4.57 | A power toll is at work while it buzzes (4.57, text+sound)<br>Continuous buzzing and hissing (4.41, text+sound)<br>A machine hums followed by a buzz (4.41, text+sound) |
| someone tap dancing | 17 | 5.60 | HER LITTLE FOOT TAPPED THE GRAVEL IMPATIENTLY (5.6, text+sound)<br>People speak and tapping occurs (4.9, text)<br>WHEN SHE BEGAN TO DANCE BY WAY OF SHOWING THE GOSS (4.19, text) |
| dial-up modem connecting | 32 | 4.33 | A music is played followed by a frog croaking and  (4.33, sound)<br>A machine beeping followed by a kid screaming (4.24, sound)<br>An adult male speaks and dials a rotary phone (4.13, text) |

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
- Database time (EXPLAIN ANALYZE, exact scan of 3329 clips): /similar p50 15.1 ms (max 15.2), text search p50 70.0 ms (max 83.7).

## 7. Failures of production search (relevant clip not in the top 10)

| Set | Failures | Cut off by z < 3 | Ranked below 10 | Not near the query |
| --- | --- | --- | --- | --- |
| caption | 203 | 0 | 147 | 56 |
| fragment | 0 | 0 | 0 | 0 |
| paraphrase | 1 | 1 | 0 | 0 |
| concept | 0 | 0 | 0 | 0 |

"Cut off": the clip is in the top 10 without the cut-off, but below z = 3. "Not near": not in the top 10 even without it. All cases are in results.json (`failures.cases`).

Caption failures: 46.8% have a top result with the same AudioSet sound label as the target (a plausible answer that known-item scoring counts as wrong); in 18.7% the target stands out more on sound than on text. 135 clips fail at least one of their captions; 14 fail 3 or more of 5.

## 8. Latency and cost

| Endpoint (client-side, from this machine) | n | p50 ms | p95 ms | errors |
| --- | --- | --- | --- | --- |
| GET /api/v1/search (text, match=all) | 20 | 643 | 803 | 0 |
| GET /api/v1/audios/{id}/similar | 20 | 223 | 238 | 0 |
| POST /api/v1/search/audio (5 s WAV) | 8 | 1357 | 1559 | 0 |

- Query embedding through the AI Gateway (2 vectors, one request): p50 594 ms, p95 754 ms.
- A text search embeds 10 tokens: $2.00 per million searches. A 10 s audio search embeds 320 tokens: $2.08 per thousand. (Gateway list prices: {"input":"0.0000002","audio_input_token_cost":"0.0000065"}.)
- This run embedded 0 new tokens.
