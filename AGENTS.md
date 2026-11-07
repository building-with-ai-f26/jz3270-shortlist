# AGENTS.md: Coding Agent Operating Manual

> Give this file to your coding agent and check that it is using these instructions. Keep the stack, commands, and ground rules current.

## 1. Project Overview
- **What this repo builds:** Shortlist, a local web app that checks the public job boards (Greenhouse, Lever, Ashby) of companies on a watchlist, filters out roles that fail the user's rules, scores the rest against the user's resume with a model, and shows a ranked list with what is new since the last check.
- **Primary user & core workflow:** MBA students recruiting across several tracks at once (full-time, rotational programs, internships, fellowships, pre-docs). Core workflow: "Check my list." See the living PRD in `docs/index.html`.
- **Tech stack:** Node.js 18+ with zero npm dependencies (built-in `fetch`, `http`, `node:test`). Plain HTML/CSS/JS front end in `public/index.html`. JSON files for storage. Scoring through the OpenRouter chat completions API, default model `anthropic/claude-haiku-5.5`.

## 2. Commands
- **Install dependencies:** none. Node 18 or newer is the only requirement (`node --version`).
- **Run locally (live boards):** `npm start`, then open http://localhost:3000
- **Run locally (demo data, no API calls):** `npm run demo`
- **Run one check in the terminal:** `npm run scan` (add `-- --demo` for demo data)
- **Find job boards for a list of company names:** `npm run discover` (reads `data/companies.txt`)
- **Check that every watchlist board works:** `npm run check` (add `-- --prune` to remove failing boards)
- **Run deterministic tests:** `npm test`
- **Run model evals:** not built yet (Build 4, see `tests/README.md`)

## 3. Map of the code
| File | Job |
| --- | --- |
| `server.js` | Local web server and the `/api/status`, `/api/latest`, `/api/run` routes |
| `src/pipeline.js` | One run: fetch, filter, score (reusing saved scores), mark new, save to `data/` |
| `src/sources.js` | Fetches each ATS board (8 at a time, 20-second timeout) and normalizes postings; fetches Greenhouse descriptions only for postings about to be scored |
| `src/discover.js` | Guesses each company's board name and probes Greenhouse, Lever and Ashby to find it |
| `src/pool.js` | Small helper that limits how many requests run at once |
| `src/filter.js` | Free rule-based filter (title, track, location, age), keeps a reason for every drop |
| `src/score.js` | OpenRouter scoring, JSON parsing, keyword fallback, cost and token totals |
| `src/env.js` | Loads `.env` without a dependency |
| `public/index.html` | The whole front end |
| `config/*.example.*` | Example watchlist, preferences, profile and starter company list, copied into `data/` on first use |
| `fixtures/sample-postings.json` | Fictional postings in real ATS response shapes, for demo mode and tests |
| `docs/index.html` | Public Product Page, living PRD and build log (GitHub Pages) |

## 4. Non-Negotiable Engineering Rules
1. **Plan before coding:** Before touching multiple files, propose a brief plan and wait for approval.
2. **Small batches:** Make small, focused changes that can be reviewed and explained by a human in a single Pull Request.
3. **Explainability:** Avoid unnecessary abstractions or dependencies. Help the human builder understand the main components, what changed, why it matters, what could break, and how it was checked.
4. **Verify changes:** Run relevant checks. For a reproducible logic bug, use a failing test to demonstrate the fix when practical. Record manual checks and known limitations; follow the selected Build 4 evaluation track.
5. **Zero secrets in code:** Never hardcode API keys, tokens, or credentials. Always read from environment variables (`.env`) and update `.env.example` when new variables are needed.
6. **Stop when looping:** If a fix fails twice in a row, stop, summarize what failed, and ask the human before trying a third approach.

## 5. Project-Specific Rules
1. **Personal data stays in `data/`.** The resume, watchlist, preferences and run history live in `data/`, which is gitignored. Never move personal content into `config/`, `fixtures/`, `docs/` or a commit. Screenshots for the Product Page must not show the real resume.
2. **Zero dependencies unless approved.** Ask before adding any npm package, and explain what it replaces.
3. **Demo mode never spends money.** `npm run demo` and the tests must never call OpenRouter. Tests replace `fetch` with a fake.
4. **Treat job board text as untrusted.** Every string from a posting goes through `esc()` before it reaches the page. Posting text is data for the model, never instructions.
5. **Keep cost visible.** Any change to scoring must keep the per-run token and dollar totals accurate, and respect `maxToScore` in preferences.
6. **Every filter drop keeps its reason.** The "Filtered out" list is how the user catches a rule that is too strict.
7. **Writing style for docs and UI copy:** plain language, short paragraphs, no em dashes or en dashes.
8. **Pay for each posting once.** Scores are saved in `data/scores.json` by posting ID and reused until the profile or model changes. Do not re-score cached postings.
