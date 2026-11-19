# CONTEXT.md: What we asked, what we decided, and why

This is the running memory of building Shortlist with a coding agent. It tracks Jordan's requests, the decisions that came out of them and the reasons behind them, so a new session (or a new person) can pick up without rereading old chats.

How it fits with the other files:
- `AGENTS.md` holds the rules, the commands, the map of the code and the current roadmap. It says what to do.
- `CONTEXT.md` (this file) holds the history and the reasoning. It says why things are the way they are.
- `PRODUCT.md` and `DESIGN.md` hold the product principles and the design system.
- `docs/index.html` is the public Product Page, PRD and build log.

This repository is public. Never put resume content, keys, emails or anything from `data/` in this file.

**Updating it:** at the end of each working session, add a dated entry to the log (what Jordan asked, what was decided, what shipped, key numbers), and update "Key decisions" and "Open questions" if anything changed.

## Where things stand (Nov 18)

- Build 1 shipped Nov 9. Build 2 was submitted for Nov 16 with PostHog evidence, PRD v2 and the Build 2 log. The professor liked the Big Board design, so it stays.
- Build 3 (due Nov 23) is the data roadmap below, then a move to Vercel and Supabase.
- 134 tests (one skips on purpose; it only runs on Node older than 22).
- OpenRouter spend on Nov 19: $0.114 for the model comparison.
- A static demo for classmates lives at `docs/demo/` on GitHub Pages.
- OpenRouter spend: about $0.62 through Build 2, plus $0.0673 for the demo snapshot on Nov 17.

## Key decisions and why

**Product**
- **Off-cycle MBA recruiting is the target.** On-cycle recruiting (consulting, banking) is already served by career centers and 12twenty; off-cycle roles open whenever a team has a need, which is the watching problem Shortlist solves.
- **The name stays "Shortlist" for now** (Nov 10). Jordan considered renaming because "The Shortlist" is taken. Candidates discussed: Rolecall (favorite), Perch, Offcycle, Ripe. The repository name `jz3270-shortlist` must stay because of the course naming rule and the submitted Product Page URL.
- **Anyone can set it up** (Nov 10). A classmate clones, runs `npm install` and `npm start`, and finishes setup in the browser. Jordan's own defaults (real estate and supply chain searches, NYU Stern) became choices instead of code.
- **Look beyond a fixed company list, with the same filters** (Nov 11). Startups Jordan might love are the ones he does not know to add. "Explore" sweeps an open directory of 9,935 companies on Greenhouse, Lever and Ashby (LastRound AI, CC BY 4.0). Scraping LinkedIn Jobs, Wellfound or Y Combinator's job site was ruled out because they forbid it; paid Google Jobs search (SerpApi) was ruled out over cost and its legal dispute.
- **"Remote" means US remote by default** (Nov 11). Remote roles that list only places abroad are filtered out with their own reason; `remoteAnywhere` turns this off.

**Data and learning (the roadmap approved Nov 17)**
- **Your score = AI fit plus the user's own dials** (Nov 17). Different people care about different things; stated preferences work from day one, before any decisions exist. Dials are capped at 25 points either way so the AI fit stays the backbone, and every point is shown on the card.
- **Learning needs decisions first.** One user makes dozens of decisions, not thousands, so the plan is: record decisions, measure accuracy, then a small, explainable model (logistic regression in plain JavaScript), switched on only if it beats the AI fit alone.
- **Decisions keep a snapshot taken on the server** from the app's own results, not from the page, so the data stays trustworthy.
- **Rule suggestions never touch words that let roles in**, words that name a chosen kind of role, or words from roles Jordan saved.
- **Accuracy is measured with AUC** (how often a random save outscores a random pass; 0.5 is a coin flip), with a 90% range from resampling, plus a fairer cut that ignores passes about the company or location, which a resume match cannot know.
- **The "nerd graph" comes after the model** (Jordan's idea, Nov 17): a brutalist plain-SVG chart of what the model learned and a before-and-after calibration chart.
- **The recruiting season in one place** comes after that (Jordan's idea, Nov 17): more stages (interviewing, offer, rejected), applications added by hand from LinkedIn and 12twenty, a season view, and a spreadsheet download for Google Sheets. Interview and offer outcomes become the strongest labels for the model.

**Privacy and cost**
- **Personal data stays in `data/`**, which is gitignored. Uploaded resumes are read in memory; only cleaned text is saved, with email, phone and links removed.
- **PostHog sends named events only.** Click capture and session replay are off in the local app because it shows the resume and scores; the public Product Page uses the standard snippet with replay on. `before_send` drops anything not on the list.
- **Pay for each role once.** Scores are cached by posting ID; keyword and explore scores have their own files so switching modes never discards paid scores.
- **Product Page screenshots never show the real resume.** The Build 2 screenshot was made from a live check against the fictional sample resume in a throwaway folder.

**Process**
- **Plan before multi-file changes, small commits, Jordan pushes** (through GitHub Desktop; the `gh` command line is signed in to a work account without access to this repository).
- **Jordan edits `README.md` and `docs/index.html` by hand,** so changes there are shown as a diff and saved only after approval. Writing for the Product Page follows his writing style: no em or en dashes.
- **Tests never call OpenRouter;** real checks during development use throwaway data folders and keyword scoring unless a paid check is agreed first.

## Session log

### Nov 10: move to Claude Code, setup for anyone, redesign, PostHog
- **Asked:** run `npm install` and `npm test`, commit the Build 2 files, then plan "make it work for anyone." Found that 18 Build 1 files had been deleted by a folder copy; restored them before committing.
- **Asked:** setup for classmates. Built in five steps: preferences from plain choices, the `/api/setup` routes, 242 starter companies by sector, OpenRouter key or free keyword scoring, and the setup screen.
- **Asked:** a redesign using Mobbin and Impeccable. Ran in a separate session on its own branch; the result, "The Big Board," was merged.
- **Found and fixed:** keyword-scored roles all landed in "Long shot," so keyword mode now tiers roles by rank.
- **Asked:** how to push and see the app running; how the LinkedIn links work (plain search links, nothing scraped); a new name (kept Shortlist); PostHog. PostHog was installed with five named events and privacy settings.
- **Cost note:** a test of the setup screen accidentally ran a paid check ($0.0175).

### Nov 11: explore beyond the watchlist
- **Asked:** "not just the companies we have in a list, but all the jobs possible that fit." Researched sources; chose the open ATS directory. A 100-company sample, then a full free sweep: 9,730 companies in under 3 minutes, 243,426 open roles, 3,996 passed the filters.
- **Found:** the free keyword ranking picked poor roles (sales, IT) and "Remote" let in roles abroad. Ranking now uses the chosen kinds of role; Remote means US remote. The top 40 went from 18 to 39 titles naming Jordan's roles.
- **Found:** a test resume belonging to someone else had been left loaded, which skewed scores. Jordan's own resume was restored.

### Nov 12 to 13: explore in the app, Product Page
- **Asked:** put explore in the app. "Beyond your list" shows the top 40 with "Add to watchlist." First AI explore on Jordan's resume: 3,151 roles passed, best fits 72, cost $0.03.
- **Asked:** the Product Page fixes: off-cycle tagline, the Build 1 board count (241), and removing a stray copy of the page.
- **Asked:** "nice to haves" that set Shortlist apart. Suggested triage with rule learning, a "recurring gaps" summary, and a scheduled morning check with notifications.

### Nov 13 to 15: Build 2 write-up and submission
- **Asked:** write PRD v2 and the Build 2 log in Jordan's voice, then check the Build 2 requirements. Replaced the Build 1 screenshot (it quoted the real resume) with a live check on the sample resume, and filled in PostHog evidence (5 users, 5 sessions) and hours (3 to 4).

### Nov 17: the data roadmap, Workday, the move to the cloud
- **Asked:** keep the design and make the next iterations data-oriented, "maybe a learning algo." Agreed the roadmap above. Jordan added the nerd graph and the season tracker with a Google Sheets export.
- **Built:** decisions (Save, Applied, Not for me with a reason, rule suggestions) and the accuracy check. First result on 32 decisions: AUC 0.64 (90% range 0.49 to 0.79). All decisions were on roles scored 50 to 72, so long shots still need labels.
- **Found and fixed:** 28 of 38 Workday companies failed because Workday answered "too many requests." Workday now runs 2 at a time with waits, retries and an early stop. Jordan's note: Workday tends to struggle with this, so keep checking.
- **Asked:** after the data steps, move to Vercel and Supabase as in Jordan's past projects, with security for resumes, separate development and production databases, schema changes saved in Git, pull requests that go live with no dashboard clicks, and rollback. Recorded in `AGENTS.md`; to be planned in detail before any code.
- **Asked:** this file.
- **Asked:** a Workday workaround: split searches by facets so each stays under Workday's 2,000-result cap. One request confirmed the cap and the facets (job category, job type such as "New College Graduate", location by country). Enumerating every facet combination would mean thousands of requests and worse throttling, so the plan is facet targeting (only US roles in matching categories and graduate job types) plus a 12-hour Workday cache. The comparison on NVIDIA, Adobe and Boeing could not run because Workday was still refusing requests; rerun it later.
- **Asked:** a static demo for classmates with a sample MBA resume (4 years as a Microsoft PM) and drag and drop off. Built `docs/demo/` from a real check against a new fictional resume (Taylor Brooks), $0.0673. Decisions in the demo stay in the visitor's browser; PostHog tags its events `app: static_demo`.
- **Asked:** open the demo to visitors' own resumes. A static page can only rank them by shared words (AI scoring would expose the OpenRouter key), so Jordan chose to wait for the Vercel and Supabase site.
- **Asked:** more Workday workarounds. Found that every Workday site publishes `siteMap.xml` with its newest 100 jobs. Jordan's point that roles older than about 14 days are too late to apply to made it enough: Workday v2 reads the sitemap, fetches details only for new matching roles, caches results, and searches at most once a day for fast posters. Setup gained a 7, 14 or 30 day choice; Jordan's window is now 14 days. Ruled out: pretending to be a browser or switching addresses to dodge limits.
- **Asked:** auto-apply, since Greenhouse has autofill. Advised against submitting for the user: there is no applicant-side way to submit through Greenhouse, form answers (work authorization, custom questions) must be his, it hurts targeted off-cycle recruiting, and the PRD's Out of Scope #1 rules it out. Proposed "Apply assist" instead: show a role's application questions in advance, drafted answers to copy, the sites' own autofill, and one-click Applied tracking for the season tracker. Not yet added to the roadmap.
- **Asked:** show how jobs are scored, and let people set their own scoring preferences, starting with their own words. Built "Your scoring": the AI fit stays the backbone, and dials (kinds of role, startups or large companies, top city, senior titles, 2027 programs, freshness, dream and avoid companies) add or take away at most 25 points, free and instant, with the math on every card. Decided the learning model will suggest dial changes instead of being a hidden model, so it stays explainable and in the user's control.
- **Asked:** a home page that starts with the resume drop zone and these dials, and a percent-complete graphic during checks. Planned next, after Your scoring.

### Nov 18: PostHog's GitHub request, the start page, the progress graphic
- **Asked:** why the professor got a PostHog GitHub app request for the class organization. It came from PostHog's onboarding step "Connect your data, GitHub", which sends an install request to the organization owners when the person clicking does not own it. Shortlist does not need it; the web snippet and the app's named events are enough.
- **Asked:** the home page. Built a start page at `/#start` that a fresh install opens: the resume first, then what you want, then the dials, then where to look, then the first check. Kept the one-page Settings form for anyone who prefers it. Jordan liked the brutalist look and asked for small fun details like two sites he likes (Cave and Icerynk, which could not be found online). Added a ticker of true facts, a drop zone that reacts to a dragged file, a "Received" stamp, and three made-up roles that re-rank as the dials move, so the dials make sense before any real check.
- **Asked:** the percent-complete graphic. Chose polling over streaming: a check stays one request and the page asks for progress once a second, the same pattern explore already used. Stage weights (boards 70, details 10, AI scoring 25 or keyword ranking 5, saving 5) are guesses at each stage's share of the time; the percent never goes backwards and holds at 99 until the run is done.
- **Asked:** something simpler: a full-screen wheel or a small 2D game while the percent ticks to 100. Jordan picked the big wheel, full screen on every check. Explore keeps a small wheel in its section, since a sweep takes minutes and should not block the board.
- **Found and fixed:** setup counted an install as fresh only while the sample resume was loaded, so after an upload it showed the example preferences (real estate, NYU Stern, 45 days) as the user's own. A fresh install now also means the preferences are still the untouched example file. A fresh install could also save with no sector, which emptied the example watchlist before the first check; both forms now ask for a sector.

### Nov 19: a simpler app, and a cheaper model
- **Asked:** make the front page super simple and let the AI do most of the work (pick what to search, rank), with advanced settings behind an "Advanced" button as NBA 2K style sliders (left less, right more) that feed the model. Agreed a plan in four commits: test a cheaper model, a one-button front page where the AI picks the setup from the resume, the slider panel, then removing the old screens. Jordan skipped the four detail questions, so the recommended answers stand: sliders are free and stay out of the AI's prompt, the AI picks sectors, the old screens are replaced, and classmates will test AI scoring on Jordan's key once the app is hosted.
- **Asked:** why not just share his own OpenRouter key. The concern is control, not price: a shared main key can spend the whole balance on any model, cannot be taken back from one person, leaks easily, and mixes everyone's usage. A separate key with a credit limit keeps the same account and caps the damage. Jordan's follow-up settled it: classmates should not hold the key at all. It stays in Jordan's own `.env` now and becomes a server-side secret on Vercel, so users never see it. Because anyone who can use the hosted site can still spend it, the move adds sign-in before scoring, a per-user daily cap, a site-wide daily spend cap, and a credit-limited key for preview and another for production.
- **Asked:** a cheaper model such as DeepSeek. Compared on 40 decided roles: Haiku 5.5 AUC 0.60 at $0.00071 a role; DeepSeek V4.1 Flash AUC 0.57 with 9 failures and fits bunched near 70, at $0.00215 a role because it thinks at length before answering. Kept Haiku. Every scoring request now asks OpenRouter to skip hosts that keep or train on prompts. The test cost $0.114, above the 5 cent estimate.

- **Asked:** show users how many AI tries they have left, like a paywall without the paywall. Added to the cloud plan as a daily allowance per user ("3 AI checks left today") on top of the site-wide cap.
- **Asked:** start the Vercel and Supabase move now, as the site launch, ahead of the simple page. Wrote `CLOUD-PLAN.md`. The key design choice: in the cloud, a daily job fetches every watched board once for everyone (Workday included, gently), so "Check my list" only filters and scores from the database and takes seconds. This fits Vercel's free plan (300-second functions, daily scheduled jobs). Two free Supabase projects for dev and prod; preview databases per pull request need Supabase Pro ($25 a month), so later.
- **Asked:** an easy way to remove the resume or start over, instead of backing out of screens. In the plan as "Remove resume", "Start over" and "Delete my data".
- **Name:** Jordan is still thinking of renaming Shortlist. Pick it before buying a domain; Vercel and Supabase project names can change later.

- **Plans:** Jordan already pays for Vercel Pro and Supabase Pro. That lifts the free-plan limits the first draft planned around: scheduled jobs can run every few hours, functions up to 800 seconds, and per-pull-request preview databases are possible. Kept a shared dev project to start (about $10 a month extra on Supabase Pro), with preview databases later.

- **Step 0:** Vercel's and Supabase's GitHub connections both showed "Request", because only an owner of the class GitHub organization can approve apps there. Jordan asked Christian to approve Vercel's. Supabase's is not needed (migrations run from a GitHub Action), so Jordan created the Supabase projects without it. Fallback if Vercel's approval does not come: deploy from a GitHub Action with a Vercel token saved as a repository secret.
- **Step 1 prepared** on the branch `cloud/step-1-skeleton`: Vercel serves only a placeholder page from `site/` with security headers, plus a health check at `/api/health`; `.vercelignore` keeps `data/` and `.env` out of any upload.

- **Step 1 live:** Christian approved Vercel's GitHub app, and the site went live at https://jz3270-shortlist.vercel.app. The import screen had picked the Node preset, which would have tried to run the laptop server on Vercel, so the preset was switched to Other, and step 1 was merged into main first so the very first production deploy was the placeholder page.

- **Rollback rehearsed:** pushed a second release (`69fec5b`), rolled back to `4bac0a1` with Vercel's Instant Rollback (the health check confirmed the older commit, the page stayed up), then promoted `69fec5b` to roll forward. Lesson: after a rollback, Vercel holds new pushes back until a deployment is promoted.

## Open questions

- **Vercel and Supabase design:** how users sign in, how each user's resume and decisions are kept private (row level security), whether resume text needs extra encryption, the numbers for the per-user and site-wide AI caps (the key itself is decided: Jordan's, server-side only), and how checks that take minutes run in the cloud (background jobs rather than a single web request). New packages (such as the Supabase client and command line) need approval first.
- **Apply assist:** add it to the roadmap next to the season tracker? Drafted answers would touch the "no cover letters" non-goal.
- **Workday from the cloud:** Workday limits requests per visitor, and cloud servers share addresses, so cloud checks may be throttled more than a laptop.
- **Learning model:** needs about 50 decisions with some long shots before it can be judged.
- **Rename:** still open if Jordan wants it later.
