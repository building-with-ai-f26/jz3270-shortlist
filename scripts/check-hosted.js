// `npm run check-hosted` runs the hosted app's whole workflow, and tries to break it, against the real development
// database: it creates two throwaway accounts (A and B), has A upload the fictional Sam Rivera resume, pick
// choices and run checks, then has B try to reach A's resume, scores and checks, and has A hit the check limit,
// remove the resume and delete the account. It calls the same functions Vercel runs (api/*.js) with real fetch.
// It deletes everything it created at the end, even when a check fails. Free: keyword scoring only.
//
// Needs the dev project's SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY in .env, and postings
// in the dev database (`npm run refresh-postings`). Refuses production. Without RESUME_ENCRYPTION_KEY it uses a
// throwaway key that lives only in this process.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "../src/env.js";
import { ROOT } from "../src/pipeline.js";

loadEnv(ROOT);
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

  started = Date.now();
  res = await site(a.token, "POST", "check");
  const second = await res.json();
  check("A's second check reuses saved scores", res.status === 200 && second.results.length >= first.results.length,
    `${((Date.now() - started) / 1000).toFixed(1)} s, ${second.summary?.scoredThisRun} newly scored, ${second.results.length} on the board`);
  res = await site(a.token, "GET", "check");
  check("A's last board comes back", res.status === 200 && (await res.json()).latest?.summary?.scored > 0);

  // Attacks, as account B and as a signed-out visitor.
  check("B cannot read A's resume", rows(await rest("GET", `/rest/v1/profiles?select=resume_ciphertext&user_id=eq.${a.id}`, { token: b.token })).length === 0);
  check("B cannot read A's scores", rows(await rest("GET", `/rest/v1/scores?select=posting_id&user_id=eq.${a.id}`, { token: b.token })).length === 0);
  check("B cannot read A's checks", rows(await rest("GET", `/rest/v1/runs?select=id&user_id=eq.${a.id}`, { token: b.token })).length === 0);
  const forged = await rest("POST", "/rest/v1/scores", { token: b.token, body: { user_id: b.id, posting_id: first.results?.[0]?.id || "x", method: "keywords", cache_key: "x", fit: 100 } });
  check("B cannot write a score for itself", forged.status === 401 || forged.status === 403, `HTTP ${forged.status}`);
  const overwrite = await rest("PATCH", `/rest/v1/preferences?user_id=eq.${a.id}`, { token: b.token, body: { prefs: {} }, prefer: "return=representation" });
  check("B cannot change A's choices", rows(overwrite).length === 0, `HTTP ${overwrite.status}, ${rows(overwrite).length} rows changed`);
  res = await site(b.token, "POST", "check");
  check("B's check uses B's account, not A's resume", res.status === 400 && /resume/i.test((await res.json()).error));
  res = await site(null, "POST", "check");
  check("a signed-out visitor cannot run a check", res.status === 401);
  res = await site("forged.token.value", "GET", "me");
  check("a made-up session token is refused", res.status === 401);
  const anonPostings = await rest("GET", "/rest/v1/postings?select=id&limit=1");
  check("signed-out visitors cannot read postings", rows(anonPostings).length === 0, `HTTP ${anonPostings.status}`);
  res = await site(a.token, "DELETE", "account", { body: JSON.stringify({ confirm: "yes" }) });
  check("deleting an account needs the exact confirmation", res.status === 400);

  // The per-person rate limit: five checks in ten minutes.
  let statuses = [];
  for (let i = 0; i < 4; i++) statuses.push((await site(a.token, "POST", "check")).status);
  check("the sixth check in ten minutes is refused", statuses.join(",") === "200,200,200,429", statuses.join(","));
  res = await site(a.token, "POST", "resume", { body: pdf, headers: { "X-File-Name": "resume-sample.pdf" } });
  check("a second upload within 10 seconds is refused", res.status === 429);

  // Remove resume, then delete the account.
  res = await site(a.token, "DELETE", "resume");
  const left = await Promise.all(["profiles?select=resume_ciphertext", "scores?select=posting_id", "runs?select=id"].map((t) => rest("GET", `/rest/v1/${t}&user_id=eq.${a.id}`, { key: SECRET })));
  check("Remove resume removes the resume, its scores and checks", res.status === 200 && !rows(left[0])[0]?.resume_ciphertext && rows(left[1]).length === 0 && rows(left[2]).length === 0);
  res = await site(a.token, "DELETE", "account", { body: JSON.stringify({ confirm: "delete my account" }) });
  const gone = await rest("GET", `/auth/v1/admin/users/${a.id}`, { key: SECRET });
  check("Delete my account removes the account", res.status === 200 && gone.status === 404, `HTTP ${gone.status}`);
  if (gone.status === 404) delete people.a;
} catch (err) {
  check("the run finished", false, err.message);
} finally {
  for (const who of Object.values(people)) await rest("DELETE", `/auth/v1/admin/users/${who.id}`, { key: SECRET });
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} of ${results.length} checks passed. Test accounts deleted.`);
process.exit(failed ? 1 : 0);
