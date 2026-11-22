# Security

Build 3 security audit for the hosted Shortlist at https://jz3270-shortlist.vercel.app (Advanced lane). Last run November 22, 2026.

## What kind of app this is

**An app with sign-in and a database.** People sign in with Google or an email link (Supabase Auth), upload a resume, pick what they want, and run a check that ranks job postings against the resume. Data lives in Supabase (Postgres, row level security on every table); the site and its server functions run on Vercel.

The resume is the sensitive part, so it gets the most protection: the file is read in memory and never kept, contact details are removed, and the text is stored encrypted (AES-256-GCM, bound to the account, with a key the database does not hold).

AI scoring is not switched on for the hosted site yet. Checks rank with free keyword matching, so no hosted route calls a paid API today. AI scoring comes with a per-person daily allowance and a site-wide spending cap (CLOUD-PLAN.md, step 5).

## The audit, step by step

| Step | What I checked | What I found | What I did |
| --- | --- | --- | --- |
| 1. Access controls | Signed in as account B, tried to read, write and change account A's data, on the real dev database: `npm run check-rls` (34 checks on the tables) and `npm run check-hosted` (25 checks through the site's own functions) | Every attempt was blocked | Nothing to fix. Both scripts create throwaway accounts and delete them |
| 2. Secret keys | `npm run check-secrets`: every tracked file, every line ever added in Git history on every branch, and the live sites (hosted site, Product Page, demo) with every script they load, for `sb_secret_`, `sk-or-`, `sk-ant-`, `sk-proj-`, `sk_live_`, service_role keys and the real values in `.env` | Clean: 102 files, 29,468 added lines, 4 pages. The only matches were the made-up `sk-or-v1-replace...` placeholders and `service_role` as a role name in code | Added the script, so the search is one command. A planted fake key was caught, then removed |
| 3. File storage | Storage buckets on the dev database | None. Resumes are encrypted text in a table, not files | Nothing to fix |
| 4. Production vs the agent | Who can touch production | The agent's tools (`check-rls`, `check-hosted`, `dev-site`, `refresh-postings`) refuse the production database; migrations reach production only through the GitHub Action on merge | Added the "Ask me first" list (AGENTS.md, section 7). Production backup: see below |
| 5. Spending caps and rate limits | Every route that writes to the database or could cost money | No hosted route calls a paid API yet | Per-person limits on every write route (below). OpenRouter credit limits: see below |
| 6. Dependencies | `npm audit` | 0 vulnerabilities | The tests Action now fails any pull request with a high or critical advisory |
| 7. Agent security review | A separate agent, given only the code, read every hosted file and tried to break it | No way for one account to reach another's data. Two medium issues (the rate limits could be bypassed; one upload could stall a server), and several low ones | Fixed all but one, which needs a database change (see "Agent review" below) |

### Rate limits on every write route

| Route | Limit |
| --- | --- |
| `POST /api/check` | 5 checks per person in 10 minutes (429 after). Each check's row is written before any work and counted after, so checks sent at once, failed checks and refused checks all count, and people cannot delete their own checks |
| `POST /api/resume` | One upload per person every 10 seconds (Start over keeps the time of the last upload); 4 MB at most, text files 200 KB, PDFs 20 pages, Word files refused if they expand past 40 MB |
| `POST /api/setup` | One save per person every 2 seconds; 20 KB at most |
| `DELETE /api/resume`, `DELETE /api/account` | Act once on the signed-in person's own data; account deletion needs the exact words "delete my account" |
| `GET /api/refresh-postings` | Only Vercel's cron, with `CRON_SECRET` (compared in constant time; under 16 characters counts as no secret) |

Each limit is counted from the person's own rows (their checks, their last upload, their last save), so it holds across Vercel's many server instances.

## Agent review

A separate agent read the hosted code with no hints about what I thought was safe, and tried to break it. It found nothing that lets one account read or change another account's data: every route takes the user id from Supabase's answer about the session, never from the request, and row level security holds on all nine tables. What it did find, and what happened to each:

| Finding | Severity | What I did |
| --- | --- | --- |
| The check limit could be bypassed: many checks sent at once all passed the count, failed checks never counted, and Start over deleted the checks the limit counts | Medium | Fixed. A check writes its row first and counts after; failed and refused checks keep their rows; Start over clears a check's board but keeps the row; people cannot delete their own checks. Verified live: 6 checks sent at once, 0 got past the limit |
| One upload could stall a server function for 30 seconds (cleaning very long text is slow) or exhaust its memory (a Word "zip bomb") | Medium | Fixed. Text is trimmed before cleaning (worst case now about 0.65 seconds), text files are capped at 200 KB, PDFs at 20 pages, and Word files are unzipped first with a cap on real bytes, so a file that claims to be small but expands to 60 MB is refused |
| The browser can write to its own preferences, profile and decisions directly through Supabase, skipping the site's checks | Low to medium | Partly fixed: the site now saves choices from the server after checking them, re-checks saved choices before every check, and repairs damaged ones when saved again. Revoking the direct writes needs a database migration, which is on the "Ask me first" list, so it waits for Jordan's yes |
| "toString" or "constructor" passed as a kind of role or city | Low | Fixed with a strict check |
| The encryption accepted shortened authentication tags | Low | Fixed: only a full 16-byte tag and a 12-byte nonce are accepted |
| Some resume-derived text is stored as plain text (the file name, "What I'm looking for", a role's reason quoting a few resume words), and the privacy page did not mention PostHog | Low | The privacy page now says exactly what is encrypted and what is not, and names PostHog. Start over deletes the scores and clears past boards |
| Session replay masked text but still recorded link addresses, which name companies and schools | Low | Fixed: the board and the account bar are left out of replays entirely |
| Database errors could put a failing row (a file name, for example) into the server log | Low | Fixed: errors keep only the database's error code |
| The local dev server listened on the whole network, and its folder check could match a sibling folder | Low | Fixed: it listens on this laptop only, checks the folder exactly, and caps request bodies at 4.5 MB |
| The migrations Action ran `supabase/setup-cli@v1`, a tag that could move, with the production database password | Low | Fixed: pinned to the exact commit behind the tag |

## Checks on every pull request

- **Tests** (`.github/workflows/tests.yml`): `npm ci`, `npm test` (169 tests: row level security rules read from the migrations, each route's access rules with a fake Supabase, upload checks, encryption, the secret search, analytics limits) and `npm audit --audit-level=high`.
- **Vercel**: a preview deploy of the pull request, on the dev database.
- **Database migrations** (`.github/workflows/supabase-migrations.yml`): when a pull request changes `supabase/migrations/`, they are applied to the dev database; production gets them only on merge.

## Attack log

Attacks 1, 2, 3, 6, 9, 10 and 11 ran against the real dev database through the site's own functions (`npm run check-hosted`, with throwaway accounts deleted afterwards). Attacks 4, 5, 7, 8 and 12 run in the offline tests with a fake Supabase, on every pull request.

| # | Attack | What happened |
| --- | --- | --- |
| 1 | Signed in as B, asked the database API for A's resume, scores and checks with B's own token | 0 rows each time: row level security filters them out |
| 2 | As B, wrote a score with fit 100 for itself, and patched A's choices | Score write refused (HTTP 403: only the server writes scores); the patch changed 0 rows |
| 3 | Ran a check with no session, called `/api/me` with a made-up token, and read postings while signed out | 401 each time: every route asks Supabase who the token belongs to |
| 4 | Uploaded a text file renamed `resume.pdf`, a 5 MB file, an empty file and a `.exe` | Refused with 415, 413, 400 and 415: the first bytes must match the file type, before any reader runs |
| 5 | A job posting whose link is `javascript:alert(1)` | The link is dropped on the server, and again in the page (only `https://` links are kept); every posting string goes in as text, and the security policy blocks inline scripts |
| 6 | Ran 6 checks in a row, and uploaded twice within 10 seconds | The 6th check and the 2nd upload got 429 |
| 7 | Called the daily fetch without the cron secret, with a wrong secret of the same length, and with a too-short secret | 401 each time |
| 8 | Pasted a secret key into the publishable key setting, and a PostHog personal key into `POSTHOG_KEY` | `/api/config` refuses both and never repeats the key |
| 9 | Tried to delete an account with the wrong confirmation, and with someone else's user id in the body | 400 for the wrong words; with the right words, only the signed-in account is deleted, never an id from the request |
| 10 | Sent 6 checks at the same moment, to slip past the limit before any was counted | None got through (0 ran, 6 refused), since each check's row is written before the count |
| 11 | Tried to reset the limits: deleted my own past checks through the database API, and ran Start over then uploaded again | Deleting checks refused (HTTP 403); the upload right after Start over got 429 |
| 12 | Uploaded a 170 KB Word file that expands to 60 MB and claims to be 1,000 bytes, a 300 KB text file, and saved choices with 50,000 title words | Refused before any reader ran (415 and 413); the damaged choices are refused by the check and repaired by saving again |

## Privacy in analytics

PostHog runs on the hosted site with nobody identified, click capture off, and session replay masking every piece of text and every input, so a replay shows layout and clicks only. Events carry counts and kinds only (for example `check_run` with how many roles were ranked), never resume text, titles, companies, schools or emails. A test reads the allowed properties and fails on anything that looks personal.

## Checked on the live site (November 22, after the merge)

- **Two accounts:** Jordan signed in with a personal Google account, signed out, and signed in with his school account. Each account saw only its own resume, choices and board.
- **On a phone:** sign-in and the workflow worked on a phone.
- **What the live site answers** (from outside, signed out): the API routes refuse anyone not signed in (401), the daily fetch refuses callers without the cron secret (401), and the source files, `.env`, `data/` and the migrations are not served (404). `/api/config` hands out only the production database's public address and publishable key, and the PostHog project key.
- **Security headers** on every page: the content security policy (scripts only from the site and PostHog's loader; the page talks only to itself, the two Supabase projects and PostHog), `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy, a permissions policy, and HSTS from Vercel.
- **Leaked keys:** `npm run check-secrets` after the merge was clean on 122 tracked files, about 32,000 added lines of Git history, and 8 live pages and scripts.
- **The daily fetch** ran on production from Vercel's cron page and filled the shared postings.

## Still to do (Jordan)

- **OpenRouter credit limits:** a hard limit on each key in OpenRouter (Settings, Keys). Needed before AI scoring is switched on for the hosted site.
- **Production backup:** Supabase Pro takes a daily backup and keeps 7 days. Download one from the production project (Database, Backups) and keep it off the repo.
- **Supabase sign-in settings, in both projects:** anonymous sign-ins off, email confirmation on, and the production redirect list holding only `https://jz3270-shortlist.vercel.app/**` (no `*.vercel.app` wildcard).

## Remaining issues

- **Direct writes to your own rows.** A signed-in person can still write to their own preferences, profile, watchlist and decisions straight through Supabase's database API with their own token, which skips the site's checks. They can only touch their own rows, and the check re-validates choices, but they could, for example, delete their profile row to reset the upload limit. Fix ready to build once Jordan approves the migration: revoke those writes, since the site now saves through the server.
- **The dev project's redirect list** allows the team's preview addresses with a wildcard, which a lookalike Vercel team name could match. Dev holds only test data; production allows only its exact address.
- **Deleting and re-creating an account** (a new Google account) starts fresh limits. That is acceptable while checks are free; the AI allowance will also need a site-wide daily cap.
- **Email sign-in** uses Supabase's built-in sender, which only reaches the project's team (about 2 emails an hour). Google is the way in until a custom sender is set up.
- **Workday and SmartRecruiters boards** are not on the hosted site yet (47 of 242 starter companies), because Workday limits how fast one address may ask.
