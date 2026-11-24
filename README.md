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
| Node.js 20.9+ | Runs the app | [nodejs.org](https://nodejs.org) or `nvm install 22` |
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
  don't make it public or serve AudioCaps audio to the public.

The table is described in [`src/server/db/schema.sql`](src/server/db/schema.sql).

## Scripts

| Command          | What it does                         |
| ---------------- | ------------------------------------ |
| `pnpm dev`       | Start the dev server (uses the deployed API without `.env.local`, see Getting started) |
| `pnpm build`     | Production build                     |
| `pnpm start`     | Serve the production build           |
| `pnpm lint`      | ESLint                               |
| `pnpm typecheck` | Generate route types and run `tsc`   |

## Project layout

- `src/app/` – routes, layouts, and `globals.css` (theme tokens)
- `src/components/ui/` – shadcn/ui components (`pnpm dlx shadcn@latest add <name>`)
- `src/components/` – app components (theme provider/toggle)
- `src/lib/` – shared utilities
- `src/server/db/` – Neon client and the catalog schema (`schema.sql`)
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

Errors always look like `{ "error": { "code", "message", "details"? } }`: `400 invalid_request`, `404 not_found` and `500 internal_error` (e.g. the database is unreachable).

### Rate limits

The API is public and needs no key. The deployed app limits `/api/*` to **120 requests per
minute per IP** with a Vercel Firewall rule ("Rate limit API", in the project's Firewall
settings, not in this repo). Over the limit, requests get `429` with the firewall's own body
(not the JSON error shape above) until the minute is over; the UI shows "Too many requests" and
doesn't retry. Browsing the UI stays far below it (one request per 50 items scrolled or per
audio opened). Local dev servers without credentials proxy to the deployed API, so they share
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
