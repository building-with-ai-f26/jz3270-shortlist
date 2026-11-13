# Shortlist

> **One-line pitch:** For MBA students recruiting off-cycle, Shortlist checks the job boards of every company on your list in one run, drops the roles you cannot get, and ranks the rest against your resume with a reason for each.

- **Builder:** Jordan Zhu (`@jz3270`)
- **Pod:** [Pod 9]
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

Requires Node.js 22 or newer (`node --version`).

```bash
git clone https://github.com/building-with-ai-f26/jz3270-shortlist.git
cd jz3270-shortlist
npm install         # two small packages for reading PDF and Word resumes

npm run demo        # demo mode: fictional postings, no API calls, opens on http://localhost:3000
npm test            # 89 automated tests
```

### Run it on your own search

```bash
npm start           # live mode on http://localhost:3000
```

The first time, a setup screen opens in the browser. Add your resume, then pick the kinds of roles, cities, sectors of companies to watch, and your schools, and write a few sentences on what you are looking for. Choose free keyword scoring, or paste an OpenRouter key for AI scoring. Save, and Shortlist runs its first check. Settings, under the logo, reopens setup any time.

Everything you enter stays in `data/`, which is gitignored:

| File | What it holds |
| --- | --- |
| `data/profile.md` | Your resume as plain text, with email, phone and links removed, plus what you are looking for |
| `data/watchlist.json` | Companies to check. Setup adds a sector's companies; you can add others by hand: `{ "company": "Anthropic", "ats": "greenhouse", "board": "anthropic" }` |
| `data/preferences.json` | Setup writes roles, cities, schools and scoring. Excluded title words, max posting age and max postings to score per check are edited here by hand |

To add a company setup does not offer, put its name in `data/companies.txt` and run `npm run discover`, or paste its careers link on the same line, like `NVIDIA | https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite`. Run `npm run check` afterwards to confirm each board works.

With keyword scoring, roles are ranked against each other by shared words, which is free but much less accurate. With an OpenRouter key, each check shows the token count and the dollar cost OpenRouter reports, and each role is paid for once. Your key is saved only in `.env`.

Keep private keys out of source code, browser code, screenshots, and commits. The template ignores `.env`; `.env.example` contains placeholders only. Your resume and watchlist stay in `data/`, which is also ignored.
