// The accuracy check on made-up decisions where the right answers are known.
import { test } from "node:test";
import assert from "node:assert/strict";
import { auc, aucRange, accuracyReport } from "../src/accuracy.js";

// Builds the decisions object stored in data/decisions.json.
const decisions = (list) => Object.fromEntries(list.map(([decision, fit, reason = null, method = "ai"], i) =>
  [`greenhouse:co:${i}`, { decision, reason, at: "2026-11-17T12:00:00Z", role: { fit, method, title: `Role ${i}` } }]));

test("AUC is 1 when every yes outscores every no, 0 when reversed, and 0.5 when all tie", () => {
  assert.equal(auc([80, 70], [40, 30]), 1);
  assert.equal(auc([40, 30], [80, 70]), 0);
  assert.equal(auc([50, 50], [50, 50]), 0.5);
  assert.equal(auc([70, 40], [60, 50]), 0.5, "one win and one loss for each yes");
  assert.equal(auc([], [50]), null);
});

test("the 90% range is the same every time, and narrows with more data", () => {
  // Overlapping yeses and nos, so the AUC is somewhere in the middle and its range has real width.
  const rows = (k) => Array.from({ length: k }, (_, i) => {
    const fit = 30 + ((i * 37) % 50);
    return { fit, yes: fit + ((i * 29) % 70) > 90 };
  });
  const small = aucRange(rows(20));
  assert.deepEqual(aucRange(rows(20)), small, "a fixed seed gives the same range");
  assert.ok(small[1] - small[0] > 0.1, "20 decisions leave a wide range");
  const big = aucRange(rows(200));
  assert.ok(big[1] - big[0] < small[1] - small[0], "200 decisions narrow it");
  const whole = auc(rows(200).filter((r) => r.yes).map((r) => r.fit), rows(200).filter((r) => !r.yes).map((r) => r.fit));
  assert.ok(big[0] <= whole && whole <= big[1], "the range contains the AUC itself");
});

test("a report on a clear pattern says the fit separates them well", () => {
  const r = accuracyReport(decisions([
    ["saved", 82], ["applied", 77], ["saved", 74], ["saved", 71], ["saved", 68], ["saved", 66],
    ["passed", 45, "function"], ["passed", 41, "senior"], ["passed", 38, "function"], ["passed", 52, "other"], ["passed", 35, "function"], ["passed", 30, "senior"]
  ]));
  assert.equal(r.all.auc, 1);
  assert.equal(r.all.enough, true);
  assert.match(r.all.verdict, /separates your saves from your passes well/);
  assert.deepEqual(r.all.topK, { k: 6, yes: 6 });
  assert.deepEqual(r.all.bands.map((b) => [b.label, b.decisions, b.yes]), [["Under 50", 5, 0], ["50 to 59", 1, 0], ["60 to 69", 2, 2], ["70 and up", 4, 4]]);
  assert.equal(r.coverage, null, "decisions cover low and high scores");
});

test("passes about the company or location are left out of the fairer cut", () => {
  const r = accuracyReport(decisions([
    ["saved", 60], ["saved", 62], ["passed", 90, "company"], ["passed", 85, "location"], ["passed", 40, "function"]
  ]));
  assert.equal(r.all.no, 3);
  assert.equal(r.jobOnly.no, 1);
  assert.equal(r.jobOnly.auc, 1, "a high-fit role passed for its company does not count against the fit");
  assert.ok(r.all.auc < r.jobOnly.auc);
});

test("too few decisions, a narrow range and keyword scores are all called out", () => {
  const r = accuracyReport(decisions([
    ["saved", 60], ["saved", 58], ["passed", 55, "function"], ["passed", 57, "senior"], ["saved", 30, null, "keywords"]
  ]));
  assert.equal(r.all.enough, false);
  assert.match(r.all.verdict, /Not enough decisions yet/);
  assert.match(r.coverage, /scored 55 to 60/);
  assert.equal(r.keywordDecisionsLeftOut, 1);
  assert.equal(r.all.decisions, 4);
  assert.deepEqual(accuracyReport({}).all.decisions, 0);
});
