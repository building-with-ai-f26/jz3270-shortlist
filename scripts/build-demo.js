// `npm run build-demo -- --from <folder>` builds the static demo in docs/demo/ for GitHub Pages:
//   index.html   the app page, plus a small script that answers its /api/* requests from data.json
//   data.json    a saved check (results, filter counts) made against the fictional resume
//   resume.html  that fictional resume
// <folder> is a throwaway data folder where a check was run against fixtures/resume-mba-pm.md.
// Never point it at data/: the demo is public. Rebuild any time to refresh the snapshot.
import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "../src/env.js";
import { ROOT } from "../src/pipeline.js";

loadEnv(ROOT);
const i = process.argv.indexOf("--from");
const from = i > -1 ? path.resolve(process.argv[i + 1]) : null;
if (!from || !fs.existsSync(path.join(from, "latest.json"))) {
  console.error("Pass the throwaway folder with a finished check: npm run build-demo -- --from <folder>");
  process.exit(1);
}
if (from === path.join(ROOT, "data")) {
  console.error("That is your personal data folder. The demo is public, so build it from a throwaway folder with the fictional resume.");
  process.exit(1);
}

const out = path.join(ROOT, "docs", "demo");
const RESUME = path.join(ROOT, "fixtures", "resume-mba-pm.md");
const latest = JSON.parse(fs.readFileSync(path.join(from, "latest.json"), "utf8"));
const snapshotAt = latest.summary.runAt;
const day = new Date(snapshotAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });

const data = {
  staticDemo: {
    note: `Demo: real roles checked on ${day} against a fictional MBA resume (4 years as a product manager at Microsoft), scored by Claude Haiku 5.5. Your decisions stay in this browser.`,
    resumeName: "Taylor Brooks (fictional)",
    resumeLink: "resume.html",
    snapshotAt
  },
  // The Product Page already shows this public PostHog key; events are tagged app: static_demo.
  analytics: process.env.POSTHOG_KEY ? { key: process.env.POSTHOG_KEY, host: process.env.POSTHOG_HOST || "https://us.i.posthog.com" } : null,
  latest: {
    // A snapshot has nothing waiting to be scored, no new checks coming, and no "last check" to be new since.
    summary: { ...latest.summary, waiting: 0, cacheReset: false, newCount: 0 },
    results: latest.results.map(({ text, ...r }) => ({ ...r, isNew: false })),
    dropped: (latest.dropped || []).slice(0, 100),
    droppedCount: latest.droppedCount,
    droppedByReason: latest.droppedByReason,
    errors: latest.errors || []
  }
};

// Answers the app's /api/* requests from data.json. Decisions live in this browser's localStorage.
const shim = `<script>
    // Static demo: answers the app's /api/* requests from data.json, so the page runs on GitHub Pages with no server.
    // Decisions are kept in this browser only. Built by npm run build-demo.
    (() => {
      const realFetch = window.fetch.bind(window);
      const snapshot = realFetch("data.json").then((r) => r.json());
      const KEY = "shortlist-demo-decisions";
      const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
      const write = (d) => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {} };
      const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      window.fetch = async (url, opts = {}) => {
        const where = typeof url === "string" ? url : url.url;
        if (!where.startsWith("/api/")) return realFetch(url, opts);
        const s = await snapshot;
        const decisions = read();
        const marked = (list) => list.map((r) => (decisions[r.id] ? { ...r, ...decisions[r.id] } : r));
        if (where === "/api/status") {
          return reply({ demo: true, staticDemo: s.staticDemo, aiOn: false, model: s.latest.summary.model || "", watchlistCount: s.latest.summary.companies, runs: 1, needsSetup: false, resume: null, analytics: s.analytics });
        }
        if (where === "/api/latest" || where === "/api/run") return reply({ ...s.latest, results: marked(s.latest.results), rules: [], accuracy: null });
        if (where === "/api/decision") {
          const body = JSON.parse(opts.body || "{}");
          if (body.decision === "clear") delete decisions[body.id];
          else decisions[body.id] = { decision: body.decision, reason: body.reason || null };
          write(decisions);
          return reply({ decision: decisions[body.id] || null, rules: [], accuracy: null });
        }
        return reply({ error: "This works in the full app. The demo is a saved snapshot." }, 400);
      };
    })();
  </script>
</head>`;

const page = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
if (page.split("</head>").length !== 2) throw new Error("public/index.html should have exactly one </head>");

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
const resume = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sample resume (fictional) · Shortlist demo</title>
  <link href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@800&family=Public+Sans:wght@400;600&display=swap" rel="stylesheet" />
  <style>
    body { margin: 0; background: #e3e5e1; color: #141618; font: 15px/1.55 "Public Sans", system-ui, sans-serif; }
    main { max-width: 760px; margin: 32px auto; padding: 0 16px; }
    h1 { margin: 0 0 6px; font: 800 40px/1 "Big Shoulders Display", "Arial Narrow", sans-serif; text-transform: uppercase; }
    p.note { margin: 0 0 18px; color: #464b51; }
    pre { margin: 0; padding: 22px 24px; background: #fbfbf9; border: 1px solid #c5c9c3; white-space: pre-wrap; font: inherit; }
    a { color: inherit; }
  </style>
</head>
<body>
  <main>
    <h1>Sample resume</h1>
    <p class="note">Fictional. Every role in the <a href="./">Shortlist demo</a> was scored against this resume. Contact details are removed before anything is scored.</p>
    <pre>${esc(fs.readFileSync(RESUME, "utf8").trim())}</pre>
  </main>
</body>
</html>
`;

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "index.html"), page.replace("</head>", shim));
fs.writeFileSync(path.join(out, "data.json"), JSON.stringify(data));
fs.writeFileSync(path.join(out, "resume.html"), resume);
const kb = (f) => Math.round(fs.statSync(path.join(out, f)).size / 1024);
console.log(`Built docs/demo: ${latest.results.length} roles from a check on ${day} (index.html ${kb("index.html")} KB, data.json ${kb("data.json")} KB, resume.html ${kb("resume.html")} KB).`);
