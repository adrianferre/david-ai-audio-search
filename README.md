# AI Audio Search

Next.js 16 (App Router, Turbopack, Cache Components) with TypeScript, Tailwind CSS v4, shadcn/ui, and next-themes.

## Getting started

### 1. Prerequisites

| Tool | Why | Install |
| --- | --- | --- |
| Node.js 20.9+ | Runs the app | [nodejs.org](https://nodejs.org) or `nvm install 22` |
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

## Scripts

| Command          | What it does                         |
| ---------------- | ------------------------------------ |
| `pnpm dev`       | Start the dev server (needs `.env.local`, see Getting started) |
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

Errors always look like `{ "error": { "code", "message", "details"? } }`: `400 invalid_request` and `404 not_found`.

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
