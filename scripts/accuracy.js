// `npm run accuracy` prints how well the AI fit score predicts the user's own decisions
// (data/decisions.json). Free: it calls no model. Add -- --demo for the demo decisions.
import { readDecisions } from "../src/decisions.js";
import { accuracyReport } from "../src/accuracy.js";

const demo = process.argv.includes("--demo");
const r = accuracyReport(readDecisions(demo).decisions);
const pct = (x) => `${Math.round(x * 100)}%`;

function show(title, m) {
  console.log(`\n${title}`);
  console.log(`  ${m.decisions} decisions: ${m.yes} saved or applied, ${m.no} passed.`);
  if (m.auc !== null) {
    console.log(`  AUC ${m.auc.toFixed(2)}${m.aucRange ? ` (90% range ${m.aucRange[0].toFixed(2)} to ${m.aucRange[1].toFixed(2)})` : ""}. A coin flip is 0.50, perfect is 1.00.`);
    console.log(`  Average fit: ${m.avgFitYes} for saves and applications, ${m.avgFitNo} for passes.`);
    console.log(`  Top ${m.topK.k} by fit: ${m.topK.yes} saved or applied (${pct(m.topK.yes / m.topK.k)}), against ${pct(m.yesRate)} of all decisions.`);
  }
  console.log("  By fit:");
  for (const b of m.bands) console.log(`    ${b.label.padEnd(10)} ${String(b.decisions).padStart(3)} decisions${b.decisions ? `, ${b.yes} saved or applied (${pct(b.yes / b.decisions)})` : ""}`);
  console.log(`  ${m.verdict}`);
}

console.log("\nHow well does the AI fit predict your decisions?");
show("All decisions", r.all);
show("Only passes about the job itself (wrong function, too senior, something else)", r.jobOnly);
if (r.coverage) console.log(`\nNote: ${r.coverage}`);
if (r.keywordDecisionsLeftOut) console.log(`\n${r.keywordDecisionsLeftOut} decisions on keyword-scored roles are left out, since keyword scores mean something else.`);
console.log("");
