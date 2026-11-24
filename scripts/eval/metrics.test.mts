/** node --test scripts/eval/metrics.test.mts */
import assert from "node:assert/strict";
import { test } from "node:test";

import { bootstrapMean, rocAuc, scoreQuery } from "./metrics.mts";

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

test("known-item hit at rank 3", () => {
  const m = scoreQuery(["a", "b", "target", "c"], { target: 1 });
  assert.equal(m["R@1"], 0);
  assert.equal(m["R@5"], 1);
  close(m.MRR, 1 / 3);
  close(m["mAP@10"], 1 / 3);
  close(m["nDCG@10"], 1 / Math.log2(4));
  close(m["P@10"], 0.1);
});

test("relevant clip missing from the list scores zero", () => {
  const m = scoreQuery(["a", "b"], { target: 1 });
  assert.deepEqual(Object.values(m), [0, 0, 0, 0, 0, 0, 0]);
});

test("multi-relevant AP@10 and graded nDCG", () => {
  // Relevant at ranks 1 and 3 of 3 relevant: AP = (1/1 + 2/3) / 3.
  const m = scoreQuery(["x", "n1", "y", "n2"], { x: 1, y: 1, z: 1 });
  close(m["mAP@10"], (1 + 2 / 3) / 3);
  const graded = scoreQuery(["low", "high"], { high: 1, low: 0.5 });
  const dcg = 0.5 / Math.log2(2) + 1 / Math.log2(3);
  const ideal = 1 / Math.log2(2) + 0.5 / Math.log2(3);
  close(graded["nDCG@10"], dcg / ideal);
});

test("bootstrap interval contains the mean and is reproducible", () => {
  const values = Array.from({ length: 200 }, (_, i) => (i % 4 === 0 ? 1 : 0));
  const a = bootstrapMean(values, { seed: 7 });
  const b = bootstrapMean(values, { seed: 7 });
  assert.deepEqual(a, b);
  assert.ok(a.low <= 0.25 && 0.25 <= a.high);
  assert.ok(a.high - a.low < 0.15);
});

test("ROC AUC", () => {
  assert.equal(rocAuc([3, 4], [1, 2]), 1);
  assert.equal(rocAuc([1], [1]), 0.5);
  assert.equal(rocAuc([1, 3], [2]), 0.5);
});
