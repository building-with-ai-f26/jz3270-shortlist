// Local web app. Run with `npm start` (live boards) or `npm run demo` (saved sample postings).
// Built on Node's own http module so there is nothing to install.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { loadEnv, saveApiKey } from "./src/env.js";
import { ROOT, runPipeline, readLatest, status, ensurePersonalFiles, paths, readJson } from "./src/pipeline.js";
import { saveResume, readResumeMeta, MAX_BYTES } from "./src/resume.js";
import { readSetup, saveSetup, readScoring, saveScoring, scoringContext, cleanWeights } from "./src/setup.js";
import { yourScore } from "./src/yourscore.js";
import { runExplore, readExplore, addFromExplore } from "./src/explore.js";
import { decide, withDecisions, ruleSuggestions, applyRule, readDecisions } from "./src/decisions.js";
import { accuracyReport } from "./src/accuracy.js";

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
let runProgress = null;

// A check's results as the page needs them: each role with the user's decision, plus any suggested rules.
// Demo mode keeps its own decisions in data/demo and never suggests rules, since its preferences are the example file.
// The user's dials and what the score math needs, so the page can turn each AI fit into "your score".
function scoringFor() {
  const prefs = readJson(paths(DEMO).preferences, {});
  return { weights: cleanWeights(prefs.weights || {}), context: scoringContext(prefs) };
}
function accuracyFor() {
  const { weights, context } = scoringFor();
  return accuracyReport(readDecisions(DEMO).decisions, (role) => yourScore(role, weights, context).score);
}
function forPage(latest) {
  return {
    ...latest,
    results: withDecisions(latest.results || [], DEMO),
    rules: DEMO ? [] : ruleSuggestions(readJson(paths(false).preferences, {})),
    accuracy: accuracyFor(),
    scoring: scoringFor()
  };
}
function exploreForPage() {
  const latest = readExplore();
  return latest ? { ...latest, results: withDecisions(latest.results), more: withDecisions(latest.more) } : null;
}
const EXPLORE_TOP = 40;
let exploring = null;
let exploreProgress = null;
let exploreError = null;

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

  // The score math, shared with the page (and copied into the static demo).
  if (req.method === "GET" && url.pathname === "/yourscore.js") {
    return send(res, 200, fs.readFileSync(path.join(ROOT, "src", "yourscore.js"), "utf8"), "text/javascript; charset=utf-8");
  }
  // Your scoring: the dials that adjust each AI fit. Saving them costs nothing and starts no check.
  if (url.pathname === "/api/scoring" && (req.method === "GET" || req.method === "POST")) {
    if (DEMO && req.method === "POST") return send(res, 400, { error: "Your scoring saves in live mode. Stop the demo and run npm start." });
    if (req.method === "GET") return send(res, 200, DEMO ? { ...scoringFor(), lookingFor: "" } : readScoring(paths(false).dataDir));
    try {
      const body = JSON.parse((await readBody(req, 64 * 1024, "That form is too large.")).toString("utf8"));
      return send(res, 200, { ...saveScoring(body, paths(false).dataDir), accuracy: accuracyFor() });
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  }
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
  // Explore: a sweep takes a few minutes, so it runs in the background and the page asks how far it has got.
  // From the page it AI-scores the top EXPLORE_TOP roles, about $0.03, whatever maxToScore says.
  if (url.pathname === "/api/explore" && (req.method === "GET" || req.method === "POST")) {
    if (DEMO) return send(res, 400, { error: "Explore works in live mode. Stop the demo and run npm start." });
    if (req.method === "POST" && !exploring) {
      exploreProgress = { done: 0, total: 0, found: 0, passed: 0 };
      exploreError = null;
      exploring = runExplore({ topN: EXPLORE_TOP, onProgress: (p) => { exploreProgress = p; } })
        .catch((err) => { console.error(err); exploreError = err.message; })
        .finally(() => { exploring = null; });
    }
    return send(res, 200, { running: Boolean(exploring), progress: exploring ? exploreProgress : null, error: exploreError, top: EXPLORE_TOP, latest: exploreForPage() });
  }
  if (req.method === "POST" && url.pathname === "/api/watchlist") {
    if (DEMO) return send(res, 400, { error: "The watchlist is in live mode. Stop the demo and run npm start." });
    try {
      const body = JSON.parse((await readBody(req, 4096, "That request is too large.")).toString("utf8"));
      return send(res, 200, addFromExplore(body.ats, body.board));
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  }
  // Decisions: saved, applied, or not for me with a reason ("clear" undoes one). Only roles from the latest
  // check or explore results are accepted, and the role's details are taken from those saved results.
  if (req.method === "POST" && url.pathname === "/api/decision") {
    try {
      const body = JSON.parse((await readBody(req, 4096, "That request is too large.")).toString("utf8"));
      const saved = decide(body.id, body.decision, body.reason, { demo: DEMO });
      return send(res, 200, { decision: saved, rules: DEMO ? [] : ruleSuggestions(readJson(paths(false).preferences, {})), accuracy: accuracyFor() });
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  }
  // A suggested title rule: add it to the excluded words, or dismiss it. Only current suggestions are accepted.
  if (req.method === "POST" && url.pathname === "/api/rules") {
    if (DEMO) return send(res, 400, { error: "Rules work in live mode. Stop the demo and run npm start." });
    try {
      const body = JSON.parse((await readBody(req, 4096, "That request is too large.")).toString("utf8"));
      const result = applyRule(body.word, body.action);
      return send(res, 200, { ...result, rules: ruleSuggestions(readJson(paths(false).preferences, {})) });
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  }
  if (req.method === "GET" && url.pathname === "/api/latest") {
    return send(res, 200, forPage(readLatest(DEMO) || { summary: null, results: [], dropped: [], errors: [] }));
  }
  // While a check runs, the page asks here once a second for the stage and percent.
  if (req.method === "GET" && url.pathname === "/api/run") {
    return send(res, 200, { running: Boolean(running), progress: running ? runProgress : null });
  }
  if (req.method === "POST" && url.pathname === "/api/run") {
    // If someone double-clicks the button, both clicks share one run instead of paying twice.
    try {
      if (!running) {
        runProgress = null;
        running = runPipeline({ demo: DEMO, onProgress: (p) => { runProgress = p; } });
      }
      const latest = await running;
      return send(res, 200, forPage(latest));
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
