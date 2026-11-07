// Checks every board in data/watchlist.json and prints how many postings each returns.
// Run this after adding a company: a wrong board slug shows up here as "not found".
import fs from "node:fs";
import path from "node:path";
import { ROOT, ensurePersonalFiles } from "../src/pipeline.js";
import { fetchBoard } from "../src/sources.js";

ensurePersonalFiles();
const watchlist = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "watchlist.json"), "utf8"));

console.log(`Checking ${watchlist.length} boards...\n`);
let ok = 0;
for (const entry of watchlist) {
  const r = await fetchBoard(entry);
  if (r.error) {
    console.log(`  FAIL  ${entry.company.padEnd(20)} ${entry.ats}/${entry.board}: ${r.error}`);
  } else {
    ok++;
    const sample = r.postings[0] ? `e.g. "${r.postings[0].title}"` : "(no open roles)";
    console.log(`  OK    ${entry.company.padEnd(20)} ${String(r.postings.length).padStart(4)} postings  ${sample}`);
  }
}
console.log(`\n${ok}/${watchlist.length} boards reachable.`);
