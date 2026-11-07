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
export async function fetchBoard(entry, fetchImpl = fetch) {
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
export async function fetchAll(watchlist, fetchImpl = fetch, concurrency = 8) {
  return pool(watchlist, concurrency, (entry) => fetchBoard(entry, fetchImpl));
}

// Fills in the description for Greenhouse postings listed without one. If the detail call fails,
// the posting keeps its title and location and gets scored on those alone.
export async function fillDetails(postings, fetchImpl = fetch, concurrency = 8) {
  return pool(postings, concurrency, async (p) => {
    if (p.source !== "greenhouse" || p.text) return p;
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
