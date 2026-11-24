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

/** Added when the clip's text contains every word of the query: worth one clear match. */
export const EXACT_WORDS_BONUS = 3;
