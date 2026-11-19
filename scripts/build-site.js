// Vercel's build step for the hosted site (vercel.json "buildCommand"): copies Supabase's browser library from
// node_modules into site/vendor/, so the page loads it from our own domain at the exact version pinned in
// package-lock.json, with no outside script host. site/vendor/ is gitignored; npm run dev-site runs this too.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const from = path.join(ROOT, "node_modules", "@supabase", "supabase-js", "dist", "umd", "supabase.js");
const to = path.join(ROOT, "site", "vendor", "supabase.js");
if (!fs.existsSync(from)) {
  console.error("Supabase's browser library is missing. Run npm install first.");
  process.exit(1);
}
fs.mkdirSync(path.dirname(to), { recursive: true });
fs.copyFileSync(from, to);
const version = JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules", "@supabase", "supabase-js", "package.json"), "utf8")).version;
console.log(`Copied Supabase's browser library ${version} to site/vendor/supabase.js (${Math.round(fs.statSync(to).size / 1024)} KB).`);
