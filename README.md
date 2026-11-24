# AI Audio Search

Next.js 16 (App Router, Turbopack, Cache Components) with TypeScript, Tailwind CSS v4, shadcn/ui, and next-themes.

## Getting started

### Quick start (no credentials)

```bash
git clone <this repo> && cd david-ai-audio-search
pnpm install
pnpm dev                     # http://localhost:3000
```

Without a `DATABASE_URL`, the dev server proxies `/api/*` to the deployed API
(`https://david-ai-audio-search.vercel.app`, override with `API_UPSTREAM_URL`) and logs
`No DATABASE_URL: /api/* is proxied to …` at startup. You get the production catalog, subject
to the public [rate limit](#rate-limits). You only need Node.js 20.9+ and pnpm (`corepack enable`).

### With database access

To serve the API from your own machine (needed to change the route handlers or queries),
pull the project credentials. You need:

| Tool | Why | Install |
| --- | --- | --- |
| Node.js 22+ | Runs the app (the AI SDK needs 22) | [nodejs.org](https://nodejs.org) or `nvm install 22` |
| pnpm | Package manager (version pinned in `package.json`) | `corepack enable` |
| Vercel CLI | Links the project and pulls its credentials | `npm i -g vercel` then `vercel login` |

and access to the Vercel team `adrian-ferre`.

The catalog lives in the Vercel project
[`adrian-ferre/david-ai-audio-search`](https://vercel.com/adrian-ferre/david-ai-audio-search):
the rows are in Neon Postgres and the FLAC files in a private Vercel Blob store. Every
environment (development, preview, production) shares that database and store, so
`pnpm dev` serves the same data as production.

```bash
vercel link --yes --project david-ai-audio-search --scope adrian-ferre
vercel env pull .env.local   # writes the credentials; gitignored, never commit it
pnpm dev                     # http://localhost:3000, API served locally
```

`.env.local` holds secrets: keep it out of git (`.env*` is ignored), logs and screenshots.
The app only reads from the database. Since it is the production database, don't write to
it from local scripts or a SQL console unless you mean to change production.

### Data

- **LibriSpeech dev-clean**: 2,703 read-speech recordings with transcripts, from
  [OpenSLR 12](https://www.openslr.org/12). License CC BY 4.0.
- **AudioCaps val**: 426 ten-second sound clips with 5 captions each, from
  [AudioCaps](https://github.com/cdjkim/audiocaps). Captions are MIT; the audio was cut from
  YouTube videos and belongs to their uploaders. That is why the Blob store is private:
  don't make it public. The private store only blocks direct access to the files; the
  production app still streams them to anyone (see
  [`GET /api/v1/audios/{id}/audio`](#get-apiv1audiosidaudio)).
- **Common Voice 17.0 en (sample)**: 200 crowd-sourced recordings of volunteers reading a
  sentence, with the sentence as transcript, from [Mozilla Common Voice](https://commonvoice.mozilla.org).
  License CC0. One clip per speaker from the dev split, among clips with at least 2 up-votes,
  no down-votes and age, gender and accent filled in. Genders and accents are taken in turn,
  so the sample spans 39 accents and teens to eighties. Speakers are anonymous (`clientId` is
  Common Voice's hashed contributor id; don't try to identify them). Mozilla now distributes
  the dataset through its Data Collective (account required), so `pnpm import-commonvoice` reads
  the public mirror [`fsicoli/common_voice_17_0`](https://huggingface.co/datasets/fsicoli/common_voice_17_0)
  and stores the MP3s as 16 kHz mono FLAC like the rest of the catalog.

The table is described in [`src/server/db/schema.sql`](src/server/db/schema.sql).

## Search

One search box answers two different questions about a clip: what its **text** says (the
transcript of a LibriSpeech or Common Voice clip, the captions of an AudioCaps clip) and what it **sounds
like**. Both use the same model, `google/gemini-embedding-2`, which puts text and audio in one
vector space. It is called through the
[Vercel AI Gateway](https://vercel.com/docs/ai-gateway).

Each clip has up to three things to match against, all in the `audios` table:

| Column | Built from | Answers |
| --- | --- | --- |
| `search_text` (full-text index) | The transcript, or the captions | Exact words: "hello", "thank you" |
| `text_embedding` (pgvector) | The transcript, or all the captions joined | Meaning: "question about pricing" |
| `audio_embedding` (pgvector) | The waveform, every clip | Sounds: "dog barking", "coughing", and search by example |

- **Text search** embeds the query once per signal (one gateway request) and scores every clip
  on its text (text vector, plus a bonus when the text contains every word of the query) and
  on "sounds like" (audio vector). Raw similarities are not comparable: text-to-text
  and text-to-audio sit on different scales, and both shift from query to query. So each is
  turned into a z-score, how far the clip stands above the catalog's average for that query.
  A clip's score is its best signal, and clips below 3 standard deviations are dropped. Each
  result says why it matched: `text` (shown as "Said" for a transcript, "Caption" for captions),
  `sound` ("Sounds like") or both.
- **Exact words** (the "Words" filter, `match=exact`) skips the vectors: a clip matches when its
  transcript or captions contain every word of the query as typed. It doesn't stem or drop stop
  words, so "barking" doesn't match "barks" and "the end" needs both words, which is what you want
  when looking for a specific word or line. The query needs no model call, so it works even when the
  AI Gateway doesn't.
- **Search by example** ("Find similar sound" on any clip) returns the nearest neighbours of that clip's
  audio vector. It needs no model call: the vector is already stored.
- **Search with your own audio file** ("Upload", or drop a file anywhere on the
  page): the browser decodes the file (WAV, MP3, M4A, OGG, FLAC…), converts it to 16 kHz mono
  WAV like the catalog, keeps the first 30 seconds and posts it. The server embeds it the same
  way the catalog was embedded and returns the nearest audio vectors. The file is not stored.
- **Search with a recording** ("Record"): the browser records from the microphone with
  `MediaRecorder` (up to 30 seconds, stopped by "Stop and search") and sends the recording
  through the same conversion as a file. Echo cancellation and noise suppression are turned off,
  since they are tuned for voices and would filter out the sounds being searched for.
- **All, Words, Meaning or Sound, for any clip.** A search with a clip (a file, a recording, or
  "Find similar sound") has the same options as text search, in the same order, and compares its
  **Sound** by default: the audio vector, as above. **Words** and **Meaning** search by what's said
  in it instead: its transcript goes through the text search as the query, with `match=exact`
  (every word said, as said) or `match=text` (its meaning: text vector plus exact words), so it is
  compared with the transcripts and captions, not the sound. **All** is text search's All with the
  clip's own sound as the sound signal (`soundOf`, or a WAV body): a clip stands out on its sound or
  on what's said in it, and each result says which. The clip itself is left out of its own results.
  LibriSpeech and Common Voice clips come with their transcript. AudioCaps clips and your own clips
  are transcribed when All, Words or Meaning is picked, by `mistral/voxtral-mini-transcribe-3`
  through the AI Gateway (about $0.0035 a minute of audio). No speech-to-text library fits a Vercel
  Function: Whisper on ONNX needs a large runtime and model download, and Whisper also makes up
  words for clips without speech ("Thank you for watching."). Tried live on catalog clips, this
  model was as accurate as the OpenAI and Google ones, the fastest, and returned nothing when nobody
  speaks. With no speech, Words and Meaning say so and offer the sound instead; All matches on the
  sound alone. The transcript is shown under the search bar.
- **Captions are indexed as text.** A sound query such as "dog barking" can match an AudioCaps
  clip through its captions, its audio, or both. The "Sounds like" filter (`match=sound`) uses
  the audio alone, which is what finds sounds in clips nobody has described. A clip has several
  captions; a result shows the one that shares most words with the query.
- **Speech also matches "sounds like".** The audio vector carries the spoken words as well as
  the acoustics, so a clip where someone says "raining" can appear next to clips of rain.
- **The cut-off trims, it doesn't judge.** Nearest-neighbour search always has a nearest clip,
  so a query with no good answer in the catalog still returns a handful of weak results.
- **No vector index.** With about 3,300 clips an exact scan takes a few milliseconds and returns
  the true nearest neighbours. An HNSW index is the next step at a much larger scale.

### Embedding the catalog

The vectors are filled by a script. It reads each FLAC from the Blob store, converts it to WAV
(the model takes WAV or MP3) and stores the vectors. It **writes to the production database**
and spends about $5 of AI Gateway credit for the whole catalog. It only touches clips without a
vector, so it can be stopped and re-run, and running it when everything is embedded does nothing.

```bash
brew install ffmpeg      # once
pnpm embed-catalog       # add `--limit 20` for a trial run
```

The schema changes are in [`src/server/db/migrations/`](src/server/db/migrations/).
The model, vector size and text formats are in
[`src/server/search/embedding-config.ts`](src/server/search/embedding-config.ts), shared by the
script and the app. Changing any of them means embedding the catalog again.

### Adding the Common Voice sample

The Common Voice clips were added by a script, and it can be re-run. It reads the transcripts
of the mirror's en dev split and picks the sample (the same 200 clips every time). It then
streams the 717 MB audio tar once and keeps only those MP3s, converts them to FLAC, uploads them
to the private Blob store and upserts their rows. Like `embed-catalog`, it **writes to production**.
It only touches `commonvoice` rows and skips blobs and rows that are already up to date. The schema
change it needs is [`003_commonvoice.sql`](src/server/db/migrations/003_commonvoice.sql).

```bash
pnpm import-commonvoice --dry-run   # print the sample, write nothing
pnpm import-commonvoice             # add `--count N` for a different sample size
pnpm embed-catalog                  # embed the new clips (about $0.30 for 200)
pnpm compute-waveforms              # their waveform overviews
```

### Waveforms

Each clip's waveform overview is stored with it, in `waveform_peaks`
([`004_waveform_peaks.sql`](src/server/db/migrations/004_waveform_peaks.sql)), and sent by the
API, so the UI only draws it. A script fills it: it reads each FLAC from the Blob store, decodes
it to 8 kHz mono with ffmpeg and keeps the loudest sample of each of 64 equal slices, scaled so
the loudest slice is 1 (with a gentle curve, so quiet passages still show). Like `embed-catalog`,
it **writes to production**; it only touches clips without peaks and costs nothing but Blob
reads. The algorithm is in [`src/lib/audio/peaks.ts`](src/lib/audio/peaks.ts); after changing
it, recompute every clip with `--all`.

```bash
pnpm compute-waveforms   # add `--limit 20` for a trial run, `--all` to recompute every clip
```

### AI Gateway

Nothing to configure: the app authenticates to the gateway with the project's OIDC token, the
same one the Blob store uses (`vercel env pull .env.local` refreshes it locally). Models are
addressed by ID in code, so there is nothing to enable per model. Usage, cost and logs are in
the AI Gateway tab of the Vercel team. To use an API key instead of OIDC, set `AI_GATEWAY_API_KEY`.

## Scripts

| Command          | What it does                         |
| ---------------- | ------------------------------------ |
| `pnpm dev`       | Start the dev server (uses the deployed API without `.env.local`, see Getting started) |
| `pnpm build`     | Production build                     |
| `pnpm start`     | Serve the production build           |
| `pnpm lint`      | ESLint                               |
| `pnpm typecheck` | Generate route types and run `tsc`   |
| `pnpm embed-catalog` | Embed the clips that have no vector yet (see Search) |
| `pnpm import-commonvoice` | Add the Common Voice sample to the database and Blob store (see Search) |
| `pnpm compute-waveforms` | Compute the waveform overviews of the clips that have none yet (see Waveforms) |

## Project layout

- `src/app/` – routes, layouts, and `globals.css` (theme tokens)
- `src/components/ui/` – shadcn/ui components (`pnpm dlx shadcn@latest add <name>`)
- `src/components/` – app components (theme provider/toggle)
- `src/lib/` – shared utilities
- `src/server/db/` – Neon client, the catalog schema (`schema.sql`) and its migrations
- `src/server/search/` – embedding settings and the query embedding call
- `scripts/` – one-off scripts (`embed-catalog.mts`, `import-commonvoice.mts`, `compute-waveforms.mts`)
- `src/env.ts` – typed, validated environment variables (`import { env } from "@/env"`)

## API

JSON endpoints served by the app. They are versioned under `/api/vN`; once a version ships, its response shapes don't change in a breaking way. Breaking changes go in a new version.

### `GET /api/v1/audios`

Paginated list of every audio in the catalog: LibriSpeech first, then AudioCaps, then Common Voice, each sorted by id. Every item has the same shape whatever its dataset. Every item, in this list and in every other response, carries `waveformPeaks`: the clip's waveform overview, 64 levels from 0 (silence) to 1 (its loudest moment), evenly spaced over the clip, or `null` if not computed yet. The UI draws its waveforms from it.

| Query param | Default | Rules |
| --- | --- | --- |
| `page` | `1` | integer ≥ 1 (pages past the end return `data: []`) |
| `pageSize` | `50` | integer 1–100 |
| `source` | every dataset | `librispeech`, `audiocaps` or `commonvoice`: only that dataset (`total` counts only it) |

```json
{
  "data": [
    { "id": "librispeech-1272-128104-0000", "source": "librispeech", "title": "Reviews · read by John Rose",
      "text": "MISTER QUILTER IS THE APOSTLE OF ...", "durationSeconds": 5.855,
      "waveformPeaks": [0.412, 0.733, 0.951, "… 64 in all"] }
  ],
  "pagination": { "page": 1, "pageSize": 50, "total": 3329, "totalPages": 67,
                  "hasNextPage": true, "hasPreviousPage": false, "nextPage": 2, "previousPage": null }
}
```

### `GET /api/v1/datasets`

Every dataset of the catalog with its number of audios, in the list's order. The UI shows them as the sidebar's filters.

```json
{ "data": [ { "source": "librispeech", "count": 2703 }, { "source": "audiocaps", "count": 426 },
            { "source": "commonvoice", "count": 200 } ] }
```

### `GET /api/v1/audios/{id}`

One audio: the list fields plus a dataset-specific `metadata` object (speaker/chapter/transcript for LibriSpeech; YouTube id, start time and all captions for AudioCaps; anonymous speaker id, self-reported age/gender/accent, sentence and validation votes for Common Voice).

### `GET /api/v1/audios/{id}/audio`

The audio's FLAC (`audio/flac`), streamed from the private Blob store. Supports `Range` requests (`206`, or `416` for an unsatisfiable range) and `If-None-Match` (`304`). The UI uses it as the `<audio>` source of the player (the waveforms come with the list items, see `waveformPeaks`). The Blob store is private, so its files can't be fetched directly, but this route streams any clip, AudioCaps included, to anyone who can reach the app. The project uses Vercel Authentication with Standard Protection: preview and generated deployment URLs require a Vercel login, the production domain `david-ai-audio-search.vercel.app` does not. Known gap: AudioCaps audio is publicly reachable through the production API. The fix is to protect this route or the production domain; that is not done yet.

### `GET /api/v1/search`

Text search over each audio's text (transcript or captions) and what it sounds like. Returns the best matches, most
relevant first. There is no pagination: it is a ranked top list.

| Query param | Default | Rules |
| --- | --- | --- |
| `q` | required | 1–1,000 characters (room for a clip's transcript; the search box takes 200). Optional with an example's sound and `match` `all` or `sound` |
| `match` | `all` | `all`, `exact` (the exact words of the transcripts and captions, no vectors; "Words" in the UI), `text` (their meaning; "Meaning") or `sound` (the audio alone; "Sound") |
| `limit` | `50` | integer 1–100 |
| `source` | every dataset | `librispeech`, `audiocaps` or `commonvoice`: only that dataset's clips |
| `soundOf` | none | An audio's id: the sound signal compares with that audio's sound instead of the text of `q` (`404` for an unknown id) |

```json
{
  "data": [
    { "id": "audiocaps-...", "source": "audiocaps", "title": "YouTube ... @ 30s",
      "text": "A dog barks and a man speaks", "durationSeconds": 10,
      "score": 8.27, "matches": ["text", "sound"] }
  ]
}
```

`score` is how far the clip stands out from the rest of the catalog for this query, in standard
deviations (plus a bonus for exact words); compare it only within one response. With `source`, clips
are still scored against the whole catalog, so a score doesn't change with the filter. Clips that
don't stand out are left out, so the list is often shorter than `limit`.
Returns `503 search_unavailable` when the embedding model can't be reached.

With `match=exact` there is no model call and no cut-off: every clip whose text contains all the
query's words as written is returned (up to `limit`), with `matches: ["text"]`. `score` is then
Postgres's `ts_rank_cd` (more and closer occurrences rank higher). The query takes web-search
syntax: `"a phrase"`, `or`, `-word`.

`POST /api/v1/search` with a WAV body (`Content-Type: audio/wav`, same rules and errors as
`/search/audio`) works like `soundOf` for a clip outside the catalog: the sound signal compares
with the body's sound. The UI uses `soundOf` and the POST for **All** on a clip, with the clip's
transcript as `q`. The clip is embedded and discarded.

### `GET /api/v1/audios/{id}/similar`

Search by example: the audios that sound most like `{id}`, most similar first. Each item is a list
item plus `similarity` (cosine similarity, at most 1). `limit` and `source` work as above. `404` for an
unknown id.

### `GET /api/v1/audios/{id}/transcript`

What's said in the audio: `{ "data": { "text": "…", "generated": false } }`. LibriSpeech and Common
Voice return their transcript (`generated: false`). AudioCaps clips come with captions, not
transcripts, so one is made on the spot by a speech-to-text model (`generated: true`); `text` is
empty when nobody speaks. The UI searches with it (`GET /api/v1/search`, `match=all` with `soundOf`,
`exact` or `text`) when All, Words or Meaning is picked for a "similar" clip. Cached by the browser for a day. `404` for an unknown id,
`503 transcription_unavailable` when the model can't be reached.

### `POST /api/v1/audios/export`

Downloads several audios at once as a ZIP (`application/zip`, `Content-Disposition: attachment`). Body: `{ "ids": ["librispeech-1272-128104-0000", "…"] }`, 1–200 ids (duplicates are ignored).

```text
audios-2026-11-24-2.zip
├── metadata.json          { exportedAt, count, audios: [ <same shape as GET /api/v1/audios/{id}> … ] }
└── audio/
    ├── librispeech-1272-128104-0000.flac
    └── audiocaps-rqfQRErjfk8_170.flac
```

The ZIP is streamed (so it isn't bound by the 4.5 MB function response limit) and its entries are stored uncompressed (FLAC already is). Unknown ids return `404 not_found` with `details.missingIds` before anything is streamed. It is one request for the rate limit, whatever the number of ids. The UI uses it for the selection bar's **Download ZIP** (the checked rows) and for **Download › Audio + details (ZIP)** in the details panel (one audio). The panel's **Download › Audio only (FLAC)** saves only the FLAC, from `GET /api/v1/audios/{id}/audio`.

### `POST /api/v1/search/audio`

Search by your own example: the audios that sound most like the clip in the request body, most
similar first. Send a WAV file with `Content-Type: audio/wav` (at most 2 MB; 16 kHz mono, about a
minute, is what the model was given for the catalog). Items, `limit` and `source` are as in `/similar`.
The clip is embedded and discarded.

```sh
ffmpeg -i my-dog.m4a -ac 1 -ar 16000 my-dog.wav
curl -X POST -H 'content-type: audio/wav' --data-binary @my-dog.wav \
  'https://david-ai-audio-search.vercel.app/api/v1/search/audio?limit=10'
```

`415 unsupported_media_type` for another content type, `413 payload_too_large` over 2 MB,
`400 invalid_request` when the body is not a WAV file and `503 search_unavailable` when the
embedding model can't be reached.

### `POST /api/v1/transcriptions`

What's said in the WAV clip in the request body, by a speech-to-text model:
`{ "data": { "text": "…", "generated": true } }`, with an empty `text` when nobody speaks. Same body
and body errors as `/search/audio`; `503 transcription_unavailable` when the model can't be reached.
The clip is transcribed and discarded. The UI uses it when All, Words or Meaning is picked for a file or
a recording, then searches with the text.

Errors always look like `{ "error": { "code", "message", "details"? } }`: `400 invalid_request`, `404 not_found`, `413 payload_too_large`, `415 unsupported_media_type`, `500 internal_error` (e.g. the database is unreachable), `503 search_unavailable` and `503 transcription_unavailable`.

### Rate limits

The production API (`david-ai-audio-search.vercel.app`) is public and needs no key; preview
deployments require a Vercel login. The deployed app limits `/api/*` to **120 requests per
minute per IP** with a Vercel Firewall rule ("Rate limit API", in the project's Firewall
settings, not in this repo). Over the limit, requests get `429` with the firewall's own body
(not the JSON error shape above) until the minute is over; the UI shows "Too many requests" and
doesn't retry. Browsing costs one request per 50 items scrolled or per audio opened (the
waveforms come with the items), plus the audio a clip plays. Local dev servers without credentials proxy to the deployed API, so they share
the limit of your IP; with `.env.local` the local API isn't limited.

### Where the code lives

- `src/app/api/v1/**/route.ts`: route handlers.
- `src/server/api/v1/`: mappers from the internal records to the v1 response shapes.
- `src/server/api/`: shared pagination and error helpers.
- `src/server/audios/`: the internal record types and the Postgres queries (`repository.ts`).
- `src/server/db/`: the Neon client (HTTP driver, one fetch per query) and `schema.sql`.
- `src/lib/api/v1/`: the public types and the client fetchers used by the UI.

To add a v2, create `src/app/api/v2/...` and `src/server/api/v2/` mappers (and `src/lib/api/v2/` types). The data layer (`src/server/audios/`) is shared.

## Environment variables

Declare every variable in `src/env.ts` (server vars in `server`, `NEXT_PUBLIC_*` vars in `client` + `experimental__runtimeEnv`) and document it in `.env.example`. Validation runs on `dev` and `build`; set `SKIP_ENV_VALIDATION=1` to bypass it.
