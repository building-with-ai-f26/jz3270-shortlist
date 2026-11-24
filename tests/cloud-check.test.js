// The hosted check (CLOUD-PLAN.md, steps 3b and 5, first version): the encrypted resume, the upload rules, the
// per-person check, the shared postings fetch, and the rules that keep each route to the signed-in person.
// A fake Supabase and fake job boards only; nothing here reaches the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { encryptResume, decryptResume, encryptionKey } from "../src/cloud/crypto.js";
import zlib from "node:zlib";
import { readUpload, safeFileName, looksLike, docxProblem } from "../src/cloud/resume.js";
import { checkPrefs } from "../src/cloud/check.js";
import { ok as okOrThrow } from "../src/cloud/supabase.js";
import { buildPreferences } from "../src/setup.js";
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
    // Checks still running answer the one-at-a-time rule; other id reads are the rate limit's recent checks.
    if (method === "GET" && table === "runs" && decodeURIComponent(u.search).includes("status=eq.running")) return reply(state.running || []);
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
    // A check reserves its run row first; the fake hands back an id and counts the row as a recent check.
    if (method === "POST" && table === "runs") {
      state.recentRuns = [...(state.recentRuns || []), { id: (state.recentRuns || []).length + 1 }];
      return reply([{ id: state.recentRuns.length }], 201);
    }
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
      assert.deepEqual(writes.map((c) => `${c.method} ${c.path}`), ["PATCH /rest/v1/profiles", "DELETE /rest/v1/scores", "PATCH /rest/v1/runs"]);
      assert.ok(!("resume_uploaded_at" in writes[0].body), "the time of the last upload stays, so Start over does not reset the upload limit");
      assert.deepEqual(writes[2].body, { summary: { status: "cleared" } }, "past checks stay counted, with their boards cleared");
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
      const reserved = calls.findIndex((c) => c.method === "POST" && c.path === "/rest/v1/runs");
      const firstRead = calls.findIndex((c) => c.method === "GET" && c.path === "/rest/v1/profiles");
      assert.ok(reserved >= 0 && reserved < firstRead, "the check's row is written before any work, so it always counts");
      assert.equal(calls[reserved].body.user_id, USER.id);
      const runWrites = calls.filter((c) => c.method === "PATCH" && c.path === "/rest/v1/runs");
      const done = runWrites.at(-1);
      assert.equal(done.body.summary.status, "done");
      const progress = runWrites.slice(0, -1);
      assert.ok(progress.length && progress.every((c) => c.body.summary.status === "running" && c.query.includes("summary->>status=eq.running")),
        "progress is written only while the check runs, and never over a finished board");
      assert.ok(!JSON.stringify(done.body).includes("Rivera"), "the saved board holds no resume text");
    });

    // Four earlier checks plus this one is five: allowed. A sixth is refused, and its row is marked refused.
    state.recentRuns = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
    const sixth = fakeSupabase(state);
    await withFetch(sixth.fake, async () => {
      const limited = await runCheck(signedIn("/api/check", { method: "POST" }));
      assert.equal(limited.status, 429, "five checks in ten minutes is the limit");
      assert.equal(sixth.calls.find((c) => c.method === "PATCH" && c.path === "/rest/v1/runs").body.summary.status, "refused");
    });

    // A check that fails still counts: its row is marked failed rather than left out.
    state.recentRuns = [];
    state.profile = null;
    const failing = fakeSupabase(state);
    await withFetch(failing.fake, async () => {
      const res = await runCheck(signedIn("/api/check", { method: "POST" }));
      assert.equal(res.status, 400);
      assert.equal(failing.calls.findLast((c) => c.method === "PATCH" && c.path === "/rest/v1/runs").body.summary.status, "failed");
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
      assert.equal(saved.key, ENV.SUPABASE_SECRET_KEY, "saved by the server, after every choice was checked");
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

// A minimal zip with one deflated entry, for the Word file checks.
function zipOf(name, content) {
  const packed = zlib.deflateRawSync(content);
  const n = Buffer.from(name);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(content.length, 22); local.writeUInt16LE(n.length, 26);
  const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(8, 10); entry.writeUInt32LE(packed.length, 20); entry.writeUInt32LE(1000, 24); entry.writeUInt16LE(n.length, 28); entry.writeUInt32LE(0, 42);
  const dirAt = 30 + n.length + packed.length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + n.length, 12); end.writeUInt32LE(dirAt, 16);
  return Buffer.concat([local, n, packed, entry, n, end]);
}

test("a Word file that expands too far is refused before the Word reader runs, whatever sizes it claims", async () => {
  const bomb = zipOf("word/document.xml", Buffer.alloc(60 * 1024 * 1024));
  assert.ok(bomb.length < 200 * 1024, "small on the wire");
  assert.match(docxProblem(bomb), /expand too far/, "the claimed size (1,000 bytes) is ignored; real bytes are counted");
  await assert.rejects(readUpload(bomb, "resume.docx"), /expand too far/);
  assert.equal(docxProblem(zipOf("word/document.xml", Buffer.from("<w:document/>"))), null);
  assert.equal(docxProblem(fs.readFileSync(new URL("../fixtures/resume-sample.docx", import.meta.url))), null, "a real resume passes");
  await assert.rejects(readUpload(Buffer.alloc(300 * 1024, 97), "resume.txt"), /over 200 KB/);
});

test("choices are checked strictly: no built-in names, no damaged saved lists, and only full encryption tags", () => {
  for (const sneaky of ["toString", "constructor", "__proto__"]) {
    assert.throws(() => buildPreferences({ roles: [sneaky] }), /Unknown role type/, sneaky);
    assert.throws(() => buildPreferences({ cities: [sneaky] }), /Unknown city/, sneaky);
  }
  assert.throws(() => checkPrefs({ titleExclude: Array(50000).fill("x"), setup: { sectors: ["ai"] } }), /damaged/);
  assert.throws(() => checkPrefs({ locations: [{ evil: true }], setup: { sectors: ["ai"] } }), /damaged/);
  assert.throws(() => checkPrefs({ maxAgeDays: 9999, setup: { sectors: ["ai"] } }), /damaged/);
  assert.ok(checkPrefs({ titleExclude: ["Director"], maxAgeDays: 14, setup: { sectors: ["ai"] } }));
  const key = encryptionKey({ RESUME_ENCRYPTION_KEY: KEY_B64 });
  const [v, iv, tag, data] = encryptResume(RESUME, USER.id, key).split(":");
  const short = [v, iv, Buffer.from(tag, "base64").subarray(0, 4).toString("base64"), data].join(":");
  assert.throws(() => decryptResume(short, USER.id, key), /not in a format/, "a 4-byte tag is refused");
});

test("a failed database call never puts the failing row into an error or a log", async () => {
  const res = { ok: false, status: 400, json: async () => ({ code: "23514", message: "violates check", details: "Failing row contains (Sam Rivera resume.pdf, Strategy roles in New York)" }) };
  await assert.rejects(okOrThrow(res, "Saving"), (err) => err.message === "Saving failed (HTTP 400, code 23514)" && !err.message.includes("Rivera"));
});

test("saving choices repairs damaged saved settings instead of carrying them forward", async () => {
  await withEnv(ENV, async () => {
    const state = { prefs: { titleExclude: Array(5000).fill("x"), setup: { sectors: ["ai"] } } };
    const { fake, calls } = fakeSupabase(state);
    await withFetch(fake, async () => {
      const res = await saveSetup(signedIn("/api/setup", { method: "POST", body: JSON.stringify({ roles: ["strategy"], sectors: ["ai"] }) }));
      assert.equal(res.status, 200, await res.clone().text());
      const saved = calls.find((c) => c.method === "POST" && c.path === "/rest/v1/preferences");
      assert.equal(saved.key, ENV.SUPABASE_SECRET_KEY, "the server saves choices, only after checking them");
      assert.ok(saved.body.prefs.titleExclude.length < 50, "the damaged list was replaced by the defaults");
    });
  });
});
