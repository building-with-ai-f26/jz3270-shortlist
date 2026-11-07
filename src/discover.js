// Discovery turns a plain list of company names into watchlist entries.
// Greenhouse, Lever and Ashby have no public directory, so I guess each company's board name from
// its own name (e.g. "Anduril Industries" -> "andurilindustries") and ask each system whether that
// board exists and has open roles. The first match wins.
import { pool } from "./pool.js";

const ATS_ORDER = ["greenhouse", "lever", "ashby"];
// Words that are often left out of a board name: legal suffixes and generic industry words.
const DROP_WORDS = new Set(["inc", "llc", "corp", "corporation", "company", "co", "the", "technologies", "technology", "labs", "group",
  "holdings", "ai", "energy", "space", "health", "robotics", "aviation", "industries", "materials", "systems", "games", "software",
  "security", "aerospace", "rewards", "capital", "therapeutics"]);

export function normalizeName(name) {
  return (name || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
}

export function slugVariants(name) {
  const words = (name || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9\s-]/g, "").split(/[\s-]+/).filter(Boolean);
  if (!words.length) return [];
  const joined = words.join("");
  const core = words.filter((w) => !DROP_WORDS.has(w)).join("") || joined;
  // The full name goes first, so "Scale AI" tries "scaleai" before the riskier "scale".
  const variants = [joined, core, words.join("-"), `${core}hq`, `${core}inc`, `${core}usa`];
  return [...new Set(variants)].filter((v) => v.length >= 3);
}

// A line is either "Company Name" or "Company Name | greenhouse:board" when you already know the board.
export function parseCompanyLine(line) {
  const trimmed = line.replace(/#.*$/, "").trim();
  if (!trimmed) return null;
  const [name, manual] = trimmed.split("|").map((x) => x.trim());
  if (manual) {
    const [ats, board] = manual.split(":").map((x) => x.trim());
    if (ATS_ORDER.includes(ats) && board) return { name, ats, board };
  }
  return { name };
}

async function getJson(fetchImpl, url) {
  try {
    const res = await fetchImpl(url, { headers: { "Accept": "application/json" }, signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Each probe returns null when the board does not exist or has no open roles.
// I require at least one open role everywhere, because some systems answer "200, zero jobs" for any name.
const PROBES = {
  greenhouse: async (slug, f) => {
    const board = await getJson(f, `https://boards-api.greenhouse.io/v1/boards/${slug}`);
    if (!board) return null;
    const jobs = await getJson(f, `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`);
    const list = jobs?.jobs || [];
    return list.length ? { boardName: board.name || null, count: list.length, sample: list[0].title } : null;
  },
  lever: async (slug, f) => {
    const list = await getJson(f, `https://api.lever.co/v0/postings/${slug}?mode=json`);
    return Array.isArray(list) && list.length ? { boardName: null, count: list.length, sample: list[0].text } : null;
  },
  ashby: async (slug, f) => {
    const json = await getJson(f, `https://api.ashbyhq.com/posting-api/job-board/${slug}`);
    const list = Array.isArray(json?.jobs) ? json.jobs : [];
    return list.length ? { boardName: null, count: list.length, sample: list[0].title } : null;
  }
};

export async function discoverCompany(name, fetchImpl = fetch) {
  for (const slug of slugVariants(name)) {
    for (const ats of ATS_ORDER) {
      const hit = await PROBES[ats](slug, fetchImpl);
      if (hit) return { company: name, ats, board: slug, ...hit };
    }
  }
  return null;
}

// Finds boards for every name not already on the watchlist. Returns what was added and what was not found.
export async function discoverAll(lines, watchlist, { fetchImpl = fetch, concurrency = 6, onProgress } = {}) {
  const known = new Set(watchlist.map((w) => normalizeName(w.company)));
  const knownBoards = new Set(watchlist.map((w) => `${w.ats}:${w.board}`));
  const todo = lines.map(parseCompanyLine).filter(Boolean).filter((c) => !known.has(normalizeName(c.name)));

  const added = [];
  const notFound = [];
  let done = 0;

  await pool(todo, concurrency, async (c) => {
    const hit = c.ats ? { company: c.name, ats: c.ats, board: c.board, manual: true } : await discoverCompany(c.name, fetchImpl);
    done++;
    if (onProgress) onProgress(done, todo.length, c.name, hit);
    if (!hit) { notFound.push(c.name); return; }
    const key = `${hit.ats}:${hit.board}`;
    if (knownBoards.has(key)) return;
    knownBoards.add(key);
    added.push(hit);
  });

  const entries = added.map(({ company, ats, board }) => ({ company, ats, board }));
  return { added, notFound, skipped: lines.map(parseCompanyLine).filter(Boolean).length - todo.length, watchlist: [...watchlist, ...entries] };
}
