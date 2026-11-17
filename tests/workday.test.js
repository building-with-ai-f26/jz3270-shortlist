// Workday support, tested against a fake Workday careers site in the shape of the real search API.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseWorkdayUrl, workdayAgeDays, fetchBoard, fillDetails } from "../src/sources.js";
import { runPipeline } from "../src/pipeline.js";

const NOW = Date.parse("2026-11-07T12:00:00Z");
const SITE = "https://acme.wd5.myworkdayjobs.com/AcmeCareers";
const API = "https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/AcmeCareers";

// 25 postings match "MBA" (so paging is needed), and one of them also matches "2027" (so de-duplication is needed).
const JOBS = Array.from({ length: 25 }, (_, i) => ({
  title: i === 0 ? "MBA Rotational Program, Class of 2027" : `Strategy Associate ${i}`,
  externalPath: `/job/New-York-NY/Role-${i}_JR${i}`,
  locationsText: i === 1 ? "3 Locations" : i === 2 ? "Bengaluru, India" : "New York, NY",
  postedOn: i === 0 ? "Posted Yesterday" : "Posted 3 Days Ago"
}));
const DETAILS = {
  "/job/New-York-NY/Role-0_JR0": { jobDescription: "<p>Two-year program for MBA graduates starting summer 2027.</p>", location: "New York, NY" },
  "/job/New-York-NY/Role-1_JR1": { jobDescription: "<p>Own pricing strategy.</p>", location: "Bengaluru, India", additionalLocations: ["Pune, India"] }
};

function fakeWorkday(log = []) {
  return async (url, opts = {}) => {
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    if (url.includes("openrouter.ai")) {
      return ok({ choices: [{ message: { content: "{\"fit\": 70, \"why\": \"x\"}" }, finish_reason: "stop" }], usage: { prompt_tokens: 900, completion_tokens: 60, cost: 0.0002 } });
    }
    if (url === `${API}/jobs` && opts.method === "POST") {
      const body = JSON.parse(opts.body);
      log.push(body);
      const matches = body.searchText === "MBA" ? JOBS : body.searchText === "2027" ? [JOBS[0]] : [];
      return ok({ total: matches.length, jobPostings: matches.slice(body.offset, body.offset + body.limit) });
    }
    const detail = Object.keys(DETAILS).find((k) => url === `${API}${k}`);
    if (detail) return ok({ jobPostingInfo: DETAILS[detail] });
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

test("reads Workday careers links, with or without a locale", () => {
  assert.deepEqual(parseWorkdayUrl("https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/x"),
    { host: "nvidia.wd5.myworkdayjobs.com", tenant: "nvidia", site: "NVIDIAExternalCareerSite", base: "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite" });
  assert.equal(parseWorkdayUrl("https://wd1.myworkdaysite.com/recruiting/acme/Careers").tenant, "acme");
  assert.equal(parseWorkdayUrl("https://www.tesla.com/careers"), null);
});

test("turns Workday's 'Posted N Days Ago' into days", () => {
  assert.deepEqual(["Posted Today", "Posted Yesterday", "Posted 3 Days Ago", "Posted 30+ Days Ago"].map(workdayAgeDays), [0, 1, 3, 31]);
});

test("searches page by 20, merge duplicates across searches, and build working links", async () => {
  const log = [];
  const r = await fetchBoard({ company: "Acme", ats: "workday", board: "acme/AcmeCareers", url: SITE }, fakeWorkday(log), { searches: ["MBA", "2027"], maxPerSearch: 40, now: NOW });
  assert.equal(r.error, null);
  assert.equal(r.postings.length, 25, "the 2027 match was already found by the MBA search");
  assert.deepEqual(log.map((b) => [b.searchText, b.offset]), [["MBA", 0], ["MBA", 20], ["2027", 0]]);
  assert.ok(log.every((b) => b.limit === 20), "Workday rejects pages bigger than 20");
  const first = r.postings[0];
  assert.equal(first.url, "https://acme.wd5.myworkdayjobs.com/AcmeCareers/job/New-York-NY/Role-0_JR0");
  assert.equal(first.postedAt, new Date(NOW - 86400000).toISOString());
  assert.equal(r.postings[1].location, "", "\"3 Locations\" is left blank until the detail page fills it in");
});

test("a wrong Workday link is reported clearly", async () => {
  const r = await fetchBoard({ company: "Typo", ats: "workday", board: "x/y", url: "https://typo.wd1.myworkdayjobs.com/Nope" }, fakeWorkday(), { searches: ["MBA"] });
  assert.match(r.error, /not found/);
  const r2 = await fetchBoard({ company: "No link", ats: "workday", board: "x/y" }, fakeWorkday());
  assert.match(r2.error, /needs a careers link/);
});

test("detail pages fill in the description and the real location", async () => {
  const r = await fetchBoard({ company: "Acme", ats: "workday", board: "acme/AcmeCareers", url: SITE }, fakeWorkday(), { searches: ["2027"], now: NOW });
  const [filled] = await fillDetails(r.postings, fakeWorkday());
  assert.match(filled.text, /MBA graduates starting summer 2027/);
});

// ---- Full run in a temporary data folder ----
let dir;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "shortlist-wd-"));
  process.env.SHORTLIST_DATA_DIR = dir;
  process.env.OPENROUTER_API_KEY = "sk-or-v1-" + "w".repeat(64);
  fs.writeFileSync(path.join(dir, "watchlist.json"), JSON.stringify([{ company: "Acme", ats: "workday", board: "acme/AcmeCareers", url: SITE }]));
  const prefs = JSON.parse(fs.readFileSync(new URL("../config/preferences.example.json", import.meta.url), "utf8"));
  fs.writeFileSync(path.join(dir, "preferences.json"), JSON.stringify({ ...prefs, workdaySearch: ["MBA", "2027"], maxToScore: 40 }));
  fs.writeFileSync(path.join(dir, "profile.md"), "Sample profile");
});
after(() => {
  delete process.env.SHORTLIST_DATA_DIR;
  delete process.env.OPENROUTER_API_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a full check on a Workday company: India roles are dropped, the 2027 program lands in the 2027 column", async () => {
  const r = await runPipeline({ fetchImpl: fakeWorkday(), now: NOW });
  assert.equal(r.summary.found, 25);
  const titles = r.results.map((x) => x.title);
  assert.ok(!titles.includes("Strategy Associate 2"), "Bengaluru is filtered out by location right away");
  assert.ok(!titles.includes("Strategy Associate 1"), "the \"3 Locations\" role turns out to be in India and is dropped before scoring");
  assert.ok(r.dropped.some((d) => d.title === "Strategy Associate 1" && /Bengaluru/.test(d.reason)));
  const program = r.results.find((x) => x.title === "MBA Rotational Program, Class of 2027");
  assert.equal(program.cohort, "2027 grad");
  assert.equal(program.fit, 70);
  assert.equal(r.summary.passedFilter, r.results.length);
});

// ---- SmartRecruiters ----
import { parseBoardUrl } from "../src/sources.js";

test("SmartRecruiters: searches with your terms, merges duplicates, and fills descriptions", async () => {
  const asked = [];
  const posting = (id, name, city) => ({ id, name, releasedDate: "2026-11-05T10:00:00.000Z", location: { city, region: "NY", country: "us", remote: false }, department: { label: "Strategy" } });
  const fake = async (url) => {
    asked.push(url);
    const ok = (b) => ({ ok: true, status: 200, json: async () => b });
    if (url.includes("/postings?q=MBA")) return ok({ totalFound: 2, content: [posting("101", "MBA Associate, Strategy", "New York"), posting("102", "Business Analyst", "New York")] });
    if (url.includes("/postings?q=2027")) return ok({ totalFound: 1, content: [posting("101", "MBA Associate, Strategy", "New York")] });
    if (url.endsWith("/postings/101")) return ok({ jobAd: { sections: { jobDescription: { text: "<p>For MBA graduates starting summer 2027.</p>" }, qualifications: { text: "<ul><li>MBA 2027</li></ul>" } } } });
    return ok({ totalFound: 0, content: [] });
  };
  const r = await fetchBoard({ company: "ServiceNow", ats: "smartrecruiters", board: "ServiceNow" }, fake, { searches: ["MBA", "2027"] });
  assert.equal(r.error, null);
  assert.equal(r.postings.length, 2);
  assert.equal(r.postings[0].url, "https://jobs.smartrecruiters.com/ServiceNow/101");
  assert.equal(r.postings[0].location, "New York, NY, US");
  const [filled] = await fillDetails([r.postings[0]], fake);
  assert.match(filled.text, /starting summer 2027/);
  assert.match(filled.text, /MBA 2027/);
});

test("pasted SmartRecruiters links are recognized", () => {
  assert.deepEqual(parseBoardUrl("https://jobs.smartrecruiters.com/ServiceNow"), { ats: "smartrecruiters", board: "ServiceNow" });
  assert.deepEqual(parseBoardUrl("https://careers.smartrecruiters.com/ServiceNow/jobs"), { ats: "smartrecruiters", board: "ServiceNow" });
});

// ---- Workday rate limits (HTTP 429) ----
import { fetchAll, WORKDAY_THROTTLED } from "../src/sources.js";

// A Workday site that answers "too many requests" for the first few searches, then works.
function throttledWorkday(failures, retryAfter = null) {
  let left = failures;
  return async (url) => {
    if (url.includes("/jobs") && left > 0) {
      left--;
      return { ok: false, status: 429, headers: { get: (h) => (h === "retry-after" ? retryAfter : null) }, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => ({ jobPostings: [JOBS[0]] }) };
  };
}
const acme = { company: "Acme", ats: "workday", board: "acme/AcmeCareers", url: SITE };

test("a Workday 'too many requests' answer is waited out and the same search retried", async () => {
  const waits = [];
  const r = await fetchBoard(acme, throttledWorkday(2), { searches: ["MBA"], maxPerSearch: 20, now: NOW, wait: async (ms) => { waits.push(ms); }, pauseMs: 0 });
  assert.equal(r.error, null);
  assert.equal(r.postings.length, 1);
  assert.deepEqual(waits, [2000, 4000], "2 seconds, then 4");
});

test("Workday's own Retry-After is used when it sends one", async () => {
  const waits = [];
  await fetchBoard(acme, throttledWorkday(1, "3"), { searches: ["MBA"], maxPerSearch: 20, now: NOW, wait: async (ms) => { waits.push(ms); }, pauseMs: 0 });
  assert.deepEqual(waits, [3000]);
});

test("after three retries it gives up with a message that says to wait, not that the link is broken", async () => {
  const waits = [];
  const r = await fetchBoard(acme, throttledWorkday(99), { searches: ["MBA"], maxPerSearch: 20, now: NOW, wait: async (ms) => { waits.push(ms); }, pauseMs: 0 });
  assert.equal(r.error, WORKDAY_THROTTLED);
  assert.deepEqual(waits, [2000, 4000, 8000]);
});

test("a short pause separates one company's Workday searches", async () => {
  const waits = [];
  await fetchBoard(acme, throttledWorkday(0), { searches: ["MBA", "2027", "rotational"], maxPerSearch: 20, now: NOW, wait: async (ms) => { waits.push(ms); } });
  assert.deepEqual(waits, [250, 250], "a pause before each search after the first");
});

test("Workday companies run 2 at a time while other boards still run 8 at a time", async () => {
  const live = { workday: 0, other: 0 };
  const peak = { workday: 0, other: 0 };
  const fake = async (url) => {
    const kind = url.includes("myworkdayjobs") ? "workday" : "other";
    live[kind]++;
    peak[kind] = Math.max(peak[kind], live[kind]);
    await new Promise((r) => setTimeout(r, 5));
    live[kind]--;
    return kind === "workday"
      ? { ok: true, status: 200, json: async () => ({ jobPostings: [] }) }
      : { ok: true, status: 200, json: async () => ({ jobs: [] }) };
  };
  const list = [
    ...Array.from({ length: 6 }, (_, i) => ({ company: `W${i}`, ats: "workday", board: `w${i}/Careers`, url: `https://w${i}.wd5.myworkdayjobs.com/Careers` })),
    ...Array.from({ length: 12 }, (_, i) => ({ company: `G${i}`, ats: "greenhouse", board: `g${i}` }))
  ];
  const results = await fetchAll(list, fake, 8, { searches: ["MBA"], maxPerSearch: 20, pauseMs: 0 });
  assert.equal(peak.workday, 2);
  assert.ok(peak.other > 2 && peak.other <= 8);
  assert.deepEqual(results.map((r) => r.entry.company), list.map((e) => e.company), "results keep watchlist order");
});

test("a company stops searching once Workday still refuses after every retry", async () => {
  let calls = 0;
  const fake = async (url) => { calls++; return { ok: false, status: 429, headers: { get: () => null }, json: async () => ({}) }; };
  const r = await fetchBoard(acme, fake, { searches: ["MBA", "2027", "rotational", "strategy"], maxPerSearch: 40, now: NOW, wait: async () => {}, pauseMs: 0 });
  assert.equal(r.error, WORKDAY_THROTTLED);
  assert.equal(calls, 4, "one search tried four times, then the other three searches are skipped");
});

test("after 3 Workday companies are refused in one check, the rest are skipped without waiting", async () => {
  const asked = new Set();
  const fake = async (url) => {
    if (url.includes("myworkdayjobs")) { asked.add(new URL(url).hostname); return { ok: false, status: 429, headers: { get: () => null }, json: async () => ({}) }; }
    return { ok: true, status: 200, json: async () => ({ jobs: [] }) };
  };
  const list = Array.from({ length: 8 }, (_, i) => ({ company: `W${i}`, ats: "workday", board: `w${i}/Careers`, url: `https://w${i}.wd5.myworkdayjobs.com/Careers` }));
  const results = await fetchAll(list, fake, 8, { searches: ["MBA"], maxPerSearch: 20, pauseMs: 0, wait: async () => {}, workdayConcurrency: 1 });
  assert.ok(results.every((r) => r.error === WORKDAY_THROTTLED), "every company says to try again later");
  assert.equal(asked.size, 3, "only the first 3 companies were asked at all");
});
