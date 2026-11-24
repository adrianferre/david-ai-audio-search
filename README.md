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

## Environment variables

Declare every variable in `src/env.ts` (server vars in `server`, `NEXT_PUBLIC_*` vars in `client` + `experimental__runtimeEnv`) and document it in `.env.example`. Validation runs on `dev` and `build`; set `SKIP_ENV_VALIDATION=1` to bypass it.
