// One run = fetch every board on the watchlist, filter, score, mark what's new, save.
// Both the web app (server.js) and the terminal command (scripts/run.js) call runPipeline().
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAll, normalize } from "./sources.js";
import { runFilter } from "./filter.js";
import { scoreAll, DEFAULT_MODEL } from "./score.js";
import { hasRealKey } from "./env.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Personal files (resume, watchlist, run history) live in data/, which .gitignore keeps out of
// the public repo. On first run I copy the examples from config/ so the user has something to edit.
const PERSONAL_FILES = [
  ["watchlist.json", "watchlist.example.json"],
  ["preferences.json", "preferences.example.json"],
  ["profile.md", "profile.example.md"]
];

export function paths(demo) {
  const dataDir = demo ? path.join(ROOT, "data", "demo") : path.join(ROOT, "data");
  const configFrom = (personal, example) => demo
    ? path.join(ROOT, "config", example)
    : path.join(dataDir, personal);
  return {
    dataDir,
    watchlist: configFrom(...PERSONAL_FILES[0]),
    preferences: configFrom(...PERSONAL_FILES[1]),
    profile: configFrom(...PERSONAL_FILES[2]),
    state: path.join(dataDir, "state.json"),
    latest: path.join(dataDir, "latest.json")
  };
}

export function ensurePersonalFiles() {
  const dataDir = path.join(ROOT, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const created = [];
  for (const [personal, example] of PERSONAL_FILES) {
    const target = path.join(dataDir, personal);
    if (!fs.existsSync(target)) {
      fs.copyFileSync(path.join(ROOT, "config", example), target);
      created.push(`data/${personal}`);
    }
  }
  return created;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

// Demo mode reads saved postings from fixtures/ in the same raw shape each ATS returns,
// so the normalizers get exercised exactly as they would on live data.
// Dates are stored as "days ago" and filled in at load time so the demo never goes stale.
function loadFixtures(now) {
  const fixtures = readJson(path.join(ROOT, "fixtures", "sample-postings.json"), { boards: [] });
  const dateFields = { greenhouse: "first_published", lever: "createdAt", ashby: "publishedAt" };
  const results = [];
  const seenBefore = [];

  for (const board of fixtures.boards) {
    const jobs = board.ats === "lever" ? board.response : (board.response.jobs || []);
    for (const job of jobs) {
      const when = new Date(now - (job._daysAgo || 0) * 86400000);
      job[dateFields[board.ats]] = board.ats === "lever" ? when.getTime() : when.toISOString();
    }
    const entry = { company: board.company, ats: board.ats, board: board.board };
    const postings = normalize(board.ats, board.response, entry);
    jobs.forEach((job, i) => { if (job._seenBefore) seenBefore.push(postings[i].id); });
    results.push({ entry, postings, error: null });
  }
  return { results, seenBefore };
}

export async function runPipeline({ demo = false, now = Date.now(), fetchImpl = fetch } = {}) {
  const p = paths(demo);
  fs.mkdirSync(p.dataDir, { recursive: true });
  if (!demo) ensurePersonalFiles();

  const watchlist = readJson(p.watchlist, []);
  const prefs = readJson(p.preferences, {});
  const profile = fs.readFileSync(p.profile, "utf8");
  // Demo mode starts fresh every time so the demo looks the same on every run.
  const state = demo ? { seen: {}, runs: [] } : readJson(p.state, { seen: {}, runs: [] });

  // 1. Fetch
  let fetched;
  if (demo) {
    const fx = loadFixtures(now);
    fetched = fx.results;
    // In demo mode I pretend a few postings were already seen in an earlier check, so the "New" badge has something to show.
    const earlier = new Date(now - 3 * 86400000).toISOString();
    for (const id of fx.seenBefore) state.seen[id] = earlier;
  } else {
    fetched = await fetchAll(watchlist, fetchImpl);
  }
  const all = fetched.flatMap((r) => r.postings);
  const errors = fetched.filter((r) => r.error).map((r) => ({ company: r.entry.company, error: r.error }));

  // 2. Filter (free) then 3. Score (paid when AI is on)
  const { kept, dropped } = runFilter(all, prefs, now);
  const useAI = !demo && hasRealKey();
  const { scored, skipped, totals, method, model } = await scoreAll(profile, kept, {
    useAI,
    maxToScore: prefs.maxToScore || 40,
    fetchImpl
  });

  // 4. Mark new since the last check
  const runAt = new Date(now).toISOString();
  for (const s of scored) {
    s.isNew = !state.seen[s.id];
    if (!state.seen[s.id]) state.seen[s.id] = runAt;
    s.firstSeen = state.seen[s.id];
  }

  scored.sort((a, b) => (b.fit ?? -1) - (a.fit ?? -1));

  const summary = {
    runAt,
    demo,
    method,
    model,
    companies: fetched.length,
    boardsFailed: errors.length,
    found: all.length,
    passedFilter: kept.length,
    scored: scored.filter((s) => s.fit !== null).length,
    scoreErrors: scored.filter((s) => s.error).length,
    skippedOverCap: skipped,
    newCount: scored.filter((s) => s.isNew).length,
    tokensIn: totals.tokensIn,
    tokensOut: totals.tokensOut,
    costUsd: Number(totals.costUsd.toFixed(6))
  };

  const latest = { summary, results: scored, dropped, errors };
  state.runs.push(summary);
  fs.writeFileSync(p.state, JSON.stringify(state, null, 2));
  fs.writeFileSync(p.latest, JSON.stringify(latest, null, 2));
  return latest;
}

export function readLatest(demo) {
  return readJson(paths(demo).latest, null);
}

export function status(demo) {
  const p = paths(demo);
  return {
    demo,
    aiOn: !demo && hasRealKey(),
    model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
    watchlistCount: readJson(p.watchlist, []).length,
    runs: readJson(p.state, { runs: [] }).runs.length
  };
}
