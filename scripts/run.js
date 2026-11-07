// Terminal version of one run: `npm run scan` (live) or `npm run scan -- --demo`.
// Handy for a scheduled job later, and for checking the pipeline without opening the browser.
import { loadEnv } from "../src/env.js";
import { ROOT, runPipeline } from "../src/pipeline.js";

loadEnv(ROOT);
const demo = process.argv.includes("--demo");
const { summary, results, errors } = await runPipeline({ demo });

console.log(`\n${summary.demo ? "DEMO" : "LIVE"} run at ${summary.runAt}`);
console.log(`Scoring: ${summary.method === "ai" ? summary.model : "keywords"}`);
console.log(`${summary.companies} companies -> ${summary.found} postings -> ${summary.passedFilter} passed filter -> ${summary.scored} scored, ${summary.newCount} new`);
console.log(`Scored this run: ${summary.scoredThisRun}. Reused from earlier checks: ${summary.fromCache}. Still waiting: ${summary.waiting}.`);
if (summary.cacheReset) console.log("Your profile or model changed, so earlier scores were cleared and everything is being rescored.");
if (summary.method === "ai") {
  console.log(`Tokens: ${summary.tokensIn} in / ${summary.tokensOut} out. Cost this run: $${summary.costUsd.toFixed(4)}`);
}
for (const e of errors) console.log(`  ! ${e.company}: ${e.error}`);

console.log("");
for (const r of results.slice(0, 15)) {
  const fit = r.fit === null ? " --" : String(r.fit).padStart(3);
  const flag = r.isNew ? "NEW" : "   ";
  console.log(`${fit}  ${flag}  ${r.track.padEnd(10)}  ${r.company} | ${r.title} (${r.location})`);
  if (r.error) console.log(`          error: ${r.error}`);
}
console.log("");
