// The secret search behind `npm run check-secrets`: it catches real-looking keys, skips the made-up ones in the
// templates and tests, and never repeats a key in full.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findSecrets, ownSecrets, mask } from "../src/secret-scan.js";

const jwt = (payload) => ["eyJhbGciOiJIUzI1NiJ9", Buffer.from(JSON.stringify(payload)).toString("base64url"), "c2lnbmF0dXJlLXNpZ25hdHVyZQ"].join(".");

test("real-looking keys are found, and only masked", () => {
  const key = "sk-or-v1-" + "a1b2c3d4".repeat(8);
  const hits = findSecrets(`const k = "${key}";\nfine line`);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, "OpenRouter key");
  assert.equal(hits[0].line, 1);
  assert.ok(!hits[0].masked.includes(key), "the key itself is never repeated");
  for (const k of ["sb_secret_" + "Zq9".repeat(10), "sk-ant-api03-" + "Q".repeat(40), "sk-proj-" + "r7".repeat(20), "sk_live_" + "9".repeat(24)]) {
    assert.equal(findSecrets(k).length, 1, k.slice(0, 8));
  }
});

test("the made-up keys in .env.example and the tests are not reported", () => {
  for (const placeholder of ["sk-or-v1-replace-with-your-key", "sb_secret_replace-with-your-dev-secret-key", "sb_secret_never_share", "sb_publishable_anything"]) {
    assert.deepEqual(findSecrets(placeholder), [], placeholder);
  }
});

test("a JWT counts only when it is the service_role key", () => {
  assert.equal(findSecrets(jwt({ role: "service_role", iss: "supabase" })).length, 1);
  assert.equal(findSecrets(jwt({ role: "anon", iss: "supabase" })).length, 0, "the old anon key is public");
});

test("your own keys from .env are searched for literally, except the two public ones", () => {
  const env = { OPENROUTER_API_KEY: "zzzzunusualformat0123456789", POSTHOG_KEY: "phc_public_on_purpose_123456", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_123456789012", SUPABASE_URL: "https://x.supabase.co", PORT: "3000" };
  const own = ownSecrets(env);
  assert.deepEqual(own.map((o) => o.name), ["OPENROUTER_API_KEY"]);
  const hits = findSecrets("leaked: zzzzunusualformat0123456789", own);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, "your OPENROUTER_API_KEY");
  assert.match(mask("abcdefghijklmnopqrstuvwxyz"), /^abcdef… \(26 characters\)$/);
});
