// Each company posts jobs through an applicant tracking system (ATS).
// Greenhouse, Lever and Ashby all publish open roles as public JSON, no login or key needed.
// I fetch each board and reshape every posting into one common format so the rest of the app
// never has to care which ATS a job came from.
import { pool } from "./pool.js";

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

async function fetchWorkday(entry, fetchImpl, { searches = WORKDAY_DEFAULT_SEARCHES, maxPerSearch = 40, now = Date.now() } = {}) {
  const wd = parseWorkdayUrl(entry.url || "");
  if (!wd) return { entry, postings: [], error: "Workday entry needs a careers link like https://company.wd5.myworkdayjobs.com/SiteName" };
  const api = `https://${wd.host}/wday/cxs/${wd.tenant}/${wd.site}/jobs`;
  const found = new Map();
  let anyOk = false;

  try {
    for (const searchText of searches) {
      for (let offset = 0; offset < maxPerSearch; offset += 20) {
        const res = await fetchImpl(api, {
          ...requestOptions(),
          method: "POST",
          headers: { "Accept": "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText })
        });
        if (!res.ok) {
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
  if (!anyOk) return { entry, postings: [], error: "Workday did not answer any search" };
  return { entry, postings: normalizeWorkday([...found.values()], entry, wd, now), error: null };
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

export async function fetchAll(watchlist, fetchImpl = fetch, concurrency = 8, opts = {}) {
  return pool(watchlist, concurrency, (entry) => fetchBoard(entry, fetchImpl, opts));
}

// Fills in the description for Greenhouse and Workday postings listed without one. If the detail
// call fails, the posting keeps its title and location and gets scored on those alone.
export async function fillDetails(postings, fetchImpl = fetch, concurrency = 8) {
  return pool(postings, concurrency, async (p) => {
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
  });
}
