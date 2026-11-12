// `npm run explore` looks for roles beyond your watchlist: it checks about 10,000 companies' public job
// boards (config/ats-directory.csv), keeps what passes your filters, ranks it against your resume for free,
// and AI-scores only the top few. Results go to data/explore.json. A full sweep takes a few minutes.
//   npm run explore -- --limit 500    check only the first 500 companies, for a quick look
//   npm run explore -- --keywords     free keyword scoring only, no OpenRouter calls
//   npm run explore -- --top 20       AI-score the top 20 instead of maxToScore from your preferences
import { loadEnv } from "../src/env.js";
import { ROOT } from "../src/pipeline.js";
import { runExplore } from "../src/explore.js";

loadEnv(ROOT);
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? Number(process.argv[i + 1]) || undefined : undefined;
};

console.log("\nExploring beyond your watchlist...\n");
const { summary: s, results, more } = await runExplore({
  limit: arg("--limit"),
  topN: arg("--top"),
  keywordsOnly: process.argv.includes("--keywords"),
  onProgress: ({ done, total, found, passed }) => console.log(`  ${done}/${total} boards, ${found.toLocaleString()} open roles, ${passed} pass your filters`)
});

console.log(`\nChecked ${s.checked.toLocaleString()} companies in ${s.seconds} seconds (${s.skipped.toLocaleString()} skipped: on your watchlist or a board that recently closed).`);
console.log(`${s.reachable.toLocaleString()} boards answered, ${s.notFound} no longer exist, ${s.boardErrors} failed this time.`);
console.log(`${s.found.toLocaleString()} open roles -> ${s.passedFilter.toLocaleString()} passed your filters -> top ${s.shown} shown.`);
if (s.method === "ai") {
  console.log(`AI scored ${s.scoredThisRun} (${s.fromCache} reused from earlier sweeps) with ${s.model}. Tokens: ${s.tokensIn} in / ${s.tokensOut} out. Cost: $${s.costUsd.toFixed(4)}`);
} else {
  console.log("Keyword scoring only, so this cost nothing.");
}

console.log("");
for (const r of results.slice(0, 15)) {
  const fit = r.fit === null ? " --" : String(r.fit).padStart(3);
  console.log(`${fit}  ${r.isNew ? "NEW" : "   "}  ${r.company} | ${r.title} (${r.location})`);
}
if (more.length) console.log(`\n...and ${more.length} more ranked by keywords in data/explore.json.`);
console.log("");
