// The hosted check (CLOUD-PLAN.md, steps 3b and 5, first version): the encrypted resume, the upload rules, the
// per-person check, the shared postings fetch, and the rules that keep each route to the signed-in person.
// A fake Supabase and fake job boards only; nothing here reaches the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { encryptResume, decryptResume, encryptionKey } from "../src/cloud/crypto.js";
import { readUpload, safeFileName, looksLike } from "../src/cloud/resume.js";
import { toRows, inList } from "../src/cloud/postings.js";
import { POST as uploadResume, DELETE as removeResume } from "../api/resume.js";
import { POST as runCheck } from "../api/check.js";
import { POST as saveSetup } from "../api/setup.js";
import { DELETE as deleteAccount } from "../api/account.js";
import { GET as refresh } from "../api/refresh-postings.js";

const KEY_B64 = crypto.randomBytes(32).toString("base64");
const ENV = {
  SUPABASE_URL: "https://dev-ref.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_SECRET_KEY: "sb_secret_fake_for_tests_only",
  RESUME_ENCRYPTION_KEY: KEY_B64,
  CRON_SECRET: "a-long-cron-secret-for-tests"
};
const USER = { id: "11111111-1111-1111-1111-111111111111", email: "sam@example.com" };
const RESUME = "Sam Rivera. Strategy and operations analyst. Built a supplier scorecard across 40 vendors, cut late shipments 18%, " +
  "ran distribution center site selection models in Excel and SQL, and led a real estate underwriting review of 12 multifamily deals. ".repeat(2);
const DAY = 86400000;
const NOW = Date.now();

async function withEnv(vars, fn) {
  const saved = { ...process.env };
  Object.assign(process.env, vars);
  try { return await fn(); } finally { process.env = saved; }
}
async function withFetch(fake, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = fake;
  try { return await fn(); } finally { globalThis.fetch = real; }
}
const reply = (body, status = 200, headers = {}) => ({ ok: status < 400, status, headers: new Headers(headers), json: async () => body, text: async () => JSON.stringify(body) });
const signedIn = (path, init = {}) => new Request(`https://site.test${path}`, { ...init, headers: { Authorization: "Bearer good-token", ...(init.headers || {}) } });

// A small stand-in for Supabase: answers by path and records every call with the key it used.
function fakeSupabase(state) {
  const calls = [];
  const fake = async (url, opts = {}) => {
    const u = new URL(url);
    const method = opts.method || "GET";
    const key = opts.headers?.apikey;
    const asUserToken = opts.headers?.Authorization;
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ method, path: u.pathname, query: decodeURIComponent(u.search), key, asUserToken, body });
    if (u.pathname === "/auth/v1/user") return asUserToken === "Bearer good-token" ? reply(USER) : reply({}, 401);
    if (u.hostname === "boards-api.greenhouse.io") return reply({ content: "&lt;p&gt;Strategy and operations role building supplier scorecards and site selection models.&lt;/p&gt;" });
    const table = u.pathname.replace("/rest/v1/", "");
    if (method === "GET" && table === "runs") return reply(u.search.includes("select=id") ? state.recentRuns : state.lastRun);
    if (method === "GET" && table === "profiles") return reply(state.profile ? [state.profile] : []);
    if (method === "GET" && table === "preferences") return reply(state.prefs ? [{ prefs: state.prefs, updated_at: state.prefsAt || null }] : []);
    if (method === "GET" && table === "postings" && u.search.includes("description")) return reply([]);
    // The check asks once per job board system; the fake answers the first time only, so no role comes back twice.
    if (method === "GET" && table === "postings") {
      const first = !state.postingsServed;
      state.postingsServed = true;
      return reply(first ? state.postings : []);
    }
    if (method === "GET" && table === "scores") return reply(state.scores || []);
    if (["POST", "PATCH", "DELETE"].includes(method)) return reply(null, 201);
    if (u.pathname.startsWith("/auth/v1/admin/users/") && method === "DELETE") return reply({}, 200);
    throw new Error(`unexpected ${method} ${url}`);
  };
  return { fake, calls };
}

test("a resume is stored encrypted, and only opens for its own account with the right key", () => {
  const key = encryptionKey({ RESUME_ENCRYPTION_KEY: KEY_B64 });
  const stored = encryptResume(RESUME, USER.id, key);
  assert.ok(!stored.includes("Rivera") && !stored.includes("supplier"), "no plain text in what is stored");
  assert.notEqual(stored, encryptResume(RESUME, USER.id, key), "a fresh nonce every time");
  assert.equal(decryptResume(stored, USER.id, key), RESUME);
  assert.throws(() => decryptResume(stored, "someone-else", key), "copied into another account's row, it does not open");
  assert.throws(() => decryptResume(stored, USER.id, crypto.randomBytes(32)), "the database alone cannot read it");
  assert.throws(() => encryptionKey({ RESUME_ENCRYPTION_KEY: "too-short" }), /32 bytes/);
});

test("uploads must really be what their name says, and contact details are removed", async () => {
  const pdf = fs.readFileSync(new URL("../fixtures/resume-sample.pdf", import.meta.url));
  const text = await readUpload(pdf, "resume-sample.pdf");
  assert.ok(text.length > 200);
  assert.doesNotMatch(text, /@|\(\d{3}\)\s?\d{3}/, "no email or phone number kept");
  assert.equal(looksLike("pdf", Buffer.from("<script>alert(1)</script>")), false);
  await assert.rejects(readUpload(Buffer.from("just text pretending"), "resume.pdf"), /real PDF/);
  await assert.rejects(readUpload(Buffer.from("MZ\0\0binary"), "resume.exe"), /PDF, Word/);
  await assert.rejects(readUpload(Buffer.alloc(0), "resume.txt"), /empty/);
  await assert.rejects(readUpload(Buffer.from("short"), "resume.txt"), /almost no text/);
  await assert.rejects(readUpload(Buffer.alloc(5 * 1024 * 1024, 65), "resume.txt"), /over 4 MB/);
  assert.equal(safeFileName(encodeURIComponent("../../etc/passwd")), "passwd", "no folders, only a name");
  assert.equal(safeFileName("Resume\u0000<img>.pdf"), "Resumeimg.pdf", "no control characters or angle brackets");
  assert.equal(safeFileName(encodeURIComponent("C:\\Users\\sam\\Resume 2026.pdf")), "Resume 2026.pdf");
});

test("uploading needs a session, saves only ciphertext for the account Supabase confirms, and is rate limited", async () => {
  await withEnv(ENV, async () => {
    const state = { profile: null };
    const { fake, calls } = fakeSupabase(state);
    await withFetch(fake, async () => {
      const anon = await uploadResume(new Request("https://site.test/api/resume", { method: "POST", body: "x" }));
      assert.equal(anon.status, 401);
      const res = await uploadResume(signedIn("/api/resume", { method: "POST", body: RESUME, headers: { "X-File-Name": "resume.txt" } }));
      assert.equal(res.status, 200, await res.clone().text());
      const save = calls.find((c) => c.method === "POST" && c.path === "/rest/v1/profiles");
      assert.equal(save.key, ENV.SUPABASE_SECRET_KEY, "the server writes the encrypted resume");
      assert.equal(save.body.user_id, USER.id, "the user id comes from the verified session");
      assert.ok(!JSON.stringify(save.body).includes("supplier"), "never the plain resume");
      assert.equal(decryptResume(save.body.resume_ciphertext, USER.id, encryptionKey(ENV)).slice(0, 9), "Sam River");

      state.profile = { resume_uploaded_at: new Date().toISOString() };
      const tooSoon = await uploadResume(signedIn("/api/resume", { method: "POST", body: RESUME, headers: { "X-File-Name": "resume.txt" } }));
      assert.equal(tooSoon.status, 429);
    });
  });
});

test("removing the resume also removes the scores and checks made from it, only for this account", async () => {
  await withEnv(ENV, async () => {
    const { fake, calls } = fakeSupabase({});
    await withFetch(fake, async () => {
      const res = await removeResume(signedIn("/api/resume", { method: "DELETE" }));
      assert.equal(res.status, 200);
      const writes = calls.filter((c) => ["PATCH", "DELETE"].includes(c.method));
      assert.deepEqual(writes.map((c) => `${c.method} ${c.path}`), ["PATCH /rest/v1/profiles", "DELETE /rest/v1/scores", "DELETE /rest/v1/runs"]);
      for (const w of writes) assert.match(w.query, new RegExp(`user_id=eq\\.${USER.id}$`), "scoped to the signed-in account");
    });
  });
});

test("a check reads shared postings as the person, ranks what passes, and saves only their own scores", async () => {
  await withEnv(ENV, async () => {
    const key = encryptionKey(ENV);
    const posting = (id, title, daysAgo, extra = {}) => ({
      id: `greenhouse:acme:${id}`, ats: "greenhouse", board: "acme", company: "Acme", title, location: "New York, NY",
      url: `https://boards.greenhouse.io/acme/jobs/${id}`, department: "", posted_at: new Date(NOW - daysAgo * DAY).toISOString(),
      first_seen: new Date(NOW - daysAgo * DAY).toISOString(), ...extra
    });
    const state = {
      recentRuns: [],
      lastRun: [{ run_at: new Date(NOW - 2 * DAY).toISOString() }],
      profile: { resume_ciphertext: encryptResume(RESUME, USER.id, key), looking_for: "Strategy roles in New York" },
      prefs: { titleInclude: ["Strategy", "Operations", "Analyst"], titleExclude: ["Director"], locations: ["New York"], maxAgeDays: 14, tracks: ["Full-time", "Program"], setup: { roles: ["strategy"], cities: ["newYork"], sectors: ["ai", "supplyChain"] } },
      postings: [
        posting(1, "Strategy & Operations Analyst", 1),
        posting(2, "Director of Strategy", 1),
        posting(3, "Business Operations Associate", 5, { url: "javascript:alert(1)" }),
        posting(4, "Software Engineer", 1)
      ]
    };
    const { fake, calls } = fakeSupabase(state);
    await withFetch(fake, async () => {
      const res = await runCheck(signedIn("/api/check", { method: "POST" }));
      assert.equal(res.status, 200, await res.clone().text());
      const board = await res.json();
      assert.deepEqual(board.results.map((r) => r.title).sort(), ["Business Operations Associate", "Strategy & Operations Analyst"]);
      assert.ok(board.droppedByReason.some((d) => d.reason === "Excluded word in title"), "every drop keeps its reason");
      assert.equal(board.results.find((r) => r.title.startsWith("Business")).url, "", "a javascript: link never reaches the page");
      assert.equal(board.results.find((r) => r.title.startsWith("Strategy")).isNew, true, "first seen after the last check");
      assert.equal(board.results.find((r) => r.title.startsWith("Business")).isNew, false);
      assert.equal(board.summary.costUsd, 0);

      const reads = calls.filter((c) => c.method === "GET" && c.path.startsWith("/rest/v1/"));
      for (const r of reads) assert.equal(r.asUserToken, "Bearer good-token", `${r.path} is read as the person`);
      const scores = calls.find((c) => c.method === "POST" && c.path === "/rest/v1/scores");
      assert.equal(scores.key, ENV.SUPABASE_SECRET_KEY);
      assert.ok(scores.body.every((s) => s.user_id === USER.id && s.method === "keywords"));
      const run = calls.find((c) => c.method === "POST" && c.path === "/rest/v1/runs");
      assert.equal(run.body.user_id, USER.id);
      assert.ok(!JSON.stringify(run.body).includes("Rivera"), "the saved board holds no resume text");
    });

    state.recentRuns = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
    await withFetch(fakeSupabase(state).fake, async () => {
      const limited = await runCheck(signedIn("/api/check", { method: "POST" }));
      assert.equal(limited.status, 429, "five checks in ten minutes is the limit");
    });
  });
});

test("setup only accepts known choices, and needs a sector", async () => {
  await withEnv(ENV, async () => {
    const { fake, calls } = fakeSupabase({});
    await withFetch(fake, async () => {
      const bad = await saveSetup(signedIn("/api/setup", { method: "POST", body: JSON.stringify({ sectors: ["ai", "<script>"] }) }));
      assert.equal(bad.status, 400);
      const none = await saveSetup(signedIn("/api/setup", { method: "POST", body: JSON.stringify({ sectors: [] }) }));
      assert.equal(none.status, 400);
      const good = await saveSetup(signedIn("/api/setup", { method: "POST", body: JSON.stringify({ roles: ["strategy"], cities: ["newYork"], sectors: ["ai"], maxAgeDays: 14, school: "NYU Stern" }) }));
      assert.equal(good.status, 200, await good.clone().text());
      const saved = calls.find((c) => c.method === "POST" && c.path === "/rest/v1/preferences");
      assert.equal(saved.asUserToken, "Bearer good-token", "saved as the person, under row level security");
      assert.deepEqual(saved.body.prefs.setup.sectors, ["ai"]);
      assert.deepEqual(saved.body.prefs.networkSchools, ["NYU Stern"]);
    });
  });
});

test("deleting an account needs the exact confirmation, and deletes only the signed-in account", async () => {
  await withEnv(ENV, async () => {
    const { fake, calls } = fakeSupabase({});
    await withFetch(fake, async () => {
      const stray = await deleteAccount(signedIn("/api/account", { method: "DELETE", body: JSON.stringify({ confirm: "yes", userId: "someone-else" }) }));
      assert.equal(stray.status, 400);
      const res = await deleteAccount(signedIn("/api/account", { method: "DELETE", body: JSON.stringify({ confirm: "delete my account", userId: "someone-else" }) }));
      assert.equal(res.status, 200);
      const del = calls.find((c) => c.path.startsWith("/auth/v1/admin/users/"));
      assert.equal(del.path, `/auth/v1/admin/users/${USER.id}`, "never an id from the request body");
    });
  });
});

test("only the cron, with its secret, can start the shared fetch", async () => {
  await withEnv(ENV, async () => {
    assert.equal((await refresh(new Request("https://site.test/api/refresh-postings"))).status, 401);
    assert.equal((await refresh(new Request("https://site.test/api/refresh-postings", { headers: { Authorization: "Bearer wrong-secret-of-same-size!!" } }))).status, 401);
  });
  await withEnv({ ...ENV, CRON_SECRET: "short" }, async () => {
    const res = await refresh(new Request("https://site.test/api/refresh-postings", { headers: { Authorization: "Bearer short" } }));
    assert.equal(res.status, 401, "a weak secret is treated as no secret");
  });
});

test("the shared fetch keeps recent roles only, and never blanks a saved Greenhouse description", () => {
  const now = NOW;
  const result = {
    entry: { company: "Acme", ats: "greenhouse", board: "acme" },
    postings: [
      { id: "greenhouse:acme:1", title: "Analyst", location: "NYC", url: "https://x", postedAt: new Date(now - 3 * DAY).toISOString(), text: "" },
      { id: "greenhouse:acme:2", title: "Old role", location: "NYC", url: "https://x", postedAt: new Date(now - 45 * DAY).toISOString(), text: "" },
      { id: "greenhouse:acme:3", title: "Undated", location: "", url: "", postedAt: null, text: "" }
    ]
  };
  const rows = toRows(result, now);
  assert.deepEqual(rows.map((r) => r.id), ["greenhouse:acme:1", "greenhouse:acme:3"]);
  assert.ok(rows.every((r) => !("description" in r)), "no description column, so an upsert keeps the saved one");
  const lever = toRows({ entry: { company: "B", ats: "lever", board: "b" }, postings: [{ id: "lever:b:1", title: "PM", postedAt: null, text: "x".repeat(9000) }] }, now);
  assert.equal(lever[0].description.length, 8000);
  assert.equal(inList(['a"b', "c,d"]), '("a\\"b","c,d")', "quoted so a board name cannot break the filter");
});

test("the cron and every function's time limit point at real files", () => {
  const vercel = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  for (const file of Object.keys(vercel.functions)) assert.ok(fs.existsSync(new URL(`../${file}`, import.meta.url)), file);
  for (const cron of vercel.crons) assert.ok(fs.existsSync(new URL(`..${cron.path}.js`, import.meta.url)), cron.path);
});
