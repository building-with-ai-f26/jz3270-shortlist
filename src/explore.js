// Explore looks past the watchlist. It checks the public job boards of about 10,000 companies from an open
// directory (config/ats-directory.csv), runs the same filter on every board as it arrives so only passing
// roles stay in memory, ranks the survivors with free keyword scoring, then AI-scores only the top few.
// It never changes the watchlist; the user adds companies they like.
import fs from "node:fs";
import path from "node:path";
import { pool } from "./pool.js";
import { fetchBoard, fillDetails } from "./sources.js";
import { runFilter, prefilter, classifyCohort, COHORTS } from "./filter.js";
import { scoreAll, DEFAULT_MODEL } from "./score.js";
import { hasRealKey } from "./env.js";
import { peopleLinks } from "./people.js";
import { normalizeName } from "./discover.js";
import { ROOT, paths, readJson, reasonType, scoreCacheKey, ensurePersonalFiles } from "./pipeline.js";

export const DIRECTORY_FILE = path.join(ROOT, "config", "ats-directory.csv");
// A board that answered "not found" is skipped for this long, then tried once more in case it came back.
const DEAD_RETRY_DAYS = 30;
const DAY = 86400000;
const boardKey = (e) => `${e.ats}:${e.board}`.toLowerCase();

// Rows look like: greenhouse,"Acme, Inc.",acme,2026-08-01
export function parseDirectory(csv) {
  return csv.trim().split("\n").slice(1).map((line) => {
    const m = line.match(/^(\w+),(?:"((?:[^"]|"")*)"|([^,]*)),([^,]+),/);
    if (!m) return null;
    return { ats: m[1], company: (m[2] ?? m[3] ?? "").replace(/""/g, "\"").trim(), board: m[4].trim() };
  }).filter((r) => r && ["greenhouse", "lever", "ashby"].includes(r.ats) && r.board);
}

// Watchlist companies are left to "Check my list", and recently dead boards are skipped.
export function explorePool(directory, watchlist, dead = {}, now = Date.now()) {
  const boards = new Set(watchlist.map(boardKey));
  const names = new Set(watchlist.map((w) => normalizeName(w.company)));
  const stillDead = (d) => dead[boardKey(d)] && now - new Date(dead[boardKey(d)]).getTime() < DEAD_RETRY_DAYS * DAY;
  return directory.filter((d) => !boards.has(boardKey(d)) && !names.has(normalizeName(d.company)) && !stillDead(d));
}

export async function runExplore({ fetchImpl = fetch, now = Date.now(), directory, concurrency = 16, limit, topN, keywordsOnly = false, onProgress } = {}) {
  ensurePersonalFiles();
  const p = paths(false);
  const prefs = readJson(p.preferences, {});
  const profile = fs.readFileSync(p.profile, "utf8");
  const watchlist = readJson(p.watchlist, []);
  const dead = readJson(p.exploreDead, {});
  const listed = directory || parseDirectory(fs.readFileSync(DIRECTORY_FILE, "utf8"));
  let todo = explorePool(listed, watchlist, dead, now);
  const skipped = listed.length - todo.length;
  if (limit) todo = todo.slice(0, limit);
  const started = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);

  // 1. Fetch and filter each board as it arrives. A full sweep finds over 100,000 postings,
  // so only the ones that pass are kept; the rest become counts by reason.
  const kept = [];
  const dropCounts = {};
  const dropExamples = [];
  const errors = [];
  let found = 0;
  let reachable = 0;
  let done = 0;
  const countDrop = (d) => {
    const t = reasonType(d.reason);
    dropCounts[t] = (dropCounts[t] || 0) + 1;
    if (dropExamples.length < 100) dropExamples.push({ title: d.title, company: d.company, reason: d.reason });
  };
  await pool(todo, concurrency, async (entry) => {
    const r = await fetchBoard(entry, fetchImpl, {});
    done++;
    if (r.error) {
      if (/not found on/.test(r.error)) dead[boardKey(entry)] = today;
      else errors.push({ company: entry.company, error: r.error });
    } else {
      reachable++;
      found += r.postings.length;
      const f = runFilter(r.postings, prefs, now);
      kept.push(...f.kept);
      f.dropped.forEach(countDrop);
    }
    if (onProgress && (done % 250 === 0 || done === todo.length)) onProgress({ done, total: todo.length, found, passed: kept.length });
  });

  // 2. Greenhouse lists come without descriptions. Fetch them only for roles that passed, then filter
  // once more now that the text is known.
  const filled = await fillDetails(kept, fetchImpl, concurrency);
  const ready = [];
  for (const x of filled) {
    const again = prefilter(x, prefs, now);
    if (again.keep) ready.push({ ...again.posting, text: x.text, cohort: classifyCohort(x.title, x.text) });
    else countDrop({ ...again.posting, reason: again.reason });
  }

  // 3. Rank every passing role against the resume with free keyword scoring.
  const textById = new Map(ready.map((r) => [r.id, r.text]));
  const { scored: ranked } = await scoreAll(profile, ready, { useAI: false, maxToScore: ready.length });
  ranked.sort((a, b) => (b.fit ?? -1) - (a.fit ?? -1) || (a.ageDays ?? 999) - (b.ageDays ?? 999));
  const cap = topN || prefs.maxToScore || 40;
  let results = ranked.slice(0, cap);
  const more = ranked.slice(cap, cap + 100);

  // 4. AI-score only the top roles, reusing explore's saved scores so no role is paid for twice.
  const useAI = !keywordsOnly && hasRealKey() && prefs.scoring !== "keywords";
  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  let totals = { tokensIn: 0, tokensOut: 0, costUsd: 0 };
  let scoredThisRun = 0;
  let fromCache = 0;
  if (useAI) {
    const cacheKey = scoreCacheKey(profile, true, model);
    const saved = readJson(p.exploreScores, { key: cacheKey, scores: {} });
    const cache = saved.key === cacheKey ? saved : { key: cacheKey, scores: {} };
    const cached = [];
    const fresh = [];
    for (const r of results) {
      const c = cache.scores[r.id];
      if (c) cached.push({ ...r, ...c, error: null, fromCache: true });
      else fresh.push({ ...r, text: textById.get(r.id) });
    }
    const ai = await scoreAll(profile, fresh, { useAI: true, maxToScore: cap, fetchImpl, model });
    const scoredAt = new Date(now).toISOString();
    for (const f of ai.scored) {
      if (f.newGrad) f.cohort = COHORTS.grad;
      if (!f.error) cache.scores[f.id] = { fit: f.fit, track: f.track, why: f.why, gap: f.gap, dealbreaker: f.dealbreaker, cohort: f.cohort, scoredAt };
    }
    // Scores for roles this sweep no longer found are dropped after 60 days, so the file does not grow forever.
    const open = new Set(ranked.map((r) => r.id));
    for (const [id, s] of Object.entries(cache.scores)) if (!open.has(id) && now - new Date(s.scoredAt).getTime() > 60 * DAY) delete cache.scores[id];
    fs.writeFileSync(p.exploreScores, JSON.stringify(cache));
    results = [...cached, ...ai.scored];
    totals = ai.totals;
    scoredThisRun = ai.scored.filter((x) => x.fit !== null).length;
    fromCache = cached.length;
  }

  // 5. Mark what is new since the last sweep and add the Reach out links.
  const seen = readJson(p.exploreSeen, {});
  const runAt = new Date(now).toISOString();
  for (const r of [...results, ...more]) {
    r.isNew = !seen[r.id];
    if (!seen[r.id]) seen[r.id] = runAt;
  }
  const stillOpen = new Set(ranked.map((r) => r.id));
  for (const id of Object.keys(seen)) if (!stillOpen.has(id)) delete seen[id];
  results.sort((a, b) => (b.fit ?? -1) - (a.fit ?? -1));
  for (const r of results) r.people = peopleLinks(r, prefs);
  const slim = ({ id, title, company, location, url, fit, cohort, track, ageDays, isNew }) => ({ id, title, company, location, url, fit, cohort, track, ageDays, isNew });

  const summary = {
    runAt,
    method: useAI ? "ai" : "keywords",
    model: useAI ? model : null,
    inDirectory: listed.length,
    skipped,
    checked: todo.length,
    reachable,
    notFound: todo.length - reachable - errors.length,
    boardErrors: errors.length,
    found,
    passedFilter: ready.length,
    shown: results.length,
    scoredThisRun,
    fromCache,
    tokensIn: totals.tokensIn,
    tokensOut: totals.tokensOut,
    costUsd: Number(totals.costUsd.toFixed(6)),
    seconds: Math.round((Date.now() - started) / 1000)
  };
  const droppedByReason = Object.entries(dropCounts).sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count }));
  const out = { summary, results: results.map((r) => ({ ...r, text: undefined })), more: more.map(slim), droppedByReason, dropped: dropExamples, errors: errors.slice(0, 50) };

  fs.writeFileSync(p.exploreDead, JSON.stringify(dead, null, 2));
  fs.writeFileSync(p.exploreSeen, JSON.stringify(seen));
  fs.writeFileSync(p.explore, JSON.stringify(out, null, 2));
  return out;
}
