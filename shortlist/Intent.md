# Intent.md: Optional PRD Draft (Build 1)

Use this as a scratchpad if helpful. Publish the required PRD and Build 1 log on `docs/index.html`; this file is not a separate hand-in.

**Build 1 due:** Monday, Nov 9, 2026 at noon, New York time  
**Builder:** Jordan Zhu

---

## 1. Who is it for?
*Name a specific person or role you have direct access to (not a broad demographic). Who will actually test and use this before Demo Day?*

- **Target user:** Me, as a Stern MBA Class of 2027 student recruiting for full-time roles, rotational programs, real estate roles and a pre-doc at once. Then three to five classmates running the same multi-track search.
- **How I will reach them to test it:** My pod, the Family Business Club, and classmates in my recruiting circles, in class and over Slack.

## 2. What job does it do?
*Describe the concrete recurring problem from work, school, or life, and what "done" looks like for the user.*

- **Current painful workflow (before):** Since August I have applied to or prepared applications for roughly 25 companies. Every week I open 12twenty, LinkedIn and each career page one by one, and read every description to see if it wants an MBA, a 2027 start, or years of experience I do not have. Programs with short windows can open and close between two checks.
- **New workflow with this product (after):** One click checks every board on my watchlist, filters out roles that fail my rules, scores the rest against my resume, and shows a ranked list with a reason, a gap, any dealbreaker, and a "new" flag.
- **Why this is useful** *(used weekly / saves real time / worth paying for)*: I would run it several times a week through the end of recruiting, and it replaces the part of the search that is pure reading and ruling out.

## 3. What is in and out of scope?

- **One core workflow:** Check my list (fetch, filter, score, rank, flag new).
*You have six weeks. List the features, integrations, and polish you are deliberately NOT building.*

- [x] Not building: auto-applying or writing cover letters
- [x] Not building: LinkedIn, Handshake or 12twenty (login-only)
- [x] Not building: custom career sites and Workday portals

## 4. Rough Local Prototype
*What did you spike this week to test the core idea, and what did you learn from throwing it at the problem?*

- **Local run command / branch / screenshot:** `npm run demo` (sample data) or `npm start` (live). Screenshot in `docs/assets/build1-prototype.png`.
- **What worked vs. what surprised me:** The fetch, filter and ranking loop works end to end, and the "Filtered out" list makes every rule visible. The surprise was how badly keyword scoring ranks roles: it put a thin analyst posting at 88 and the best-fit fellowship at 36, which makes the AI scorer the real product.
