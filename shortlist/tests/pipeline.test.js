// End-to-end run on the demo fixtures: fetch, filter, score, mark new, save.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runPipeline } from "../src/pipeline.js";

test("demo run produces a ranked shortlist with filter reasons and new flags", async () => {
  const { summary, results, dropped } = await runPipeline({ demo: true, now: Date.parse("2026-11-07T12:00:00Z") });

  assert.equal(summary.found, 19);
  assert.equal(summary.passedFilter + dropped.length, summary.found);
  assert.equal(summary.costUsd, 0, "demo mode never calls a paid API");
  assert.ok(dropped.every((d) => d.reason), "every dropped posting says why");

  for (let i = 1; i < results.length; i++) {
    assert.ok((results[i - 1].fit ?? -1) >= (results[i].fit ?? -1), "sorted by fit, highest first");
  }
  assert.ok(results.some((r) => r.isNew) && results.some((r) => !r.isNew), "has both new and previously seen roles");
  assert.ok(results.every((r) => r.text === undefined), "full descriptions are not stored in results");
});
