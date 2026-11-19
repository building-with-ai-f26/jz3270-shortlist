// `npm run compare-models` scores the roles you already decided on (saved, applied or passed) with two or more
// models, against your current resume, and shows which model ranks your saves and applications above your
// passes (AUC, as in npm run accuracy), what each costs, and how often the models agree.
// It spends a little on OpenRouter: each role is scored once per model. The report is saved to
// data/model-compare.json, which stays on this computer. Nothing else in data/ changes.
//   npm run compare-models                                Claude Haiku 5.5 against DeepSeek V4.1 Flash
//   npm run compare-models -- --models one/model,two/model
import fs from "node:fs";
import path from "node:path";
import { loadEnv, hasRealKey } from "../src/env.js";
import { ROOT, paths, readJson } from "../src/pipeline.js";
import { fetchBoard, fillDetails } from "../src/sources.js";
import { scoreWithAI } from "../src/score.js";
import { auc, aucRange } from "../src/accuracy.js";
import { pool } from "../src/pool.js";

loadEnv(ROOT);
if (!hasRealKey()) {
  console.error("This needs an OpenRouter key in .env. It scores each decided role once per model.");
  process.exit(1);
}
const at = process.argv.indexOf("--models");
const models = at > -1 ? process.argv[at + 1].split(",").map((m) => m.trim()).filter(Boolean) : ["anthropic/claude-haiku-5.5", "deepseek/deepseek-v4.1-flash"];

const p = paths(false);
const profile = fs.readFileSync(p.profile, "utf8");
const decisions = readJson(path.join(p.dataDir, "decisions.json"), { decisions: {} }).decisions;
// As in the accuracy check: passing because of the company or the place says nothing about the resume match.
const JOB_REASONS = new Set(["function", "senior", "other"]);

// 1. Decisions keep no posting text, so fetch each role again from its board. Workday is skipped to stay
// gentle with its rate limits, and roles that have closed since are left out.
const all = Object.entries(decisions);
const wanted = all.filter(([id]) => /^(greenhouse|ashby|lever):/.test(id));
const boards = new Map();
for (const [id, d] of wanted) {
  const [ats, board] = id.split(":");
  const key = `${ats}:${board}`;
  if (!boards.has(key)) boards.set(key, { company: d.role?.company || board, ats, board });
}
console.log(`\nFetching ${wanted.length} decided roles from ${boards.size} boards (${all.length - wanted.length} on Workday or elsewhere skipped)...`);
const found = new Map();
await pool([...boards.values()], 6, async (entry) => {
  const r = await fetchBoard(entry, fetch, {});
  for (const post of r.postings || []) found.set(post.id, post);
});
let rows = wanted.filter(([id]) => found.has(id)).map(([id, d]) => ({
  id,
  yes: d.decision !== "passed",
  jobOnly: d.decision !== "passed" || JOB_REASONS.has(d.reason),
  posting: { ...found.get(id), track: d.role?.track || "Full-time" }
}));
const filled = await fillDetails(rows.map((r) => r.posting), fetch, 6);
rows = rows.map((r, i) => ({ ...r, posting: filled[i] })).filter((r) => (r.posting.text || "").length > 200);
console.log(`${rows.length} still open with a description (${rows.filter((r) => r.yes).length} saved or applied, ${rows.filter((r) => !r.yes).length} passed).\n`);
if (rows.length < 4) {
  console.error("Too few decided roles are still open to compare. Make more decisions and try again.");
  process.exit(1);
}

// 2. Score every role with every model, the same prompt and the same resume.
const results = {};
for (const model of models) {
  process.stdout.write(`Scoring with ${model}... `);
  const t0 = Date.now();
  const scored = await pool(rows, 4, async (r) => {
    try {
      const s = await scoreWithAI(profile, r.posting, { model, apiKey: process.env.OPENROUTER_API_KEY });
      return { id: r.id, fit: s.fit, usage: s.usage, error: null };
    } catch (err) {
      return { id: r.id, fit: null, usage: err.usage || { tokensIn: 0, tokensOut: 0, costUsd: 0 }, error: err.message };
    }
  });
  results[model] = { scored, seconds: Math.round((Date.now() - t0) / 1000) };
  console.log(`done in ${results[model].seconds} seconds.`);
}

// 3. Compare.
const r2 = (x) => (x === null || x === undefined ? null : Math.round(x * 100) / 100);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
function aucFor(model, keep) {
  const fits = new Map(results[model].scored.filter((s) => s.fit !== null).map((s) => [s.id, s.fit]));
  const use = rows.filter(keep).filter((r) => fits.has(r.id)).map((r) => ({ yes: r.yes, fit: fits.get(r.id) }));
  const value = auc(use.filter((r) => r.yes).map((r) => r.fit), use.filter((r) => !r.yes).map((r) => r.fit));
  return { auc: r2(value), range: value === null ? null : aucRange(use)?.map(r2), n: use.length };
}
const report = { comparedAt: new Date().toISOString(), roles: rows.length, models: {} };
for (const model of models) {
  const s = results[model].scored;
  const ok = s.filter((x) => x.fit !== null);
  const cost = s.reduce((a, x) => a + x.usage.costUsd, 0);
  report.models[model] = {
    scored: ok.length,
    failed: s.length - ok.length,
    errors: [...new Set(s.filter((x) => x.error).map((x) => x.error))].slice(0, 3),
    all: aucFor(model, () => true),
    jobOnly: aucFor(model, (r) => r.jobOnly),
    avgFitYes: r2(mean(ok.filter((x) => rows.find((r) => r.id === x.id).yes).map((x) => x.fit))),
    avgFitNo: r2(mean(ok.filter((x) => !rows.find((r) => r.id === x.id).yes).map((x) => x.fit))),
    costUsd: Number(cost.toFixed(6)),
    costPerRole: ok.length ? Number((cost / s.length).toFixed(6)) : null,
    avgTokensIn: Math.round(mean(s.map((x) => x.usage.tokensIn)) || 0),
    avgTokensOut: Math.round(mean(s.map((x) => x.usage.tokensOut)) || 0),
    seconds: results[model].seconds
  };
}
// How often the first two models agree: average gap in fit, and the share within 10 points.
if (models.length >= 2) {
  const [a, b] = models.map((m) => new Map(results[m].scored.filter((x) => x.fit !== null).map((x) => [x.id, x.fit])));
  const both = rows.filter((r) => a.has(r.id) && b.has(r.id)).map((r) => Math.abs(a.get(r.id) - b.get(r.id)));
  report.agreement = { roles: both.length, avgGap: r2(mean(both)), within10: both.length ? r2(both.filter((g) => g <= 10).length / both.length) : null };
}
fs.writeFileSync(path.join(p.dataDir, "model-compare.json"), JSON.stringify(report, null, 2));

console.log(`\nSame ${rows.length} roles, same resume. AUC: how often a random save or application outscores a random pass (0.5 is a coin flip).\n`);
for (const [model, m] of Object.entries(report.models)) {
  const range = (x) => (x.range ? ` (90% range ${x.range[0]} to ${x.range[1]})` : "");
  console.log(model);
  console.log(`  AUC, all passes: ${m.all.auc}${range(m.all)}, on ${m.all.n} roles`);
  console.log(`  AUC, passes about the job only: ${m.jobOnly.auc}${range(m.jobOnly)}, on ${m.jobOnly.n} roles`);
  console.log(`  Average fit: ${m.avgFitYes} for saves and applications, ${m.avgFitNo} for passes`);
  console.log(`  Cost: $${m.costUsd.toFixed(4)} in all, $${(m.costPerRole || 0).toFixed(5)} a role (${m.avgTokensIn} tokens in, ${m.avgTokensOut} out on average), ${m.seconds} seconds`);
  if (m.failed) console.log(`  Failed on ${m.failed} roles: ${m.errors.join(" | ")}`);
  console.log("");
}
if (report.agreement) console.log(`The two models' fits differ by ${report.agreement.avgGap} points on average; ${Math.round(report.agreement.within10 * 100)}% are within 10 points.`);
console.log("Saved to data/model-compare.json.\n");
