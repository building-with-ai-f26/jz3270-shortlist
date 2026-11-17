// Workday read sitemap first, against a fake Workday site and an in-memory cache.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchBoard, parseWorkdaySitemap, WORKDAY_THROTTLED } from "../src/sources.js";
import { buildPreferences, readSetup } from "../src/setup.js";

const NOW = Date.parse("2026-11-18T12:00:00Z");
const DAY = 86400000;
const BASE = "https://acme.wd5.myworkdayjobs.com/Careers";
const entry = { company: "Acme", ats: "workday", board: "acme/Careers", url: BASE };
const prefs = { tracks: ["Full-time", "Program"], locations: ["New York", "Remote"], titleInclude: ["Associate", "Analyst", "Strategy", "MBA"], titleExclude: ["Engineer"], maxAgeDays: 14 };
const quiet = { wait: async () => {}, pauseMs: 0 };

const sitemap = (paths) => `<urlset>${paths.map((p) => `<url><loc>${BASE}${p}</loc></url>`).join("")}</urlset>`;
const memoryCache = () => { const m = {}; return { m, get: (k) => m[k], set: (k, v) => { m[k] = v; } }; };

// paths: what the sitemap lists. ages: days since each path was posted (for its detail page).
function fakeWorkday({ paths, ages = {}, sitemapStatus = 200, searchJobs = [] }) {
  const calls = { sitemap: 0, detail: [], search: 0 };
  const fetchImpl = async (url, init = {}) => {
    if (url.endsWith("/siteMap.xml")) {
      calls.sitemap++;
      if (sitemapStatus !== 200) return { ok: false, status: sitemapStatus, headers: { get: () => null }, text: async () => "" };
      return { ok: true, status: 200, text: async () => sitemap(paths) };
    }
    if (init.method === "POST") {
      calls.search++;
      return { ok: true, status: 200, json: async () => ({ jobPostings: searchJobs }) };
    }
    const path = url.split("/wday/cxs/acme/Careers")[1];
    calls.detail.push(path);
    if (!(path in ages)) return { ok: false, status: 404, json: async () => ({}) };
    const start = new Date(NOW - ages[path] * DAY).toISOString().slice(0, 10);
    return { ok: true, status: 200, json: async () => ({ jobPostingInfo: { title: `Real ${path.split("/").pop()}`, location: "New York, NY", startDate: start, jobDescription: "<p>Own the plan.</p>" } }) };
  };
  return { fetchImpl, calls };
}

test("a sitemap link gives the title and location", () => {
  const jobs = parseWorkdaySitemap(sitemap(["/job/US-CA-Santa-Clara/Corporate-Development-MBA-Intern---Summer-2027_JR2029532-1", "/job/London/XMLNAME-2027-Intern---Marketing-Operations_R173217", "/not-a-job"]));
  assert.deepEqual(jobs, [
    { externalPath: "/job/US-CA-Santa-Clara/Corporate-Development-MBA-Intern---Summer-2027_JR2029532-1", title: "Corporate Development MBA Intern - Summer 2027", location: "US CA Santa Clara" },
    { externalPath: "/job/London/XMLNAME-2027-Intern---Marketing-Operations_R173217", title: "2027 Intern - Marketing Operations", location: "London" }
  ]);
});

test("details are fetched only for new roles that pass the title and location rules, and only once", async () => {
  const paths = ["/job/New-York-NY/Strategy-Associate_R1", "/job/Remote-USA/MBA-Rotational-Program_R2", "/job/Austin-TX/Software-Engineer_R3", "/job/London/Strategy-Analyst_R4"];
  const cache = memoryCache();
  const fake = fakeWorkday({ paths, ages: { [paths[0]]: 3, [paths[1]]: 20 } });
  const r = await fetchBoard(entry, fake.fetchImpl, { ...quiet, now: NOW, prefs, workdayCache: cache });
  assert.equal(r.error, null);
  assert.deepEqual(fake.calls.detail, [paths[0], paths[1]], "the engineer and London roles are never asked about");
  assert.equal(fake.calls.search, 0, "fewer than 100 listed means the sitemap is the whole site");
  const first = r.postings.find((p) => p.id.endsWith("R1"));
  assert.equal(first.title, "Real Strategy-Associate_R1");
  assert.equal(first.text, "Own the plan.");
  assert.equal(Math.floor((NOW - Date.parse(first.postedAt)) / DAY), 3, "Workday dates have no time, so count whole days");
  assert.equal(r.postings.length, 4, "every listed role goes on to the filter, which keeps each drop's reason");

  const again = fakeWorkday({ paths, ages: { [paths[0]]: 3, [paths[1]]: 20 } });
  const r2 = await fetchBoard(entry, again.fetchImpl, { ...quiet, now: NOW + 3600000, prefs, workdayCache: cache });
  assert.equal(again.calls.sitemap, 1);
  assert.deepEqual(again.calls.detail, [], "the next check asks Workday for nothing but the sitemap");
  assert.equal(r2.postings.find((p) => p.id.endsWith("R1")).text, "Own the plan.");
});

test("the daily search runs only when the newest 100 do not reach back far enough, and at most once a day", async () => {
  const paths = Array.from({ length: 100 }, (_, i) => `/job/Austin-TX/Software-Engineer_R${i}`);
  const last = paths[99];
  const searchJobs = [{ title: "Strategy Associate", externalPath: "/job/New-York-NY/Strategy-Associate_R900", locationsText: "New York, NY", postedOn: "Posted 10 Days Ago" }];

  const covered = fakeWorkday({ paths, ages: { [last]: 20 }, searchJobs });
  await fetchBoard(entry, covered.fetchImpl, { ...quiet, now: NOW, prefs, workdayCache: memoryCache() });
  assert.equal(covered.calls.search, 0, "the oldest of the 100 is 20 days old, past the 14-day window");

  const cache = memoryCache();
  const busy = fakeWorkday({ paths, ages: { [last]: 5 }, searchJobs });
  const r = await fetchBoard(entry, busy.fetchImpl, { ...quiet, now: NOW, prefs, searches: ["MBA"], maxPerSearch: 20, workdayCache: cache });
  assert.equal(busy.calls.search, 1, "the 100 newest only reach back 5 days, so search");
  assert.ok(r.postings.some((p) => p.id.endsWith("R900")), "a role found by the search is on the board");

  const sameDay = fakeWorkday({ paths, ages: { [last]: 5 }, searchJobs });
  const r2 = await fetchBoard(entry, sameDay.fetchImpl, { ...quiet, now: NOW + 6 * 3600000, prefs, searches: ["MBA"], maxPerSearch: 20, workdayCache: cache });
  assert.equal(sameDay.calls.search, 0, "not again the same day");
  assert.ok(r2.postings.some((p) => p.id.endsWith("R900")), "and the role found earlier is still shown");

  const nextDay = fakeWorkday({ paths, ages: { [last]: 5 }, searchJobs });
  await fetchBoard(entry, nextDay.fetchImpl, { ...quiet, now: NOW + 25 * 3600000, prefs, searches: ["MBA"], maxPerSearch: 20, workdayCache: cache });
  assert.equal(nextDay.calls.search, 1);
});

test("while Workday says to slow down, saved roles are shown; with none saved, the check says to try later", async () => {
  const paths = ["/job/New-York-NY/Strategy-Associate_R1"];
  const cache = memoryCache();
  await fetchBoard(entry, fakeWorkday({ paths, ages: { [paths[0]]: 3 } }).fetchImpl, { ...quiet, now: NOW, prefs, workdayCache: cache });
  const busy = fakeWorkday({ paths, sitemapStatus: 429 });
  const r = await fetchBoard(entry, busy.fetchImpl, { ...quiet, now: NOW + 3600000, prefs, workdayCache: cache });
  assert.equal(r.error, null);
  assert.equal(r.postings.length, 1);
  const empty = await fetchBoard(entry, busy.fetchImpl, { ...quiet, now: NOW, prefs, workdayCache: memoryCache() });
  assert.equal(empty.error, WORKDAY_THROTTLED);
});

test("a site with no sitemap falls back to the keyword searches, and a closed role leaves the cache", async () => {
  const searchJobs = [{ title: "Strategy Associate", externalPath: "/job/New-York-NY/Strategy-Associate_R5", locationsText: "New York, NY", postedOn: "Posted 2 Days Ago" }];
  const none = fakeWorkday({ paths: [], sitemapStatus: 404, searchJobs });
  const r = await fetchBoard(entry, none.fetchImpl, { ...quiet, now: NOW, prefs, searches: ["MBA"], maxPerSearch: 20, workdayCache: memoryCache() });
  assert.equal(none.calls.search, 1);
  assert.equal(r.postings.length, 1);

  const paths = ["/job/New-York-NY/Strategy-Associate_R7"];
  const cache = memoryCache();
  const closed = fakeWorkday({ paths, ages: {} });
  const r2 = await fetchBoard(entry, closed.fetchImpl, { ...quiet, now: NOW, prefs, workdayCache: cache });
  assert.equal(r2.postings.length, 0, "its detail page says not found, so it is gone");
});

test("setup offers 7, 14 or 30 days, starts new installs at 14, and keeps anyone's own setting", () => {
  assert.equal(buildPreferences({ maxAgeDays: 7 }).maxAgeDays, 7);
  assert.equal(buildPreferences({}).maxAgeDays, 14);
  assert.equal(buildPreferences({}, { maxAgeDays: 45 }).maxAgeDays, 45, "not sent means not changed");
  assert.throws(() => buildPreferences({ maxAgeDays: 45 }), /Pick 7, 14, 30 days/);
});
