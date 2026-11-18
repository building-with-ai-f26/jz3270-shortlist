// Each company posts jobs through an applicant tracking system (ATS).
// Greenhouse, Lever and Ashby all publish open roles as public JSON, no login or key needed.
// I fetch each board and reshape every posting into one common format so the rest of the app
// never has to care which ATS a job came from.
import { pool } from "./pool.js";
import { prefilter } from "./filter.js";

// For Greenhouse I list jobs WITHOUT descriptions (much smaller), then fetch the full text only for
// the postings that are about to be scored. With 100+ companies that keeps a check fast and light.
const ENDPOINTS = {
  greenhouse: (board) => `https://boards-api.greenhouse.io/v1/boards/${board}/jobs`,
  lever: (board) => `https://api.lever.co/v0/postings/${board}?mode=json`,
  ashby: (board) => `https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=true`
};

// Job descriptions arrive as HTML (Greenhouse even double-encodes it), so I decode and strip tags.
export function htmlToText(html) {
  if (!html) return "";
  const decode = (s) => s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

  return decode(decode(html)
    .replace(/<(br|\/p|\/li|\/h\d|\/div)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .split("\n").map((line) => line.trim()).filter(Boolean).join("\n");
}

export function normalizeGreenhouse(json, entry) {
  return (json.jobs || []).map((job) => ({
    id: `greenhouse:${entry.board}:${job.id}`,
    company: entry.company,
    title: job.title || "",
    location: job.location?.name || "",
    url: job.absolute_url || "",
    postedAt: job.first_published || job.updated_at || null,
    department: job.departments?.[0]?.name || "",
    text: htmlToText(job.content),
    source: "greenhouse"
  }));
}

export function normalizeLever(json, entry) {
  const list = Array.isArray(json) ? json : [];
  return list.map((job) => {
    const lists = (job.lists || []).map((l) => `${l.text}\n${htmlToText(l.content)}`).join("\n");
    return {
      id: `lever:${entry.board}:${job.id}`,
      company: entry.company,
      title: job.text || "",
      location: job.categories?.location || (job.categories?.allLocations || []).join(", "),
      url: job.hostedUrl || "",
      postedAt: job.createdAt ? new Date(job.createdAt).toISOString() : null,
      department: job.categories?.department || job.categories?.team || "",
      text: [job.descriptionPlain || htmlToText(job.description), lists, job.additionalPlain || ""].join("\n").trim(),
      source: "lever"
    };
  });
}

// Ashby flags remote roles separately from the location text, so I add "Remote" only when it's missing.
function withRemote(location, isRemote) {
  if (!isRemote || /remote/i.test(location)) return location;
  return location ? `${location} (Remote)` : "Remote";
}

export function normalizeAshby(json, entry) {
  return (json.jobs || [])
    .filter((job) => job.isListed !== false)
    .map((job) => {
      const extra = (job.secondaryLocations || []).map((s) => s.location).filter(Boolean);
      return {
        id: `ashby:${entry.board}:${job.id}`,
        company: entry.company,
        title: job.title || "",
        location: withRemote([job.location, ...extra].filter(Boolean).join(", "), job.isRemote),
        url: job.jobUrl || job.applyUrl || "",
        postedAt: job.publishedAt || null,
        department: job.department || job.team || "",
        text: job.descriptionPlain || htmlToText(job.descriptionHtml),
        source: "ashby"
      };
    });
}

// ---------- Workday ----------
// Many large companies (NVIDIA, Salesforce, Adobe, most aerospace and real estate majors) use Workday.
// Every Workday careers site answers the same search request its own search box sends, so instead of
// downloading thousands of postings I run a handful of searches ("MBA", "2027", "new grad"...) per company.

// Used only when preferences have no workdaySearch. Setup writes searches that match the user's chosen roles.
export const WORKDAY_DEFAULT_SEARCHES = ["MBA", "2027", "new grad", "university", "rotational", "early career", "strategy", "operations"];

// Reads a careers link such as https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite
// or https://wd1.myworkdaysite.com/recruiting/acme/Careers.
export function parseWorkdayUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const parts = u.pathname.split("/").filter(Boolean).filter((x) => !/^[a-z]{2}-[A-Z]{2}$/.test(x));
  if (u.hostname.endsWith(".myworkdayjobs.com") && parts[0]) {
    return { host: u.hostname, tenant: u.hostname.split(".")[0], site: parts[0], base: `https://${u.hostname}/${parts[0]}` };
  }
  if (u.hostname.endsWith(".myworkdaysite.com") && parts[0] === "recruiting" && parts[1] && parts[2]) {
    return { host: u.hostname, tenant: parts[1], site: parts[2], base: `https://${u.hostname}/recruiting/${parts[1]}/${parts[2]}` };
  }
  return null;
}

// Workday only says "Posted 3 Days Ago", so I turn that back into a number of days.
export function workdayAgeDays(postedOn) {
  const t = (postedOn || "").toLowerCase();
  if (t.includes("today")) return 0;
  if (t.includes("yesterday")) return 1;
  const m = t.match(/(\d+)\+?\s*days?/);
  if (!m) return null;
  return t.includes("+") ? Number(m[1]) + 1 : Number(m[1]);
}

export function normalizeWorkday(jobs, entry, wd, now = Date.now()) {
  const api = `https://${wd.host}/wday/cxs/${wd.tenant}/${wd.site}`;
  return jobs.map((job) => {
    const pathPart = job.externalPath.startsWith("/job/") ? job.externalPath : `/job${job.externalPath}`;
    const age = workdayAgeDays(job.postedOn);
    // "3 Locations" says nothing useful, so I leave it blank and fill it in from the job's detail page.
    const loc = /^\d+\s+locations?$/i.test(job.locationsText || "") ? "" : (job.locationsText || "");
    return {
      id: `workday:${wd.tenant}/${wd.site}:${pathPart}`,
      company: entry.company,
      title: job.title || "",
      location: loc,
      url: `${wd.base}${pathPart}`,
      detailUrl: `${api}${pathPart}`,
      postedAt: age === null ? null : new Date(now - age * 86400000).toISOString(),
      department: "",
      text: "",
      source: "workday"
    };
  });
}

// Workday limits how fast one visitor can search. When it answers 429 ("too many requests") or 503, I wait
// and try the same search again: as long as Workday asks for (Retry-After), or 2, 4 and then 8 seconds.
export const WORKDAY_RETRY_WAITS_MS = [2000, 4000, 8000];
export const WORKDAY_THROTTLED = "Workday asked Shortlist to slow down (too many requests). This usually clears within a few minutes.";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function retryAfterMs(res) {
  const value = res.headers?.get?.("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : new Date(value).getTime() - Date.now();
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, 30000) : null;
}

// Once this many Workday companies are refused in one check, the rest are skipped with the same message,
// so a check never crawls through minutes of waiting while Workday is limiting us.
export const WORKDAY_GIVE_UP_AFTER = 3;
const isThrottled = (res) => res.status === 429 || res.status === 503;

// Every Workday request for one company goes through this: a short pause between requests keeps a check under
// Workday's limit, and a 429 or 503 is waited out and retried.
function workdayRequester(fetchImpl, { wait = sleep, pauseMs = 250 } = {}) {
  let requests = 0;
  return async (url, init = {}) => {
    for (let attempt = 0; ; attempt++) {
      if (requests++ > 0 && pauseMs) await wait(pauseMs);
      const base = requestOptions();
      const res = await fetchImpl(url, { ...base, ...init, headers: { ...base.headers, ...(init.headers || {}) } });
      if (!isThrottled(res) || attempt >= WORKDAY_RETRY_WAITS_MS.length) return res;
      await wait(retryAfterMs(res) ?? WORKDAY_RETRY_WAITS_MS[attempt]);
    }
  };
}

// With a cache from the pipeline, Workday is read sitemap first (below); without one (tests, npm run check),
// with the keyword searches.
async function fetchWorkday(entry, fetchImpl, opts = {}) {
  const wd = parseWorkdayUrl(entry.url || "");
  if (!wd) return { entry, postings: [], error: "Workday entry needs a careers link like https://company.wd5.myworkdayjobs.com/SiteName" };
  return opts.workdayCache ? sitemapWorkday(entry, fetchImpl, wd, opts) : searchWorkday(entry, fetchImpl, wd, opts);
}

// The keyword searches: each search term in turn, 20 results a page, up to maxPerSearch.
async function searchWorkday(entry, fetchImpl, wd, { searches = WORKDAY_DEFAULT_SEARCHES, maxPerSearch = 40, now = Date.now(), wait = sleep, pauseMs = 250, workdayGate = null } = {}) {
  if (workdayGate && workdayGate.refused >= WORKDAY_GIVE_UP_AFTER) return { entry, postings: [], error: WORKDAY_THROTTLED };
  const api = `https://${wd.host}/wday/cxs/${wd.tenant}/${wd.site}/jobs`;
  const found = new Map();
  let anyOk = false;
  let throttled = false;
  const request = workdayRequester(fetchImpl, { wait, pauseMs });
  const search = (body) => request(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  try {
    searching: for (const searchText of searches) {
      for (let offset = 0; offset < maxPerSearch; offset += 20) {
        const res = await search({ appliedFacets: {}, limit: 20, offset, searchText });
        if (!res.ok) {
          // Still refused after every retry: stop this company's searches and keep what was found.
          if (res.status === 429 || res.status === 503) { throttled = true; break searching; }
          if (!anyOk && (res.status === 404 || res.status === 422)) return { entry, postings: [], error: `Workday site "${wd.tenant}/${wd.site}" not found (check the careers link)` };
          break;
        }
        anyOk = true;
        const list = (await res.json()).jobPostings || [];
        for (const job of list) if (job.externalPath && !found.has(job.externalPath)) found.set(job.externalPath, job);
        if (list.length < 20) break;
      }
    }
  } catch (err) {
    if (!anyOk) return { entry, postings: [], error: `Could not reach Workday: ${describeError(err)}` };
  }
  if (!anyOk && throttled && workdayGate) workdayGate.refused++;
  if (!anyOk) return { entry, postings: [], error: throttled ? WORKDAY_THROTTLED : "Workday did not answer any search" };
  return { entry, postings: normalizeWorkday([...found.values()], entry, wd, now), error: null };
}

// ---------- Workday, sitemap first ----------
// Every Workday careers site publishes siteMap.xml: its newest 100 jobs, each link carrying the location and title.
// With the pipeline's cache (data/workday-cache.json) a check reads the sitemap (1 request), fetches details only
// for new roles that pass the title and location rules, and runs the keyword searches above at most once a day,
// and only when the newest 100 jobs do not reach back as far as maxAgeDays.
const SITEMAP_SIZE = 100;
const DAY_MS = 86400000;
// Detail requests per company per check; any others wait for the next check.
export const WORKDAY_DETAILS_PER_CHECK = 25;

// "/job/US-CA-Santa-Clara/Corporate-Development-MBA-Intern---Summer-2027_JR2029532-1" becomes
// title "Corporate Development MBA Intern - Summer 2027" and location "US CA Santa Clara".
export function parseWorkdaySitemap(xml) {
  const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
  const jobs = [];
  for (const m of String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
    const at = m[1].indexOf("/job/");
    if (at < 0) continue;
    const externalPath = m[1].slice(at);
    const parts = externalPath.split("/").filter(Boolean);
    if (parts.length < 2) continue;
    const slug = decode(parts[parts.length - 1]).replace(/_[^_]*$/, "").replace(/^XMLNAME-*/i, "");
    const title = slug.replace(/-{3,}/g, "\u0000").replace(/-+/g, " ").replace(/\u0000/g, " - ").replace(/\s+/g, " ").trim();
    const location = parts.length >= 3 ? decode(parts[parts.length - 2]).replace(/-+/g, " ").trim() : "";
    jobs.push({ externalPath, title, location });
  }
  return jobs;
}

function workdayPosting(entry, wd, externalPath, job) {
  return {
    id: `workday:${wd.tenant}/${wd.site}:${externalPath}`,
    company: entry.company,
    title: job.title || "",
    location: job.location || "",
    url: `${wd.base}${externalPath}`,
    detailUrl: `https://${wd.host}/wday/cxs/${wd.tenant}/${wd.site}${externalPath}`,
    postedAt: job.postedAt || null,
    department: "",
    text: job.text || "",
    source: "workday"
  };
}

// A job's detail page: real title, every location, the posting date and the description.
async function workdayDetail(request, wd, externalPath, now) {
  const res = await request(`https://${wd.host}/wday/cxs/${wd.tenant}/${wd.site}${externalPath}`);
  if (isThrottled(res)) return { throttled: true };
  if (res.status === 404) return { gone: true };
  if (!res.ok) return null;
  const info = (await res.json()).jobPostingInfo || {};
  const start = info.startDate ? Date.parse(info.startDate) : NaN;
  const age = workdayAgeDays(info.postedOn);
  const out = {
    title: info.title,
    location: [info.location, ...(info.additionalLocations || [])].filter(Boolean).join("; "),
    postedAt: Number.isFinite(start) ? new Date(start).toISOString() : age === null ? null : new Date(now - age * DAY_MS).toISOString(),
    text: htmlToText(info.jobDescription).slice(0, 8000)
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined && v !== ""));
}

async function sitemapWorkday(entry, fetchImpl, wd, opts) {
  const { now = Date.now(), workdayCache: cache, prefs = {}, workdayGate = null } = opts;
  const key = `${wd.tenant}/${wd.site}`;
  const store = cache.get(key) || { jobs: {} };
  const seenAt = new Date(now).toISOString();
  const maxAge = prefs.maxAgeDays || 14;
  // Roles listed on the sitemap or found by a search in the last two days are on the board.
  const current = () => Object.entries(store.jobs)
    .filter(([, j]) => now - Date.parse(j.seenAt) <= 2 * DAY_MS)
    .map(([path, j]) => workdayPosting(entry, wd, path, j));
  const finish = (error = null) => {
    for (const [path, j] of Object.entries(store.jobs)) if (now - Date.parse(j.seenAt) > 7 * DAY_MS) delete store.jobs[path];
    cache.set(key, store);
    return { entry, postings: error ? [] : current(), error };
  };
  // While Workday is refusing this check, show what is already known instead of asking again.
  const refused = () => {
    if (workdayGate) workdayGate.refused++;
    return Object.keys(store.jobs).length ? finish() : { entry, postings: [], error: WORKDAY_THROTTLED };
  };
  if (workdayGate && workdayGate.refused >= WORKDAY_GIVE_UP_AFTER) return Object.keys(store.jobs).length ? finish() : { entry, postings: [], error: WORKDAY_THROTTLED };

  const request = workdayRequester(fetchImpl, opts);
  let listed = null;
  try {
    const res = await request(`${wd.base}/siteMap.xml`, { headers: { Accept: "application/xml" } });
    if (isThrottled(res)) return refused();
    if (res.ok) listed = parseWorkdaySitemap(await res.text());
  } catch {
    listed = null;
  }
  // No sitemap on this site: the keyword searches, as before.
  if (!listed || !listed.length) return searchWorkday(entry, fetchImpl, wd, opts);

  for (const job of listed) {
    const known = store.jobs[job.externalPath];
    store.jobs[job.externalPath] = known ? { ...known, seenAt } : { title: job.title, location: job.location, seenAt };
  }

  // Details only for new roles that pass the title and location rules (their age is not known yet).
  let throttled = false;
  let details = 0;
  const passes = (path) => prefilter(workdayPosting(entry, wd, path, store.jobs[path]), { ...prefs, maxAgeDays: 0 }, now).keep;
  const fillIn = async (path) => {
    const info = await workdayDetail(request, wd, path, now);
    if (info?.throttled) { throttled = true; return; }
    if (info?.gone) { delete store.jobs[path]; return; }
    if (info) Object.assign(store.jobs[path], info, { detailedAt: seenAt });
  };
  for (const job of listed) {
    if (throttled || details >= WORKDAY_DETAILS_PER_CHECK) break;
    const j = store.jobs[job.externalPath];
    if (!j || j.detailedAt || !passes(job.externalPath)) continue;
    details++;
    await fillIn(job.externalPath);
  }

  // Do the newest 100 reach back maxAgeDays? Fewer than 100 listed means the sitemap is the whole site;
  // otherwise the oldest listed job's date answers it.
  if (listed.length < SITEMAP_SIZE) {
    store.coverDays = null;
  } else if (!throttled) {
    const last = listed[listed.length - 1].externalPath;
    if (store.jobs[last] && !store.jobs[last].postedAt) await fillIn(last);
    const at = store.jobs[last]?.postedAt;
    store.coverDays = at ? Math.floor((now - Date.parse(at)) / DAY_MS) : store.coverDays ?? null;
  }
  const dueForSearch = !store.searchedAt || now - Date.parse(store.searchedAt) > DAY_MS;
  if (listed.length >= SITEMAP_SIZE && !throttled && store.coverDays !== null && store.coverDays < maxAge && dueForSearch) {
    const found = await searchWorkday(entry, fetchImpl, wd, opts);
    if (!found.error) {
      const prefix = `workday:${key}:`;
      for (const p of found.postings) {
        const path = p.id.slice(prefix.length);
        store.jobs[path] = { ...(store.jobs[path] || {}), title: p.title, location: store.jobs[path]?.location || p.location, postedAt: store.jobs[path]?.postedAt || p.postedAt, seenAt };
      }
      store.searchedAt = seenAt;
    }
  }
  store.checkedAt = seenAt;
  return finish();
}

// ---------- SmartRecruiters ----------
// SmartRecruiters publishes an official, documented Posting API. Like Workday, big employers can have
// thousands of postings, so I run the same search terms instead of downloading everything.
const SR_API = "https://api.smartrecruiters.com/v1/companies";

export function normalizeSmartRecruiters(postings, entry) {
  return postings.map((job) => {
    const l = job.location || {};
    const place = l.fullLocation || [l.city, l.region, l.country ? l.country.toUpperCase() : ""].filter(Boolean).join(", ");
    return {
      id: `smartrecruiters:${entry.board}:${job.id}`,
      company: entry.company,
      title: job.name || "",
      location: l.remote && !/remote/i.test(place) ? `${place} (Remote)`.trim() : place,
      url: `https://jobs.smartrecruiters.com/${entry.board}/${job.id}`,
      detailUrl: `${SR_API}/${entry.board}/postings/${job.id}`,
      postedAt: job.releasedDate || null,
      department: job.department?.label || job.function?.label || "",
      text: "",
      source: "smartrecruiters"
    };
  });
}

async function fetchSmartRecruiters(entry, fetchImpl, { searches = WORKDAY_DEFAULT_SEARCHES } = {}) {
  const found = new Map();
  let anyOk = false;
  try {
    for (const q of searches) {
      const res = await fetchImpl(`${SR_API}/${encodeURIComponent(entry.board)}/postings?q=${encodeURIComponent(q)}&limit=100&offset=0`, requestOptions());
      if (!res.ok) {
        if (!anyOk && res.status === 404) return { entry, postings: [], error: `SmartRecruiters company "${entry.board}" not found (check the name)` };
        continue;
      }
      anyOk = true;
      for (const job of (await res.json()).content || []) if (!found.has(job.id)) found.set(job.id, job);
    }
  } catch (err) {
    if (!anyOk) return { entry, postings: [], error: `Could not reach SmartRecruiters: ${describeError(err)}` };
  }
  if (!anyOk) return { entry, postings: [], error: "SmartRecruiters did not answer any search" };
  return { entry, postings: normalizeSmartRecruiters([...found.values()], entry), error: null };
}

const NORMALIZERS = { greenhouse: normalizeGreenhouse, lever: normalizeLever, ashby: normalizeAshby };

export function normalize(ats, json, entry) {
  const fn = NORMALIZERS[ats];
  if (!fn) throw new Error(`Unknown ATS "${ats}". Use greenhouse, lever or ashby.`);
  return fn(json, entry);
}

// A slow board should not hold up the whole check, so every request gives up after 20 seconds.
export const TIMEOUT_MS = 20000;
const requestOptions = () => ({
  headers: { "Accept": "application/json" },
  signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(TIMEOUT_MS) : undefined
});

function describeError(err) {
  return err?.name === "TimeoutError" || err?.name === "AbortError" ? `no answer after ${TIMEOUT_MS / 1000} seconds` : err.message;
}

// One failed board should never sink the whole run, so I return the error instead of throwing.
export async function fetchBoard(entry, fetchImpl = fetch, opts = {}) {
  if (entry.ats === "workday") return fetchWorkday(entry, fetchImpl, opts);
  if (entry.ats === "smartrecruiters") return fetchSmartRecruiters(entry, fetchImpl, opts);
  const build = ENDPOINTS[entry.ats];
  if (!build) return { entry, postings: [], error: `Unknown ATS "${entry.ats}"` };

  try {
    const res = await fetchImpl(build(entry.board), requestOptions());
    if (res.status === 404) return { entry, postings: [], error: `Board "${entry.board}" not found on ${entry.ats} (check the slug)` };
    if (!res.ok) return { entry, postings: [], error: `${entry.ats} returned HTTP ${res.status}` };
    const json = await res.json();
    return { entry, postings: normalize(entry.ats, json, entry), error: null };
  } catch (err) {
    return { entry, postings: [], error: `Could not reach ${entry.ats}: ${describeError(err)}` };
  }
}

// Eight boards at a time is fast but polite.
// Turns any careers link into a watchlist entry, so adding a company is just pasting its link.
export function parseBoardUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const first = u.pathname.split("/").filter(Boolean)[0];
  if (/(^|\.)greenhouse\.io$/.test(u.hostname)) {
    const slug = u.searchParams.get("for") || (first !== "embed" ? first : null);
    return slug ? { ats: "greenhouse", board: slug } : null;
  }
  if (u.hostname === "jobs.lever.co" && first) return { ats: "lever", board: first };
  if (u.hostname === "jobs.ashbyhq.com" && first) return { ats: "ashby", board: first };
  if (/^(jobs|careers)\.smartrecruiters\.com$/.test(u.hostname) && first) return { ats: "smartrecruiters", board: first };
  const wd = parseWorkdayUrl(url);
  if (wd) return { ats: "workday", board: `${wd.tenant}/${wd.site}`, url: wd.base };
  return null;
}

// Workday companies run 2 at a time, apart from the other boards, because Workday limits how fast one
// visitor can search; everything else runs 8 at a time. Results come back in watchlist order.
export const WORKDAY_CONCURRENCY = 2;
export async function fetchAll(watchlist, fetchImpl = fetch, concurrency = 8, opts = {}) {
  const indexed = watchlist.map((entry, i) => ({ entry, i }));
  const isWorkday = ({ entry }) => entry.ats === "workday";
  const shared = { ...opts, workdayGate: opts.workdayGate || { refused: 0 } };
  // opts.onBoard(done, total) after each board, so the page can show how far a check has got.
  let done = 0;
  const finished = (r, i) => {
    done++;
    if (opts.onBoard) opts.onBoard(done, watchlist.length);
    return { r, i };
  };
  const run = (list, n) => pool(list, n, ({ entry, i }) => fetchBoard(entry, fetchImpl, shared).then((r) => finished(r, i)));
  const [others, workday] = await Promise.all([
    run(indexed.filter((x) => !isWorkday(x)), concurrency),
    run(indexed.filter(isWorkday), opts.workdayConcurrency || WORKDAY_CONCURRENCY)
  ]);
  return [...others, ...workday].sort((a, b) => a.i - b.i).map(({ r }) => r);
}

// Fills in the description for Greenhouse and Workday postings listed without one. If the detail
// call fails, the posting keeps its title and location and gets scored on those alone.
// onEach(done, total) runs after each posting, for the progress graphic.
export async function fillDetails(postings, fetchImpl = fetch, concurrency = 8, onEach) {
  let done = 0;
  return pool(postings, concurrency, async (p) => {
    const filled = await detailFor(p, fetchImpl);
    done++;
    if (onEach) onEach(done, postings.length);
    return filled;
  });
}

async function detailFor(p, fetchImpl) {
  if (p.text) return p;
  if (p.source === "workday" && p.detailUrl) {
    try {
      const res = await fetchImpl(p.detailUrl, requestOptions());
      if (!res.ok) return p;
      const info = (await res.json()).jobPostingInfo || {};
      const loc = p.location || [info.location, ...(info.additionalLocations || [])].filter(Boolean).join("; ");
      return { ...p, text: htmlToText(info.jobDescription), location: loc };
    } catch {
      return p;
    }
  }
  if (p.source === "smartrecruiters" && p.detailUrl) {
    try {
      const res = await fetchImpl(p.detailUrl, requestOptions());
      if (!res.ok) return p;
      const sec = (await res.json()).jobAd?.sections || {};
      const text = ["jobDescription", "qualifications", "additionalInformation"].map((k) => htmlToText(sec[k]?.text)).filter(Boolean).join("\n");
      return { ...p, text };
    } catch {
      return p;
    }
  }
  if (p.source !== "greenhouse") return p;
  const [, board, jobId] = p.id.split(":");
  try {
    const res = await fetchImpl(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${jobId}`, requestOptions());
    if (!res.ok) return p;
    const job = await res.json();
    return { ...p, text: htmlToText(job.content) };
  } catch {
    return p;
  }
}
