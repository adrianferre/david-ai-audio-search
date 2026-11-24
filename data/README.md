# Datasets

Downloaded datasets live here. They are gitignored and fetched by the scripts in
`scripts/datasets/`. The Conductor setup script runs `pnpm data:setup`, so every
new workspace gets them automatically.

The app doesn't read this folder: it serves the catalog from Neon Postgres and keeps
the FLAC files in a private Vercel Blob store. `pnpm catalog:sync` publishes what is
here to both (see the README, "Publish the datasets").

```bash
pnpm data:setup        # everything below (checks prerequisites first)
pnpm data:librispeech  # LibriSpeech dev-clean (pass another subset as an argument)
pnpm data:audiocaps    # AudioCaps val (--split=test|train, --concurrency=N, --retry-unavailable)
```

**Shared cache.** Each dataset is downloaded once per machine into
`~/.cache/david-ai-audio-search/` (override with `DATASETS_CACHE_DIR`) and then
mirrored into this folder. On macOS the mirror uses APFS copy-on-write clones,
so extra workspaces cost no extra disk space and need no network. Scripts are
idempotent: re-running only fetches what is missing.

## LibriSpeech dev-clean

Read English speech with transcripts.

- Source: [OpenSLR 12](https://www.openslr.org/12), license CC BY 4.0
  (see `librispeech/LibriSpeech/LICENSE.TXT`)
- 2,703 utterances, ~5.4 h, 40 speakers, ~350 MB
- Audio: 16 kHz mono 16-bit FLAC

```
data/librispeech/LibriSpeech/
  SPEAKERS.TXT, CHAPTERS.TXT, BOOKS.TXT     # metadata
  dev-clean/<speaker>/<chapter>/
    <speaker>-<chapter>-<utt>.flac           # one utterance
    <speaker>-<chapter>.trans.txt            # "<utterance-id> <TRANSCRIPT>" per line
```

## AudioCaps val

General sounds (not speech) with human-written captions, 5 per clip.

- Source: [cdjkim/audiocaps](https://github.com/cdjkim/audiocaps) (CSV pinned to a
  commit; captions MIT). Audio is cut from the original YouTube videos with
  [yt-dlp](https://github.com/yt-dlp/yt-dlp) + ffmpeg; it belongs to its
  uploaders, so use it for local research only.
- 495 clips × 10 s (~82 min), a few percent are no longer on YouTube
- Audio: 16 kHz mono FLAC
- Requires `ffmpeg` on PATH (`brew install ffmpeg`). The yt-dlp binary is
  downloaded into the cache automatically and refreshed weekly.

```
data/audiocaps/val/
  audio/<youtube_id>_<start>.flac   # 10 s clip
  manifest.jsonl                    # one downloaded clip per line (see below)
  captions.csv                      # original AudioCaps CSV, all rows
  unavailable.json                  # clips whose video is gone, with the reason
```

`manifest.jsonl` line:

```json
{"id":"vfY_TJq7n_U_130","youtube_id":"vfY_TJq7n_U","start_time":130,"file":"audio/vfY_TJq7n_U_130.flac","captions":["Rustling occurs, ducks quack ...", "..."],"audiocap_ids":[97151, ...]}
```

If YouTube rate-limits the download, the script exits non-zero after fetching
what it could. Run `pnpm data:audiocaps` again to fill in the rest.
