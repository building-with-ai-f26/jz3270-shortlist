// A full live-mode run against fake job boards and a fake OpenRouter, in a temporary data folder.
// It checks the behavior that matters at 100+ companies: each posting is paid for once.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runPipeline } from "../src/pipeline.js";

const NOW = Date.parse("2026-11-07T12:00:00Z");
const fixtures = JSON.parse(fs.readFileSync(new URL("../fixtures/sample-postings.json", import.meta.url), "utf8"));
let dir;
let scoredTitles = [];

// Real Greenhouse lists come without descriptions, so I strip them and serve each one at its detail URL.
function fakeInternet() {
  const fx = structuredClone(fixtures);
  const details = {};
  for (const b of fx.boards) {
    const jobs = b.ats === "lever" ? b.response : b.response.jobs;
    for (const j of jobs) {
      const d = new Date(NOW - j._daysAgo * 86400000);
      if (b.ats === "lever") j.createdAt = d.getTime(); else if (b.ats === "ashby") j.publishedAt = d.toISOString(); else j.first_published = d.toISOString();
      if (b.ats === "greenhouse") { details[`${b.board}/jobs/${j.id}`] = j.content; delete j.content; }
    }
  }
  return async (url, opts) => {
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    if (url.includes("openrouter.ai")) {
      const prompt = JSON.parse(opts.body).messages[1].content;
      const title = prompt.match(/Title: (.*)/)[1];
      scoredTitles.push({ title, hasText: !/Description:\n\s*$/.test(prompt.split("Return JSON")[0]) });
      return ok({ choices: [{ message: { content: "{\"fit\": 60, \"why\": \"x\"}" }, finish_reason: "stop" }], usage: { prompt_tokens: 1000, completion_tokens: 80, cost: 0.0002 } });
    }
    const detail = Object.keys(details).find((k) => url.endsWith(k));
    if (detail) return ok({ content: details[detail] });
    const b = fx.boards.find((x) => url.includes(`/${x.board}`));
    return b ? ok(b.response) : { ok: false, status: 404, json: async () => ({}) };
  };
}

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "shortlist-test-"));
  process.env.SHORTLIST_DATA_DIR = dir;
  process.env.OPENROUTER_API_KEY = "sk-or-v1-" + "t".repeat(64);
  fs.writeFileSync(path.join(dir, "watchlist.json"), JSON.stringify(fixtures.boards.map((b) => ({ company: b.company, ats: b.ats, board: b.board }))));
  const prefs = JSON.parse(fs.readFileSync(new URL("../config/preferences.example.json", import.meta.url), "utf8"));
  fs.writeFileSync(path.join(dir, "preferences.json"), JSON.stringify({ ...prefs, maxToScore: 5 }));
  fs.writeFileSync(path.join(dir, "profile.md"), "Sample profile A");
});

after(() => {
  delete process.env.SHORTLIST_DATA_DIR;
  delete process.env.OPENROUTER_API_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

test("each check scores only postings it has not seen, until the backlog is done", async () => {
  const net = fakeInternet();

  scoredTitles = [];
  const r1 = await runPipeline({ fetchImpl: net, now: NOW });
  assert.equal(r1.summary.passedFilter, 12);
  assert.equal(r1.summary.scoredThisRun, 5);
  assert.equal(r1.summary.waiting, 7);
  assert.equal(r1.summary.fromCache, 0);
  assert.ok(Math.abs(r1.summary.costUsd - 0.001) < 1e-9);
  const firstBatch = scoredTitles.map((t) => t.title);
  assert.ok(scoredTitles.every((t) => t.hasText), "Greenhouse descriptions were fetched before scoring");

  scoredTitles = [];
  const r2 = await runPipeline({ fetchImpl: net, now: NOW + 3600000 });
  assert.equal(r2.summary.fromCache, 5);
  assert.equal(r2.summary.scoredThisRun, 5);
  assert.equal(r2.summary.waiting, 2);
  assert.ok(scoredTitles.every((t) => !firstBatch.includes(t.title)), "nothing was paid for twice");

  scoredTitles = [];
  const r3 = await runPipeline({ fetchImpl: net, now: NOW + 7200000 });
  assert.equal(r3.summary.scoredThisRun, 2);
  assert.equal(r3.summary.waiting, 0);
  assert.equal(r3.results.length, 12, "all 12 matches now show with scores");

  scoredTitles = [];
  const r4 = await runPipeline({ fetchImpl: net, now: NOW + 10800000 });
  assert.equal(r4.summary.scoredThisRun, 0);
  assert.equal(r4.summary.costUsd, 0, "a check with nothing new costs nothing");
});

test("changing the profile clears saved scores so roles are judged against the new resume", async () => {
  fs.writeFileSync(path.join(dir, "profile.md"), "Sample profile B, rewritten");
  const r = await runPipeline({ fetchImpl: fakeInternet(), now: NOW + 14400000 });
  assert.equal(r.summary.cacheReset, true);
  assert.equal(r.summary.fromCache, 0);
  assert.equal(r.summary.scoredThisRun, 5);
});

test("the filtered-out list is summarized by reason", async () => {
  const r = JSON.parse(fs.readFileSync(path.join(dir, "latest.json"), "utf8"));
  assert.equal(r.droppedCount, 7);
  const reasons = Object.fromEntries(r.droppedByReason.map((x) => [x.reason, x.count]));
  assert.equal(reasons["Excluded word in title"], 3);
  assert.equal(reasons["Location not on your list"], 3);
  assert.equal(reasons["Older than your max age"], 1);
});
