# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

MBA students recruiting off-cycle for full-time roles and programs (2027 and new grad, rotational programs, full-time roles open now). Built first by Jordan at NYU Stern; next it has to work for any classmate, at any school, who clones the repo and runs it.

The main moment is on a laptop, a few times a week: sit down, press "Check my list", triage what is new since the last check, open the strongest postings, and use the "Reach out" links to find people. The phone is a glance, not the main workspace.

## Product Purpose

Shortlist checks the public job boards (Greenhouse, Lever, Ashby, Workday, SmartRecruiters) of the companies on a personal watchlist, drops roles that fail the user's rules with a reason for every drop, scores the rest against the user's resume with a model, and shows two ranked columns with what is new. Success is a student spending their few minutes on the five roles worth applying to, not scrolling hundreds.

## Positioning

It is the student's own watchlist, checked directly at the source, ranked against their own resume, with the reasoning shown. Not a job board: no feed of everyone's jobs, no ads, no promoted listings. Each role carries a fit score, why it fits, the gap, any dealbreaker, and LinkedIn search links for people to contact.

## Operating Context

- Runs locally (`npm start`, http://localhost:3000). Stays a local app through Week 4 of the course.
- `npm run demo` shows fictional postings with keyword scoring and no API calls.
- First run will get a setup screen: resume, target roles, cities, schools, "What I'm looking for", OpenRouter key or keyword-only mode.
- A check can take minutes on a big watchlist; scores are cached so each check only pays for unseen roles.

## Capabilities and Constraints

- One plain HTML/CSS/JS front end file, no build step, no new npm packages. Google Fonts allowed.
- Every string from a job board is untrusted and escaped before it reaches the page.
- Cost stays visible: per-run token and dollar totals.
- Every filter drop keeps its reason; the "Filtered out" list is how users catch a rule that is too strict.
- "Reach out" is LinkedIn search links only. Never fetch, guess or store anyone's name or profile.
- Resume uploads are read in memory; contact details are stripped before saving or scoring.

## Brand Commitments

- Name: Shortlist. The earlier NYU violet is not a commitment; the product is now for students at any school.
- Voice: plain language, short paragraphs, no em dashes or en dashes in UI copy or docs.

## Evidence on Hand

- `fixtures/sample-postings.json`: fictional postings used by demo mode and tests.
- `fixtures/resume-sample.pdf`, `.docx`: a fictional resume (Sam Rivera).
- No testimonials, user counts or outcomes exist yet. Do not invent them.

## Product Principles

1. The fit score is the first thing the eye lands on. Nothing may bury it.
2. Show the reasoning: why it fits, the gap, the dealbreaker, the drop reason. Trust comes from visible rules.
3. New since last check is the unit of work. Triage first, browse second.
4. Feel like a personal tool, not a job board and not a generic SaaS dashboard.
5. Cost and limits are always visible, never hidden.
