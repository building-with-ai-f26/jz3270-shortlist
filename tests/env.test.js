import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { withEnvKey, saveApiKey } from "../src/env.js";

const KEY = "sk-or-v1-" + "a".repeat(64);
const original = process.env.OPENROUTER_API_KEY;
after(() => { if (original === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = original; });

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "shortlist-env-"));
const answers = (status) => async (url, opts) => {
  assert.equal(url, "https://openrouter.ai/api/v1/key", "only the free key check is called");
  assert.equal(opts.method, undefined, "a GET, never a scoring call");
  return { ok: status === 200, status, json: async () => ({}) };
};

test("the key line is replaced or added, and other lines stay", () => {
  assert.equal(withEnvKey("# keys\nOPENROUTER_API_KEY=sk-or-v1-replace-with-your-key\nPORT=3001\n", "sk-or-new"),
    "# keys\nOPENROUTER_API_KEY=sk-or-new\nPORT=3001\n");
  assert.equal(withEnvKey("PORT=3001", "sk-or-new"), "PORT=3001\nOPENROUTER_API_KEY=sk-or-new\n");
  assert.equal(withEnvKey("", "sk-or-new"), "OPENROUTER_API_KEY=sk-or-new\n");
});

test("a good key is saved to .env, readable only by you, and used right away", async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, ".env"), "PORT=3001\n");
  assert.deepEqual(await saveApiKey(`  ${KEY}\n`, dir, { fetchImpl: answers(200) }), { checked: true });
  assert.equal(fs.readFileSync(path.join(dir, ".env"), "utf8"), `PORT=3001\nOPENROUTER_API_KEY=${KEY}\n`);
  assert.equal(process.env.OPENROUTER_API_KEY, KEY);
  if (process.platform !== "win32") {
    const fresh = tmp();
    await saveApiKey(KEY, fresh, { fetchImpl: answers(200) });
    assert.equal(fs.statSync(path.join(fresh, ".env")).mode & 0o777, 0o600);
  }
});

test("a key OpenRouter rejects, or one that is not a key, changes nothing", async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, ".env"), "OPENROUTER_API_KEY=old\n");
  await assert.rejects(saveApiKey(KEY, dir, { fetchImpl: answers(401) }), /did not accept that key/);
  let called = false;
  const spy = async () => { called = true; return { ok: true, status: 200 }; };
  await assert.rejects(saveApiKey("sk-or-v1-short\nPORT=1", dir, { fetchImpl: spy }), /does not look like an OpenRouter key/);
  await assert.rejects(saveApiKey("hello", dir, { fetchImpl: spy }), /starts with sk-or-/);
  assert.equal(called, false, "a malformed key is never sent anywhere");
  assert.equal(fs.readFileSync(path.join(dir, ".env"), "utf8"), "OPENROUTER_API_KEY=old\n");
});

test("if OpenRouter cannot be reached, the key is still saved", async () => {
  const dir = tmp();
  const offline = async () => { throw new Error("offline"); };
  assert.deepEqual(await saveApiKey(KEY, dir, { fetchImpl: offline }), { checked: false });
  assert.match(fs.readFileSync(path.join(dir, ".env"), "utf8"), /OPENROUTER_API_KEY=sk-or-v1-a+/);
});
