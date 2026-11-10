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
      // The fake model flags one role as a new-grad program that the title alone would not reveal.
      const newGrad = title.startsWith("Real Estate Analyst");
      return ok({ choices: [{ message: { content: JSON.stringify({ fit: 60, why: "x", new_grad: newGrad }) }, finish_reason: "stop" }], usage: { prompt_tokens: 1000, completion_tokens: 80, cost: 0.0002 } });
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
  assert.equal(r1.summary.passedFilter, 8, "internships, fellowships and pre-docs are filtered out");
  assert.equal(r1.summary.scoredThisRun, 5);
  assert.equal(r1.summary.waiting, 3);
  assert.equal(r1.summary.fromCache, 0);
  assert.ok(Math.abs(r1.summary.costUsd - 0.001) < 1e-9);
  const firstBatch = scoredTitles.map((t) => t.title);
  assert.ok(scoredTitles.every((t) => t.hasText), "Greenhouse descriptions were fetched before scoring");

  scoredTitles = [];
  const r2 = await runPipeline({ fetchImpl: net, now: NOW + 3600000 });
  assert.equal(r2.summary.fromCache, 5);
  assert.equal(r2.summary.scoredThisRun, 3);
  assert.equal(r2.summary.waiting, 0);
  assert.ok(scoredTitles.every((t) => !firstBatch.includes(t.title)), "nothing was paid for twice");

  assert.equal(r2.results.length, 8, "all 8 matches now show with scores");

  scoredTitles = [];
  const r3 = await runPipeline({ fetchImpl: net, now: NOW + 7200000 });
  assert.equal(r3.summary.scoredThisRun, 0);
  assert.equal(r3.summary.costUsd, 0, "a check with nothing new costs nothing");

  // Columns: titles and descriptions sort most roles; the model's new_grad flag catches the rest,
  // and the column survives being read back from saved scores.
  const col = Object.fromEntries(r3.results.map((x) => [x.title, x.cohort]));
  assert.equal(col["MBA Associate, Supply Chain Strategy (Class of 2027)"], "2027 grad");
  assert.equal(col["Rotational Leadership Program, MBA 2027"], "2027 grad");
  assert.equal(col["Real Estate Analyst, Distribution Network"], "2027 grad", "moved by the model's new_grad flag");
  assert.equal(col["Associate, Data Center Development"], "Open now");
  assert.ok(r3.results.every((x) => ["Full-time", "Program"].includes(x.track)), "only full-time roles and programs reach the results");
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
  assert.equal(r.droppedCount, 11);
  const byReason = Object.fromEntries(r.droppedByReason.map((x) => [x.reason, x.count]));
  assert.equal(byReason["Track is Internship"], 3, "the track rule runs before the location rule, so the Torrance internship counts here");
  assert.equal(byReason["Track is Fellowship"], 1);
  assert.equal(byReason["Track is Pre-doc"], 2);
  const reasons = Object.fromEntries(r.droppedByReason.map((x) => [x.reason, x.count]));
  assert.equal(reasons["Excluded word in title"], 3);
  assert.equal(reasons["Location not on your list"], 1);
  assert.equal(reasons["Older than your max age"], 1);
});

test("switching to keyword-only and back keeps the AI scores already paid for", async () => {
  const prefsPath = path.join(dir, "preferences.json");
  const prefs = JSON.parse(fs.readFileSync(prefsPath, "utf8"));
  const paid = fs.readFileSync(path.join(dir, "scores.json"), "utf8");

  fs.writeFileSync(prefsPath, JSON.stringify({ ...prefs, scoring: "keywords" }));
  scoredTitles = [];
  const kw = await runPipeline({ fetchImpl: fakeInternet(), now: NOW + 18000000 });
  assert.equal(scoredTitles.length, 0, "keyword-only never calls OpenRouter, even with a key saved");
  assert.equal(kw.summary.costUsd, 0);
  assert.equal(kw.summary.cacheReset, false);
  assert.equal(fs.readFileSync(path.join(dir, "scores.json"), "utf8"), paid, "the AI scores file is untouched");
  assert.ok(fs.existsSync(path.join(dir, "scores.keywords.json")));

  fs.writeFileSync(prefsPath, JSON.stringify({ ...prefs, scoring: "ai" }));
  scoredTitles = [];
  const back = await runPipeline({ fetchImpl: fakeInternet(), now: NOW + 21600000 });
  assert.equal(back.summary.cacheReset, false);
  assert.equal(back.summary.fromCache, 5, "the 5 roles scored before are reused, not paid for again");
  assert.ok(scoredTitles.length <= 3, "only roles never scored are sent to the model");
});
