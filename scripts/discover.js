// `npm run discover` reads company names from data/companies.txt, finds each one's job board,
// and adds what it finds to data/watchlist.json. Companies already on the watchlist are skipped,
// so it is safe to run again after adding more names.
import fs from "node:fs";
import path from "node:path";
import { ensurePersonalFiles, paths, ROOT } from "../src/pipeline.js";
import { discoverAll, normalizeName } from "../src/discover.js";

ensurePersonalFiles();
const p = paths(false);
const companiesFile = path.join(p.dataDir, "companies.txt");
if (!fs.existsSync(companiesFile)) {
  fs.copyFileSync(path.join(ROOT, "config", "companies.example.txt"), companiesFile);
  console.log("Created data/companies.txt from the starter list. Edit it any time and run this again.\n");
}

const lines = fs.readFileSync(companiesFile, "utf8").split("\n");
const watchlist = JSON.parse(fs.readFileSync(p.watchlist, "utf8"));
console.log(`Looking up job boards for the names in data/companies.txt (${watchlist.length} already on your watchlist)...\n`);

const { added, notFound, skipped, watchlist: updated } = await discoverAll(lines, watchlist, {
  onProgress: (done, total, name, hit) => {
    const status = hit ? `found  ${hit.ats}:${hit.board}${hit.count ? ` (${hit.count} open)` : ""}` : "not found";
    console.log(`  [${String(done).padStart(3)}/${total}] ${name.padEnd(32)} ${status}`);
  }
});

fs.writeFileSync(p.watchlist, JSON.stringify(updated, null, 2));

const renamed = added.filter((a) => a.boardName && normalizeName(a.boardName) !== normalizeName(a.company));
console.log(`\nAdded ${added.length} companies. Your watchlist now has ${updated.length}. Skipped ${skipped} already listed.`);
if (renamed.length) {
  console.log("\nDouble-check these, since the board's own name differs from yours:");
  for (const r of renamed) console.log(`  ${r.company} -> ${r.ats}:${r.board} (board says "${r.boardName}")`);
}
if (notFound.length) {
  console.log(`\nNo board found for ${notFound.length}. They probably use another system (Workday, their own site),`);
  console.log("or a board name I could not guess. If you know it, add it in data/companies.txt like:");
  console.log("  Commonwealth Fusion Systems | greenhouse:cfsenergy\n");
  console.log("  " + notFound.join(", "));
}
console.log("");
