// `npm run dev-site` runs the hosted site on this laptop at http://localhost:3002, the way Vercel runs it: the page
// in site/, each file in api/ as a function, and the security headers from vercel.json. It uses the development
// Supabase project from .env and refuses production. The laptop app is still npm start.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { loadEnv } from "../src/env.js";
import { ROOT } from "../src/pipeline.js";

loadEnv(ROOT);
const PORT = 3002;
if ((process.env.SUPABASE_URL || "").includes("ohagjyhptkisbynowupl")) {
  console.error("This runs against the development database only. Point SUPABASE_URL in .env at the dev project.");
  process.exit(1);
}
execFileSync(process.execPath, [path.join(ROOT, "scripts", "build-site.js")], { stdio: "inherit" });

const SITE = path.join(ROOT, "site");
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
const securityHeaders = Object.fromEntries(vercel.headers[0].headers.map((h) => [h.key, h.value]));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  for (const [key, value] of Object.entries(securityHeaders)) res.setHeader(key, value);
  try {
    if (url.pathname.startsWith("/api/")) {
      const name = url.pathname.slice(5).replace(/[^a-z0-9-]/gi, "");
      const file = path.join(ROOT, "api", `${name}.js`);
      const handler = fs.existsSync(file) ? (await import(pathToFileURL(file).href))[req.method] : null;
      if (!handler) { res.writeHead(404, { "Content-Type": "application/json" }); return res.end('{"error":"Not found"}'); }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(key, value);
      const request = new Request(url, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) });
      const response = await handler(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      return res.end(Buffer.from(await response.arrayBuffer()));
    }
    let file = path.normalize(path.join(SITE, decodeURIComponent(url.pathname)));
    if (!file.startsWith(SITE)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(fs.readFileSync(file));
  } catch (err) {
    console.error(err);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Something went wrong. The terminal running npm run dev-site has the details.");
  }
}).listen(PORT, () => console.log(`The hosted site, on the development database: http://localhost:${PORT}`));
