Design an "Embedding Map" view for AI Audio Search (David AI), an existing audio search app.
It is a second view of the same catalog, inside the current app shell, and it will also be
screenshotted for a short technical presentation. Audience: ML/product engineers judging whether
the embeddings and the retrieval layer make sense.

## The app it lives in (keep all of this)
- Left sidebar, 240 px, background #F1F2EA: David AI logo, "Audio Search" in Besley, a
  "Search by datasets" filter (All 3,329 · LibriSpeech 2,703 · AudioCaps 426 · Common Voice 200,
  each with a 2 px-radius colour swatch and its count), and a "Search by sound" tip card. The
  dataset filter applies to every view, the map included. Add a "List | Map" switch to the
  sidebar or the top of the main area.
- Search bar with modes All / Words / Sound, plus labelled Record and Upload buttons. Results
  say why they matched: "Said" (transcript), "Caption" (AudioCaps captions) or "Sounds like"
  (audio). Search results show a 5-bar relevance meter.
- Dataset tags are pills: LibriSpeech #4B4592 (soft #E9E7F2, ink #3C3663), AudioCaps #D9822B
  (soft #F6EBDB, ink #774A16), Common Voice #3F8A73 (soft #E0ECE6, ink #2D5A4C). Use these exact
  colours for the dataset colouring on the map.
- Details panel: a seekable waveform player, the transcript or all captions, dataset details,
  "Find similar sound", and a Download menu (ZIP or FLAC). Every clip has a 64-bar waveform
  overview (waveformPeaks, 0–1), drawn in #C9CAC1.
- Grounds #F9F9F6 (page) / #F1F2EA (sidebar, muted) / #FFFFFF (cards), ink #1A1A19, muted text
  #686963, borders #E4E5DD, hairlines #ECEDE6, row hover #F4F4EF. Pill-shaped buttons. Fonts:
  Besley for titles, Inter for UI, Geist Mono for clip ids and numbers. Light mode only.

## What is being visualized
- 3,329 clips:
  - LibriSpeech dev-clean: 2,703 read-speech clips, 40 speakers (20 F / 20 M) reading 97
    chapters of 63 books, with transcripts
  - AudioCaps val: 426 ten-second sound clips, with 5 captions and AudioSet labels each.
    156 of them also contain someone speaking
  - Common Voice 17 en: 200 spoken sentences, one per speaker, with self-reported gender
    (123 male, 77 female), age (teens to eighties, mostly twenties/thirties) and accent (39)
- One model, google/gemini-embedding-2, puts text AND audio in the same 768-d space. Every clip
  has an audio vector (from the waveform) and a text vector (from its transcript, or its
  captions joined).
- Points are a 2D UMAP projection of those vectors (cosine metric), computed offline. A toggle
  switches between the audio map and the text map.

## The story the view must tell (5 steppable cards, "1 of 5")
1. "Speech and sounds live in different regions." Audio map of all clips, coloured by dataset.
   Measured: 99% of a LibriSpeech clip's 10 nearest neighbours are LibriSpeech, and 98.5% for
   AudioCaps. Common Voice blends into the speech region (34% of its neighbours are Common
   Voice), because it is speech too.
2. "Sounds cluster by what they are." AudioCaps coloured by sound family (from its AudioSet
   labels): Vehicles 123 (cars, aircraft, boats, trains, motorcycles), Animals 97 (birds,
   insects, dogs, ducks), Human sounds 53 (laughing, crying, sneezing, snoring, applause,
   footsteps), Tools & machines 39 (drills, buzzing, clocks ticking), Water & weather 38 (rain,
   streams, wind), Household & other 76 (toilet flush, dishes, doors, phones). Label each
   family's centroid on the map. Offer a "Has speech" filter: those 156 clips still sit with
   the other sounds (2.3% of their 10 nearest neighbours are speech clips, vs 1% for the rest
   of AudioCaps), so the speaking in them barely moves them.
3. "Speech clusters by what is said, not by who says it." Colour LibriSpeech by book, then
   speaker, then sex. Book and chapter form groups; sex is mixed throughout. Card numbers
   (10 nearest neighbours):
   - same chapter: 31.6% with the audio vector vs 30.5% with the text vector
   - same speaker reading another chapter: 7.6% vs 5.7%
   - same sex among other speakers: 53% (chance 50%)
   - Common Voice same gender: 59% (chance 53%)
   Takeaway: "The audio vector mostly encodes content: 'Find similar sound' on speech finds
   similar words, not similar voices. Speaker search would need a speaker-embedding model."
4. "Text and audio vectors don't sit on the same scale (the modality gap)." Two overlaid
   distributions of a query's cosine similarity: against text vectors p10/p50/p90 =
   0.54/0.59/0.64, against audio vectors 0.33/0.48/0.57. Takeaway: "That's why search turns
   each signal into a z-score before combining them."
5. "Where does a query land?" Use the existing search bar. The query appears on the map as a
   distinct marker (star/crosshair), its top 10 results are connected to it, and clips below the
   z ≥ 3 cut-off are dimmed. Results keep the Said / Caption / Sounds like tags and the
   relevance meter. Example chips with measured precision@10: dog barking (70%), baby crying
   (90%), someone sneezing (30%), thank you, question about pricing. In Sound mode only the audio
   map applies.

## Layout of the Map view (right of the existing sidebar)
- Top: the search bar, then stat tiles: 3,329 clips · 768-d · 3 datasets · 99% of a speech
  clip's neighbours are speech · "dog barking" P@10 70%.
- Main: the scatter (about 70% of the main area) with pan/zoom, lasso or box select, and a reset
  view.
- Right rail: Map: Audio | Text; Colour by: Dataset | Sound family | Book | Speaker | Sex/Gender
  | Age | Accent; a "Has speech" filter; the active story card; the modality-gap mini-chart.
- Hover a point: a white card with the dataset pill, a mini waveform (64 bars), the transcript
  or best caption (2 lines), duration, and its book/speaker or sound family.
- Click a point: the existing details panel slides in, and its 10 nearest neighbours (cosine
  similarity) are drawn on the map. "Find similar sound" highlights them in the map.
- Lasso a cluster: a summary card with N clips, the dataset mix, the top families, books or
  words, total duration, and "Download ZIP" (the app already exports selections).

## Visual rules
- 3,300 points: 3–4 px dots at ~0.7 opacity, dimmed ~0.15. The dataset colours are fixed (see
  above). Other categorical palettes (6 sound families, 63 books, 40 speakers) must stay
  colour-blind safe on #F9F9F6: show the top ~10 categories and the rest as "Other" in #C9CAC1.
- Every icon-only button has a tooltip naming its action ("Reset view", "Play", "Find similar
  sound", "Close details").
- Desktop first; at narrow widths the right rail moves under the map.

## Data
The real data is in `design/embedding-map/` of this repo (attached). Use it as-is: every clip,
position, neighbour, query result and number comes from these files. Don't invent data or
change the numbers.
- `points.json`: one entry per clip (3,329). `id`, `source` (dataset), `text` (the transcript,
  or the first AudioCaps caption), `captions` (AudioCaps, all 5), `durationSeconds`,
  `waveformPeaks` (64 bars, 0–1), its position on the audio map (`audio`) and on the text map
  (`textEmb`), and its 10 nearest neighbours by audio cosine similarity (`neighbors`: id and
  similarity). Per dataset: `soundFamily`, `soundLabels` (AudioSet) and `hasSpeech`
  (AudioCaps); `bookTitle`, `chapterId`, `speakerId` and `sex` (LibriSpeech); `gender`, `age`
  and `accent` (Common Voice). Map coordinates are in [0, 1] with the same scale on both axes;
  x grows to the right and y upward.
- `queries.json`: the 5 example queries. For each: where it lands on the audio map (its sound
  vector) and on the text map (its text vector), its real top 10 results from the production
  search API (`id`, `score`, `matches`: "text" shows as Said or Caption, "sound" as Sounds
  like), and its cosine similarity against every text vector and every audio vector (p10/p50/p90
  and a 20-bin histogram; text and audio share the bins, so they overlay).
- `summary.json`: every number quoted above and the checks behind it: dataset counts, sound
  families, neighbour statistics (`neighbors`), the same statistics on the 2D maps
  (`groupAgreement`, `maps`), each sound family's centroid on each map (`maps.*.soundFamilyCentroids`,
  for the labels in story 2), and the evaluation numbers quoted in stories 4 and 5
  (`fromEvaluation`).

What the data looks like, so the design fits it:
- On both maps the 426 AudioCaps clips form one compact island, far from the large speech
  region. Story 2 happens inside that island: zoom to it.
- 15 Common Voice clips have at least half of their 10 nearest neighbours among the sounds
  (noisy recordings); on the audio map most of them sit in the sound island.
- Story 4's numbers come from the retrieval evaluation, over many queries. The 5 example queries
  have their own distributions in `queries.json` (averaged: text 0.56/0.59/0.63, audio
  0.48/0.52/0.57): the mini-chart shows the active query's.
- A query marker can sit far from some of its results: on the audio map, "thank you" lands
  among the sounds while its results, matched by their transcripts, are speech clips. Draw the
  connecting lines anyway; that distance is the point of story 5.

Deliverables: the Map view in the app shell in its default state ("Colour by: Dataset"), the
"dog barking" query state, a hovered point, the details panel open with neighbours drawn, a
lasso selection, and the 5 story cards as presentation-ready frames.
