// Local web app. Run with `npm start` (live boards) or `npm run demo` (saved sample postings).
// Built on Node's own http module so there is nothing to install.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { loadEnv, saveApiKey } from "./src/env.js";
import { ROOT, runPipeline, readLatest, status, ensurePersonalFiles, paths } from "./src/pipeline.js";
import { saveResume, readResumeMeta, MAX_BYTES } from "./src/resume.js";
import { readSetup, saveSetup } from "./src/setup.js";

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

// Reads the raw request body, refusing anything over the size limit. Past the limit I stop keeping
// chunks but let the upload finish, so the browser gets the error message instead of a dropped connection.
function readBody(req, limit, tooBig = "That file is over 10 MB. Export a smaller PDF and try again.") {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error(tooBig)); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    return send(res, 200, fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8"), "text/html; charset=utf-8");
  }
  if (req.method === "GET" && url.pathname === "/api/status") {
    // PostHog runs in the page only when POSTHOG_KEY is set. It is a public project key that can only send events.
    const analytics = process.env.POSTHOG_KEY ? { key: process.env.POSTHOG_KEY, host: process.env.POSTHOG_HOST || "https://us.i.posthog.com" } : null;
    return send(res, 200, { ...status(DEMO), resume: DEMO ? null : readResumeMeta(paths(false).dataDir), analytics });
  }
  // The browser sends the resume file as the raw body, with its name in a header.
  if (req.method === "POST" && url.pathname === "/api/resume") {
    if (DEMO) return send(res, 400, { error: "Resume upload works in live mode. Stop the demo and run npm start." });
    try {
      const filename = decodeURIComponent(req.headers["x-filename"] || "resume.pdf");
      const meta = await saveResume(await readBody(req, MAX_BYTES), filename, paths(false).dataDir);
      return send(res, 200, meta);
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  }
  // Setup: the choices on offer and what this user picked, and saving the setup form.
  if (url.pathname === "/api/setup" && (req.method === "GET" || req.method === "POST")) {
    if (DEMO) return send(res, 400, { error: "Setup works in live mode. Stop the demo and run npm start." });
    const dataDir = paths(false).dataDir;
    if (req.method === "GET") return send(res, 200, readSetup(dataDir));
    try {
      const body = await readBody(req, 64 * 1024, "That form is too large.");
      let input;
      try { input = JSON.parse(body.toString("utf8")); } catch { throw new Error("The form did not arrive as JSON."); }
      // A new key is checked and saved first, so a rejected key stops the save before anything else changes.
      // An empty field means "keep the key I already have".
      if (input.apiKey) await saveApiKey(input.apiKey, ROOT);
      return send(res, 200, saveSetup(input, dataDir));
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
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
    : `Mode: LIVE (${s.watchlistCount} companies, scoring with ${s.aiOn ? s.model + " via OpenRouter" : s.keywordsChosen ? "keywords (chosen in setup)" : "keywords (no OPENROUTER_API_KEY in .env)"})`);
});
