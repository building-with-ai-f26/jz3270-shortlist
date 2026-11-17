// Your score: the AI fit adjusted by the user's dials, and how the dials are checked and saved.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { yourScore, EMPTY_WEIGHTS } from "../src/yourscore.js";
import { cleanWeights, saveScoring, readScoring, scoringContext } from "../src/setup.js";
import { accuracyReport } from "../src/accuracy.js";

const context = scoringContext({ setup: { roles: ["strategy", "product"], cities: ["newYork", "remote"] } });
const role = (over = {}) => ({ id: "greenhouse:acme:1", company: "Acme", title: "Strategy Associate", location: "New York, NY", cohort: "Open now", ageDays: 10, fit: 60, ...over });
const labels = (r) => r.parts.map((p) => `${p.label} ${p.points}`);

test("with no dials set, your score is the AI fit", () => {
  const r = yourScore(role(), EMPTY_WEIGHTS, context);
  assert.equal(r.score, 60);
  assert.deepEqual(r.parts, []);
});

test("each dial adds or takes away points, and every point is explained", () => {
  const w = { roles: { strategy: 2, product: 1 }, size: 1, topCity: 1, seniority: 2, programs: 2, freshness: 1, dream: ["acme"], avoid: [] };
  const r = yourScore(role({ title: "Senior Strategy Associate", cohort: "2027 grad", ageDays: 2 }), w, context);
  assert.deepEqual(labels(r), [
    "Strategy and operations role 10", "Startup or growth company (approx.) 5", "In New York 5",
    "Senior title -10", "2027 or new grad role 10", "Posted in the last 3 days 5", "Dream company 10"
  ]);
  assert.equal(r.score, 85, "35 in all, capped at 25");
  assert.equal(r.capped, true);
});

test("large companies are guessed from the job system, and a company to avoid loses 15", () => {
  const big = yourScore(role({ id: "workday:acme/Careers:/job/x" }), { ...EMPTY_WEIGHTS, size: -2 }, context);
  assert.deepEqual(labels(big), ["Large company (approx.) 10"]);
  const startup = yourScore(role(), { ...EMPTY_WEIGHTS, size: -2 }, context);
  assert.deepEqual(startup.parts, [], "preferring large companies does not punish startups");
  const avoid = yourScore(role({ company: "Acme Corp" }), { ...EMPTY_WEIGHTS, avoid: ["Acme"] }, context);
  assert.equal(avoid.score, 45);
});

test("the highest matching kind of role counts once, posted this week gives half, and unscored roles stay unscored", () => {
  const w = { ...EMPTY_WEIGHTS, roles: { strategy: 1, product: 2 }, freshness: 2 };
  const r = yourScore(role({ title: "Product Manager, Strategy", ageDays: 6 }), w, context);
  assert.deepEqual(labels(r), ["Product management role 10", "Posted this week 5"]);
  assert.equal(yourScore(role({ fit: null }), w, context).score, null);
  assert.equal(yourScore(role({ fit: 95 }), { ...EMPTY_WEIGHTS, roles: { strategy: 2 } }, context).score, 100, "never above 100");
});

test("dials are checked strictly", () => {
  assert.deepEqual(cleanWeights({}), { roles: {}, size: 0, topCity: 0, seniority: 0, programs: 0, freshness: 0, dream: [], avoid: [] });
  assert.deepEqual(cleanWeights({ roles: { strategy: 2, product: 0 }, dream: [" Stripe ", "stripe", "", "Ramp"] }).roles, { strategy: 2 });
  assert.deepEqual(cleanWeights({ dream: [" Stripe ", "Stripe", "", "Ramp"] }).dream, ["Stripe", "Ramp"]);
  assert.throws(() => cleanWeights({ roles: { astronaut: 1 } }), /Unknown role type/);
  assert.throws(() => cleanWeights({ size: 3 }), /from -2 to 2/);
  assert.throws(() => cleanWeights({ seniority: 1.5 }), /whole number/);
  assert.throws(() => cleanWeights({ dream: "Stripe" }), /must be a list/);
});

test("saving dials changes only the dials, unless What I'm looking for changed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shortlist-scoring-"));
  fs.writeFileSync(path.join(dir, "preferences.json"), JSON.stringify({ maxToScore: 40, setup: { roles: ["strategy"], cities: ["newYork"] } }));
  fs.writeFileSync(path.join(dir, "profile.md"), "## Resume\n\nMine\n\n## What I'm looking for\n\nStrategy roles.\n");
  const before = fs.readFileSync(path.join(dir, "profile.md"), "utf8");
  const saved = saveScoring({ weights: { seniority: 2, dream: ["Stripe"] }, lookingFor: "Strategy roles." }, dir);
  assert.equal(saved.lookingForChanged, false);
  assert.equal(fs.readFileSync(path.join(dir, "profile.md"), "utf8"), before, "unchanged words do not trigger rescoring");
  const prefs = JSON.parse(fs.readFileSync(path.join(dir, "preferences.json"), "utf8"));
  assert.equal(prefs.maxToScore, 40, "other settings are kept");
  assert.deepEqual([prefs.weights.seniority, prefs.weights.dream], [2, ["Stripe"]]);
  assert.equal(readScoring(dir).context.topCity.label, "New York");
  const changed = saveScoring({ weights: {}, lookingFor: "Product roles in New York." }, dir);
  assert.equal(changed.lookingForChanged, true);
  assert.match(fs.readFileSync(path.join(dir, "profile.md"), "utf8"), /Product roles in New York\./);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the accuracy check compares your score with the AI fit", () => {
  const d = (decision, fit, title) => ({ decision, reason: decision === "passed" ? "function" : null, role: { fit, method: "ai", title, company: "Co", location: "New York", ats: "greenhouse" } });
  const decisions = Object.fromEntries([
    d("saved", 55, "Strategy Associate"), d("saved", 52, "Strategy Analyst"), d("saved", 50, "Strategy Lead"), d("saved", 58, "Strategy Manager"), d("saved", 51, "Strategy Partner"),
    d("passed", 60, "Sales Associate"), d("passed", 62, "Sales Analyst"), d("passed", 57, "Account Associate"), d("passed", 59, "Sales Lead"), d("passed", 61, "Sales Partner")
  ].map((x, i) => [`id${i}`, x]));
  const plain = accuracyReport(decisions);
  assert.equal(plain.yours, null, "no scorer, no comparison");
  const rescore = (r) => yourScore(r, { ...EMPTY_WEIGHTS, roles: { strategy: 2 } }, context).score;
  const report = accuracyReport(decisions, rescore);
  // By hand: the AI fit wins 1 of 25 save-and-pass pairs (58 over 57); with +10 on strategy titles,
  // the saves become 60, 61, 62, 65 and 68 and win 20.5 of 25 (ties count half).
  assert.equal(report.all.auc, 0.04);
  assert.equal(report.yours.auc, 0.82);
});
