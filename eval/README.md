# Retrieval evaluation

How well does the search find the right clip, and do the design decisions in the
[main README](../README.md#search) hold up when measured? This folder answers with numbers
anyone can reproduce: [`report.md`](report.md) is the latest run, [`results.json`](results.json)
the raw output.

```bash
pnpm test           # unit tests of the metrics
pnpm eval           # the evaluation (2–4 min; add --skip-live to skip the deployed-API checks)
EVAL_API_URL=http://localhost:3000 pnpm eval   # parity against a local `pnpm dev`, for a ranking change not deployed yet
pnpm eval:queries   # rebuild queries.json (only to change the query sets)
pnpm eval:labels    # rebuild data/audioset-labels.json from AudioSet's CSV
```

Needs `.env.local` (see the main README). **Read-only**: every database statement runs in a
read-only transaction. It never writes to the production catalog. A run from a clean checkout
embeds ~155k query tokens (about $0.03 through the AI Gateway); query vectors are then cached
in `.eval-cache/` (gitignored). The live checks send ~50 requests to the deployed API, paced
under its rate limit.

## Ground truth comes from the datasets, not from the system

| Set | Queries | Query | Relevant | What it tests |
| --- | --- | --- | --- | --- |
| `caption` | 2,130 | Each of the 5 human captions of each AudioCaps clip | That clip | Text → sound, the AudioCaps retrieval protocol |
| `fragment` | 250 | A 4–7 word span of a LibriSpeech / Common Voice transcript | Every clip containing it | Exact words ("hello", "thank you") |
| `paraphrase` | 130 | An LLM rewrite of a transcript that avoids its words | That clip | Meaning ("question about pricing") |
| `concept` | 101 | An AudioSet label name ("dog", "rain") + the brief's sound queries | Clips with that label | Sound events ("dog barking") |
| `example` | 419 | An AudioCaps clip (search by example) | Clips sharing a sound label, graded by overlap | Audio → audio |
| `speaker` | 300 | A LibriSpeech clip | Clips by the same speaker | What "Find similar" does on speech |
| `negative` | 11 | Queries checked against every transcript, caption and label | None | Does the cut-off say "nothing here"? |

The sets are frozen in [`queries.json`](queries.json) (seeded sampling; the paraphrases were
written once by `anthropic/claude-sonnet-5.5` and are listed there for review, each with the
words it shares with its transcript). AudioSet labels come from Google's
`unbalanced_train_segments.csv` (CC BY 4.0); all 426 AudioCaps clips matched.

## Controls

- **No leakage.** Captions are indexed as text, so a caption query would find its own clip by
  string match. For each caption query, the clip's text vector is rebuilt from its *other*
  four captions (re-embedded the way `embed-catalog` does it), and its full-text index is
  rebuilt without the held-out caption.
- **Parity with production.** The eval ranks in memory so variants can be tried without
  touching the database. It re-implements `searchAudios` (constants shared through
  `src/server/search/ranking-config.ts`), and each run checks it against the live API. Latest
  run: 20/20 identical result lists for `/search` and 20/20 for `/similar`, max score
  difference 1e-5. The run fails if the top-10 overlap drops below 90%.
- **Uncertainty.** Every mean has a 95% percentile-bootstrap interval (2,000 resamples). Variants
  are compared with a paired bootstrap of the per-query difference; ▲/▼ in the report means the
  interval excludes zero.
- **Baselines.** Postgres full-text search (all words / any word, `ts_rank`), plus published
  CLAP results as an outside reference point.

## What the README claims, and what the numbers say (run of 2026-11-24)

| Claim (main README, Search) | Verdict | Evidence |
| --- | --- | --- |
| One model for text and audio puts both in one space | **Holds, with a weak audio side.** Text → audio vector alone: R@10 32% on captions vs 83% for LAION-CLAP. | report §1, §4 |
| Raw similarities sit on different scales, so use z-scores | **Holds.** Text-text cosine p50 0.59 vs text-audio 0.48. z-max beats RRF (−33 nDCG on captions) and z-sum (−10). Raw cosine max is slightly better on captions (+0.9) but loses 8.6 on fragments and 4.3 on concepts: it is nearly text-only, since text similarities are always larger. | §2, §6 |
| A clip's score is its best signal, not the sum | **Holds.** z-sum is significantly worse on 3 of 4 sets | §2 |
| Exact-words bonus | **Holds.** +11.6 nDCG on fragments, +4.5 on concepts; −1.1 on captions. The phrase bonus on top: +1.9 nDCG on fragments (LibriSpeech R@1 92.7 → 98.7) | §2 |
| "Sounds like" finds sounds in clips nobody described | **Partly.** Sound-only R@10 32% (captions), 77% (concepts); the brief's "dog barking" reaches P@10 50% from audio alone | §1, §2 |
| Speech also matches "sounds like" | **Holds, mildly.** Speech is 24% of sound-only top-10s for sound concepts (87% of the catalog). Sound-only finds 87% of transcript fragments: the audio vector carries the words. | §2, §6 |
| The cut-off trims; the top score judges | **Holds.** 0/11 negative queries return an empty list (12.5 results on average, 21.8 before the stricter typed-sound cut-off). The top score separates answerable queries from negatives with AUC 0.98: `strongMatch` (top score ≥ 5) is false for 10/11 negatives and 3.5% of answerable queries. | §3 |
| The cut-offs cost little | **Mostly.** Dropping results under half of the best halves the lists (fragments 11.1 → 1.9 results, captions 47 → 24) and multiplies the share of relevant results by 4–5, for −0.8 caption R@10 (significant) and −2 concept R@10 (2 of 101 queries, not significant). At 0.6 the caption loss is −3.2. The typed-sound cut-off at 4 halves the results of negatives and costs nothing measurable. | §1, §2, §3 |
| No vector index; an exact scan takes a few milliseconds | **Mostly.** Measured 15 ms (`/similar`) and 69 ms (text search, window functions + caption pick) in the database. Latency is dominated by the query embedding: end-to-end `/search` p50 is 0.6–0.65 s across runs, of which the embedding call alone is 0.56–0.6 s. | §6, §8 |
| Search by example works | **Holds.** P@10 33% for clips sharing a sound label (chance 1%). On speech, "similar" means *same speaker* (P@10 38%, chance 2%), not same topic | §5 |

## Threats to validity (read before quoting a number)

- **Paraphrases are easy.** The LLM saw the transcript, so its queries are more specific than a
  person's memory. Treat 98% R@10 as an upper bound for meaning search. The 76 paraphrases
  that share no content word with their transcript score the same (R@10 98.7%).
- **Known-item scoring undercounts.** 47% of caption "failures" return, at rank 1, a clip with
  the target's AudioSet sound label: a plausible answer scored as wrong. Generic captions
  ("A man speaking") have dozens of right answers and one counted one.
- **AudioSet labels are incomplete.** "people laughing" scores P@10 10%, but 8 of its top 9 have
  laughter in their human caption; AudioSet doesn't label them Laughter. Concept precision is a
  lower bound. No clip is labelled Cough, so "coughing" is not in the concept set.
- **Negatives are few** (11) and checked against text and labels only, not by listening.
- **The CLAP comparison is not like for like.** Different pool (426 val clips; the full catalog
  adds 2,903 speech distractors), and CLAP was trained on AudioCaps. A smaller pool makes our
  task easier, so the gap is if anything understated.
- **Small catalog.** 3,329 clips. Nearest-neighbour quality and z-score statistics shift with
  scale. Latency is from one client location.
