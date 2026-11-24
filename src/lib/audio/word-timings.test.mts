/** node --test src/lib/audio/word-timings.test.mts */
import assert from "node:assert/strict";
import { test } from "node:test";

import { alignWords, findQueryInWords, normalizeWord } from "./word-timings.ts";

const heard = (...words: [string, number, number][]) => words.map(([text, start, end]) => ({ text, start, end }));

test("normalizeWord drops case, punctuation and accents", () => {
  assert.equal(normalizeWord("QUILTER'S"), "quilters");
  assert.equal(normalizeWord("Quilter's,"), "quilters");
  assert.equal(normalizeWord("Café."), "cafe");
});

test("words spelled differently take the times of the word they line up with", () => {
  const a = alignWords("MISTER QUILTER IS HERE", heard(["Mr.", 0.5, 0.8], ["Quilter", 0.84, 1.2], ["is", 1.3, 1.4], ["here.", 1.5, 1.9]), 3)!;
  assert.deepEqual(a.timings.map((t) => [t.word, t.start, t.end]), [
    ["MISTER", 0.5, 0.8], ["QUILTER", 0.84, 1.2], ["IS", 1.3, 1.4], ["HERE", 1.5, 1.9],
  ]);
  assert.equal(a.exactShare, 0.75);
});

test("a number written as one word shares its time with the words it stands for", () => {
  const a = alignWords("IN NINETEEN NINETY WE", heard(["In", 0, 0.2], ["1990", 0.2, 1.0], ["we", 1.0, 1.2]), 2)!;
  const [, nineteen, ninety] = a.timings;
  assert.deepEqual([nineteen.start, nineteen.end, ninety.start, ninety.end], [0.2, 0.6, 0.6, 1]);
});

test("a word the model missed gets the gap between its neighbours", () => {
  const a = alignWords("ONE TWO THREE", heard(["one", 0, 0.3], ["three", 1.0, 1.3]), 2)!;
  assert.deepEqual([a.timings[1].start, a.timings[1].end], [0.3, 1]);
});

test("extra words the model heard are ignored", () => {
  const a = alignWords("HELLO WORLD", heard(["uh", 0, 0.1], ["hello", 0.2, 0.5], ["world", 0.6, 1]), 2)!;
  assert.deepEqual(a.timings.map((t) => t.start), [0.2, 0.6]);
  assert.equal(a.exactShare, 1);
});

test("no heard words: no alignment", () => {
  assert.equal(alignWords("HELLO", [], 1), null);
});

const timings = [
  { word: "THE", start: 0, end: 0.1 }, { word: "DOG", start: 0.1, end: 0.4 }, { word: "BARKS", start: 0.4, end: 0.8 },
  { word: "AT", start: 0.8, end: 0.9 }, { word: "THE", start: 0.9, end: 1 }, { word: "END.", start: 1, end: 1.3 },
];

test("a phrase is found as a whole", () => {
  assert.deepEqual(findQueryInWords(timings, "the end", { exact: true }), [{ start: 0.9, end: 1.3 }]);
});

test("without the phrase, each word but the common ones", () => {
  assert.deepEqual(findQueryInWords(timings, "the dog end", { exact: true }), [{ start: 0.1, end: 0.4 }, { start: 1, end: 1.3 }]);
});

test("loose matching finds other forms of a word; exact doesn't", () => {
  assert.deepEqual(findQueryInWords(timings, "barking"), [{ start: 0.4, end: 0.8 }]);
  assert.deepEqual(findQueryInWords(timings, "barking", { exact: true }), []);
});

test("excluded words are not pointed at", () => {
  assert.deepEqual(findQueryInWords(timings, "dog -barks", { exact: true }), [{ start: 0.1, end: 0.4 }]);
});

test("a word is also found inside a possessive or a hyphenated word", () => {
  const words = [{ word: "MISTER", start: 0, end: 0.3 }, { word: "QUILTER'S", start: 0.3, end: 0.8 }, { word: "well-known", start: 0.8, end: 1.2 }];
  assert.deepEqual(findQueryInWords(words, "quilter", { exact: true }), [{ start: 0.3, end: 0.8 }]);
  assert.deepEqual(findQueryInWords(words, "quilter's", { exact: true }), [{ start: 0.3, end: 0.8 }]);
  assert.deepEqual(findQueryInWords(words, "known", { exact: true }), [{ start: 0.8, end: 1.2 }]);
  assert.deepEqual(findQueryInWords(words, "mister quilter", { exact: true }), [{ start: 0, end: 0.8 }]);
});
