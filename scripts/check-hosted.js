// `npm run check-hosted` runs the hosted app's whole workflow, and tries to break it, against the real development
// database: it creates two throwaway accounts (A and B), has A upload the fictional Sam Rivera resume, pick
// choices and run checks, then has B try to reach A's resume, scores and checks, and has A hit the check limit,
// remove the resume and delete the account. It calls the same functions Vercel runs (api/*.js) with real fetch.
// It deletes everything it created at the end, even when a check fails.
//
// Free: AI scoring runs against a fake OpenRouter (scripts/fake-openrouter.js), with made-up fits and costs, so the
// allowance, the site's daily budget and the counter are tested on the real database without spending. The site's
// budget row for today is put back as it was at the end.
//
// Needs the dev project's SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY in .env, and postings
// in the dev database (`npm run refresh-postings`). Refuses production. Without RESUME_ENCRYPTION_KEY it uses a
// throwaway key that lives only in this process.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "../src/env.js";
import { ROOT } from "../src/pipeline.js";
import { aiDay, AI_ROLES_PER_DAY, AI_ROLES_PER_CHECK, SITE_DAILY_USD } from "../src/cloud/allowance.js";
import { useFakeOpenRouter, FAKE_COST } from "./fake-openrouter.js";

loadEnv(ROOT);
const fakeAI = useFakeOpenRouter();
const URL_ = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const PUB = process.env.SUPABASE_PUBLISHABLE_KEY || "";
const SECRET = process.env.SUPABASE_SECRET_KEY || "";
if (!URL_ || !PUB || !SECRET || /replace/.test(PUB + SECRET)) {
  console.error("Add the dev project's SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY to .env (see .env.example).");
  process.exit(1);
}
if (URL_.includes("ohagjyhptkisbynowupl")) {
  console.error("This creates and deletes test accounts, so it only runs against the development database.");
  process.exit(1);
}
if (!process.env.RESUME_ENCRYPTION_KEY) process.env.RESUME_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");

const api = {
  resume: await import("../api/resume.js"),
  setup: await import("../api/setup.js"),
  check: await import("../api/check.js"),
  account: await import("../api/account.js"),
  me: await import("../api/me.js")
};
const site = (token, method, route, { body, headers = {} } = {}) =>
  api[route][method](new Request(`https://hosted-check.test/api/${route}`, {
    method, body, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }
  }));
async function rest(method, p, { key = PUB, token, body, prefer } = {}) {
  const res = await fetch(`${URL_}${p}`, {
    method,
    headers: { apikey: key, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}
const rows = (r) => (Array.isArray(r.json) ? r.json : []);

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

const run = crypto.randomBytes(4).toString("hex");
const people = {};
const today = aiDay();
const siteBefore = rows(await rest("GET", `/rest/v1/site_spend?select=roles_scored,cost_usd&day=eq.${today}`, { key: SECRET }))[0] || null;
const usageOf = async (id) => rows(await rest("GET", `/rest/v1/ai_usage?select=roles_scored,cost_usd&user_id=eq.${id}&day=eq.${today}`, { key: SECRET }))[0] || { roles_scored: 0, cost_usd: 0 };
const aiScoresOf = async (id) => rows(await rest("GET", `/rest/v1/scores?select=posting_id&method=eq.ai&user_id=eq.${id}`, { key: SECRET })).length;
try {
  for (const who of ["a", "b"]) {
    const email = `hosted-check-${who}-${run}@example.com`;
    const password = crypto.randomBytes(24).toString("base64url");
    const made = await rest("POST", "/auth/v1/admin/users", { key: SECRET, body: { email, password, email_confirm: true } });
    if (!made.json?.id) throw new Error(`Could not create a test account (HTTP ${made.status})`);
    const session = await rest("POST", "/auth/v1/token?grant_type=password", { body: { email, password } });
    if (!session.json?.access_token) throw new Error(`Could not sign the test account in (HTTP ${session.status})`);
    people[who] = { id: made.json.id, token: session.json.access_token };
  }
  const { a, b } = people;

  // The workflow, as account A.
  const pdf = fs.readFileSync(path.join(ROOT, "fixtures", "resume-sample.pdf"));
  let res = await site(a.token, "POST", "resume", { body: pdf, headers: { "X-File-Name": "resume-sample.pdf" } });
  const upload = await res.json();
  check("A uploads a PDF resume", res.status === 200, `${upload.characters || 0} characters kept`);
  const stored = rows(await rest("GET", `/rest/v1/profiles?select=resume_ciphertext&user_id=eq.${a.id}`, { key: SECRET }))[0];
  check("the database holds only ciphertext", Boolean(stored?.resume_ciphertext?.startsWith("v1:")) && !/Rivera|supplier/i.test(stored.resume_ciphertext));

  res = await site(a.token, "POST", "setup", { body: JSON.stringify({ roles: ["strategy", "supplyChain"], cities: ["newYork", "remote"], sectors: ["supplyChain", "ai", "consumer"], maxAgeDays: 14, school: "Example Business School", lookingFor: "Strategy and operations roles in New York or remote." }) });
  const setup = await res.json();
  check("A saves choices", res.status === 200, `${setup.companies} companies`);

  let started = Date.now();
  res = await site(a.token, "POST", "check");
  const first = await res.json();
  const s = first.summary || {};
  check("A's first check ranks roles", res.status === 200 && first.results?.length > 0,
    `${((Date.now() - started) / 1000).toFixed(1)} s, ${s.found} roles found, ${s.passedFilter} passed, ${s.scoredThisRun} scored, ${s.waiting} waiting, $${s.costUsd}`);
  if (first.results?.length) {
    const top = first.results.slice(0, 3).map((r) => `${r.fit} ${r.title} (${r.company})`).join("; ");
    console.log(`      top 3: ${top}`);
  }
  check("every role links to a web page or nothing", (first.results || []).every((r) => r.url === "" || /^https:\/\//.test(r.url)));
  check("every drop keeps its reason", (first.droppedByReason || []).every((d) => d.reason && d.count > 0));

  // AI scoring, against the fake OpenRouter.
  const firstAI = s.aiScoredThisRun || 0;
  let usage = await usageOf(a.id);
  check("A's first check AI-scores up to 20 roles, and only what the keywords rank", firstAI > 0 && firstAI <= AI_ROLES_PER_CHECK && fakeAI.calls === firstAI,
    `${firstAI} AI-scored, ${s.aiWaiting} waiting, $${s.costUsd}`);
  check("the counter goes down by what was scored", first.ai?.left === AI_ROLES_PER_DAY - firstAI && usage.roles_scored === firstAI,
    `${first.ai?.left} of ${first.ai?.limit} left; ai_usage ${usage.roles_scored} roles, $${usage.cost_usd}`);
  check("the check's cost is what OpenRouter reported", Math.abs(s.costUsd - firstAI * FAKE_COST) < 1e-6 && Math.abs(Number(usage.cost_usd) - firstAI * FAKE_COST) < 1e-6);
  check("AI fits come first on the board", first.results.findIndex((r) => r.method !== "ai") === -1 ||
    first.results.slice(first.results.findIndex((r) => r.method !== "ai")).every((r) => r.method !== "ai"));

  // The site's daily budget: with today's row at the cap, AI pauses for everyone and keyword ranking carries on.
  await rest("POST", "/rest/v1/site_spend?on_conflict=day", { key: SECRET, body: { day: today, cost_usd: SITE_DAILY_USD }, prefer: "resolution=merge-duplicates" });
  const callsBefore = fakeAI.calls;
  res = await site(a.token, "POST", "check");
  const paused = await res.json();
  check("at the site's daily budget, AI pauses and keyword ranking still works", res.status === 200 && fakeAI.calls === callsBefore &&
    paused.results?.length >= first.results.length && (s.aiWaiting === 0 || paused.summary?.aiPaused === "site"),
    `${paused.summary?.aiPaused}, ${paused.results?.length} on the board`);
  res = await site(a.token, "GET", "check");
  const read = await res.json();
  check("the page learns only that AI is paused, never the site's spending", read.ai?.paused === "site" && !/cost_usd|"1(\.0+)?"/.test(JSON.stringify(read.ai)));
  check("A's usage was given back when the site could not cover it", (await usageOf(a.id)).roles_scored === firstAI);
  await rest("PATCH", `/rest/v1/site_spend?day=eq.${today}`, { key: SECRET, body: { cost_usd: siteBefore ? siteBefore.cost_usd : 0, roles_scored: siteBefore ? siteBefore.roles_scored : 0 } });

  started = Date.now();
  res = await site(a.token, "POST", "check");
  const second = await res.json();
  check("A's next check reuses saved scores and AI-scores only new ones", res.status === 200 && second.results.length >= first.results.length,
    `${((Date.now() - started) / 1000).toFixed(1)} s, ${second.summary?.scoredThisRun} newly ranked, ${second.summary?.aiScoredThisRun} newly AI-scored, ${second.results.length} on the board`);
  usage = await usageOf(a.id);
  check("no role was paid for twice: AI scores saved equal roles counted", (await aiScoresOf(a.id)) === usage.roles_scored && fakeAI.calls === usage.roles_scored,
    `${usage.roles_scored} counted, ${fakeAI.calls} calls`);
  res = await site(a.token, "GET", "check");
  check("A's last board comes back", res.status === 200 && (await res.json()).latest?.summary?.scored > 0);

  // The end of the allowance: with 58 used, a check can AI-score at most 2.
  await rest("PATCH", `/rest/v1/ai_usage?user_id=eq.${a.id}&day=eq.${today}`, { key: SECRET, body: { roles_scored: AI_ROLES_PER_DAY - 2 } });
  res = await site(a.token, "POST", "check");
  const nearEnd = await res.json();
  usage = await usageOf(a.id);
  check("near the end of the allowance a check gets only what is left", res.status === 200 && nearEnd.summary.aiScoredThisRun <= 2 && usage.roles_scored <= AI_ROLES_PER_DAY,
    `${nearEnd.summary.aiScoredThisRun} AI-scored, ${nearEnd.ai?.left} left, ${usage.roles_scored} counted`);

  // Attacks, as account B and as a signed-out visitor.
  check("B cannot read A's resume", rows(await rest("GET", `/rest/v1/profiles?select=resume_ciphertext&user_id=eq.${a.id}`, { token: b.token })).length === 0);
  check("B cannot read A's scores", rows(await rest("GET", `/rest/v1/scores?select=posting_id&user_id=eq.${a.id}`, { token: b.token })).length === 0);
  check("B cannot read A's checks", rows(await rest("GET", `/rest/v1/runs?select=id&user_id=eq.${a.id}`, { token: b.token })).length === 0);
  const forged = await rest("POST", "/rest/v1/scores", { token: b.token, body: { user_id: b.id, posting_id: first.results?.[0]?.id || "x", method: "keywords", cache_key: "x", fit: 100 } });
  check("B cannot write a score for itself", forged.status === 401 || forged.status === 403, `HTTP ${forged.status}`);
  check("B cannot read A's AI usage", rows(await rest("GET", `/rest/v1/ai_usage?select=roles_scored&user_id=eq.${a.id}`, { token: b.token })).length === 0);
  const reset = await rest("POST", "/rest/v1/ai_usage", { token: b.token, body: { user_id: b.id, day: today, roles_scored: -1000 } });
  const lowered = await rest("PATCH", `/rest/v1/ai_usage?user_id=eq.${a.id}`, { token: a.token, body: { roles_scored: 0 }, prefer: "return=representation" });
  check("nobody can write their own AI usage to get more", (reset.status === 401 || reset.status === 403) && (lowered.status === 401 || lowered.status === 403 || rows(lowered).length === 0),
    `HTTP ${reset.status} and ${lowered.status}`);
  const spend = await rest("GET", "/rest/v1/site_spend?select=cost_usd", { token: b.token });
  check("signed-in people cannot see the site's spending", rows(spend).length === 0, `HTTP ${spend.status}`);
  const overwrite = await rest("PATCH", `/rest/v1/preferences?user_id=eq.${a.id}`, { token: b.token, body: { prefs: {} }, prefer: "return=representation" });
  check("B cannot change A's choices", rows(overwrite).length === 0, `HTTP ${overwrite.status}, ${rows(overwrite).length} rows changed`);
  res = await site(b.token, "POST", "check");
  check("B's check uses B's account, not A's resume", res.status === 400 && /resume/i.test((await res.json()).error));
  await rest("POST", "/rest/v1/runs", { key: SECRET, body: { user_id: b.id, run_at: new Date().toISOString(), summary: { status: "running" } } });
  res = await site(b.token, "POST", "check");
  check("while an earlier check is still running, the next one is refused", res.status === 409, `HTTP ${res.status}`);
  res = await site(null, "POST", "check");
  check("a signed-out visitor cannot run a check", res.status === 401);
  res = await site("forged.token.value", "GET", "me");
  check("a made-up session token is refused", res.status === 401);
  const anonPostings = await rest("GET", "/rest/v1/postings?select=id&limit=1");
  check("signed-out visitors cannot read postings", rows(anonPostings).length === 0, `HTTP ${anonPostings.status}`);
  res = await site(a.token, "DELETE", "account", { body: JSON.stringify({ confirm: "yes" }) });
  check("deleting an account needs the exact confirmation", res.status === 400);

  // The per-person rate limit (five checks in ten minutes, counted from rows written before any work) and one
  // check at a time.
  const burst = await Promise.all(Array.from({ length: 6 }, () => site(a.token, "POST", "check").then((r) => r.status)));
  const ran = burst.filter((code) => code === 200).length;
  check("6 checks sent at once do not get past the limit", ran <= 1 && burst.every((code) => [200, 409, 429].includes(code)),
    `${ran} ran, ${burst.filter((c) => c === 409).length} refused as still running, ${burst.filter((c) => c === 429).length} over the limit`);
  res = await site(a.token, "POST", "check");
  check("the next check is refused too", res.status === 429);
  const wipe = await rest("DELETE", `/rest/v1/runs?user_id=eq.${a.id}`, { token: a.token, prefer: "return=representation" });
  check("A cannot delete its own past checks to reset the limit", wipe.status === 401 || wipe.status === 403 || rows(wipe).length === 0, `HTTP ${wipe.status}`);
  // Two uploads in a row (the first upload was over 10 seconds ago by now, so this pair is the test).
  await site(a.token, "POST", "resume", { body: pdf, headers: { "X-File-Name": "resume-sample.pdf" } });
  res = await site(a.token, "POST", "resume", { body: pdf, headers: { "X-File-Name": "resume-sample.pdf" } });
  check("a second upload within 10 seconds is refused", res.status === 429);

  // Remove resume, then delete the account.
  const usedBeforeStartOver = (await usageOf(a.id)).roles_scored;
  res = await site(a.token, "DELETE", "resume");
  const left = await Promise.all(["profiles?select=resume_ciphertext", "scores?select=posting_id", "runs?select=summary"].map((t) => rest("GET", `/rest/v1/${t}&user_id=eq.${a.id}`, { key: SECRET })));
  check("Start over removes the resume and its scores, and clears past boards", res.status === 200 && !rows(left[0])[0]?.resume_ciphertext && rows(left[1]).length === 0 &&
    rows(left[2]).length > 0 && rows(left[2]).every((r) => !r.summary.results));
  res = await site(a.token, "POST", "resume", { body: pdf, headers: { "X-File-Name": "resume-sample.pdf" } });
  check("Start over does not reset the upload limit", res.status === 429);
  check("Start over does not reset the AI allowance", (await usageOf(a.id)).roles_scored === usedBeforeStartOver, `${usedBeforeStartOver} still counted`);
  res = await site(a.token, "DELETE", "account", { body: JSON.stringify({ confirm: "delete my account" }) });
  const gone = await rest("GET", `/auth/v1/admin/users/${a.id}`, { key: SECRET });
  check("Delete my account removes the account", res.status === 200 && gone.status === 404, `HTTP ${gone.status}`);
  if (gone.status === 404) delete people.a;
} catch (err) {
  check("the run finished", false, err.message);
} finally {
  for (const who of Object.values(people)) await rest("DELETE", `/auth/v1/admin/users/${who.id}`, { key: SECRET });
  // The fake checks' made-up costs come off the site's budget again.
  if (siteBefore) await rest("PATCH", `/rest/v1/site_spend?day=eq.${today}`, { key: SECRET, body: siteBefore });
  else await rest("DELETE", `/rest/v1/site_spend?day=eq.${today}`, { key: SECRET });
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} of ${results.length} checks passed. ${fakeAI.calls} AI calls, all to the fake OpenRouter ($0). Test accounts deleted.`);
process.exit(failed ? 1 : 0);
