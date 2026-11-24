# AI Audio Search

Next.js 16 (App Router, Turbopack, Cache Components) with TypeScript, Tailwind CSS v4, shadcn/ui, and next-themes.

## Getting started

### 1. Prerequisites

Runs on macOS and Linux (on Windows, use WSL).

| Tool | Why | Install |
| --- | --- | --- |
| Node.js 20.9+ | Runs the app and scripts | [nodejs.org](https://nodejs.org) or `nvm install 22` |
| pnpm | Package manager (version pinned in `package.json`) | `corepack enable` |
| ffmpeg | Cuts the AudioCaps clips | macOS: `brew install ffmpeg` · Linux: `sudo apt install ffmpeg` |
| `tar`, `unzip` | Unpack downloads | Preinstalled on macOS · Linux: `sudo apt install tar unzip` |

### 2. Install and download the datasets

```bash
git clone <this repo> && cd david-ai-audio-search
pnpm install
pnpm data:setup              # downloads the audio datasets the app uses
cp .env.example .env.local   # then fill in values
pnpm dev                     # http://localhost:3000
```

`pnpm data:setup` checks the prerequisites first, then downloads about 520 MB into `data/`:

- **LibriSpeech dev-clean**: 2,703 read-speech recordings with transcripts, from OpenSLR.
- **AudioCaps val**: up to 495 ten-second sound clips with 5 captions each, cut from YouTube.

The first run takes about 10–15 minutes. Files are cached in `~/.cache/david-ai-audio-search/`,
so re-running it, or setting up another clone on the same machine, takes seconds.
`pnpm dev` reminds you if the datasets are missing.

Good to know:

- **It's safe to re-run.** If it stops partway (network drop, YouTube rate limiting), run
  `pnpm data:setup` again and it continues where it left off.
- **Some AudioCaps clips will be missing.** About 14% of the source videos have been deleted,
  made private or age-restricted. Those are listed in `data/audiocaps/val/unavailable.json`,
  and the exact count can differ by country.
- **Licenses:** LibriSpeech is CC BY 4.0. AudioCaps captions are MIT; the audio belongs to
  the original YouTube uploaders, so keep it for local research and don't redistribute it.
- Details and file layout: [`data/README.md`](data/README.md).

## Scripts

| Command          | What it does                         |
| ---------------- | ------------------------------------ |
| `pnpm dev`       | Start the dev server (warns if datasets are missing) |
| `pnpm build`     | Production build                     |
| `pnpm start`     | Serve the production build           |
| `pnpm lint`      | ESLint                               |
| `pnpm typecheck` | Generate route types and run `tsc`   |
| `pnpm data:setup` | Download all datasets into `data/` (LibriSpeech dev-clean + AudioCaps val) |

## Project layout

- `src/app/` – routes, layouts, and `globals.css` (theme tokens)
- `src/components/ui/` – shadcn/ui components (`pnpm dlx shadcn@latest add <name>`)
- `src/components/` – app components (theme provider/toggle)
- `src/lib/` – shared utilities
- `data/` – downloaded datasets, gitignored (see `data/README.md`)
- `scripts/datasets/` – dataset download scripts
- `src/env.ts` – typed, validated environment variables (`import { env } from "@/env"`)

## API

JSON endpoints served by the app. They are versioned under `/api/vN`; once a version ships, its response shapes don't change in a breaking way. Breaking changes go in a new version.

### `GET /api/v1/audios`

Paginated list of every audio in `data/`: LibriSpeech first, then AudioCaps, each sorted by id. Every item has the same shape whatever its dataset.

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
- `src/server/audios/`: dataset loaders. They build an in-memory index once per server process.
- `src/lib/api/v1/`: the public types and the client fetchers used by the UI.

To add a v2, create `src/app/api/v2/...` and `src/server/api/v2/` mappers (and `src/lib/api/v2/` types). The dataset layer is shared.

## Environment variables

Declare every variable in `src/env.ts` (server vars in `server`, `NEXT_PUBLIC_*` vars in `client` + `experimental__runtimeEnv`) and document it in `.env.example`. Validation runs on `dev` and `build`; set `SKIP_ENV_VALIDATION=1` to bypass it.
