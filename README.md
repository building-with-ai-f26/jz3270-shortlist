# Shortlist

> **One-line pitch:** For MBA students recruiting across several tracks at once, Shortlist checks every company on your list in one run, drops the roles you cannot get, and ranks the rest against your resume with a reason for each.

- **Builder:** Jordan Zhu (`@jz3270`)
- **Pod:** [Pod Name / Number]
- **Product Page & Living PRD:** https://building-with-ai-f26.github.io/jz3270-shortlist/
- **App:** runs locally through Week 4; add a cloud URL in Build 5.

## Start here: Build 1

**Due Monday, November 9 at noon, New York time.** No class November 3; keep building that week.

1. Join the [class organization](https://github.com/building-with-ai-f26), then use this template to create a **public** repo named `<netid>-<project-slug>`. Ask Christian or Hew if the organization is missing from the owner list.
2. Set up Git and one coding agent during the week of October 27. Follow the [Icerynk setup guide](https://www.icerynk.com/c/fa26-tech-gb-2160-dm2-f2/content/pre-class-setup-github-openrouter-your-coding-agent).
3. Publish [`docs/index.html`](./docs/index.html): **Settings → Pages → Deploy from a branch → main → /docs → Save**. When deployment finishes, open `https://building-with-ai-f26.github.io/<your-repo-name>/`.
4. Fill in PRD v1: a reachable user, their painful before/after workflow, one core workflow, and three non-goals.
5. Build a rough local prototype. Add a screenshot or GIF and an honest Build 1 log to the Product Page, including progress, learning, problems, costs, and hours.
6. Push meaningful commits on **at least two separate days each week outside class**, including the November 3 break.
7. Submit your **Product Page URL and repository URL in Icerynk**. Come ready to demo the prototype in two minutes on November 10.

Create your PostHog account in Week 1. Install it on the Product Page and local app in **Build 2**, then verify events. The Product Page is public from Build 1; the app can stay local through Week 4.

## Repository map

| File / folder | Purpose |
| --- | --- |
| [`docs/index.html`](./docs/index.html) | Required public pitch, living PRD, and weekly build log. Update with actual work and evidence. |
| [`Intent.md`](./Intent.md), [`Plan.md`](./Plan.md), [`journal/`](./journal/) | Optional drafting aids. No duplicate submission is required. |
| [`AGENTS.md`](./AGENTS.md) | Local run commands, project context, and agent rules. Build 2 onward. |
| [`tests/`](./tests/) | Verification guidance. Build 4 offers Track A domain evals **or** Track B user replays. |
| [`SPONSOR_MEMO.md`](./SPONSOR_MEMO.md) | One-page recommendation backed by actual usage, full costs, and risks. Due December 14 at noon. |

[Icerynk](https://www.icerynk.com/c/fa26-tech-gb-2160-dm2-f2/content) holds the assignment instructions and submissions.

## Local setup

Requires Node.js 18 or newer (`node --version`). There are no npm packages to install.

```bash
git clone https://github.com/building-with-ai-f26/jz3270-shortlist.git
cd jz3270-shortlist

npm run demo        # demo mode: fictional postings, no API calls, opens on http://localhost:3000
npm test            # 22 automated tests
```

### Run it on your own search

```bash
cp .env.example .env          # then paste your OpenRouter key into .env
npm run check                 # creates data/ on first run and tests every board in your watchlist
npm start                     # live mode on http://localhost:3000, press "Check my list"
```

On the first live run, Shortlist copies three example files into `data/`, which is gitignored:

| File | What to put in it |
| --- | --- |
| `data/profile.md` | Your resume as plain text, plus a short paragraph on what you want |
| `data/watchlist.json` | Companies to check: `{ "company": "Anthropic", "ats": "greenhouse", "board": "anthropic" }` |
| `data/preferences.json` | Tracks, locations, title keywords to include or exclude, max posting age, max postings to score per run |

To find a company's board slug, open one of its job postings. A URL like `boards.greenhouse.io/anthropic/...` or `job-boards.greenhouse.io/anthropic/...` means `"ats": "greenhouse", "board": "anthropic"`. Lever uses `jobs.lever.co/<board>` and Ashby uses `jobs.ashbyhq.com/<board>`. Run `npm run check` after adding companies to confirm each slug works.

Without a real `OPENROUTER_API_KEY`, live mode still runs but scores with keyword overlap, which is much less accurate. With a key, each run prints and displays the token count and the dollar cost OpenRouter reports.

Keep private keys out of source code, browser code, screenshots, and commits. The template ignores `.env`; `.env.example` contains placeholders only. Your resume and watchlist stay in `data/`, which is also ignored.
