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
