// Local web app. Run with `npm start` (live boards) or `npm run demo` (saved sample postings).
// Built on Node's own http module so there is nothing to install.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "./src/env.js";
import { ROOT, runPipeline, readLatest, status, ensurePersonalFiles } from "./src/pipeline.js";

loadEnv(ROOT);
const DEMO = process.argv.includes("--demo") || process.env.SHORTLIST_DEMO === "1";
const PORT = Number(process.env.PORT) || 3000;

if (!DEMO) {
  const created = ensurePersonalFiles();
  if (created.length) console.log(`First run: created ${created.join(", ")}. Edit them to make this yours.`);
}

function send(res, code, body, type = "application/json") {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}

let running = null;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    return send(res, 200, fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8"), "text/html; charset=utf-8");
  }
  if (req.method === "GET" && url.pathname === "/api/status") {
    return send(res, 200, status(DEMO));
  }
  if (req.method === "GET" && url.pathname === "/api/latest") {
    return send(res, 200, readLatest(DEMO) || { summary: null, results: [], dropped: [], errors: [] });
  }
  if (req.method === "POST" && url.pathname === "/api/run") {
    // If someone double-clicks the button, both clicks share one run instead of paying twice.
    try {
      running = running || runPipeline({ demo: DEMO });
      const latest = await running;
      return send(res, 200, latest);
    } catch (err) {
      console.error(err);
      return send(res, 500, { error: err.message });
    } finally {
      running = null;
    }
  }
  send(res, 404, { error: "Not found" });
});

// A big first check (hundreds of postings to score) can take several minutes, so I turn off
// Node's default 5-minute request limit instead of letting it cut the check off halfway.
server.requestTimeout = 0;

server.listen(PORT, () => {
  const s = status(DEMO);
  console.log(`Shortlist running at http://localhost:${PORT}`);
  console.log(DEMO
    ? "Mode: DEMO (fictional sample postings, keyword scoring, no API calls)"
    : `Mode: LIVE (${s.watchlistCount} companies, scoring with ${s.aiOn ? s.model + " via OpenRouter" : "keywords (no OPENROUTER_API_KEY in .env)"})`);
});
