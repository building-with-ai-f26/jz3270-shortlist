// The hosted site's health check, and the settings that keep the hosted site from serving anything personal.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { GET } from "../api/health.js";

test("the health check says which environment and commit answered, and nothing else", async () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_SHA: "abcdef1234567", OPENROUTER_API_KEY: "sk-or-v1-secret" });
    const res = GET();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = await res.json();
    assert.deepEqual(body, { ok: true, environment: "preview", commit: "abcdef1" });
    assert.ok(!JSON.stringify(body).includes("secret"), "no environment secret is ever returned");
  } finally {
    process.env = saved;
  }
});

test("the hosted site serves only site/, never data/ or .env, and sends security headers", () => {
  const config = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.equal(config.outputDirectory, "site");
  const headers = Object.fromEntries(config.headers[0].headers.map((h) => [h.key, h.value]));
  assert.match(headers["Content-Security-Policy"], /frame-ancestors 'none'/);
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  const ignore = fs.readFileSync(new URL("../.vercelignore", import.meta.url), "utf8").split("\n").map((l) => l.trim());
  for (const path of ["data/", ".env", ".env.*"]) assert.ok(ignore.includes(path), `${path} is never uploaded`);
  assert.ok(!fs.existsSync(new URL("../site/data", import.meta.url)), "no data folder inside site/");
});
