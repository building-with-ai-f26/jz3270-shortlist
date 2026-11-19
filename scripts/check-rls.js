// `npm run check-rls` checks the privacy rules on the real development database, not just in the migration
// files: it creates two throwaway accounts (A and B), has A save some rows, and confirms that B cannot read,
// change or delete them, that signed-out visitors see nothing, and that nobody but the server can write
// scores or see site spending. It deletes everything it created at the end, even when a check fails.
//
// Needs the dev project's SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY in .env.
// It refuses to run against production. It talks to Supabase with plain fetch, so no package is needed.
import crypto from "node:crypto";
import { loadEnv } from "../src/env.js";
import { ROOT } from "../src/pipeline.js";

loadEnv(ROOT);
const PROD_REF = "ohagjyhptkisbynowupl";
const URL_ = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const PUB = process.env.SUPABASE_PUBLISHABLE_KEY || "";
const SECRET = process.env.SUPABASE_SECRET_KEY || "";
if (!URL_ || !PUB || !SECRET || /replace/.test(PUB + SECRET)) {
  console.error("Add the dev project's SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY to .env (see .env.example).");
  process.exit(1);
}
if (URL_.includes(PROD_REF)) {
  console.error("This creates and deletes test accounts, so it only runs against the development database.");
  process.exit(1);
}

// Supabase's current keys go in the apikey header only; a signed-in person also sends their session token.
const headers = (key, token) => ({ apikey: key, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) });
async function call(method, path, { key = PUB, token, body, prefer } = {}) {
  const res = await fetch(`${URL_}${path}`, {
    method,
    headers: { ...headers(key, token), ...(prefer ? { Prefer: prefer } : {}) },
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
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  (${detail})`}`);
}

const run = crypto.randomBytes(4).toString("hex");
const POSTING = `rls-check:${run}:1`;
const people = {};
try {
  // Two throwaway accounts, confirmed so they can sign in. Their passwords exist only in this process.
  for (const who of ["a", "b"]) {
    const email = `rls-check-${who}-${run}@example.com`;
    const password = crypto.randomBytes(24).toString("base64url");
    const made = await call("POST", "/auth/v1/admin/users", { key: SECRET, body: { email, password, email_confirm: true } });
    if (!made.json?.id) throw new Error(`Could not create a test account (HTTP ${made.status}): ${made.json?.msg || made.json?.message || "no id returned"}`);
    const session = await call("POST", "/auth/v1/token?grant_type=password", { body: { email, password } });
    if (!session.json?.access_token) throw new Error(`Could not sign the test account in (HTTP ${session.status})`);
    people[who] = { id: made.json.id, token: session.json.access_token };
  }
  const A = people.a;
  const B = people.b;
  const asA = { token: A.token, prefer: "return=representation" };
  const asB = { token: B.token, prefer: "return=representation" };

  // A saves rows of their own.
  const ownWrites = [
    ["profiles", { user_id: A.id, looking_for: "Test only" }],
    ["preferences", { user_id: A.id, prefs: { test: true } }],
    ["watchlist", { user_id: A.id, company: "Test Co", ats: "greenhouse", board: `test${run}` }],
    ["decisions", { user_id: A.id, posting_id: POSTING, decision: "saved" }]
  ];
  for (const [table, row] of ownWrites) {
    const r = await call("POST", `/rest/v1/${table}`, { ...asA, body: row });
    check(`A can save their own ${table}`, r.status === 201, `HTTP ${r.status}`);
  }
  // The server (secret key) writes a posting, A's score and A's AI usage.
  const day = new Date().toISOString().slice(0, 10);
  const serverWrites = [
    ["postings", { id: POSTING, ats: "greenhouse", board: `test${run}`, company: "Test Co", title: "Test role" }],
    ["scores", { user_id: A.id, posting_id: POSTING, method: "ai", cache_key: "test", fit: 70 }],
    ["ai_usage", { user_id: A.id, day, roles_scored: 1 }]
  ];
  for (const [table, row] of serverWrites) {
    const r = await call("POST", `/rest/v1/${table}`, { key: SECRET, body: row, prefer: "return=minimal" });
    check(`the server can write ${table}`, r.status === 201, `HTTP ${r.status}`);
  }

  // A sees their own rows (so the empty results below mean something).
  for (const table of ["profiles", "preferences", "watchlist", "decisions", "scores", "ai_usage"]) {
    const r = await call("GET", `/rest/v1/${table}?select=user_id`, { token: A.token });
    check(`A reads their own ${table}`, rows(r).length === 1 && rows(r)[0].user_id === A.id, `HTTP ${r.status}, ${rows(r).length} rows`);
  }

  // B sees none of A's rows and cannot change them.
  for (const table of ["profiles", "preferences", "watchlist", "decisions", "scores", "ai_usage", "runs"]) {
    const r = await call("GET", `/rest/v1/${table}?select=user_id`, { token: B.token });
    check(`B cannot read A's ${table}`, r.status === 200 && rows(r).length === 0, `HTTP ${r.status}, ${rows(r).length} rows`);
  }
  const patch = await call("PATCH", `/rest/v1/watchlist?user_id=eq.${A.id}`, { ...asB, body: { company: "Changed by B" } });
  check("B cannot change A's watchlist", rows(patch).length === 0, `HTTP ${patch.status}, ${rows(patch).length} rows changed`);
  const del = await call("DELETE", `/rest/v1/decisions?user_id=eq.${A.id}`, asB);
  check("B cannot delete A's decisions", rows(del).length === 0, `HTTP ${del.status}, ${rows(del).length} rows deleted`);
  const forge = await call("POST", "/rest/v1/preferences", { ...asB, body: { user_id: A.id, prefs: { forged: true } } });
  check("B cannot write a row in A's name", forge.status >= 400, `HTTP ${forge.status}`);

  // Signed-in people can read postings but not write the server's tables or see site spending.
  const postings = await call("GET", `/rest/v1/postings?id=eq.${encodeURIComponent(POSTING)}&select=id`, { token: B.token });
  check("B can read public postings", rows(postings).length === 1, `HTTP ${postings.status}`);
  for (const [table, row] of [
    ["postings", { id: `${POSTING}-b`, ats: "greenhouse", board: "x", company: "x", title: "x" }],
    ["scores", { user_id: B.id, posting_id: POSTING, method: "ai", cache_key: "fake", fit: 100 }],
    ["ai_usage", { user_id: B.id, day, roles_scored: -100 }],
    ["runs", { user_id: B.id, summary: {} }]
  ]) {
    const r = await call("POST", `/rest/v1/${table}`, { ...asB, body: row });
    check(`B cannot write ${table} (server only)`, r.status >= 400, `HTTP ${r.status}`);
  }
  const spend = await call("GET", "/rest/v1/site_spend?select=day", { token: B.token });
  check("B cannot see site spending", spend.status >= 400 || rows(spend).length === 0, `HTTP ${spend.status}`);

  // Signed-out visitors see nothing.
  for (const table of ["postings", "profiles", "preferences", "scores"]) {
    const r = await call("GET", `/rest/v1/${table}?select=*`);
    check(`signed-out visitors cannot read ${table}`, r.status >= 400 || rows(r).length === 0, `HTTP ${r.status}, ${rows(r).length} rows`);
  }
} catch (err) {
  check("the check ran to the end", false, err.message);
} finally {
  // Deleting the accounts deletes their rows (on delete cascade); the test posting is deleted by hand.
  for (const who of Object.values(people)) await call("DELETE", `/auth/v1/admin/users/${who.id}`, { key: SECRET });
  await call("DELETE", `/rest/v1/postings?id=like.${encodeURIComponent(`rls-check:${run}:*`)}`, { key: SECRET });
  const left = people.a ? await call("GET", `/rest/v1/preferences?user_id=eq.${people.a.id}&select=user_id`, { key: SECRET }) : { json: [] };
  check("everything the check created was deleted", rows(left).length === 0, `${rows(left).length} rows left`);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} of ${results.length} checks passed on ${new URL(URL_).host}.`);
process.exit(failed ? 1 : 0);
