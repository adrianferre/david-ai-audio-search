# AI Audio Search

Search about 3,300 audio clips by what's said in them, what they sound like, or by example: a
clip from the catalog, a file, a microphone recording or a link.

Live at **https://david-ai-audio-search.vercel.app**. Built with Next.js 16 (App Router, Cache
Components), TypeScript, Tailwind CSS v4 and shadcn/ui, on Neon Postgres with pgvector, a private
Vercel Blob store and the Vercel AI Gateway.

## Getting started

You need Node.js 22.18+ and pnpm (`corepack enable`).

```bash
pnpm install
pnpm dev        # http://localhost:3000
```

That's enough to work on the UI. Without credentials, `/api/*` is proxied to the deployed API
(change it with `API_UPSTREAM_URL`), so you browse the real catalog under the public
[rate limit](#api).

## Data

| Dataset | Clips | What it is | License |
| --- | --- | --- | --- |
| [LibriSpeech](https://www.openslr.org/12) dev-clean | 2,703 | Read audiobook speech, with transcripts | CC BY 4.0 |
| [AudioCaps](https://github.com/cdjkim/audiocaps) val | 426 | 10-second YouTube sound clips, 5 captions each, plus their AudioSet labels | Captions MIT, labels CC BY 4.0; the audio belongs to the YouTube uploaders |
| [Common Voice](https://commonvoice.mozilla.org) 17.0 en, sample | 200 | Volunteers reading a sentence: one per speaker, spread over ages, genders and accents | CC0 |

- Every clip is stored as 16 kHz mono FLAC. The Blob store is private because of the AudioCaps
  audio, so don't make it public.
- Common Voice speakers are anonymous (`clientId` is a hashed id), so don't try to identify them.
  The sample comes from the public mirror
  [`fsicoli/common_voice_17_0`](https://huggingface.co/datasets/fsicoli/common_voice_17_0),
  because Mozilla's own download now requires an account.
- The schema is in [`src/server/db/schema.sql`](src/server/db/schema.sql), with migrations in
  [`src/server/db/migrations/`](src/server/db/migrations/).

## How search works

One model, `google/gemini-embedding-2`, puts text and audio in the same vector space. Each clip
has three things to match against:

| Column | Built from | Finds |
| --- | --- | --- |
| `search_text` (full-text index) | Transcript or captions | Exact words: "thank you" |
| `text_embedding` (pgvector) | Transcript or captions | Meaning: "question about pricing" |
| `audio_embedding` (pgvector) | The audio itself | Sounds: "dog barking", and search by example |

The search bar has four modes:

- **All** (the default): meaning and sound together. Each result says why it matched ("Said",
  "Caption" or "Sounds like").
- **Words**: the exact words as typed, with no stemming and no model call, so it still works if
  the AI Gateway is down.
- **Meaning**: the text vector, plus a bonus for exact words.
- **Sound**: the audio vector only. This is what finds sounds in clips nobody described.

**Ranking.** Text-to-text and text-to-audio similarities sit on different scales, so each one is
turned into a z-score: how far a clip stands above the rest of the catalog for this query. Then:

1. Clips under 3 standard deviations are dropped. In All the cut-off for the sound signal is 4,
   because typed text against audio is the weakest signal.
2. A clip whose text has every word of the query gets +3, and +1.5 more for the exact phrase.
3. Results that score under half of the best one are dropped.
4. If the best score is under 5, the response sets `strongMatch: false` and the UI says "Nothing
   clearly matches". A score of 4 or more still counts when the best text match is close
   (cosine ≥ 0.735).

The constants live in [`ranking-config.ts`](src/server/search/ranking-config.ts).

**Searching with a clip.** Use "Find similar" on any clip, upload or drop a file, record from the
microphone, or paste a link. The browser converts the audio to 16 kHz mono WAV and keeps the
first 30 seconds. Recordings have echo cancellation and noise suppression turned off, since those
would filter out the sounds you're looking for. **Sound** compares audio vectors. **Words** and
**Meaning** search with what's said in the clip: AudioCaps clips and your own audio are
transcribed by `mistral/voxtral-mini-transcribe-3` (about $0.0035 a minute). **All** combines
both. Your audio is never stored.

**Good to know:**

- The audio vector also carries spoken words, so a clip of someone saying "raining" can show up
  next to recordings of rain.
- There's no vector index. An exact scan over 3,300 clips takes a few milliseconds; HNSW is the
  next step at a much larger scale.

### How good is it?

`pnpm eval` (read-only) runs 3,341 queries built from the datasets and compares production
ranking with 9 variants and baselines. Highlights: 90% R@10 for held-out AudioCaps captions, 100%
for transcript fragments and 99% for paraphrases. The top score also tells queries with no answer
apart (AUC 0.98), which is what `strongMatch` relies on. See [`eval/report.md`](eval/report.md)
for the numbers and [`eval/README.md`](eval/README.md) for the method.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start the dev server |
| `pnpm build` / `pnpm start` | Build for production / serve that build |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | Generate route types and run `tsc` |
| `pnpm test` | Unit tests (the evaluation's metrics) |
| `pnpm eval` | Retrieval evaluation, read-only |

The catalog scripts below **write to production**. They need `.env.local` and ffmpeg
(`brew install ffmpeg`). Each one skips work that's already done, so it's safe to stop and run again.

| Command | What it does |
| --- | --- |
| `pnpm embed-catalog [--limit N]` | Embed clips that have no vectors yet (about $5 for the whole catalog) |
| `pnpm compute-waveforms [--limit N] [--all]` | Compute the 64-point waveform overviews. After changing [`peaks.ts`](src/lib/audio/peaks.ts), rerun with `--all` |
| `pnpm import-commonvoice [--dry-run] [--count N]` | Import the Common Voice sample, then run the two scripts above |
| `pnpm import-audioset-labels [--dry-run]` | Store the AudioSet labels on the AudioCaps rows |

If you change the embedding model, the vector size or the text formats in
[`embedding-config.ts`](src/server/search/embedding-config.ts), you have to embed the whole catalog again.

**AI Gateway:** there's nothing to configure. The app signs in with the project's OIDC token,
which `vercel env pull` refreshes. To use an API key instead, set `AI_GATEWAY_API_KEY`. Usage and
cost are in the team's AI Gateway tab.

## API

A public JSON API with no key. It's versioned under `/api/v1`, and breaking changes go in a new
version. Production allows **120 requests per minute per IP**, set by a Vercel Firewall rule in
the dashboard (not in this repo). Over the limit you get a `429` with the firewall's own response
body. Preview deployments require a Vercel login.

| Endpoint | Returns |
| --- | --- |
| `GET /api/v1/audios` | The catalog, paginated (`page`, `pageSize` up to 100) |
| `GET /api/v1/datasets` | Each dataset with its clip count, duration range, split and original format |
| `GET /api/v1/audios/{id}` | One clip, with its dataset's metadata (speaker, captions, AudioSet labels…) |
| `GET /api/v1/audios/{id}/audio` | The FLAC, streamed (supports `Range` and `If-None-Match`) |
| `GET /api/v1/audios/{id}/similar` | The clips that sound most like this one, each with its `similarity` |
| `GET /api/v1/audios/{id}/transcript` | What's said in it (`generated: true` when made by speech-to-text) |
| `POST /api/v1/audios/export` | A streamed ZIP of up to 200 clips plus `metadata.json`. Body: `{ "ids": [...] }` |
| `GET /api/v1/search` | Search with text (see below) |
| `POST /api/v1/search` | The same, with a WAV body as the sound to compare |
| `POST /api/v1/search/audio` | The clips that sound most like a WAV body |
| `POST /api/v1/transcriptions` | The transcript of a WAV body |
| `GET /api/v1/remote-audio?url=…` | The file behind a public audio or video link, fetched for the browser (up to 20 MB, 30 s timeout, public addresses only) |

- **Filters** for the list, search and similar endpoints: `source` (`librispeech`,
  `audiocaps` or `commonvoice`), `minDuration` and `maxDuration` (in seconds), and `limit`
  (1–100, 50 by default) for searches.
- **WAV bodies** use `Content-Type: audio/wav`, up to 2 MB, 16 kHz mono. They are processed and
  then thrown away.
- **Every clip** in every response includes `waveformPeaks`: 64 levels from 0 to 1, or `null`.

### Search

| Param | Meaning |
| --- | --- |
| `q` | The query, 1–1,000 characters. Optional when the sound comes from `soundOf` or a WAV body |
| `match` | `all` (default), `exact` (Words), `text` (Meaning) or `sound` (Sound) |
| `soundOf` | A clip id: compare with that clip's sound instead of the text of `q` |
| `exclude` | A clip id to leave out of the results |

```json
{
  "data": [
    { "id": "audiocaps-...", "source": "audiocaps", "title": "Dog, Speech · YouTube ... @ 30s",
      "text": "A dog barks and a man speaks", "durationSeconds": 10, "waveformPeaks": [...],
      "score": 8.27, "matches": ["text", "sound"] }
  ],
  "strongMatch": true
}
```

The results are a ranked list with no pagination, and often shorter than `limit`. `score` is the
z-score plus bonuses, so only compare scores within one response. Filters don't change scores,
because clips are always scored against the whole catalog. With `match=exact` there's no model
call, `score` is Postgres `ts_rank_cd`, and the query takes web-search syntax: `"a phrase"`, `or`,
`-word`.

```sh
ffmpeg -i my-dog.m4a -ac 1 -ar 16000 my-dog.wav
curl -X POST -H 'content-type: audio/wav' --data-binary @my-dog.wav \
  'https://david-ai-audio-search.vercel.app/api/v1/search/audio?limit=10'
```

### Errors

Errors look like `{ "error": { "code", "message", "details"? } }`:

| Status | Codes |
| --- | --- |
| 400 | `invalid_request`, `invalid_url` |
| 404 | `not_found` (an export lists the unknown ids in `details.missingIds`) |
| 413 | `payload_too_large` |
| 415 | `unsupported_media_type`, `not_audio` (the link is a web page, not a file) |
| 500 | `internal_error` |
| 502 / 504 | `remote_fetch_failed` / `remote_timeout` |
| 503 | `search_unavailable`, `transcription_unavailable` (the AI model can't be reached) |

> [!NOTE]
> **Known gap:** the Blob store is private, but `GET /api/v1/audios/{id}/audio` streams any clip,
> AudioCaps included, to anyone on the production domain. Fixing it means protecting that route
> or the domain.

## Project layout

```text
src/app/              routes, layouts, globals.css (theme tokens)
src/app/api/v1/       API route handlers
src/components/audios the app's UI (browser, list, search bar, details panel)
src/components/ui/    shadcn/ui components (pnpm dlx shadcn@latest add <name>)
src/lib/api/v1/       public API types and the client fetchers used by the UI
src/lib/audio/        browser audio: WAV conversion, recording, waveform peaks
src/server/api/       v1 response mappers, pagination and error helpers
src/server/audios/    record types, Postgres queries (repository.ts), Blob reads, remote fetch
src/server/db/        Neon client, schema and migrations
src/server/search/    embedding, ranking and transcription settings
scripts/              catalog scripts; scripts/eval/ and eval/ hold the evaluation
src/env.ts            typed, validated environment variables
```

To add an API v2, create `src/app/api/v2/`, `src/server/api/v2/` and `src/lib/api/v2/`. The data
layer in `src/server/audios/` is shared.

**Environment variables** are declared and validated in [`src/env.ts`](src/env.ts) and
documented in [`.env.example`](.env.example), so add any new variable to both. Validation runs on
`dev` and `build`; set `SKIP_ENV_VALIDATION=1` to skip it.
