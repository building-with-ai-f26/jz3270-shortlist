// Decisions are the data the accuracy check and the learning model will learn from, so they must be
// trustworthy: only real roles, details taken from the app's own results, and rules suggested carefully.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decide, readDecisions, withDecisions, ruleSuggestions, applyRule } from "../src/decisions.js";

let dir;
const NOW = Date.parse("2026-11-17T12:00:00Z");
const role = (id, title, over = {}) => ({ id, title, company: "Acme", location: "New York, NY", fit: 60, track: "Full-time", cohort: "Open now", ageDays: 3, ...over });
const write = (name, obj) => fs.writeFileSync(path.join(dir, name), JSON.stringify(obj));
const prefsFile = () => JSON.parse(fs.readFileSync(path.join(dir, "preferences.json"), "utf8"));

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "shortlist-decisions-"));
  process.env.SHORTLIST_DATA_DIR = dir;
  write("latest.json", {
    summary: { method: "ai" },
    results: [
      role("greenhouse:acme:1", "Sales Strategy Analyst"),
      role("greenhouse:acme:2", "Sales Operations Associate"),
      role("lever:beta:3", "Sales Enablement Analyst", { company: "Beta" }),
      role("lever:beta:4", "Senior Strategy Manager", { company: "Beta", fit: 80 }),
      role("ashby:gamma:5", "Real Estate Analyst", { company: "Gamma", fit: 75 })
    ]
  });
  write("explore.json", { summary: { method: "keywords" }, results: [role("ashby:delta:9", "Supply Chain Associate", { company: "Delta" })], more: [] });
  write("preferences.json", { titleInclude: ["Associate", "Analyst", "Strategy"], titleExclude: ["Director"], setup: { roles: ["strategy"] } });
});

after(() => {
  delete process.env.SHORTLIST_DATA_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a decision keeps a snapshot of the role from the app's own results", () => {
  const d = decide("lever:beta:4", "saved", null, { now: NOW });
  assert.equal(d.decision, "saved");
  assert.equal(d.at, "2026-11-17T12:00:00.000Z");
  assert.deepEqual(d.role, {
    title: "Senior Strategy Manager", company: "Beta", location: "New York, NY", ats: "lever", fit: 80, method: "ai",
    dealbreaker: false, track: "Full-time", cohort: "Open now", ageDays: 3, from: "board"
  });
  const explored = decide("ashby:delta:9", "applied", null, { now: NOW });
  assert.equal(explored.role.from, "explore");
  assert.equal(explored.role.method, "keywords");
});

test("only real roles and known decisions are accepted, and passing needs a reason", () => {
  assert.throws(() => decide("greenhouse:nobody:1", "saved"), /not in your latest check/);
  assert.throws(() => decide("greenhouse:acme:1", "loved"), /Unknown decision/);
  assert.throws(() => decide("greenhouse:acme:1", "passed"), /why it is not for you/);
  assert.throws(() => decide("greenhouse:acme:1", "passed", "boring"), /why it is not for you/);
  assert.throws(() => decide(undefined, "saved"), /Pick a role/);
});

test("the page sees each role's decision, and a decision can be undone", () => {
  decide("ashby:gamma:5", "saved", null, { now: NOW });
  let list = withDecisions([role("ashby:gamma:5", "Real Estate Analyst"), role("x:y:1", "Other")]);
  assert.equal(list[0].decision, "saved");
  assert.equal(list[1].decision, undefined);
  decide("ashby:gamma:5", "clear");
  list = withDecisions([role("ashby:gamma:5", "Real Estate Analyst")]);
  assert.equal(list[0].decision, undefined);
  assert.equal(readDecisions().decisions["ashby:gamma:5"], undefined);
});

test("a rule is suggested once three wrong-function passes share a title word, but never for protected words", () => {
  decide("greenhouse:acme:1", "passed", "function", { now: NOW });
  decide("greenhouse:acme:2", "passed", "function", { now: NOW });
  assert.deepEqual(ruleSuggestions(prefsFile()), [], "two is not enough");
  decide("lever:beta:3", "passed", "function", { now: NOW });
  const s = ruleSuggestions(prefsFile());
  assert.deepEqual(s.map((x) => [x.word, x.count, x.reason]), [["Sales", 3, "function"]]);
  // Analyst and Associate let roles in, and Strategy and Operations name a chosen kind of role.
  assert.ok(!s.some((x) => ["Analyst", "Associate", "Strategy", "Operations"].includes(x.word)));
});

test("a word from a role you saved or applied to is never suggested", () => {
  write("latest.json", { summary: { method: "ai" }, results: [
    ...JSON.parse(fs.readFileSync(path.join(dir, "latest.json"), "utf8")).results,
    role("lever:beta:6", "Sales Analytics Lead", { company: "Beta" })
  ] });
  decide("lever:beta:6", "saved", null, { now: NOW });
  assert.deepEqual(ruleSuggestions(prefsFile()), []);
  decide("lever:beta:6", "clear");
  assert.equal(ruleSuggestions(prefsFile())[0].word, "Sales");
});

test("a suggested rule can be added to the excluded words or dismissed, and nothing else can", () => {
  assert.throws(() => applyRule("Strategy", "add"), /not one of your current suggestions/);
  assert.throws(() => applyRule("Sales", "maybe"), /add or dismiss/);
  const added = applyRule("sales", "add");
  assert.equal(added.word, "Sales");
  assert.deepEqual(prefsFile().titleExclude, ["Director", "Sales"]);
  assert.deepEqual(ruleSuggestions(prefsFile()), [], "an added rule is not suggested again");

  write("preferences.json", { ...prefsFile(), titleExclude: ["Director"] });
  assert.equal(ruleSuggestions(prefsFile())[0].word, "Sales");
  applyRule("Sales", "dismiss");
  assert.deepEqual(ruleSuggestions(prefsFile()), [], "a dismissed rule stays dismissed");
  assert.deepEqual(prefsFile().titleExclude, ["Director"], "dismissing does not change the filters");
});

test("demo mode keeps its own decisions and never touches the real ones", () => {
  fs.mkdirSync(path.join(dir, "demo"), { recursive: true });
  fs.writeFileSync(path.join(dir, "demo", "latest.json"), JSON.stringify({ summary: { method: "keywords" }, results: [role("greenhouse:demo:1", "Demo Analyst")] }));
  const before = fs.readFileSync(path.join(dir, "decisions.json"), "utf8");
  decide("greenhouse:demo:1", "saved", null, { demo: true, now: NOW });
  assert.equal(readDecisions(true).decisions["greenhouse:demo:1"].decision, "saved");
  assert.equal(fs.readFileSync(path.join(dir, "decisions.json"), "utf8"), before);
  assert.throws(() => decide("greenhouse:acme:1", "saved", null, { demo: true }), /not in your latest check/);
});
