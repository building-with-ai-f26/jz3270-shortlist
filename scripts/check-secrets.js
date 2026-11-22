// `npm run check-secrets` searches for secret keys in three places (SECURITY.md, step 2 of the audit):
//   1. every file Git tracks today
//   2. every line ever added in the Git history, on every branch
//   3. the live sites: the hosted site, the Product Page and the static demo, with every script they load
// It looks for sb_secret_, sk-or-, sk-ant-, sk-proj-, sk_live_, service_role keys, and the real values of the keys
// in your .env. Hits are masked; a key is never printed. Exits with 1 if anything turns up, so rotate that key.
// Options: --no-history, --no-live, --site <url> (another hosted address, for example a preview).
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { loadEnv } from "../src/env.js";
import { ROOT } from "../src/pipeline.js";
import { findSecrets, ownSecrets } from "../src/secret-scan.js";

loadEnv(ROOT);
const args = process.argv.slice(2);
const siteArg = args.includes("--site") ? args[args.indexOf("--site") + 1] : null;
const SITES = [
  siteArg || "https://jz3270-shortlist.vercel.app/",
  "https://building-with-ai-f26.github.io/jz3270-shortlist/",
  "https://building-with-ai-f26.github.io/jz3270-shortlist/demo/"
];
const own = ownSecrets(process.env);
let total = 0;

function report(where, hits) {
  for (const h of hits) console.log(`  FOUND ${h.kind} in ${where}${h.line ? `, line ${h.line}` : ""}: ${h.masked}`);
  total += hits.length;
}

// 1. Tracked files.
console.log(`Searching tracked files (also for the ${own.length} secret value${own.length === 1 ? "" : "s"} in .env and your shell)...`);
const files = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT }).toString().split("\0").filter(Boolean);
let before = total;
for (const file of files) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full) || fs.statSync(full).size > 20 * 1024 * 1024) continue;
  const text = fs.readFileSync(full);
  if (text.includes(0)) continue; // binary (images)
  report(file, findSecrets(text.toString("utf8"), own));
}
console.log(total === before ? `  clean (${files.length} files)` : "");

// 2. Every line ever added, on every branch.
if (!args.includes("--no-history")) {
  console.log("Searching the whole Git history...");
  before = total;
  const git = spawn("git", ["log", "--all", "-p", "--no-color", "--format=commit %h"], { cwd: ROOT });
  let commit = "";
  let lines = 0;
  for await (const line of readline.createInterface({ input: git.stdout })) {
    if (line.startsWith("commit ")) { commit = line.slice(7); continue; }
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    lines++;
    report(`commit ${commit}`, findSecrets(line.slice(1), own).map((h) => ({ ...h, line: 0 })));
  }
  console.log(total === before ? `  clean (${lines.toLocaleString("en-US")} added lines)` : "");
}

// 3. The live sites and every script they load from themselves.
if (!args.includes("--no-live")) {
  console.log("Searching the live sites...");
  before = total;
  let fetched = 0;
  for (const site of SITES) {
    const pages = [site, new URL("/api/config", site).href, new URL("/api/health", site).href];
    const seen = new Set();
    while (pages.length) {
      const url = pages.shift();
      if (seen.has(url)) continue;
      seen.add(url);
      let text;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
        if (!res.ok) continue;
        text = await res.text();
      } catch (err) {
        console.log(`  could not open ${url} (${err.message})`);
        continue;
      }
      fetched++;
      report(url, findSecrets(text, own));
      for (const [, src] of text.matchAll(/<script[^>]+src="([^"]+)"/g)) {
        const scriptUrl = new URL(src, url);
        if (scriptUrl.origin === new URL(site).origin) pages.push(scriptUrl.href);
      }
    }
  }
  console.log(total === before ? `  clean (${fetched} pages and scripts)` : "");
}

console.log(total ? `\n${total} possible secret${total === 1 ? "" : "s"} found. Rotate each key now, then remove it.` : "\nNo secret keys found.");
process.exit(total ? 1 : 0);
