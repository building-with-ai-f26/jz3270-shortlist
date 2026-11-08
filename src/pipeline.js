// One run = fetch every board on the watchlist, filter, score, mark what's new, save.
// Both the web app (server.js) and the terminal command (scripts/run.js) call runPipeline().
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { fetchAll, fillDetails, normalize } from "./sources.js";
import { runFilter, prefilter, classifyCohort, COHORTS } from "./filter.js";
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

// Tests point SHORTLIST_DATA_DIR at a temporary folder so they never touch the real data/ folder.
const dataRoot = () => process.env.SHORTLIST_DATA_DIR || path.join(ROOT, "data");

export function paths(demo) {
  const dataDir = demo ? path.join(dataRoot(), "demo") : dataRoot();
  const configFrom = (personal, example) => demo
    ? path.join(ROOT, "config", example)
    : path.join(dataDir, personal);
  return {
    dataDir,
    watchlist: configFrom(...PERSONAL_FILES[0]),
    preferences: configFrom(...PERSONAL_FILES[1]),
    profile: configFrom(...PERSONAL_FILES[2]),
    state: path.join(dataDir, "state.json"),
    latest: path.join(dataDir, "latest.json"),
    scores: path.join(dataDir, "scores.json")
  };
}

export function ensurePersonalFiles() {
  const dataDir = dataRoot();
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
    fetched = await fetchAll(watchlist, fetchImpl, 8, {
      searches: prefs.workdaySearch,
      maxPerSearch: prefs.workdayMaxPerSearch,
      now
    });
  }
  const all = fetched.flatMap((r) => r.postings);
  const errors = fetched.filter((r) => r.error).map((r) => ({ company: r.entry.company, error: r.error }));

  // 2. Filter (free)
  const { kept, dropped } = runFilter(all, prefs, now);

  // 3. Score (paid when AI is on). Scores are saved by posting ID, so a posting is only paid for once.
  // If the profile or the model changes, the saved scores no longer apply and I start over.
  const useAI = !demo && hasRealKey();
  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  // SCORE_VERSION goes up whenever the scoring prompt changes what it returns, so old scores are redone once.
  const SCORE_VERSION = 2;
  const cacheKey = `v${SCORE_VERSION}:${useAI ? `ai:${model}` : "keywords"}:${crypto.createHash("sha256").update(profile).digest("hex").slice(0, 16)}`;
  const saved = demo ? { key: cacheKey, scores: {} } : readJson(p.scores, { key: cacheKey, scores: {} });
  const cache = saved.key === cacheKey ? saved : { key: cacheKey, scores: {} };
  const cacheReset = !demo && saved.key !== cacheKey && Object.keys(saved.scores || {}).length > 0;

  const fromCache = [];
  const unscored = [];
  for (const k of kept) {
    const c = cache.scores[k.id];
    if (c) fromCache.push({ ...k, ...c, text: undefined, error: null, fromCache: true });
    else unscored.push(k);
  }

  // The freshest unscored postings go first, capped so one check has a known worst-case cost.
  const cap = prefs.maxToScore || 40;
  const queue = unscored.sort((a, b) => (a.ageDays ?? 999) - (b.ageDays ?? 999)).slice(0, cap);
  const waiting = unscored.length - queue.length;
  const filled = demo ? queue : await fillDetails(queue, fetchImpl);
  // Some boards (Workday) only reveal the real location on the detail page, so I run the filter
  // once more now that it is known, and drop anything that fails before paying to score it.
  const lateDropped = [];
  const withText = [];
  for (const x of filled) {
    const again = prefilter(x, prefs, now);
    if (again.keep) withText.push({ ...x, cohort: classifyCohort(x.title, x.text) });
    else lateDropped.push({ ...again.posting, reason: again.reason, text: undefined });
  }
  dropped.push(...lateDropped);
  const { scored: fresh, totals, method } = await scoreAll(profile, withText, { useAI, maxToScore: cap, fetchImpl, model });
  // The model reads the whole posting, so if it says the role is for new grads, I trust that too.
  for (const f of fresh) if (f.newGrad) f.cohort = COHORTS.grad;

  const scoredAt = new Date(now).toISOString();
  for (const f of fresh) {
    if (f.error) continue;
    cache.scores[f.id] = { fit: f.fit, track: f.track, why: f.why, gap: f.gap, dealbreaker: f.dealbreaker, cohort: f.cohort, scoredAt };
  }
  // I drop saved scores for postings that have closed, so the file does not grow forever.
  const open = new Set(all.map((x) => x.id));
  for (const id of Object.keys(cache.scores)) if (!open.has(id)) delete cache.scores[id];

  const scored = [...fromCache, ...fresh];

  // 4. Mark new since the last check
  const runAt = new Date(now).toISOString();
  for (const s of scored) {
    s.isNew = !state.seen[s.id];
    if (!state.seen[s.id]) state.seen[s.id] = runAt;
    s.firstSeen = state.seen[s.id];
  }

  scored.sort((a, b) => (b.fit ?? -1) - (a.fit ?? -1));

  // With 100+ companies the filtered-out list can run to tens of thousands, so I send counts by
  // reason plus the first 300 examples instead of the whole list.
  const reasonType = (r = "") => {
    if (r.startsWith("Title has")) return "Excluded word in title";
    if (r.startsWith("Location")) return "Location not on your list";
    if (r.startsWith("Posted")) return "Older than your max age";
    if (r.startsWith("No target keyword")) return "No target keyword in title";
    return r;
  };
  const droppedByReason = Object.entries(dropped.reduce((acc, d) => {
    const t = reasonType(d.reason);
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count }));

  const summary = {
    runAt,
    demo,
    method,
    model: useAI ? model : null,
    companies: fetched.length,
    boardsFailed: errors.length,
    found: all.length,
    passedFilter: kept.length - lateDropped.length,
    scored: scored.filter((x) => x.fit !== null).length,
    scoredThisRun: fresh.filter((x) => x.fit !== null).length,
    fromCache: fromCache.length,
    waiting,
    cacheReset,
    scoreErrors: fresh.filter((x) => x.error).length,
    newCount: scored.filter((x) => x.isNew).length,
    gradCount: scored.filter((x) => x.cohort === COHORTS.grad).length,
    tokensIn: totals.tokensIn,
    tokensOut: totals.tokensOut,
    costUsd: Number(totals.costUsd.toFixed(6))
  };

  const latest = { summary, results: scored, dropped: dropped.slice(0, 300), droppedCount: dropped.length, droppedByReason, errors };
  state.runs.push(summary);
  fs.writeFileSync(p.state, JSON.stringify(state, null, 2));
  fs.writeFileSync(p.latest, JSON.stringify(latest, null, 2));
  if (!demo) fs.writeFileSync(p.scores, JSON.stringify(cache));
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
