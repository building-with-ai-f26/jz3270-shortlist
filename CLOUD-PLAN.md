# Cloud plan: Shortlist on Vercel and Supabase

Status: proposed Nov 19, waiting for Jordan's approval. No code until it is approved (AGENTS.md, rule 1 and roadmap item 5).

## What we are building

The same app, hosted, so a classmate opens a link, signs in, drops a resume and gets a ranked board. Nobody installs anything, and nobody holds an OpenRouter key.

Jordan's requirements (Nov 17 and Nov 19):

1. Security, since resumes and their bullets are sensitive.
2. Separate development and production databases.
3. Schema changes saved in Git as migrations.
4. A pull request goes live as a preview with no dashboard clicks.
5. Any release can be rolled back.
6. Jordan's OpenRouter key stays a server-side secret. Users never see it, and what they can spend is capped.
7. Users see how much AI scoring they have left ("3 AI checks left today"). No paywall, just a visible limit.
8. An easy way to remove the resume or start over.

## The big idea: fetch once, rank per person

Today every check fetches every board on your list, which takes minutes and is what makes Workday angry. In the cloud, job boards are public and the same for everyone, so:

- **A scheduled job fetches the boards once** for every company anyone watches, and saves the postings in the database: Greenhouse, Lever, Ashby and SmartRecruiters every few hours, Workday once a day, paced gently from one place instead of once per user.
- **"Check my list" becomes fast:** it reads today's postings for your companies from the database, filters them with your rules, and scores only the roles you have not paid for yet. Seconds instead of minutes.
- **A company you just added** is fetched on the spot (not Workday, which waits for the daily job), so it shows up right away.

Jordan has Vercel Pro, so a function can run for up to 800 seconds (300 by default) ([limits](https://vercel.com/docs/functions/limitations)) and scheduled jobs can run as often as every minute ([cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing)). Each fetch is still split into slices of the company list, so no single job runs long.

## How the pieces fit

| Piece | Where it runs | Notes |
| --- | --- | --- |
| The page (`public/index.html`) | Vercel, as a static file | Same Big Board design, plus a sign-in screen |
| The API (`/api/*`) | Vercel Functions in an `api/` folder | Plain Node, no framework. Same routes as `server.js`, split into one file per route |
| Board fetch | Vercel scheduled jobs | Slices of the company list; most boards every few hours, Workday once a day |
| Database | Supabase Postgres | One project for development, one for production |
| Sign-in | Supabase Auth | Google sign-in and an email link. No passwords to store |
| AI scoring | OpenRouter, called only from Vercel Functions | Jordan's key, server-side only, hosts that keep no prompts |

Local development keeps working: `npm start` runs the same code against the development database, and `npm test` keeps using fakes with no network or OpenRouter calls.

## The database

Every table that holds personal data has row level security: a signed-in user can read and write only their own rows, enforced by the database itself, not just by our code.

| Table | Holds | Who can read it |
| --- | --- | --- |
| `profiles` | Cleaned resume text (encrypted, see below), file name and date, "What I'm looking for" | Only that user |
| `preferences` | The setup choices and the dials or sliders | Only that user |
| `watchlist` | Companies on the user's list | Only that user |
| `postings` | Public job postings from the daily fetch | Any signed-in user (they are public anyway) |
| `scores` | Each user's AI fit, why, gap and dealbreaker per posting, keyed to their resume version | Only that user |
| `decisions` | Saved, applied, passed, with the reason and a snapshot | Only that user |
| `runs` | Each check's summary, cost and counts | Only that user |
| `ai_usage` | AI-scored roles and dollars per user per day | Only that user (read); the server writes |
| `site_spend` | AI dollars per day across everyone | Server only |

Schema changes live in `supabase/migrations/` as plain SQL files, one per change, in Git.

## Security

- **Secrets:** the OpenRouter key and Supabase's service key are Vercel environment variables, readable only by server code, never sent to the page, never logged. The page only gets Supabase's public key, which is safe by design because row level security decides what it can read.
- **Prompts are not logged** anywhere, since each one carries a resume.
- **Resume text is encrypted** before it is saved, with a key that lives only in Vercel's environment (Node's built-in `crypto`, no new package). Someone browsing the database sees ciphertext. Supabase also encrypts its disks.
- **The AI caps:** each user gets a daily number of AI-scored roles (for example 60, about 4 cents), shown as "3 AI checks left today", resetting at midnight. A site-wide daily dollar cap pauses AI scoring for everyone if reached; keyword ranking keeps working, so nothing breaks. OpenRouter keys have their own credit limit as a last line.
- **Separate keys per environment:** previews use a development key with a small credit limit; production uses its own.
- **OpenRouter routing:** only hosts that do not keep or train on prompts (already in place).
- **Remove and delete:** "Remove resume" deletes the resume text and its scores. "Delete my data" deletes every row for the user and the account itself. Both are one click plus a confirmation.
- **Rate limits** on sign-in and on "Check my list", so one account cannot hammer the site.

## Environments, previews and rollback

| | Development | Production |
| --- | --- | --- |
| Supabase project | `shortlist-dev` | `shortlist-prod` |
| Vercel | Every pull request gets a preview link automatically | `main` deploys automatically |
| OpenRouter key | Small credit limit | Production limit |
| Migrations | Applied to dev when a pull request opens | Applied to prod when it merges |

- **Previews with no clicks:** Vercel's Git connection builds every pull request into its own preview link and posts it on the pull request.
- **Migrations with no clicks:** a GitHub Action runs the Supabase command line tool: on a pull request it applies new migrations to dev, on merge to prod.
- **Rollback:** Vercel's Instant Rollback puts the previous release back in seconds (`vercel rollback` or one click). Database changes are written so the previous release still works with the newer schema (add columns and tables first, remove old ones a release later), so rolling back the app never needs rolling back the database.
- **Supabase preview branches** (a fresh database per pull request) are available on Jordan's Pro plan, at about $0.013 an hour per branch while its pull request is open ([pricing](https://supabase.com/pricing), [branching](https://supabase.com/docs/guides/deployment/branching)). Start with the shared dev project, which is simpler and reliable, and switch branches on later if previews start getting in each other's way. Supabase's Vercel integration, which points each preview at its branch, has reported problems syncing settings ([troubleshooting](https://supabase.com/docs/guides/troubleshooting/vercel-integration-environment-variables-not-syncing-for-persistent-git-branches-b9191e)), another reason to wait.

## Cost

- Vercel Pro: Jordan already pays for it; this project fits within it.
- Supabase Pro: Jordan already pays for it. The first project (prod) is included; a second always-on project (dev) adds about $10 a month in compute ([pricing](https://supabase.com/pricing)). To skip that, dev could live in a separate free Supabase organization, where it pauses after a week unused.
- Postings without descriptions are small; descriptions are fetched only for roles about to be scored.
- OpenRouter: capped per user, per day, and by each key's credit limit.

## New packages (need Jordan's approval, rule 2)

- `@supabase/supabase-js`: sign-in and database access from the page and the functions. Replaces the JSON files in `data/` for the hosted app.
- The Supabase command line tool: runs only inside the GitHub Action and through `npx` for local migrations. It is not added to the app's dependencies.

No framework (no Next.js): the page stays one HTML file and the API stays plain Node functions.

## Steps, each a small pull request

0. **Setup (Jordan, about 15 minutes, no code):** in Jordan's paid Vercel team and Supabase organization, connect the repository and create two Supabase projects; create a development OpenRouter key with a credit limit. Check whether the class organization lets Vercel's GitHub app see this repository. PostHog's GitHub app needed the organization owners' approval, so Vercel's likely does too. If not, the fallback is a GitHub Action that deploys with Vercel's command line tool and a token saved as a repository secret.
1. **Hosting skeleton:** the current page on Vercel with one health check function, previews on pull requests, production on `main`, and a rollback rehearsed once. No personal data yet.
2. **Database and migrations:** the tables above with row level security, the GitHub Action for dev and prod, and tests that one user cannot read another's rows.
3. **Sign-in and the resume:** Google and email sign-in, encrypted resume upload, "Remove resume" and "Delete my data".
4. **Storage moves to Supabase:** watchlist, preferences, scores, decisions and runs, behind one small storage module, so the rest of the code barely changes. Tests keep running on an in-memory fake.
5. **Checks in the cloud:** the daily fetch in slices, fast per-user checks, the AI caps and the "AI checks left" counter, and the progress wheel reading real progress.
6. **The simple front page and Advanced sliders** (the Nov 19 plan), built on the hosted app, with "Start over" and "Remove resume" one click away.
7. **Explore in the cloud, later:** a full sweep is about 10,000 boards and over 200,000 postings. On Supabase Pro, keeping recent, relevant postings is feasible, and a shared sweep a few times a day would make explore instant for everyone. Decide after step 5.

Build 3 is due Monday, Nov 23. Steps 0 to 2 fit before then; 3 to 5 are realistic for the week after.

## Open questions

- **The name.** Jordan is still deciding. Vercel and Supabase project names can be renamed later; the default link is `<project>.vercel.app` until a custom domain is bought, so pick the name before buying a domain. The repository name stays `jz3270-shortlist` (course rule).
- **The daily AI allowance** per user (60 roles a day is a starting guess) and the site-wide daily cap (for example $1).
- **Who can sign in:** anyone with a Google account, or only a list of classmates' emails at first.
- **The local app:** keep the JSON-file version for people who want everything on their own laptop, or make the hosted site the only version.
