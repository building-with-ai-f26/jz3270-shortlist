// AI scoring on the hosted site (CLOUD-PLAN.md, step 5): the daily allowance per person, the site's daily budget,
// the counter, and paying for each role once. An in-memory Supabase that honors filters (so the conditional writes
// really are conditional) and a fake OpenRouter; nothing here reaches the network or spends anything.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { encryptResume, encryptionKey } from "../src/cloud/crypto.js";
import { aiDay, aiStatus, reserveAI, settleAI, AI_ROLES_PER_DAY, AI_ROLES_PER_CHECK, SITE_DAILY_USD } from "../src/cloud/allowance.js";
import { RUNNING_SECONDS } from "../src/cloud/check.js";
import { DEFAULT_MODEL } from "../src/score.js";
import { POST as runCheck, GET as readCheck } from "../api/check.js";
import { DELETE as removeResume } from "../api/resume.js";

const ENV = {
  SUPABASE_URL: "https://dev-ref.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_SECRET_KEY: "sb_secret_fake_for_tests_only",
  RESUME_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64"),
  OPENROUTER_API_KEY: "fake-openrouter-key-for-tests"
};
const USER = { id: "22222222-2222-2222-2222-222222222222", email: "sam@example.com" };
const RESUME = "Sam Rivera. Strategy and operations analyst. Built a supplier scorecard across 40 vendors, cut late shipments 18%, " +
  "ran distribution center site selection models in Excel and SQL, and led a real estate underwriting review of 12 multifamily deals.";
const NOW = Date.now();
const DAY = 86400000;
const TODAY = aiDay(NOW);
const COST = 0.0007;

async function withEnv(vars, fn) {
  const saved = { ...process.env };
  for (const k of Object.keys(process.env)) if (k.startsWith("OPENROUTER")) delete process.env[k];
  Object.assign(process.env, vars);
  try { return await fn(); } finally { process.env = saved; }
}
async function withFetch(fake, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = fake;
  try { return await fn(); } finally { globalThis.fetch = real; }
}
const reply = (body, status = 200) => ({ ok: status < 400, status, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) });
const signedIn = (path, init = {}) => new Request(`https://site.test${path}`, { ...init, headers: { Authorization: "Bearer good-token" } });

// 25 roles that pass the filter, each with a description, so no job board is ever asked. Made-up filler words
// (rare, so they weigh a lot) spread the keyword ranks, so the order the AI scores them in can be checked.
const WORDS = ["supplier scorecard", "site selection", "distribution center", "underwriting", "SQL models", "late shipments"];
const letter = (n) => String.fromCharCode(97 + (n % 26));
const filler = (i) => Array.from({ length: i * 3 }, (_, j) => `qz${letter(i)}${letter(j)}${letter(j * 7 + i)}`).join(" ");
const POSTINGS = Array.from({ length: 25 }, (_, i) => ({
  id: `greenhouse:acme:${i + 1}`, ats: "greenhouse", board: "acme", company: "Acme", title: `Strategy Analyst ${i + 1}`,
  location: "New York, NY", url: `https://boards.greenhouse.io/acme/jobs/${i + 1}`, department: "",
  posted_at: new Date(NOW - (i % 5) * DAY).toISOString(), first_seen: new Date(NOW - DAY).toISOString(), closed_at: null,
  description: `Strategy and operations role. ${WORDS.slice(0, 1 + (i % WORDS.length)).join(", ")}. ${filler(i)}`
}));
const PREFS = { titleInclude: ["Strategy", "Operations", "Analyst"], titleExclude: [], locations: ["New York"], maxAgeDays: 14, tracks: ["Full-time", "Program"], setup: { sectors: ["ai", "supplyChain"] } };

// PostgREST filters, enough for these routes: eq, lt, gte, in and is.null, on plain columns and summary->>status.
function matches(row, params) {
  for (const [k, raw] of params) {
    if (["select", "order", "limit", "on_conflict", "or"].includes(k)) continue;
    const value = k.includes("->>") ? row[k.split("->>")[0]]?.[k.split("->>")[1]] : row[k];
    const [op, ...rest] = raw.split(".");
    const want = rest.join(".");
    const num = (x) => (typeof x === "number" ? x : Number(x));
    if (op === "eq" && !(String(value) === want || (value !== null && value !== undefined && typeof value === "number" && num(want) === value))) return false;
    if (op === "lt" && !(num(value) < num(want))) return false;
    if (op === "gte" && !(String(value) >= want)) return false;
    if (op === "is" && want === "null" && value !== null && value !== undefined) return false;
    if (op === "in") {
      const list = [...want.matchAll(/"((?:[^"\\]|\\.)*)"|([^,()]+)/g)].map((m) => m[1] ?? m[2]);
      if (!list.includes(String(value))) return false;
    }
  }
  return true;
}

// The in-memory Supabase. `openrouter(body)` answers AI calls. Every call yields once, so checks and holds that
// run at the same time really interleave between a read and a write.
function fakeCloud({ usage = 0, siteCost = 0, running = [], openrouter = defaultModel } = {}) {
  const key = encryptionKey(ENV);
  const db = {
    profiles: [{ user_id: USER.id, resume_ciphertext: encryptResume(RESUME, USER.id, key), looking_for: "Strategy roles in New York", resume_file_name: "resume.txt" }],
    preferences: [{ user_id: USER.id, prefs: PREFS }],
    postings: POSTINGS.map((p) => ({ ...p })),
    runs: running.map((r) => ({ user_id: USER.id, ...r })),
    scores: [],
    ai_usage: usage ? [{ user_id: USER.id, day: TODAY, roles_scored: usage, cost_usd: 0 }] : [],
    site_spend: siteCost ? [{ day: TODAY, roles_scored: 0, cost_usd: siteCost }] : []
  };
  const calls = [];
  const ai = [];
  let nextRun = 100;
  const fake = async (url, opts = {}) => {
    await new Promise((r) => setImmediate(r));
    const u = new URL(url);
    const method = opts.method || "GET";
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    if (u.hostname === "openrouter.ai") {
      ai.push({ body, auth: opts.headers?.Authorization });
      return openrouter(body);
    }
    if (u.pathname === "/auth/v1/user") return opts.headers?.Authorization === "Bearer good-token" ? reply(USER) : reply({}, 401);
    const table = u.pathname.replace("/rest/v1/", "");
    const params = [...u.searchParams];
    calls.push({ method, table, query: decodeURIComponent(u.search), body, key: opts.headers?.apikey });
    const rows = db[table];
    if (!rows) throw new Error(`unexpected ${method} ${url}`);
    if (method === "GET") {
      // The fake's postings all belong to the person's companies, so the board filter is left out.
      let found = rows.filter((r) => matches(r, table === "postings" ? params.filter(([k]) => k !== "board") : params));
      if (u.searchParams.get("order")?.endsWith(".desc")) found = [...found].reverse();
      if (u.searchParams.get("limit")) found = found.slice(0, Number(u.searchParams.get("limit")));
      return reply(found);
    }
    if (method === "POST") {
      const list = Array.isArray(body) ? body : [body];
      const conflict = (u.searchParams.get("on_conflict") || "").split(",").filter(Boolean);
      const out = [];
      for (const item of list) {
        if (table === "runs") { const row = { id: nextRun++, ...item }; rows.push(row); out.push(row); continue; }
        if (table === "postings") continue;
        const same = conflict.length ? rows.find((r) => conflict.every((c) => r[c] === item[c])) : null;
        if (same && /ignore-duplicates/.test(opts.headers?.Prefer || "")) continue;
        const base = table === "ai_usage" || table === "site_spend" ? { roles_scored: 0, cost_usd: 0 } : {};
        if (same) Object.assign(same, item); else rows.push({ ...base, ...item });
        out.push(item);
      }
      return reply(out, 201);
    }
    if (method === "PATCH") {
      const changed = rows.filter((r) => matches(r, params));
      for (const r of changed) Object.assign(r, body);
      return reply(changed.map((r) => ({ ...r })));
    }
    if (method === "DELETE") {
      db[table] = rows.filter((r) => !matches(r, params));
      return reply(null, 204);
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
  return { fake, db, calls, ai };
}

// A model that likes every role a little differently, at the measured cost per role.
function defaultModel(body) {
  const title = body.messages[1].content.match(/^Title: (.*)$/m)[1];
  const n = Number(title.match(/\d+/)[0]);
  const content = JSON.stringify({ fit: 40 + n * 2, track: "Full-time", why: `Matches ${title}`, gap: "None", dealbreaker: null, new_grad: n === 3 });
  return reply({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 900, completion_tokens: 120, cost: COST } });
}

const post = async () => {
  const res = await runCheck(signedIn("/api/check", { method: "POST" }));
  return { status: res.status, body: await res.json() };
};
const mine = (db) => db.ai_usage.find((r) => r.user_id === USER.id && r.day === TODAY);
const site = (db) => db.site_spend.find((r) => r.day === TODAY);

test("a check AI-scores the roles the keywords rank highest, up to 20, and the counter goes down by what was scored", async () => {
  await withEnv(ENV, async () => {
    const cloud = fakeCloud();
    await withFetch(cloud.fake, async () => {
      const { status, body } = await post();
      assert.equal(status, 200, JSON.stringify(body));
      assert.equal(cloud.ai.length, AI_ROLES_PER_CHECK, "20 calls, not 25");
      assert.equal(body.summary.aiScoredThisRun, 20);
      assert.equal(body.summary.aiWaiting, 5, "the other 5 wait for the next check");
      assert.equal(body.summary.method, "ai");
      assert.equal(body.summary.costUsd, Number((20 * COST).toFixed(6)), "the check's cost is the real cost OpenRouter reported");
      assert.deepEqual(body.ai, { on: true, limit: 60, perCheck: 20, left: 40, paused: null });
      assert.equal(mine(cloud.db).roles_scored, 20);
      assert.equal(mine(cloud.db).cost_usd, Number((20 * COST).toFixed(6)));
      assert.equal(site(cloud.db).roles_scored, 20);
      assert.equal(site(cloud.db).cost_usd, Number((20 * COST).toFixed(6)), "the site's hold became the real cost");

      // The 20 picked are the 20 best by keyword rank.
      const kw = new Map(cloud.db.scores.filter((s) => s.method === "keywords").map((s) => [s.posting_id, s.fit]));
      const picked = new Set(cloud.db.scores.filter((s) => s.method === "ai").map((s) => s.posting_id));
      const lowestPicked = Math.min(...[...picked].map((id) => kw.get(id)));
      const highestLeft = Math.max(...[...kw.keys()].filter((id) => !picked.has(id)).map((id) => kw.get(id)));
      assert.ok(lowestPicked >= highestLeft, `picked by keyword rank (${lowestPicked} vs ${highestLeft})`);

      // AI fits come first on the board, then the keyword-ranked rest.
      assert.deepEqual([...new Set(body.results.map((r) => r.method))], ["ai", "keywords"]);
      const aiFits = body.results.filter((r) => r.method === "ai").map((r) => r.fit);
      assert.deepEqual(aiFits, [...aiFits].sort((a, b) => b - a));
      assert.equal(body.results.find((r) => r.title === "Strategy Analyst 3")?.cohort, "2027 grad", "the model's new grad flag moves a role to that column");

      const saved = cloud.db.scores.filter((s) => s.method === "ai");
      assert.ok(saved.every((s) => s.user_id === USER.id && s.model === DEFAULT_MODEL && s.cost_usd === COST && s.tokens_in === 900));
      const writes = cloud.calls.filter((c) => c.method !== "GET" && ["ai_usage", "site_spend", "scores"].includes(c.table));
      assert.ok(writes.every((c) => c.key === ENV.SUPABASE_SECRET_KEY), "only the server writes usage and scores");
    });
  });
});

test("each role is paid for once: later checks reuse AI fits and score only what is left", async () => {
  await withEnv(ENV, async () => {
    const cloud = fakeCloud();
    await withFetch(cloud.fake, async () => {
      await post();
      const second = await post();
      assert.equal(cloud.ai.length, 25, "the second check scored only the 5 waiting roles");
      assert.equal(second.body.summary.aiScored, 25);
      assert.equal(second.body.ai.left, 35);
      const third = await post();
      assert.equal(cloud.ai.length, 25, "nothing new, nothing paid");
      assert.equal(third.body.summary.aiScoredThisRun, 0);
      assert.equal(third.body.ai.left, 35, "a check with nothing to score uses none of the allowance");
      const titles = cloud.ai.map((c) => c.body.messages[1].content.match(/^Title: (.*)$/m)[1]);
      assert.equal(new Set(titles).size, titles.length, "no role was sent twice");
    });
  });
});

test("near the end of the allowance a check gets only what is left, then ranks by keywords", async () => {
  await withEnv(ENV, async () => {
    const cloud = fakeCloud({ usage: 55 });
    await withFetch(cloud.fake, async () => {
      const first = await post();
      assert.equal(cloud.ai.length, 5);
      assert.deepEqual(first.body.ai, { on: true, limit: 60, perCheck: 20, left: 0, paused: "person" });
      const second = await post();
      assert.equal(second.status, 200);
      assert.equal(cloud.ai.length, 5, "no more AI today");
      assert.equal(second.body.summary.aiPaused, "person");
      assert.equal(second.body.results.length, 25, "every role is still ranked, by keywords where AI is used up");
      assert.equal(mine(cloud.db).roles_scored, 60);
    });
  });
});

test("the site's daily budget pauses AI for everyone, keyword ranking still works, and the page never sees the site's spending", async () => {
  await withEnv(ENV, async () => {
    const cloud = fakeCloud({ siteCost: SITE_DAILY_USD - 0.001 });
    await withFetch(cloud.fake, async () => {
      const { status, body } = await post();
      assert.equal(status, 200);
      assert.equal(cloud.ai.length, 0);
      assert.equal(body.summary.aiPaused, "site");
      assert.equal(body.summary.method, "keywords");
      assert.equal(body.results.length, 25);
      assert.equal(mine(cloud.db).roles_scored, 0, "the person's hold was given back");
      assert.deepEqual(body.ai, { on: true, limit: 60, perCheck: 20, left: 60, paused: "site" });
      const res = await readCheck(signedIn("/api/check"));
      const read = await res.json();
      assert.equal(read.ai.paused, "site");
      assert.doesNotMatch(JSON.stringify(read), /0\.999|cost_usd/, "no site dollars in what the page gets");
    });
  });
});

test("part of the site's budget is shared out, and the rest of the person's hold goes back", async () => {
  await withEnv(ENV, async () => {
    const cloud = fakeCloud({ siteCost: SITE_DAILY_USD - 0.007 });
    await withFetch(cloud.fake, async () => {
      const { body } = await post();
      assert.equal(cloud.ai.length, 3, "room for 3 roles at the $0.002 hold each");
      assert.equal(mine(cloud.db).roles_scored, 3);
      assert.equal(body.ai.paused, null, "$0.0049 back from the real cost leaves room for 2 more");
    });
  });
});

test("Start over keeps the day's AI count, so removing the resume never resets the allowance", async () => {
  await withEnv(ENV, async () => {
    const cloud = fakeCloud();
    await withFetch(cloud.fake, async () => {
      await post();
      const res = await removeResume(signedIn("/api/resume", { method: "DELETE" }));
      assert.equal(res.status, 200);
      assert.equal(cloud.db.scores.length, 0, "the scores are gone");
      assert.equal(mine(cloud.db).roles_scored, 20, "the count is not");
      const read = await (await readCheck(signedIn("/api/check"))).json();
      assert.equal(read.ai.left, 40);
    });
  });
});

test("holds made at the same moment never pass the daily limit, and the counts stay exact", async () => {
  await withEnv(ENV, async () => {
    const cloud = fakeCloud({ usage: 10 });
    await withFetch(cloud.fake, async () => {
      const holds = await Promise.all(Array.from({ length: 4 }, () => reserveAI(USER, 20, { env: ENV, now: NOW }).catch(() => ({ granted: 0 }))));
      const granted = holds.reduce((n, h) => n + h.granted, 0);
      assert.ok(granted <= AI_ROLES_PER_DAY - 10 && granted > 0, `granted ${granted}`);
      assert.equal(mine(cloud.db).roles_scored, 10 + granted, "every hold was counted, none lost");
      assert.equal(site(cloud.db).roles_scored, granted);
      await Promise.all(holds.filter((h) => h.granted).map((h) => settleAI(USER, h, { used: h.granted - 1, costUsd: 0.001 }, { env: ENV })));
      const holders = holds.filter((h) => h.granted).length;
      assert.equal(mine(cloud.db).roles_scored, 10 + granted - holders, "each settle gave back its unused role");
      assert.equal(site(cloud.db).cost_usd, Number((holders * 0.001).toFixed(6)), "the site holds only the real cost after settling");
    });
  });
});

test("a failed AI call adds its cost but not a role, and the role is tried again on the next check", async () => {
  await withEnv(ENV, async () => {
    // The first role the model sees gets an answer with no score in it, once; it costs something all the same.
    let failing = null;
    const titleOf = (body) => body.messages[1].content.match(/^Title: (.*)$/m)[1];
    const flaky = (body) => {
      if (failing === null) failing = titleOf(body);
      return titleOf(body) === failing && failing !== "answered"
        ? reply({ choices: [{ message: { content: "I cannot score this." }, finish_reason: "stop" }], usage: { prompt_tokens: 900, completion_tokens: 10, cost: 0.0005 } })
        : defaultModel(body);
    };
    const cloud = fakeCloud({ openrouter: flaky });
    await withFetch(cloud.fake, async () => {
      const { body } = await post();
      assert.equal(cloud.ai.length, 20);
      assert.equal(body.summary.aiScoredThisRun, 19);
      assert.equal(body.summary.aiFailed, 1);
      assert.equal(body.summary.aiWaiting, 6, "the failed role waits with the 5 not yet tried");
      assert.equal(mine(cloud.db).roles_scored, 19, "only scored roles count");
      assert.equal(mine(cloud.db).cost_usd, Number((19 * COST + 0.0005).toFixed(6)), "every call's cost counts");
      const retry = failing;
      failing = "answered";
      await post();
      assert.ok(cloud.ai.slice(20).some((c) => titleOf(c.body) === retry), "tried again on the next check");
    });
  });
});

test("without a key on the server there is no AI call and no usage row, and the board is keyword-ranked", async () => {
  await withEnv({ ...ENV, OPENROUTER_API_KEY: "" }, async () => {
    const cloud = fakeCloud();
    await withFetch(cloud.fake, async () => {
      const { status, body } = await post();
      assert.equal(status, 200);
      assert.equal(cloud.ai.length, 0);
      assert.equal(cloud.calls.filter((c) => c.table === "ai_usage" || c.table === "site_spend").length, 0);
      assert.equal(body.summary.method, "keywords");
      assert.equal(body.ai.on, false);
    });
  });
});

test("the model and privacy settings are fixed on the server, and the key and resume never reach the page or a log", async () => {
  await withEnv({ ...ENV, OPENROUTER_MODEL: "some/expensive-model" }, async () => {
    const cloud = fakeCloud();
    const logged = [];
    const saved = { log: console.log, error: console.error, warn: console.warn };
    for (const k of Object.keys(saved)) console[k] = (...args) => logged.push(args.join(" "));
    try {
      await withFetch(cloud.fake, async () => {
        const { body } = await post();
        const sent = cloud.ai[0];
        assert.equal(sent.body.model, DEFAULT_MODEL, "an environment variable cannot switch the hosted site to another model");
        assert.deepEqual(sent.body.provider, { data_collection: "deny" }, "only hosts that keep no prompts");
        assert.equal(sent.auth, `Bearer ${ENV.OPENROUTER_API_KEY}`);
        const page = JSON.stringify(body);
        assert.ok(!page.includes(ENV.OPENROUTER_API_KEY), "the key never reaches the page");
        assert.ok(!page.includes("supplier scorecard across 40 vendors"), "nor the resume");
      });
    } finally {
      Object.assign(console, saved);
    }
    assert.ok(logged.every((line) => !line.includes(ENV.OPENROUTER_API_KEY) && !line.includes("Rivera")), "nothing personal or secret in a log");
  });
});

test("one check at a time: while an earlier check runs, the next is refused before it spends anything", async () => {
  await withEnv(ENV, async () => {
    const cloud = fakeCloud({ running: [{ id: 1, run_at: new Date(NOW - 5000).toISOString(), summary: { status: "running" } }] });
    await withFetch(cloud.fake, async () => {
      const { status, body } = await post();
      assert.equal(status, 409, JSON.stringify(body));
      assert.equal(cloud.ai.length, 0);
      assert.equal(cloud.db.runs.find((r) => r.id === 100).summary.status, "refused", "and it still counts toward the rate limit");
    });
    const stale = fakeCloud({ running: [{ id: 1, run_at: new Date(NOW - (RUNNING_SECONDS + 10) * 1000).toISOString(), summary: { status: "running" } }] });
    await withFetch(stale.fake, async () => {
      assert.equal((await post()).status, 200, "a check that died long ago does not block");
    });
  });
});

test("days run midnight to midnight in New York, and a dead check stops blocking before the next could time out", () => {
  assert.equal(aiDay(Date.parse("2026-11-23T04:30:00Z")), "2026-11-22", "11:30 pm in New York is still the 22nd");
  assert.equal(aiDay(Date.parse("2026-11-23T05:30:00Z")), "2026-11-23");
  assert.equal(aiDay(Date.parse("2026-07-01T03:59:00Z")), "2026-06-30", "summer time too");
  const vercel = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.ok(vercel.functions["api/check.js"].maxDuration < RUNNING_SECONDS, "a check is stopped before it would count as still running");
});

test("the counter reads today's row only", async () => {
  await withEnv(ENV, async () => {
    const cloud = fakeCloud();
    cloud.db.ai_usage.push({ user_id: USER.id, day: "2026-01-01", roles_scored: 60, cost_usd: 0.04 });
    await withFetch(cloud.fake, async () => {
      assert.deepEqual(await aiStatus(USER, { env: ENV, now: NOW }), { on: true, limit: 60, perCheck: 20, left: 60, paused: null });
    });
  });
});
