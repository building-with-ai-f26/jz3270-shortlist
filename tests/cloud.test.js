// The hosted site's sign-in (CLOUD-PLAN.md, step 3a): what the page is given, how the server checks a session,
// and the rules that keep scripts and secrets where they belong. Fake fetch only; nothing reaches Supabase.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { GET as config } from "../api/config.js";
import { GET as me } from "../api/me.js";
import { looksSecret } from "../src/cloud/supabase.js";

const DEV = { SUPABASE_URL: "https://dev-ref.supabase.co/", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test", SUPABASE_SECRET_KEY: "sb_secret_never_share" };
const fakeJwt = (payload) => ["e30", Buffer.from(JSON.stringify(payload)).toString("base64url"), "sig"].join(".");

async function withEnv(vars, fn) {
  const saved = { ...process.env };
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  try { return await fn(); } finally { process.env = saved; }
}
async function withFetch(fake, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = fake;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

test("the page is given only the public address and key, never a secret", async () => {
  await withEnv(DEV, async () => {
    const res = config();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = await res.json();
    assert.deepEqual(body, { supabaseUrl: "https://dev-ref.supabase.co", publishableKey: "sb_publishable_test" });
    assert.ok(!JSON.stringify(body).includes("secret"));
  });
  await withEnv({ SUPABASE_URL: undefined, SUPABASE_PUBLISHABLE_KEY: undefined }, async () => {
    assert.equal(config().status, 503, "not set up yet, said plainly");
  });
});

test("a secret key pasted into the publishable setting is refused, not handed to the browser", async () => {
  assert.equal(looksSecret("sb_secret_abc"), true);
  assert.equal(looksSecret(fakeJwt({ role: "service_role" })), true, "the older service_role key");
  assert.equal(looksSecret(fakeJwt({ role: "anon" })), false, "the older anon key is public");
  assert.equal(looksSecret("sb_publishable_abc"), false);
  for (const wrong of ["sb_secret_oops", fakeJwt({ role: "service_role" })]) {
    await withEnv({ ...DEV, SUPABASE_PUBLISHABLE_KEY: wrong }, async () => {
      const res = config();
      assert.equal(res.status, 500);
      assert.ok(!(await res.text()).includes(wrong), "the key itself is never sent");
    });
  }
});

test("the server only trusts a session that Supabase vouches for, and reads the profile as that person", async () => {
  const calls = [];
  const fake = async (url, opts = {}) => {
    calls.push({ url, headers: opts.headers });
    if (url.endsWith("/auth/v1/user")) {
      return opts.headers.Authorization === "Bearer good-token"
        ? { ok: true, status: 200, json: async () => ({ id: "user-1", email: "sam@example.com" }) }
        : { ok: false, status: 401, json: async () => ({}) };
    }
    if (url.includes("/rest/v1/profiles")) {
      return { ok: true, status: 200, json: async () => [{ resume_file_name: "resume.pdf", resume_uploaded_at: "2026-11-19T12:00:00Z" }] };
    }
    throw new Error(`unexpected ${url}`);
  };
  await withEnv(DEV, () => withFetch(fake, async () => {
    const none = await me(new Request("https://site.test/api/me"));
    assert.equal(none.status, 401, "no session, no answer");
    const bad = await me(new Request("https://site.test/api/me", { headers: { Authorization: "Bearer forged" } }));
    assert.equal(bad.status, 401, "a token Supabase rejects is rejected");
    calls.length = 0;
    const ok = await me(new Request("https://site.test/api/me", { headers: { Authorization: "Bearer good-token" } }));
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { email: "sam@example.com", hasResume: true, resumeFileName: "resume.pdf", resumeUploadedAt: "2026-11-19T12:00:00Z" });
    const profileCall = calls.find((c) => c.url.includes("/rest/v1/profiles"));
    assert.match(profileCall.url, /user_id=eq\.user-1/);
    assert.equal(profileCall.headers.Authorization, "Bearer good-token", "read as the person, so row level security applies");
    assert.equal(profileCall.headers.apikey, "sb_publishable_test", "never the secret key");
  }));
});

test("the page runs no inline scripts and builds nothing from server text as HTML", () => {
  const page = fs.readFileSync(new URL("../site/index.html", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../site/app.js", import.meta.url), "utf8");
  const scripts = [...page.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length >= 2);
  for (const [, attrs, body] of scripts) {
    assert.match(attrs, /src="\/(vendor\/supabase|app)\.js"/, "scripts come from this site");
    assert.equal(body.trim(), "", "no inline script");
  }
  assert.doesNotMatch(page, /\son[a-z]+="/i, "no inline event handlers");
  assert.doesNotMatch(app, /innerHTML|insertAdjacentHTML|document\.write/, "text goes in with textContent");
});

test("the security policy lets the page talk only to itself and the two Supabase projects", () => {
  const vercel = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const csp = vercel.headers[0].headers.find((h) => h.key === "Content-Security-Policy").value;
  const connect = csp.match(/connect-src ([^;]+)/)[1].trim().split(/\s+/);
  assert.deepEqual(connect, ["'self'", "https://huvgdzobcgnvqhysfvlc.supabase.co", "https://ohagjyhptkisbynowupl.supabase.co"]);
  assert.match(csp, /script-src 'self';/, "scripts only from this site");
  assert.equal(vercel.buildCommand, "node scripts/build-site.js");
});
