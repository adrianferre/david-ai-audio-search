/**
 * When each word of a clip's transcript is said. Stored with the clip in the
 * `audios` table (`word_timings`, migrations/006_word_timings.sql): one entry per
 * word of the dataset's transcript, in order. scripts/compute-word-timings.mts
 * computes them by transcribing the clip with a speech-to-text model that times
 * its words, then lining those words up with the transcript (`alignWords`), so
 * the times belong to the words the UI shows, not to the model's own spelling.
 *
 * No imports and no `server-only`: plain Node loads this file from the script,
 * and the server and the browser use the matching helpers.
 */

/** One word of the transcript, as written there (punctuation included), and when it is said. */
export type WordTiming = {
  word: string;
  /** Seconds from the start of the clip. */
  start: number;
  end: number;
};

/** A word the speech-to-text model heard, with its times. */
export type TimedWord = { text: string; start: number; end: number };

/** The words of a transcript as stored: split on whitespace, punctuation kept. */
export function transcriptWords(transcript: string): string[] {
  return transcript.split(/\s+/).filter(Boolean);
}

/**
 * A word reduced to what compares: lower case, no accents, letters and digits
 * only. "QUILTER'S" and "Quilter's," both become "quilters".
 */
export function normalizeWord(word: string): string {
  return word.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

/** 0 for the same word, up to 1 for words with nothing in common. */
function substitutionCost(a: string, b: string): number {
  if (a === b) return 0;
  return editDistance(a, b) / Math.max(a.length, b.length, 1);
}

/** Cost of a transcript word the model didn't hear, or of a word the model heard that isn't in the transcript. */
const GAP_COST = 1;

/** Shortest time a word lined up by interpolation gets, in seconds, when there is room. */
const MIN_WORD_SECONDS = 0.08;

const round = (seconds: number) => Math.round(seconds * 1000) / 1000;

export type Alignment = {
  timings: WordTiming[];
  /** Share of the transcript's words the model heard exactly (after `normalizeWord`), from 0 to 1. */
  exactShare: number;
};

/**
 * Times the words of `transcript` with the words the model heard (`heard`, in
 * order). The two are lined up by edit distance over words: a transcript word
 * takes the times of the heard word it lines up with, even when spelled
 * differently ("MISTER" and "Mr."). Words the model missed, or wrote as fewer
 * words ("NINETEEN NINETY" as "1990"), share the time between their
 * neighbours, or the time of the differently spelled word next to them when
 * the gap is too short. Null when the transcript or `heard` has no words.
 */
export function alignWords(transcript: string, heard: TimedWord[], durationSeconds: number): Alignment | null {
  const words = transcriptWords(transcript);
  const said = heard
    .map((w) => ({ ...w, norm: normalizeWord(w.text) }))
    .filter((w) => w.norm !== "" && Number.isFinite(w.start) && Number.isFinite(w.end));
  if (words.length === 0 || said.length === 0) return null;
  const norms = words.map(normalizeWord);

  // cost[i][j]: lining up the first i transcript words with the first j heard ones.
  const n = words.length;
  const m = said.length;
  const cost = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  const move = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1)); // 0 pair, 1 skip transcript word, 2 skip heard word
  for (let i = 1; i <= n; i++) { cost[i][0] = i * GAP_COST; move[i][0] = 1; }
  for (let j = 1; j <= m; j++) { cost[0][j] = j * GAP_COST; move[0][j] = 2; }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const pair = cost[i - 1][j - 1] + substitutionCost(norms[i - 1], said[j - 1].norm);
      const skipWord = cost[i - 1][j] + GAP_COST;
      const skipHeard = cost[i][j - 1] + GAP_COST;
      if (pair <= skipWord && pair <= skipHeard) { cost[i][j] = pair; move[i][j] = 0; }
      else if (skipWord <= skipHeard) { cost[i][j] = skipWord; move[i][j] = 1; }
      else { cost[i][j] = skipHeard; move[i][j] = 2; }
    }
  }

  // The heard word each transcript word lines up with, or -1.
  const pairedWith = new Array<number>(n).fill(-1);
  for (let i = n, j = m; i > 0 || j > 0;) {
    const step = move[i][j];
    if (step === 0) { pairedWith[i - 1] = j - 1; i--; j--; }
    else if (step === 1) i--;
    else j--;
  }

  const start = new Array<number>(n);
  const end = new Array<number>(n);
  const exact = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) {
    const j = pairedWith[i];
    if (j === -1) continue;
    start[i] = said[j].start;
    end[i] = said[j].end;
    exact[i] = norms[i] === said[j].norm;
  }

  // Runs of transcript words with no heard word: give them the time in between.
  for (let i = 0; i < n; i++) {
    if (pairedWith[i] !== -1) continue;
    let last = i;
    while (last + 1 < n && pairedWith[last + 1] === -1) last++;
    let first = i;
    const count = last - first + 1;
    let from = first > 0 ? end[first - 1] : Math.max(0, start[last + 1] - count * 0.3);
    let to = last + 1 < n ? start[last + 1] : Math.min(durationSeconds, end[first - 1] + count * 0.3);
    // Too short a gap: share the time of a differently spelled neighbour ("1990" for "NINETEEN NINETY").
    if (to - from < count * MIN_WORD_SECONDS) {
      if (first > 0 && !exact[first - 1]) {
        first--;
        from = start[first];
      } else if (last + 1 < n && !exact[last + 1]) {
        last++;
        to = end[last];
      }
    }
    const share = Math.max(0, to - from) / (last - first + 1);
    for (let k = first; k <= last; k++) {
      start[k] = from + (k - first) * share;
      end[k] = from + (k - first + 1) * share;
    }
    i = last;
  }

  return {
    timings: words.map((word, i) => ({ word, start: round(start[i]), end: round(end[i]) })),
    exactShare: exact.filter(Boolean).length / n,
  };
}

/** Words too common to point at on their own; still matched inside a phrase ("the end"). */
const STOP_WORDS = new Set(
  ("a an and are as at be but by for from had has have he her his i if in into is it its me my no not of on or our " +
    "she so that the their them then there they this to was we were what when which who will with you your").split(" "),
);

/**
 * "barking", "barked" and "barks" all become "bark", "house" and "houses"
 * "hous": loose matching for the Meaning and All searches.
 */
function stem(word: string): string {
  for (const suffix of ["ing", "ed", "es", "s"]) {
    if (word.length > suffix.length + 2 && word.endsWith(suffix)) {
      word = word.slice(0, -suffix.length);
      break;
    }
  }
  return word.length > 3 && word.endsWith("e") ? word.slice(0, -1) : word;
}

/**
 * Where the words of `query` are said in a clip, from its word timings: the
 * spans (start and end, in seconds) to point at. The whole query, words in a
 * row, when the transcript has it; otherwise each of its words (but the
 * common ones, unless the query has nothing else). `exact` compares the words
 * as typed, as the Words search does; otherwise "barks" also finds "barking".
 * Web-search syntax is read loosely: quotes and `or` are ignored, and a word
 * excluded with `-word` is not pointed at.
 */
export function findQueryInWords(
  timings: readonly WordTiming[],
  query: string,
  { exact = false }: { exact?: boolean } = {},
): { start: number; end: number }[] {
  const key = exact ? normalizeWord : (word: string) => stem(normalizeWord(word));
  const tokens = query
    .split(/\s+/)
    .filter((token) => !token.startsWith("-") && token.toLowerCase() !== "or" && normalizeWord(token) !== "");
  const queryKeys = tokens.map(key);
  if (queryKeys.length === 0) return [];
  // A transcript word also answers to its parts, as the full-text search splits it:
  // "QUILTER'S" to "quilter", "WELL-KNOWN" to "well" and "known".
  const keys = timings.map((t) => {
    const parts = t.word.split(/['’‘-]|[–—]/).map(key).filter(Boolean);
    return new Set([key(t.word), ...parts]);
  });

  const spans: { start: number; end: number }[] = [];
  if (queryKeys.length > 1) {
    for (let i = 0; i + queryKeys.length <= keys.length; i++) {
      if (queryKeys.every((k, offset) => keys[i + offset].has(k))) {
        spans.push({ start: timings[i].start, end: timings[i + queryKeys.length - 1].end });
        i += queryKeys.length - 1;
      }
    }
    if (spans.length > 0) return spans;
  }

  const meaningful = queryKeys.filter((_, i) => !STOP_WORDS.has(normalizeWord(tokens[i])));
  const wanted = new Set(meaningful.length > 0 ? meaningful : queryKeys);
  keys.forEach((candidates, i) => {
    if ([...candidates].some((k) => wanted.has(k))) spans.push({ start: timings[i].start, end: timings[i].end });
  });
  return spans;
}
