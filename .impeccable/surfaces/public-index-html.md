---
version: 1
slug: "public-index-html"
primary_target: "public/index.html"
related_targets: []
---

# Surface brief: Shortlist app (public/index.html)

Scope: the whole local app page. Main board plus a static first-run setup mock reachable at `/#setup` (to be wired to `/api/setup` by a later session).
Mode: Operate. Laptop first, a few times a week; the phone is a glance.
Task: press Check my list, triage what is new, open strong postings, use Reach out links. Catch over-strict filters in Filtered out.
Constraints: one plain HTML file, no build step, Google Fonts allowed, every posting string through esc(), no em or en dashes in copy, demo mode must work.
Avoid (from Jordan): generic SaaS dashboard, job board clutter, a buried score.

## Direction contract

THESIS: The watchlist is a ranked board you work, like a draft room war board: magnetic strips in tiers, a scouting report on each. It refuses the category default of a sidebar plus stacked white cards with a match badge.

OWN-WORLD: Cool enamel board ground (#e3e5e1), paper white strips (#fbfbf9) on hairline rules, ink #141618. The fit score is a colored magnet tile: green 75+, amber 50 to 74, slate under 50, red strike for a dealbreaker. Safety yellow (#ffd60a) means New since last check and nothing else. Big Shoulders Display for numerals, tier rules and headings; Public Sans for everything else. Square corners, hairlines, no cards in cards.

STORY: The student sees at once how many roles passed, what is new, and which few are strong. Rank buys space: strong fits show why, gap and Reach out; long shots fold to one line. They open postings and people links, and check the cut list when something seems missing.

FIRST VIEWPORT: Top band: wordmark and mode at left, resume tile and the black Check my list button at right, last checked and cost under it. One funnel strip across the width. Filter bar. Then two boards side by side, each headed by its name and count, split by tier rules; the first strong strip of each board visible above the fold with its score tile at 64px.

FORM: The Big Board, position 3 of my grounded list (draft war board). Seed key 2b5f1ed0. Raises: yellow reserved for New (wayfinding); rank decides apparatus (lexicon); J/K/O keyboard triage with a lifted focused strip (feed); hairline density instead of cards (density portal). Signature interaction: keyboard triage, the focused strip lifts off the board.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
