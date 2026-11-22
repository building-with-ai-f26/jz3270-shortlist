// One person's check on the hosted site (CLOUD-PLAN.md, step 5, first version). It never fetches a whole job
// board: it reads today's shared postings for the person's sectors, runs the same free filter as the laptop app
// (src/filter.js), ranks what passes against their resume, and saves the scores and the run. Each posting is
// scored once per resume (rule 8), the freshest first, up to KEYWORD_CAP a check.
//
// This first version ranks with the free keyword scoring. AI scoring, with a daily allowance per person and a
// site-wide spending cap, comes next (CLOUD-PLAN.md, step 5).
import { runFilter, prefilter, classifyCohort, COHORTS } from "../filter.js";
import { scoreAll } from "../score.js";
import { fillDetails } from "../sources.js";
import { peopleLinks } from "../people.js";
import { scoreCacheKey, reasonType } from "../pipeline.js";
import { asUser, asServer, readAll, ok } from "./supabase.js";
import { decryptResume, encryptionKey } from "./crypto.js";
import { hostedStarter, HOSTED_ATS, inList, upsertPostings } from "./postings.js";
import { HttpError } from "./http.js";

export const KEYWORD_CAP = 60;
// A per-person rate limit: at most CHECKS_PER_WINDOW checks in WINDOW_MINUTES, counted from the runs table.
export const CHECKS_PER_WINDOW = 5;
export const WINDOW_MINUTES = 10;
const RESULTS_KEPT = 150;
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

export async function recentChecks(user, { env, fetchImpl, now = Date.now() } = {}) {
  const since = new Date(now - WINDOW_MINUTES * 60000).toISOString();
  const res = await ok(await asUser(user, `/rest/v1/runs?select=id&user_id=eq.${q(user.id)}&run_at=gte.${q(since)}`, { env, fetchImpl }), "Reading recent checks");
  return (await res.json()).length;
}

async function readInputs(user, { env, fetchImpl }) {
  const [profileRes, prefsRes, lastRes] = await Promise.all([
    asUser(user, `/rest/v1/profiles?select=resume_ciphertext,looking_for&user_id=eq.${q(user.id)}`, { env, fetchImpl }),
    asUser(user, `/rest/v1/preferences?select=prefs&user_id=eq.${q(user.id)}`, { env, fetchImpl }),
    asUser(user, `/rest/v1/runs?select=run_at&user_id=eq.${q(user.id)}&order=run_at.desc&limit=1`, { env, fetchImpl })
  ]);
  for (const [res, what] of [[profileRes, "Reading your profile"], [prefsRes, "Reading your choices"], [lastRes, "Reading your last check"]]) await ok(res, what);
  const profile = (await profileRes.json())[0];
  const prefs = (await prefsRes.json())[0]?.prefs;
  const lastRunAt = (await lastRes.json())[0]?.run_at || null;
  if (!profile?.resume_ciphertext) throw new HttpError("Upload your resume first.");
  if (!prefs?.setup?.sectors?.length) throw new HttpError("Pick at least one sector of companies first.");
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

// The link on a card must be a real web address, never javascript: or data:, whatever a job board sent.
const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");

export async function runCloudCheck(user, { env = process.env, fetchImpl = fetch, now = Date.now() } = {}) {
  if (await recentChecks(user, { env, fetchImpl, now }) >= CHECKS_PER_WINDOW) {
    throw new HttpError(`That is ${CHECKS_PER_WINDOW} checks in ${WINDOW_MINUTES} minutes. Job boards update about once a day, so try again later.`, 429);
  }
  const { profile, prefs, lastRunAt } = await readInputs(user, { env, fetchImpl });
  const boards = boardsFor(prefs);
  const maxAge = prefs.maxAgeDays || 14;
  const since = new Date(now - maxAge * 86400000).toISOString();

  // 1. Today's postings for these companies, and 2. the free filter.
  const all = await readPostings(user, boards, { env, fetchImpl, since });
  const { kept, dropped } = runFilter(all, prefs, now);

  // 3. Scores saved for this resume are reused; the freshest unscored roles are scored now.
  const cacheKey = scoreCacheKey(profile, false, null);
  const savedRows = await readAll((path, opts) => asUser(user, path, { ...opts, env, fetchImpl }),
    `/rest/v1/scores?select=posting_id,fit,track,why,gap,dealbreaker,cohort&user_id=eq.${q(user.id)}&method=eq.keywords&cache_key=eq.${q(cacheKey)}&order=posting_id`);
  const saved = new Map(savedRows.map((s) => [s.posting_id, s]));
  const unscored = kept.filter((k) => !saved.has(k.id)).sort((a, b) => (a.ageDays ?? 999) - (b.ageDays ?? 999));
  const queue = unscored.slice(0, KEYWORD_CAP);

  // Descriptions: from the database when an earlier check or the daily fetch saved one, else from Greenhouse,
  // and then saved for the next person.
  const known = await readDescriptions(user, queue.map((x) => x.id), { env, fetchImpl });
  const withKnown = queue.map((x) => ({ ...x, text: known.get(x.id) || "" }));
  const filled = await fillDetails(withKnown, fetchImpl, 8);
  const newlyFilled = filled.filter((x) => x.text && !known.has(x.id));
  if (newlyFilled.length) {
    await upsertPostings(newlyFilled.map((x) => ({ id: x.id, ats: x.source, board: x.board, company: x.company, title: x.title, description: x.text.slice(0, 8000) })), { env, fetchImpl });
  }
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
  const scoredAt = new Date(now).toISOString();
  const rows = fresh.filter((f) => !f.error).map((f) => ({
    user_id: user.id, posting_id: f.id, method: "keywords", cache_key: cacheKey, fit: f.fit, track: f.track || null,
    why: f.why, gap: f.gap, dealbreaker: f.dealbreaker, cohort: f.cohort, model: null,
    tokens_in: 0, tokens_out: 0, cost_usd: 0, scored_at: scoredAt
  }));
  for (const batch of chunks(rows, 500)) {
    await ok(await asServer("/rest/v1/scores?on_conflict=user_id,posting_id,method", {
      method: "POST", body: batch, prefer: "resolution=merge-duplicates,return=minimal", env, fetchImpl
    }), "Saving scores");
  }
  for (const r of rows) saved.set(r.posting_id, r);

  // 4. The board: every role that passed and has a score, best first, marked new if it reached the shared
  // postings after this person's last check.
  const results = kept
    .filter((k) => saved.has(k.id) && !lateDropped.has(k.id))
    .map((k) => {
      const s = saved.get(k.id);
      const role = {
        id: k.id, title: k.title, company: k.company, location: k.location, url: safeUrl(k.url), postedAt: k.postedAt,
        ageDays: k.ageDays, track: s.track || k.track, cohort: s.cohort || k.cohort, fit: s.fit, why: s.why, gap: s.gap,
        dealbreaker: s.dealbreaker, method: "keywords", isNew: !lastRunAt || Date.parse(k.firstSeen) > Date.parse(lastRunAt)
      };
      return { ...role, people: peopleLinks(role, prefs) };
    })
    .sort((a, b) => (b.fit ?? -1) - (a.fit ?? -1));

  const droppedByReason = Object.entries(dropped.reduce((acc, d) => {
    const t = reasonType(d.reason);
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count }));

  const summary = {
    runAt: scoredAt,
    method: "keywords",
    model: null,
    companies: boards.length,
    found: all.length,
    passedFilter: kept.length - lateDropped.size,
    scored: results.length,
    scoredThisRun: rows.length,
    waiting: Math.max(0, unscored.length - queue.length),
    newCount: results.filter((r) => r.isNew).length,
    gradCount: results.filter((r) => r.cohort === COHORTS.grad).length,
    maxAgeDays: maxAge,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0
  };
  const latest = { summary, results: results.slice(0, RESULTS_KEPT), droppedByReason };
  await ok(await asServer("/rest/v1/runs", {
    method: "POST", body: { user_id: user.id, run_at: scoredAt, summary: latest }, prefer: "return=minimal", env, fetchImpl
  }), "Saving the check");
  return latest;
}

// The last check's board, read as the person (row level security), or null before their first check.
export async function latestCheck(user, { env = process.env, fetchImpl = fetch } = {}) {
  const res = await ok(await asUser(user, `/rest/v1/runs?select=summary&user_id=eq.${q(user.id)}&order=run_at.desc&limit=1`, { env, fetchImpl }), "Reading your last check");
  return (await res.json())[0]?.summary || null;
}
