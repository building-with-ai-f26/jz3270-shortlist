// The database's privacy rules, checked from the migration files themselves, so a later migration cannot
// quietly add an unprotected table. These run offline; scripts/check-rls.js checks a real database.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const dir = new URL("../supabase/migrations/", import.meta.url);
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const sql = files.map((f) => fs.readFileSync(new URL(f, dir), "utf8")).join("\n").replace(/--.*$/gm, "");
const tables = [...sql.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);
const policiesOn = (t) => [...sql.matchAll(new RegExp(`create policy "[^"]+" on public\\.${t}\\b([^;]*);`, "g"))].map((m) => m[1]);
// Tables that hold one person's data, and the ones only the server writes.
const PERSONAL = ["profiles", "preferences", "watchlist", "decisions", "scores", "runs", "ai_usage"];
const SERVER_WRITES = ["postings", "scores", "runs", "ai_usage"];

test("migration files are named by timestamp, so they apply in order", () => {
  assert.ok(files.length >= 1);
  for (const f of files) assert.match(f, /^\d{14}_[a-z0-9_]+\.sql$/);
});

test("every table has row level security switched on", () => {
  assert.ok(tables.length >= 9, "the tables were found");
  for (const t of tables) assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`), `${t} has row level security`);
});

test("personal tables only ever match the signed-in person's own rows", () => {
  for (const t of PERSONAL) {
    const policies = policiesOn(t);
    assert.ok(policies.length >= 1, `${t} has a policy`);
    for (const p of policies) {
      assert.match(p, /to authenticated/, `${t}: only signed-in people`);
      assert.match(p, /using \(user_id = \(select auth\.uid\(\)\)\)/, `${t}: own rows only`);
      if (/for all/.test(p)) assert.match(p, /with check \(user_id = \(select auth\.uid\(\)\)\)/, `${t}: cannot write rows for someone else`);
    }
  }
});

test("people can only read the tables the server writes, and nobody but the server sees site spending", () => {
  for (const t of SERVER_WRITES) {
    for (const p of policiesOn(t)) assert.match(p, /for select/, `${t}: read-only for people`);
    assert.match(sql, new RegExp(`revoke insert, update, delete, truncate on [^;]*public\\.${t}\\b[^;]*from authenticated`), `${t}: writes revoked`);
  }
  assert.equal(policiesOn("site_spend").length, 0, "site_spend has no policy");
  assert.match(sql, /revoke all on public\.site_spend from authenticated/);
});

test("signed-out visitors cannot reach any table", () => {
  const revoked = sql.match(/revoke all on ([^;]*) from anon/)?.[1] || "";
  for (const t of tables) assert.match(revoked, new RegExp(`public\\.${t}\\b`), `${t}: no access for anon`);
  for (const t of tables) for (const p of policiesOn(t)) assert.doesNotMatch(p, /to (anon|public)\b/, `${t}: no policy for anon`);
});

test("deleting a person deletes all of their rows", () => {
  for (const t of PERSONAL) {
    const body = sql.match(new RegExp(`create table public\\.${t} \\(([\\s\\S]*?)\\n\\);`))[1];
    assert.match(body, /user_id uuid[^,]*references auth\.users \(id\) on delete cascade/, `${t} cascades`);
  }
});

test("the resume is never stored in plain text", () => {
  const profiles = sql.match(/create table public\.profiles \(([\s\S]*?)\n\);/)[1];
  assert.match(profiles, /resume_ciphertext text/);
  assert.doesNotMatch(profiles, /\bresume_text\b|\bresume text\b/);
});
