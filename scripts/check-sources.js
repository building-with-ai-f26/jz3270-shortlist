// Checks every board in data/watchlist.json and prints how many postings each returns.
// Run this after adding companies: a wrong board name shows up here as "not found".
// `npm run check -- --prune` also removes boards that fail and saves them to data/watchlist.removed.json.
import fs from "node:fs";
import path from "node:path";
import { ensurePersonalFiles, paths } from "../src/pipeline.js";
import { fetchAll } from "../src/sources.js";

ensurePersonalFiles();
const p = paths(false);
const prune = process.argv.includes("--prune");
const watchlist = JSON.parse(fs.readFileSync(p.watchlist, "utf8"));

console.log(`Checking ${watchlist.length} boards...\n`);
const results = await fetchAll(watchlist);

let ok = 0;
let total = 0;
const failed = [];
for (const r of results) {
  const { entry } = r;
  if (r.error) {
    failed.push({ ...entry, error: r.error });
    console.log(`  FAIL  ${entry.company.padEnd(28)} ${entry.ats}/${entry.board}: ${r.error}`);
  } else {
    ok++;
    total += r.postings.length;
    const sample = r.postings[0] ? `e.g. "${r.postings[0].title}"` : "(no open roles right now)";
    console.log(`  OK    ${entry.company.padEnd(28)} ${String(r.postings.length).padStart(5)} postings  ${sample}`);
  }
}
console.log(`\n${ok}/${watchlist.length} boards reachable, ${total.toLocaleString()} open postings in total.`);

if (prune && failed.length) {
  const removedFile = path.join(p.dataDir, "watchlist.removed.json");
  const keep = watchlist.filter((w) => !failed.some((f) => f.ats === w.ats && f.board === w.board));
  fs.writeFileSync(p.watchlist, JSON.stringify(keep, null, 2));
  fs.writeFileSync(removedFile, JSON.stringify(failed, null, 2));
  console.log(`Removed ${failed.length} failing boards from your watchlist (saved in data/watchlist.removed.json).`);
} else if (failed.length) {
  console.log("Run `npm run check -- --prune` to remove the failing boards automatically.");
}
console.log("");
