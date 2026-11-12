// Explore against fake job boards and a fake OpenRouter, in a temporary data folder.
// It checks what matters at 10,000 companies: the watchlist is left alone, dead boards are skipped,
// only the top roles are paid for, and nothing is paid for twice.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseDirectory, explorePool, runExplore } from "../src/explore.js";
import { runPipeline } from "../src/pipeline.js";

const NOW = Date.parse("2026-11-11T12:00:00Z");
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();
let dir;
let calls;

const DIRECTORY = [
  { ats: "greenhouse", company: "Alpha", board: "alpha" },
  { ats: "lever", company: "Beta", board: "beta" },
  { ats: "ashby", company: "Gamma", board: "gamma" },
  { ats: "greenhouse", company: "Gone", board: "gone" },
  { ats: "ashby", company: "Mine", board: "mine" }
];

function fakeInternet() {
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  return async (url, opts) => {
    calls.push(url);
    if (url.includes("openrouter.ai")) {
      const title = JSON.parse(opts.body).messages[1].content.match(/Title: (.*)/)[1];
      calls.push(`scored:${title}`);
      return ok({ choices: [{ message: { content: JSON.stringify({ fit: 70, why: "x", gap: "y", new_grad: false }) }, finish_reason: "stop" }], usage: { prompt_tokens: 1000, completion_tokens: 80, cost: 0.0002 } });
    }
    if (url.endsWith("/boards/alpha/jobs")) {
      return ok({ jobs: [
        { id: 1, title: "MBA Associate, Strategy", location: { name: "New York, NY" }, absolute_url: "https://x/1", first_published: daysAgo(2) },
        { id: 2, title: "Software Engineer", location: { name: "New York, NY" }, absolute_url: "https://x/2", first_published: daysAgo(2) }
      ] });
    }
    if (url.endsWith("/boards/alpha/jobs/1")) return ok({ content: "Strategy and operations for our MBA associate program in New York." });
    if (url.includes("/postings/beta")) {
      return ok([{ id: "b1", text: "Strategy Associate", categories: { location: "Remote" }, hostedUrl: "https://x/b1", createdAt: NOW - 86400000, descriptionPlain: "Strategy work with operations teams." }]);
    }
    if (url.includes("/job-board/gamma")) {
      return ok({ jobs: [{ id: "g1", title: "Business Operations Analyst", location: "New York", jobUrl: "https://x/g1", publishedAt: daysAgo(5), descriptionPlain: "Analyst for operations." }] });
    }
    if (url.includes("/boards/gone/")) return { ok: false, status: 404, json: async () => ({}) };
    throw new Error(`unexpected request: ${url}`);
  };
}

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "shortlist-explore-"));
  process.env.SHORTLIST_DATA_DIR = dir;
  process.env.OPENROUTER_API_KEY = "sk-or-v1-" + "e".repeat(64);
  fs.writeFileSync(path.join(dir, "watchlist.json"), JSON.stringify([{ company: "Mine", ats: "ashby", board: "mine" }]));
  fs.writeFileSync(path.join(dir, "preferences.json"), JSON.stringify({
    tracks: ["Full-time", "Program"], locations: ["New York", "Remote"], titleInclude: ["Associate", "Analyst", "Strategy"],
    titleExclude: ["Engineer"], maxAgeDays: 45, maxToScore: 2
  }));
  fs.writeFileSync(path.join(dir, "profile.md"), "## Resume\n\nMBA strategy and operations.\n\n## What I'm looking for\n\nStrategy roles.\n");
});

after(() => {
  delete process.env.SHORTLIST_DATA_DIR;
  delete process.env.OPENROUTER_API_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the directory file is read, including names with commas and quotes", () => {
  const rows = parseDirectory('ats_vendor,company_name,board_slug,last_crawled\ngreenhouse,"Acme, Inc.",acme,2026-08-01\nlever,"The ""Best"" Co",best,2026-08-01\nworkday,Skip,skip,2026-08-01\n');
  assert.deepEqual(rows, [{ ats: "greenhouse", company: "Acme, Inc.", board: "acme" }, { ats: "lever", company: "The \"Best\" Co", board: "best" }]);
  const real = parseDirectory(fs.readFileSync(new URL("../config/ats-directory.csv", import.meta.url), "utf8"));
  assert.ok(real.length > 9000, "the committed directory parses");
});

test("watchlist companies and recently dead boards are skipped; dead boards are retried after 30 days", () => {
  const pool = explorePool(DIRECTORY, [{ company: "Mine", ats: "ashby", board: "mine" }], { "greenhouse:gone": "2026-11-01" }, NOW);
  assert.deepEqual(pool.map((d) => d.company), ["Alpha", "Beta", "Gamma"]);
  const later = explorePool(DIRECTORY, [], { "greenhouse:gone": "2026-09-01" }, NOW);
  assert.ok(later.some((d) => d.company === "Gone"));
});

test("keyword-only explore costs nothing, filters, ranks, notes dead boards and leaves the watchlist alone", async () => {
  calls = [];
  const before = fs.readFileSync(path.join(dir, "watchlist.json"), "utf8");
  const r = await runExplore({ directory: DIRECTORY, fetchImpl: fakeInternet(), now: NOW, keywordsOnly: true });
  assert.equal(calls.filter((c) => c.includes("openrouter")).length, 0);
  assert.ok(!calls.some((c) => c.includes("/mine")), "the watchlist company is left to Check my list");
  const s = r.summary;
  assert.deepEqual([s.checked, s.reachable, s.notFound, s.found, s.passedFilter, s.shown, s.costUsd], [4, 3, 1, 4, 3, 2, 0]);
  assert.equal(r.more.length, 1, "roles past the top go to the keyword-ranked list");
  assert.equal(r.droppedByReason.find((d) => d.reason === "Excluded word in title").count, 1, "every drop keeps its reason");
  assert.ok(r.results.every((x) => x.isNew && x.people.length >= 3));
  assert.ok(r.results.every((x) => x.text === undefined), "descriptions are not saved");
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, "explore-dead.json"), "utf8"))), ["greenhouse:gone"]);
  assert.equal(fs.readFileSync(path.join(dir, "watchlist.json"), "utf8"), before);
  assert.ok(fs.existsSync(path.join(dir, "explore.json")));
});

test("with AI on, only the top roles are scored, and the next sweep pays for nothing", async () => {
  calls = [];
  const first = await runExplore({ directory: DIRECTORY, fetchImpl: fakeInternet(), now: NOW + 3600000 });
  assert.equal(calls.filter((c) => c.startsWith("scored:")).length, 2, "maxToScore caps the paid calls");
  assert.equal(first.summary.method, "ai");
  assert.ok(Math.abs(first.summary.costUsd - 0.0004) < 1e-9, "the cost is the sum of what OpenRouter reported");
  assert.ok(!calls.some((c) => c.includes("/gone/")), "the dead board was skipped");
  assert.ok(first.results.every((x) => !x.isNew), "roles seen on the last sweep are not new");

  calls = [];
  const second = await runExplore({ directory: DIRECTORY, fetchImpl: fakeInternet(), now: NOW + 7200000 });
  assert.equal(calls.filter((c) => c.startsWith("scored:")).length, 0);
  assert.equal(second.summary.fromCache, 2);
  assert.equal(second.summary.costUsd, 0);
});

test("adding an explored company to the watchlist does not pay for its roles again", async () => {
  const explored = JSON.parse(fs.readFileSync(path.join(dir, "explore.json"), "utf8"));
  const company = explored.results.find((x) => x.fit === 70).company;
  const entry = DIRECTORY.find((d) => d.company === company);
  fs.writeFileSync(path.join(dir, "watchlist.json"), JSON.stringify([{ company: entry.company, ats: entry.ats, board: entry.board }]));
  calls = [];
  const r = await runPipeline({ fetchImpl: fakeInternet(), now: NOW + 10800000 });
  const scoredHere = calls.filter((c) => c.startsWith("scored:")).map((c) => c.slice(7));
  const explorePaid = explored.results.filter((x) => x.company === company).map((x) => x.title);
  assert.ok(explorePaid.length > 0);
  for (const t of explorePaid) assert.ok(!scoredHere.includes(t), `${t} was already paid for by explore`);
  assert.ok(r.summary.fromCache >= explorePaid.length);
});

test("the free rank favors titles that name your kinds of role and pushes other functions down", async () => {
  const { matchScore } = await import("../src/explore.js");
  const { rankSignals } = await import("../src/setup.js");
  const signals = rankSignals({ setup: { roles: ["strategy", "supplyChain"] } });
  assert.ok(signals.includes("Supply Chain") && signals.includes("MBA") && !signals.includes("Business"));
  const strong = matchScore({ title: "MBA Associate, Supply Chain Strategy", fit: 50 }, signals);
  const plain = matchScore({ title: "Associate, Global Events", fit: 50 }, signals);
  const sales = matchScore({ title: "Business Development Representative, Strategic Accounts", fit: 100 }, signals);
  const barred = matchScore({ title: "Strategy Associate", fit: 90, dealbreaker: "Asks for 5+ years" }, signals);
  assert.equal(strong.fit, 70, "30 from overlap plus two role phrases (three match, two count)");
  assert.match(strong.why, /Title matches your roles: MBA, Strategy, Supply Chain\./);
  assert.equal(plain.fit, 30);
  assert.ok(sales.fit < strong.fit, "a sales title ranks below a supply chain title even with more shared words");
  assert.ok(barred.fit <= 20);
});

test("the page sees which explored companies are on the watchlist, and can only add ones explore found", async () => {
  const { readExplore, addFromExplore } = await import("../src/explore.js");
  const watchlistPath = path.join(dir, "watchlist.json");
  const onList = JSON.parse(fs.readFileSync(watchlistPath, "utf8"))[0];
  const page = readExplore();
  const all = [...page.results, ...page.more];
  assert.ok(all.every((r) => r.ats && r.board), "every result says which board it came from");
  assert.ok(all.filter((r) => r.company === onList.company).every((r) => r.onWatchlist));
  const other = all.find((r) => !r.onWatchlist);
  assert.ok(other, "at least one explored company is not on the watchlist yet");

  assert.throws(() => addFromExplore("greenhouse", "somebodyelse"), /not in your latest explore results/);
  assert.throws(() => addFromExplore(["greenhouse"], other.board), /Pick a company/);
  const first = addFromExplore(other.ats, other.board);
  assert.deepEqual([first.company, first.added, first.watchlistCount], [other.company, true, 2]);
  const again = addFromExplore(other.ats, other.board);
  assert.equal(again.added, false, "adding twice does not duplicate it");
  assert.equal(JSON.parse(fs.readFileSync(watchlistPath, "utf8")).length, 2);
  assert.ok(readExplore().results.filter((r) => r.company === other.company).every((r) => r.onWatchlist));
});
