/**
 * Ranking constants shared by the search query (src/server/audios/repository.ts)
 * and the retrieval evaluation (scripts/eval/), which re-implements the ranking
 * to test variants offline. Keep both in sync through this file.
 *
 * No imports and no `server-only`: plain Node loads this file from the scripts.
 */

/**
 * A vector list has no natural end, since every clip has some similarity to
 * every query. Below this z-score a clip is not a match. It trims the tail; it
 * cannot tell that a query has no good answer (the nearest clips to nonsense
 * still stand out a little).
 */
export const MIN_Z_SCORE = 3;

/**
 * The cut-off of the sound signal when it comes from typed text and comes
 * second, next to the text (All). Text compared with audio vectors is the weak
 * signal: at z 3–4 it is mostly sound effects that happen to sit near any short
 * query ("hello" → bells, sirens, whistling), and in All the text already finds
 * what those would. The Sound filter alone, and an example's sound (`soundOf`,
 * an uploaded clip), keep MIN_Z_SCORE.
 */
export const MIN_TYPED_SOUND_Z_SCORE = 4;

/** Added when the clip's text contains every word of the query: worth one clear match. */
export const EXACT_WORDS_BONUS = 3;

/**
 * Added on top when the text contains the query as typed, words in a row and
 * unstemmed ("thank you", not "thanked" or "thanks for"): the line itself.
 * Not when the query excludes a word (`cat -dog`): the phrase drops the `-`.
 */
export const EXACT_PHRASE_BONUS = 1.5;

/**
 * A result must score at least this share of the best result. One clip that
 * says "hello" (9.8) should not come with twenty that merely stand out a
 * little (3–4). It adapts to each query, unlike a higher MIN_Z_SCORE. At 0.6
 * and above it starts to drop the right clip of long caption queries.
 */
export const MIN_SHARE_OF_BEST = 0.5;

/**
 * Below this top score, nothing clearly matches the query: the results are the
 * closest clips, not answers (the API's `strongMatch`), unless the best text
 * match is close in absolute terms (STRONG_MATCH_TEXT_COSINE, below). In the
 * evaluation the score alone flags 10 of 11 queries without an answer and 3.5%
 * of the queries with one.
 */
export const STRONG_MATCH_SCORE = 5;

/**
 * A z-score measures how rare a match is, not how close: when a query fits a
 * large group of clips ("english conversations in noisy settings": dozens of
 * captions are people speaking over engines), the right clip can't stand far
 * above the rest, and it scored 4.6 at a text cosine of 0.748. So a top score
 * from STRONG_MATCH_MIN_SCORE also counts as a clear match when the best text
 * match is this close in absolute terms (raw cosine of the text vectors). In
 * the evaluation the queries without an answer reach at most 0.724 (bar one
 * already over 5), and the rule clears about two thirds of the answerable
 * queries the score alone flags. Tied to the embedding model and the query
 * format (embedding-config.ts): recalibrate with `pnpm eval` when either changes.
 */
export const STRONG_MATCH_TEXT_COSINE = 0.735;

/** The lowest top score that STRONG_MATCH_TEXT_COSINE can make a clear match. */
export const STRONG_MATCH_MIN_SCORE = 4;

/**
 * Whether something clearly matches a typed query, from the best result's
 * score and the raw cosine of the best text match among the results (null when
 * no result matched by text).
 */
export function isStrongMatch(bestScore: number, bestTextCosine: number | null): boolean {
  if (bestScore >= STRONG_MATCH_SCORE) return true;
  return bestScore >= STRONG_MATCH_MIN_SCORE && bestTextCosine !== null && bestTextCosine >= STRONG_MATCH_TEXT_COSINE;
}
