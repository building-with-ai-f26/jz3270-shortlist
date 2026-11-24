// One person's check on the hosted site (CLOUD-PLAN.md, step 5). It never fetches a whole job board: it reads
// today's shared postings for the person's sectors, runs the same free filter as the laptop app (src/filter.js),
// ranks what passes against their resume, and saves the scores and the run. Each posting is scored once per resume
// (rule 8).
//
// Every role that passes the filter gets an AI fit (Jordan, Nov 24: keyword scores were not good enough to show):
//   1. Keyword ranking, free and never shown: it only sets the order in which roles get AI-scored.
//   2. AI fit, paid from Jordan's OpenRouter key: the roles the keywords rank highest that have no AI fit yet,
//      within the person's daily allowance and the site's daily budget (src/cloud/allowance.js), AI_AT_ONCE at a
//      time. When either is used up, or the server has no key, the rest wait for a later check.
// The board shows AI fits; a role without one yet is listed after them, in keyword order, with no number.
// While a check runs, its row in runs says how far it has got, for the page's cover screen (checkProgress).
import { runFilter, prefilter, classifyCohort, COHORTS } from "../filter.js";
import { scoreAll, DEFAULT_MODEL } from "../score.js";
import { fillDetails } from "../sources.js";
import { peopleLinks } from "../people.js";
import { scoreCacheKey, reasonType } from "../pipeline.js";
import { asUser, asServer, readAll, ok } from "./supabase.js";
import { decryptResume, encryptionKey } from "./crypto.js";
import { hostedStarter, HOSTED_ATS, inList, upsertPostings } from "./postings.js";
import { HttpError } from "./http.js";
import { aiOn, aiStatus, reserveAI, settleAI } from "./allowance.js";

// Keyword ranking covers every role a person could AI-score in a day, so the AI order is chosen from all of them.
export const KEYWORD_CAP = 300;
// AI calls run AI_AT_ONCE at a time, in batches of AI_BATCH whose scores are saved as each batch ends, so a check
// that Vercel stops still keeps what it paid for. No batch starts after AI_SECONDS, which leaves room within the
// 300 seconds api/check.js may run (vercel.json); the rest wait for the next check.
export const AI_AT_ONCE = 8;
export const AI_BATCH = 40;
export const AI_SECONDS = 180;
const PROGRESS_MS = 1500;
// A per-person rate limit: at most CHECKS_PER_WINDOW checks in WINDOW_MINUTES, counted from the runs table.
export const CHECKS_PER_WINDOW = 5;
export const WINDOW_MINUTES = 10;
// One check at a time per person, so a double click never pays twice for the same roles. A check still marked
// running after RUNNING_SECONDS has died (Vercel stops api/check.js after 300 seconds, vercel.json), so it no
// longer blocks the next one.
export const RUNNING_SECONDS = 330;
// The board keeps the best RESULTS_KEPT roles (AI fits first), so a saved check stays a few hundred kilobytes.
export const RESULTS_KEPT = 150;
const q = encodeURIComponent;
const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

// The profile text the scorer reads, in the same shape as the laptop app's data/profile.md.
export function profileText(resume, lookingFor = "") {
  return `# Profile\n\n## Resume\n\n${resume.trim()}\n\n## What I'm looking for\n\n${(lookingFor || "").trim()}\n`;
}

// The companies a person's check covers: the hosted starter companies in their chosen sectors.
export function boardsFor(prefs = {}) {
  const sectors = prefs.setup?.sectors || [];
  return hostedStarter().filter((c) => sectors.includes(c.sector));
}

// Every check, finished or not, has a row in runs. The row is written before any work and counted after, so
// checks sent all at once, checks that fail, and refused checks all count; Start over clears a row's board but
// keeps the row; and people cannot delete their own runs (row level security lets them only read them).
export async function recentChecks(user, { env, fetchImpl, now = Date.now() } = {}) {
  const since = new Date(now - WINDOW_MINUTES * 60000).toISOString();
  const res = await ok(await asUser(user, `/rest/v1/runs?select=id&user_id=eq.${q(user.id)}&run_at=gte.${q(since)}`, { env, fetchImpl }), "Reading recent checks");
  return (await res.json()).length;
}

async function reserveRun(user, runAt, { env, fetchImpl }) {
  const res = await ok(await asServer("/rest/v1/runs?select=id", {
    method: "POST", body: { user_id: user.id, run_at: runAt, summary: { status: "running" } }, prefer: "return=representation", env, fetchImpl
  }), "Starting the check");
  return (await res.json())[0]?.id;
}

// True when an earlier check of this person is still running. Of two checks sent at once, the first one written
// runs and the other is refused.
async function earlierRunning(user, runId, { env, fetchImpl, now }) {
  const since = new Date(now - RUNNING_SECONDS * 1000).toISOString();
  const res = await ok(await asUser(user, `/rest/v1/runs?select=id&user_id=eq.${q(user.id)}&id=lt.${q(runId)}` +
    `&run_at=gte.${q(since)}&summary->>status=eq.running`, { env, fetchImpl }), "Reading recent checks");
  return (await res.json()).length > 0;
}

function finishRun(id, summary, { env, fetchImpl }) {
  return asServer(`/rest/v1/runs?id=eq.${q(id)}`, { method: "PATCH", body: { summary }, prefer: "return=minimal", env, fetchImpl });
}

// Writes { stage, done, total } into the running check's row: at each new stage, at the end of a stage, and at most
// every PROGRESS_MS in between. Writes go one after another and only touch a row still marked running, so a late one
// can never overwrite the finished board. `.settled()` waits for the last one.
function progressWriter(runId, { env, fetchImpl, clock }) {
  let stage = null;
  let last = 0;
  let writing = Promise.resolve();
  const report = (progress) => {
    const t = clock();
    if (!progress.total) return;
    if (progress.stage === stage && progress.done < progress.total && t - last < PROGRESS_MS) return;
    stage = progress.stage;
    last = t;
    writing = writing.then(() => asServer(`/rest/v1/runs?id=eq.${q(runId)}&summary->>status=eq.running`, {
      method: "PATCH", body: { summary: { status: "running", progress } }, prefer: "return=minimal", env, fetchImpl
    })).catch(() => {});
  };
  report.settled = () => writing;
  return report;
}

// How far this person's running check has got, for the cover screen: { stage, done, total }, or null.
export async function checkProgress(user, { env = process.env, fetchImpl = fetch, now = Date.now() } = {}) {
  const since = new Date(now - RUNNING_SECONDS * 1000).toISOString();
  const res = await ok(await asUser(user, `/rest/v1/runs?select=summary&user_id=eq.${q(user.id)}&run_at=gte.${q(since)}` +
    `&summary->>status=eq.running&order=run_at.desc&limit=1`, { env, fetchImpl }), "Reading your check");
  const p = (await res.json())[0]?.summary?.progress;
  return p && typeof p === "object" ? { stage: String(p.stage), done: Number(p.done) || 0, total: Number(p.total) || 0 } : null;
}

// Saved choices are written by /api/setup after validation, but they are checked again here, so damaged or
// hand-made choices (huge word lists, wrong types) cannot slow every check or break it.
const SHORT_LISTS = ["titleInclude", "titleExclude", "locations", "tracks", "networkSchools", "workdaySearch"];
export function checkPrefs(prefs) {
  const shortList = (v) => Array.isArray(v) && v.length <= 200 && v.every((x) => typeof x === "string" && x.length <= 100);
  const bad = SHORT_LISTS.some((k) => prefs[k] !== undefined && !shortList(prefs[k])) ||
    !shortList(prefs.setup?.sectors || []) ||
    (prefs.maxAgeDays !== undefined && !(Number.isInteger(prefs.maxAgeDays) && prefs.maxAgeDays >= 1 && prefs.maxAgeDays <= 30));
  if (bad) throw new HttpError("Your saved choices look damaged. Open What you want, check them, and save again.");
  return prefs;
}

async function readInputs(user, { env, fetchImpl }) {
  const [profileRes, prefsRes, lastRes] = await Promise.all([
    asUser(user, `/rest/v1/profiles?select=resume_ciphertext,looking_for&user_id=eq.${q(user.id)}`, { env, fetchImpl }),
    asUser(user, `/rest/v1/preferences?select=prefs&user_id=eq.${q(user.id)}`, { env, fetchImpl }),
    asUser(user, `/rest/v1/runs?select=run_at&user_id=eq.${q(user.id)}&summary->>status=eq.done&order=run_at.desc&limit=1`, { env, fetchImpl })
  ]);
  for (const [res, what] of [[profileRes, "Reading your profile"], [prefsRes, "Reading your choices"], [lastRes, "Reading your last check"]]) await ok(res, what);
  const profile = (await profileRes.json())[0];
  const prefs = (await prefsRes.json())[0]?.prefs;
  const lastRunAt = (await lastRes.json())[0]?.run_at || null;
  if (!profile?.resume_ciphertext) throw new HttpError("Upload your resume first.");
  if (!prefs?.setup?.sectors?.length) throw new HttpError("Pick at least one sector of companies first.");
  checkPrefs(prefs);
  const resume = decryptResume(profile.resume_ciphertext, user.id, encryptionKey(env));
  return { profile: profileText(resume, profile.looking_for), prefs, lastRunAt };
}

// Today's open postings for these boards, without descriptions (those are read only for roles about to be scored).
async function readPostings(user, boards, { env, fetchImpl, since }) {
  const rows = [];
  const call = (path, opts) => asUser(user, path, { ...opts, env, fetchImpl });
  for (const ats of HOSTED_ATS) {
    const names = boards.filter((b) => b.ats === ats).map((b) => b.board);
    for (const group of chunks(names, 60)) {
      const path = `/rest/v1/postings?select=id,ats,board,company,title,location,url,department,posted_at,first_seen` +
        `&closed_at=is.null&ats=eq.${ats}&board=in.${q(inList(group))}&or=${q(`(posted_at.gte.${since},posted_at.is.null)`)}&order=id`;
      rows.push(...await readAll(call, path));
    }
  }
  return rows.map((r) => ({
    id: r.id, company: r.company, title: r.title, location: r.location || "", url: r.url || "",
    postedAt: r.posted_at, department: r.department || "", text: "", source: r.ats, board: r.board, firstSeen: r.first_seen
  }));
}

async function readDescriptions(user, ids, { env, fetchImpl }) {
  const text = new Map();
  for (const group of chunks(ids, 50)) {
    const res = await ok(await asUser(user, `/rest/v1/postings?select=id,description&id=in.${q(inList(group))}`, { env, fetchImpl }), "Reading role details");
    for (const r of await res.json()) if (r.description) text.set(r.id, r.description);
  }
  return text;
}

// Descriptions for roles about to be scored: from the database when an earlier check or the daily fetch saved one,
// else from Greenhouse, and then saved for the next person.
async function withDescriptions(user, roles, { env, fetchImpl, onEach }) {
  const known = await readDescriptions(user, roles.map((x) => x.id), { env, fetchImpl });
  const filled = await fillDetails(roles.map((x) => ({ ...x, text: known.get(x.id) || "" })), fetchImpl, 8, onEach);
  const newlyFilled = filled.filter((x) => x.text && !known.has(x.id));
  if (newlyFilled.length) {
    await upsertPostings(newlyFilled.map((x) => ({ id: x.id, ats: x.source, board: x.board, company: x.company, title: x.title, description: x.text.slice(0, 8000) })), { env, fetchImpl });
  }
  return filled;
}

const saveScores = async (rows, { env, fetchImpl }) => {
  for (const batch of chunks(rows, 500)) {
    await ok(await asServer("/rest/v1/scores?on_conflict=user_id,posting_id,method", {
      method: "POST", body: batch, prefer: "resolution=merge-duplicates,return=minimal", env, fetchImpl
    }), "Saving scores");
  }
};

// The link on a card must be a real web address, never javascript: or data:, whatever a job board sent.
const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");

// `clock` measures how long the check has run (tests pass their own).
export async function runCloudCheck(user, { env = process.env, fetchImpl = fetch, now = Date.now(), clock = Date.now } = {}) {
  const runId = await reserveRun(user, new Date(now).toISOString(), { env, fetchImpl });
  if (await recentChecks(user, { env, fetchImpl, now }) > CHECKS_PER_WINDOW) {
    await finishRun(runId, { status: "refused" }, { env, fetchImpl });
    throw new HttpError(`That is ${CHECKS_PER_WINDOW} checks in ${WINDOW_MINUTES} minutes. Job boards update about once a day, so try again later.`, 429);
  }
  if (!runId || await earlierRunning(user, runId, { env, fetchImpl, now })) {
    await finishRun(runId, { status: "refused" }, { env, fetchImpl });
    throw new HttpError("Your last check is still running. Give it a few seconds.", 409);
  }
  const progress = progressWriter(runId, { env, fetchImpl, clock });
  try {
    const latest = await check(user, { env, fetchImpl, now, clock, progress });
    await progress.settled();
    await ok(await finishRun(runId, { ...latest, status: "done" }, { env, fetchImpl }), "Saving the check");
    // The counter is read fresh for the page and not saved with the board.
    const ai = await aiStatus(user, { env, fetchImpl, now }).catch(() => null);
    return { ...latest, ai };
  } catch (err) {
    await progress.settled();
    await finishRun(runId, { status: "failed" }, { env, fetchImpl }).catch(() => {});
    throw err;
  }
}

async function check(user, { env, fetchImpl, now, clock, progress }) {
  const started = clock();
  const { profile, prefs, lastRunAt } = await readInputs(user, { env, fetchImpl });
  const boards = boardsFor(prefs);
  const maxAge = prefs.maxAgeDays || 14;
  const since = new Date(now - maxAge * 86400000).toISOString();

  // 1. Today's postings for these companies, and 2. the free filter.
  const all = await readPostings(user, boards, { env, fetchImpl, since });
  const { kept, dropped } = runFilter(all, prefs, now);

  // 3. Scores saved for this resume are reused: keyword ranks, and AI fits (paid for once).
  const keywordKey = scoreCacheKey(profile, false, null);
  const aiKey = scoreCacheKey(profile, true, DEFAULT_MODEL);
  const readScores = async (method, key) => new Map((await readAll((path, opts) => asUser(user, path, { ...opts, env, fetchImpl }),
    `/rest/v1/scores?select=posting_id,fit,track,why,gap,dealbreaker,cohort&user_id=eq.${q(user.id)}&method=eq.${method}&cache_key=eq.${q(key)}&order=posting_id`))
    .map((s) => [s.posting_id, s]));
  const [saved, savedAI] = await Promise.all([readScores("keywords", keywordKey), readScores("ai", aiKey)]);
  const scoredAt = new Date(now).toISOString();

  // 4. Keyword ranking, free: the freshest unranked roles. It is never shown; it sets the AI order.
  const unscored = kept.filter((k) => !saved.has(k.id)).sort((a, b) => (a.ageDays ?? 999) - (b.ageDays ?? 999));
  const queue = unscored.slice(0, KEYWORD_CAP);
  progress({ stage: "details", done: 0, total: queue.length });
  const filled = await withDescriptions(user, queue, { env, fetchImpl, onEach: (done, total) => progress({ stage: "details", done, total }) });
  // Some roles only show their real location or seniority in the description, so the filter runs again.
  const toScore = [];
  const lateDropped = new Set();
  for (const x of filled) {
    const again = prefilter(x, prefs, now);
    if (again.keep) toScore.push({ ...again.posting, cohort: classifyCohort(x.title, x.text) });
    else {
      dropped.push({ ...again.posting, reason: again.reason, text: undefined });
      lateDropped.add(x.id);
    }
  }
  const { scored: fresh } = await scoreAll(profile, toScore, { useAI: false, maxToScore: KEYWORD_CAP });
  const rows = fresh.filter((f) => !f.error).map((f) => ({
    user_id: user.id, posting_id: f.id, method: "keywords", cache_key: keywordKey, fit: f.fit, track: f.track || null,
    why: f.why, gap: f.gap, dealbreaker: f.dealbreaker, cohort: f.cohort, model: null,
    tokens_in: 0, tokens_out: 0, cost_usd: 0, scored_at: scoredAt
  }));
  await saveScores(rows, { env, fetchImpl });
  for (const r of rows) saved.set(r.posting_id, r);

  // 5. AI fit, within the allowance: the roles the keywords rank highest that have no AI fit yet, freshest first
  // among equals. The allowance is held before any call and settled with the real cost after, even if a batch fails.
  const candidates = kept
    .filter((k) => saved.has(k.id) && !savedAI.has(k.id) && !lateDropped.has(k.id))
    .sort((a, b) => (saved.get(b.id).fit ?? -1) - (saved.get(a.id).fit ?? -1) || (a.ageDays ?? 999) - (b.ageDays ?? 999));
  const ai = { scored: 0, failed: 0, paused: null, stopped: false, tokensIn: 0, tokensOut: 0, costUsd: 0 };
  if (aiOn(env) && candidates.length) {
    let hold = null;
    try {
      hold = await reserveAI(user, candidates.length, { env, fetchImpl, now });
      ai.paused = hold.paused;
    } catch {
      ai.paused = "busy";
    }
    if (hold?.granted) {
      try {
        const picked = (await withDescriptions(user, candidates.slice(0, hold.granted), { env, fetchImpl }))
          .map((x) => ({ ...x, cohort: classifyCohort(x.title, x.text) }));
        let done = 0;
        progress({ stage: "ai", done, total: picked.length });
        for (const batch of chunks(picked, AI_BATCH)) {
          if (clock() - started > AI_SECONDS * 1000) {
            ai.stopped = true;
            break;
          }
          const { scored, totals } = await scoreAll(profile, batch, {
            useAI: true, maxToScore: batch.length, concurrency: AI_AT_ONCE, fetchImpl, apiKey: env.OPENROUTER_API_KEY, model: DEFAULT_MODEL,
            onEach: () => progress({ stage: "ai", done: ++done, total: picked.length })
          });
          const good = scored.filter((f) => !f.error);
          ai.scored += good.length;
          ai.failed += scored.length - good.length;
          ai.tokensIn += totals.tokensIn;
          ai.tokensOut += totals.tokensOut;
          ai.costUsd += totals.costUsd;
          const aiRows = good.map((f) => ({
            user_id: user.id, posting_id: f.id, method: "ai", cache_key: aiKey, fit: f.fit, track: f.track || null,
            why: f.why, gap: f.gap, dealbreaker: f.dealbreaker, cohort: f.newGrad ? COHORTS.grad : f.cohort, model: DEFAULT_MODEL,
            tokens_in: f.usage.tokensIn, tokens_out: f.usage.tokensOut, cost_usd: Number(f.usage.costUsd.toFixed(6)), scored_at: scoredAt
          }));
          await saveScores(aiRows, { env, fetchImpl });
          for (const r of aiRows) savedAI.set(r.posting_id, r);
        }
      } finally {
        await settleAI(user, hold, { used: ai.scored, costUsd: ai.costUsd }, { env, fetchImpl });
      }
    }
  }

  // 6. The board: every role that passed and has a score, AI fits first, best first, then the roles still waiting
  // for one in keyword order, marked new if it reached the shared postings after this person's last check. A keyword
  // score never leaves the server: a waiting role has no fit and no reason.
  const results = kept
    .filter((k) => (savedAI.has(k.id) || saved.has(k.id)) && !lateDropped.has(k.id))
    .map((k) => {
      const method = savedAI.has(k.id) ? "ai" : "keywords";
      const s = method === "ai" ? savedAI.get(k.id) : saved.get(k.id);
      const role = {
        id: k.id, title: k.title, company: k.company, location: k.location, url: safeUrl(k.url), postedAt: k.postedAt,
        ageDays: k.ageDays, track: s.track || k.track, cohort: s.cohort || k.cohort, fit: s.fit, why: s.why, gap: s.gap,
        dealbreaker: s.dealbreaker, method, isNew: !lastRunAt || Date.parse(k.firstSeen) > Date.parse(lastRunAt)
      };
      return { ...role, people: peopleLinks(role, prefs) };
    })
    .sort((a, b) => (a.method === b.method ? 0 : a.method === "ai" ? -1 : 1) || (b.fit ?? -1) - (a.fit ?? -1))
    .map((r) => (r.method === "ai" ? r : { ...r, fit: null, why: null, gap: null }));

  const droppedByReason = Object.entries(dropped.reduce((acc, d) => {
    const t = reasonType(d.reason);
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count }));

  const aiOnBoard = results.filter((r) => r.method === "ai").length;
  const summary = {
    runAt: scoredAt,
    method: aiOnBoard ? "ai" : "keywords",
    model: aiOnBoard ? DEFAULT_MODEL : null,
    companies: boards.length,
    found: all.length,
    passedFilter: kept.length - lateDropped.size,
    scored: results.length,
    scoredThisRun: rows.length,
    waiting: Math.max(0, unscored.length - queue.length),
    aiScored: aiOnBoard,
    aiScoredThisRun: ai.scored,
    aiFailed: ai.failed,
    aiWaiting: Math.max(0, candidates.length - ai.scored),
    aiPaused: ai.paused,
    aiStopped: ai.stopped,
    newCount: results.filter((r) => r.isNew).length,
    gradCount: results.filter((r) => r.cohort === COHORTS.grad).length,
    maxAgeDays: maxAge,
    tokensIn: ai.tokensIn,
    tokensOut: ai.tokensOut,
    costUsd: Number(ai.costUsd.toFixed(6))
  };
  return { summary, results: results.slice(0, RESULTS_KEPT), droppedByReason };
}

// The last check's board, read as the person (row level security), or null before their first check.
export async function latestCheck(user, { env = process.env, fetchImpl = fetch } = {}) {
  const res = await ok(await asUser(user, `/rest/v1/runs?select=summary&user_id=eq.${q(user.id)}&summary->>status=eq.done&order=run_at.desc&limit=1`, { env, fetchImpl }), "Reading your last check");
  return (await res.json())[0]?.summary || null;
}
