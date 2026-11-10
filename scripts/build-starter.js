// `npm run build-starter` turns the starter company list into config/starter-watchlist.json, so the setup
// screen can add a whole sector of companies at once without probing job boards while the user waits.
// Run it again after editing config/companies.example.txt. It only reads public job boards and writes to config/.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../src/pipeline.js";
import { discoverAll, normalizeName } from "../src/discover.js";
import { STARTER_SECTORS } from "../src/setup.js";

const listFile = path.join(ROOT, "config", "companies.example.txt");
const outFile = path.join(ROOT, "config", "starter-watchlist.json");
const byLabel = Object.fromEntries(Object.entries(STARTER_SECTORS).map(([key, label]) => [label, key]));

// Every company line belongs to the sector heading above it.
const sectorOf = new Map();
const lines = [];
let sector = null;
for (const line of fs.readFileSync(listFile, "utf8").split("\n")) {
  const heading = line.match(/^#\s+(.+?)\s*$/);
  if (heading) { if (byLabel[heading[1]]) sector = byLabel[heading[1]]; continue; }
  if (!line.trim()) continue;
  if (!sector) throw new Error(`"${line}" comes before any sector heading in companies.example.txt.`);
  sectorOf.set(line.split("|")[0].trim(), sector);
  lines.push(line);
}

console.log(`Looking up job boards for ${lines.length} starter companies...\n`);
const first = await discoverAll(lines, [], {
  onProgress: (done, total) => {
    if (done % 25 === 0 || done === total) console.log(`  ${done}/${total}`);
  }
});
// Big boards (thousands of jobs) sometimes miss the 15-second limit while many lookups run at once,
// so I look up the misses once more, fewer at a time, before calling them not found.
const missed = new Set(first.notFound);
console.log(`\nTrying the ${missed.size} misses once more, 4 at a time...`);
const retry = await discoverAll(lines.filter((l) => missed.has(l.split("|")[0].trim())), [], { concurrency: 4 });
const added = [...first.added, ...retry.added];
const { notFound } = retry;
const { unsupported } = first;

// Same order as the list, so the file reads like companies.example.txt.
const order = [...sectorOf.keys()];
const companies = added
  .sort((a, b) => order.indexOf(a.company) - order.indexOf(b.company))
  .map(({ company, ats, board, url }) => ({ company, ats, board, ...(url ? { url } : {}), sector: sectorOf.get(company) }));

fs.writeFileSync(outFile, JSON.stringify({
  note: "Built by `npm run build-starter` from config/companies.example.txt. Edit that file, not this one.",
  builtOn: new Date().toISOString().slice(0, 10),
  companies
}, null, 2) + "\n");

console.log(`\nWrote ${companies.length} companies to config/starter-watchlist.json.`);
for (const [key, label] of Object.entries(STARTER_SECTORS)) {
  console.log(`  ${label.padEnd(36)} ${companies.filter((c) => c.sector === key).length}`);
}
// A guessed board can belong to a different company with the same name. Pin those in the list as "Name | ats:board".
const renamed = added.filter((a) => a.boardName && normalizeName(a.boardName) !== normalizeName(a.company));
if (renamed.length) {
  console.log("\nDouble-check these, since the board's own name differs:");
  for (const r of renamed) console.log(`  ${r.company} -> ${r.ats}:${r.board} (board says "${r.boardName}")`);
}
if (notFound.length) console.log(`\nNo board found for ${notFound.length}: ${notFound.join(", ")}`);
if (unsupported.length) console.log(`\nLinks Shortlist cannot read: ${unsupported.join(", ")}`);
