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
 * closest clips, not answers (the API's `strongMatch`). In the evaluation it
 * flags 10 of 11 queries without an answer and 3.5% of the queries with one.
 */
export const STRONG_MATCH_SCORE = 5;
