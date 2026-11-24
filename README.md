# AI Audio Search

Next.js 16 (App Router, Turbopack, Cache Components) with TypeScript, Tailwind CSS v4, shadcn/ui, and next-themes.

## Getting started

### 1. Prerequisites

| Tool | Why | Install |
| --- | --- | --- |
| Node.js 22+ | Runs the app (the AI SDK needs 22) | [nodejs.org](https://nodejs.org) or `nvm install 22` |
| pnpm | Package manager (version pinned in `package.json`) | `corepack enable` |
| Vercel CLI | Links the project and pulls its credentials | `npm i -g vercel` then `vercel login` |

You also need access to the Vercel team `adrian-ferre`.

### 2. Install and connect to Vercel

There is no local data to download. The app reads its catalog straight from the Vercel
project [`adrian-ferre/david-ai-audio-search`](https://vercel.com/adrian-ferre/david-ai-audio-search):
the catalog is in Neon Postgres and the FLAC files in a private Vercel Blob store. Every
environment (development, preview, production) shares that database and store, so
`pnpm dev` serves the same data as production.

```bash
git clone <this repo> && cd david-ai-audio-search
pnpm install
vercel link --yes --project david-ai-audio-search --scope adrian-ferre
vercel env pull .env.local   # writes the credentials; gitignored, never commit it
pnpm dev                     # http://localhost:3000
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
  don't make it public or serve AudioCaps audio to the public.

The table is described in [`src/server/db/schema.sql`](src/server/db/schema.sql).

## Search

One search box answers two different questions about a clip: what its **text** says (the
transcript of a LibriSpeech clip, the captions of an AudioCaps clip) and what it **sounds
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
- **Search by example** ("Find similar" on any clip) returns the nearest neighbours of that clip's
  audio vector. It needs no model call: the vector is already stored.
- **Captions are indexed as text.** A sound query such as "dog barking" can match an AudioCaps
  clip through its captions, its audio, or both. The "Sounds like" filter (`match=sound`) uses
  the audio alone, which is what finds sounds in clips nobody has described. A clip has several
  captions; a result shows the one that shares most words with the query.
- **Speech also matches "sounds like".** The audio vector carries the spoken words as well as
  the acoustics, so a clip where someone says "raining" can appear next to clips of rain.
- **The cut-off trims, it doesn't judge.** Nearest-neighbour search always has a nearest clip,
  so a query with no good answer in the catalog still returns a handful of weak results.
- **No vector index.** With about 3,000 clips an exact scan takes a few milliseconds and returns
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

### AI Gateway

Nothing to configure: the app authenticates to the gateway with the project's OIDC token, the
same one the Blob store uses (`vercel env pull .env.local` refreshes it locally). Models are
addressed by ID in code, so there is nothing to enable per model. Usage, cost and logs are in
the AI Gateway tab of the Vercel team. To use an API key instead of OIDC, set `AI_GATEWAY_API_KEY`.

## Scripts

| Command          | What it does                         |
| ---------------- | ------------------------------------ |
| `pnpm dev`       | Start the dev server (needs `.env.local`, see Getting started) |
| `pnpm build`     | Production build                     |
| `pnpm start`     | Serve the production build           |
| `pnpm lint`      | ESLint                               |
| `pnpm typecheck` | Generate route types and run `tsc`   |
| `pnpm embed-catalog` | Embed the clips that have no vector yet (see Search) |

## Project layout

- `src/app/` – routes, layouts, and `globals.css` (theme tokens)
- `src/components/ui/` – shadcn/ui components (`pnpm dlx shadcn@latest add <name>`)
- `src/components/` – app components (theme provider/toggle)
- `src/lib/` – shared utilities
- `src/server/db/` – Neon client, the catalog schema (`schema.sql`) and its migrations
- `src/server/search/` – embedding settings and the query embedding call
- `scripts/` – one-off scripts (`embed-catalog.mts`)
- `src/env.ts` – typed, validated environment variables (`import { env } from "@/env"`)

## API

JSON endpoints served by the app. They are versioned under `/api/vN`; once a version ships, its response shapes don't change in a breaking way. Breaking changes go in a new version.

### `GET /api/v1/audios`

Paginated list of every audio in the catalog: LibriSpeech first, then AudioCaps, each sorted by id. Every item has the same shape whatever its dataset.

| Query param | Default | Rules |
| --- | --- | --- |
| `page` | `1` | integer ≥ 1 (pages past the end return `data: []`) |
| `pageSize` | `50` | integer 1–100 |

```json
{
  "data": [
    { "id": "librispeech-1272-128104-0000", "source": "librispeech", "title": "Reviews · read by John Rose",
      "text": "MISTER QUILTER IS THE APOSTLE OF ...", "durationSeconds": 5.855 }
  ],
  "pagination": { "page": 1, "pageSize": 50, "total": 3129, "totalPages": 63,
                  "hasNextPage": true, "hasPreviousPage": false, "nextPage": 2, "previousPage": null }
}
```

### `GET /api/v1/audios/{id}`

One audio: the list fields plus a dataset-specific `metadata` object (speaker/chapter/transcript for LibriSpeech; YouTube id, start time and all captions for AudioCaps).

### `GET /api/v1/audios/{id}/audio`

The audio's FLAC (`audio/flac`), streamed from the private Blob store. Supports `Range` requests (`206`, or `416` for an unsatisfiable range) and `If-None-Match` (`304`). The UI uses it as the `<audio>` source of the row's play button. The Blob store stays private: deployments are behind Vercel Authentication, which is what keeps the AudioCaps audio from being public.

### `GET /api/v1/search`

Text search over each audio's text (transcript or captions) and what it sounds like. Returns the best matches, most
relevant first. There is no pagination: it is a ranked top list.

| Query param | Default | Rules |
| --- | --- | --- |
| `q` | required | 1–200 characters |
| `match` | `all` | `all`, `text` (transcripts and captions) or `sound` (the audio alone) |
| `limit` | `50` | integer 1–100 |

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
deviations (plus a bonus for exact words); compare it only within one response. Clips that
don't stand out are left out, so the list is often shorter than `limit`.
Returns `503 search_unavailable` when the embedding model can't be reached.

### `GET /api/v1/audios/{id}/similar`

Search by example: the audios that sound most like `{id}`, most similar first. Each item is a list
item plus `similarity` (cosine similarity, at most 1). `limit` works as above. `404` for an
unknown id.

Errors always look like `{ "error": { "code", "message", "details"? } }`: `400 invalid_request`, `404 not_found`, `500 internal_error` (e.g. the database is unreachable) and `503 search_unavailable`.

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
