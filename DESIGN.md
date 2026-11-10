---
name: Shortlist
description: A personal watchlist of job boards, checked at the source and worked like a draft room war board.
colors:
  board: "#e3e5e1"
  board-deep: "#d5d8d3"
  strip: "#fbfbf9"
  lit-white: "#ffffff"
  ink: "#141618"
  ink-2: "#464b51"
  ink-3: "#61666c"
  ink-muted-on-dark: "#c9cdc8"
  rule: "#c5c9c3"
  rule-soft: "#dcdfda"
  strong: "#0f7a4a"
  possible: "#a26100"
  long: "#6b7178"
  stop: "#c8321e"
  stop-tint: "#fbe9e6"
  stop-ink: "#7a1c10"
  new: "#ffd60a"
typography:
  display:
    fontFamily: "Big Shoulders Display, Arial Narrow, sans-serif"
    fontSize: "56px"
    fontWeight: 900
    lineHeight: 0.92
    letterSpacing: "normal"
  wordmark:
    fontFamily: "Big Shoulders Display, Arial Narrow, sans-serif"
    fontSize: "44px"
    fontWeight: 900
    lineHeight: 0.9
    letterSpacing: "0.01em"
  headline:
    fontFamily: "Big Shoulders Display, Arial Narrow, sans-serif"
    fontSize: "34px"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "0.01em"
  title:
    fontFamily: "Big Shoulders Display, Arial Narrow, sans-serif"
    fontSize: "28px"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "normal"
  tier-label:
    fontFamily: "Big Shoulders Display, Arial Narrow, sans-serif"
    fontSize: "17px"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "0.06em"
  score-numeral:
    fontFamily: "Big Shoulders Display, Arial Narrow, sans-serif"
    fontSize: "50px"
    fontWeight: 900
    lineHeight: 0.85
    letterSpacing: "-0.01em"
    fontFeature: "tnum"
  stat-numeral:
    fontFamily: "Big Shoulders Display, Arial Narrow, sans-serif"
    fontSize: "32px"
    fontWeight: 800
    lineHeight: 1
    fontFeature: "tnum"
  action:
    fontFamily: "Big Shoulders Display, Arial Narrow, sans-serif"
    fontSize: "26px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.02em"
  body:
    fontFamily: "Public Sans, Helvetica Neue, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  strip-title:
    fontFamily: "Public Sans, Helvetica Neue, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.3
  label:
    fontFamily: "Public Sans, Helvetica Neue, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.4
  caption:
    fontFamily: "Public Sans, Helvetica Neue, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.4
  tag:
    fontFamily: "Public Sans, Helvetica Neue, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "0.08em"
rounded:
  none: "0px"
spacing:
  xxs: "4px"
  xs: "6px"
  sm: "10px"
  md: "14px"
  lg: "16px"
  xl: "28px"
  gutter: "32px"
  section: "48px"
components:
  button-run:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.strip}"
    typography: "{typography.action}"
    rounded: "{rounded.none}"
    padding: "0 18px"
    height: "58px"
  button-run-busy:
    backgroundColor: "#2e3236"
    textColor: "{colors.strip}"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "8px 12px"
  button-outline-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.strip}"
  segment:
    backgroundColor: "{colors.strip}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "6px 12px"
  segment-hover:
    backgroundColor: "{colors.board}"
  segment-pressed:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.strip}"
  switch-on:
    backgroundColor: "{colors.new}"
    rounded: "{rounded.none}"
    width: "36px"
    height: "20px"
  strip:
    backgroundColor: "{colors.strip}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "14px 16px 14px 14px"
  strip-hover:
    backgroundColor: "{colors.lit-white}"
  score-tile-strong:
    backgroundColor: "{colors.strong}"
    textColor: "{colors.lit-white}"
    typography: "{typography.score-numeral}"
    rounded: "{rounded.none}"
    size: "76px"
  score-tile-possible:
    backgroundColor: "{colors.possible}"
    textColor: "{colors.lit-white}"
    rounded: "{rounded.none}"
    size: "60px"
  score-tile-long:
    backgroundColor: "{colors.long}"
    textColor: "{colors.lit-white}"
    rounded: "{rounded.none}"
    size: "48px"
  new-tag:
    backgroundColor: "{colors.new}"
    textColor: "{colors.ink}"
    typography: "{typography.tag}"
    rounded: "{rounded.none}"
    padding: "1px 6px"
  track-tag:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.none}"
    padding: "0 6px"
  funnel-cell:
    backgroundColor: "{colors.strip}"
    textColor: "{colors.ink}"
    padding: "10px 18px"
  funnel-cell-new:
    backgroundColor: "{colors.new}"
    textColor: "{colors.ink}"
  choice:
    backgroundColor: "{colors.strip}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "10px 12px"
  choice-checked:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.strip}"
  field:
    backgroundColor: "{colors.strip}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "10px 12px"
  token:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.strip}"
    rounded: "{rounded.none}"
    padding: "4px 6px 4px 10px"
  error-panel:
    backgroundColor: "{colors.stop-tint}"
    textColor: "{colors.stop-ink}"
    rounded: "{rounded.none}"
    padding: "14px 16px"
  drop-overlay:
    backgroundColor: "rgba(20, 22, 24, 0.92)"
    textColor: "{colors.strip}"
    typography: "{typography.display}"
---

# Design System: Shortlist

## Overview

**Creative North Star: "The Big Board"**

Shortlist is a draft room war board, not a job site. The page is a cool enamel board. Each role is a paper strip pinned to it in a ranked tier, with a colored magnet tile carrying the fit score. The eye lands on the tile first, then reads the scouting report beside it: why it fits, the gap, the dealbreaker, and who to reach out to.

The density is a working tool's density. Strips share hairlines inside one ruled panel per tier instead of floating as separate cards. Rank decides how much room a role gets: strong fits show the full report at a 76px tile, possible fits tighten to 60px, and long shots fold to a single 48px line until opened. Condensed, heavy display type is reserved for names and numbers; everything you read in sentences is a plain, sturdy grotesque.

The world refuses the category default of a sidebar plus stacked white cards with a rounded match badge. Corners are square, borders are hairlines, and the only lift in the system is the strip you are working on.

**Key Characteristics:**
- Enamel board ground with paper white strips on hairline rules.
- The fit score is a square magnet tile: green, amber or slate, with a red strike for a dealbreaker.
- Safety yellow means New since last check and nothing else.
- Big Shoulders Display for wordmark, board names, tier rules and every numeral; Public Sans for all other text.
- Square corners everywhere. Selection is shown by inverting to ink, never by a tint or a glow.
- Keyboard triage (J, K, O) lifts the focused strip off the board.

## Colors

A quiet, cool neutral board with three score colors, one alarm red, and one reserved yellow.

### Primary
- **Score Green** (strong): the 75 and up tile and its tier swatch. It is the most valuable color on the board, so it only marks strong fits.
- **Scout Amber** (possible): the 50 to 74 tile and tier swatch.
- **Slate Magnet** (long): the under 50, unscored and dealbreaker tile and tier swatch. Also the fallback tile color.

### Secondary
- **Strike Red** (stop): the dealbreaker strike across a tile, "Dealbreaker" and "Could not score" text, and the border of error panels.
- **Strike Tint** (stop-tint) and **Dried Red Ink** (stop-ink): the fill and text of error panels and bad notices.

### Tertiary
- **Safety Yellow** (new): the New tag on a strip, the New since last check cell of the funnel, and the New only switch when it is on.

### Neutral
- **Enamel Board** (board): the page ground, and the hover fill of filter segments.
- **Deep Enamel** (board-deep): the track of the loading bar.
- **Paper Strip** (strip): every strip, panel, field, choice and the resume tile. Also the text color on ink.
- **Lit White** (lit-white): a strip under the pointer, and numerals on score tiles.
- **Board Ink** (ink): body text, primary actions, selected states, the 3px rules under board names and setup questions.
- **Second Ink** (ink-2): supporting text, meta lines, help copy, the gap line in a report.
- **Third Ink** (ink-3): small labels like "Why it fits", "Reach out", counts and the resume tile's dashed border.
- **Muted On Ink** (ink-muted-on-dark): secondary text sitting on an ink fill, such as counts inside a checked choice and the drop overlay's note.
- **Hairline** (rule) and **Soft Hairline** (rule-soft): the hairlines between strips, around panels, under tier names, inside the funnel.

### Named Rules
**The New Means Yellow Rule.** Safety yellow marks New since last check and nothing else. Never use it for warnings, highlights, hover or brand.

**The Score Owns Its Color Rule.** Green, amber and slate appear only as score tiles and the matching tier swatches. Text, links and buttons never borrow them.

**The Ink Inversion Rule.** A selected or pressed control turns to an ink fill with paper text: pressed segments, checked choices, school tokens, finished setup steps. No tinted selected states.

## Typography

**Display Font:** Big Shoulders Display (with Arial Narrow, sans-serif)
**Body Font:** Public Sans (with Helvetica Neue, system-ui, sans-serif)

**Character:** A condensed, heavy scoreboard face for names and numbers, paired with a plain public sector grotesque that stays readable at 12px.

### Hierarchy
- **Display** (900, 56px, 0.92): the setup page title and the drop overlay message. Uppercase. Steps down to 42px and 36px on phones.
- **Wordmark** (900, 44px, 0.9, 0.01em): "Shortlist" in the top band. Uppercase.
- **Headline** (900, 34px, 1, 0.01em): board names, uppercase, sitting on a 3px ink rule with the count beside them in 700 at 26px in Third Ink.
- **Title** (800, 28px, 1.05): setup question headings. "Filtered out" uses the same voice at 22px.
- **Tier Label** (800, 17px, 0.06em): Strong fit, Possible, Long shot. Uppercase, followed by a hairline that runs to the count.
- **Score Numeral** (900, 50px, 0.85, tabular): the number on a strong tile; 40px on possible tiles, 32px on compact ones.
- **Stat Numeral** (800, 32px, 1, tabular): funnel counts. The same face at 18px to 22px carries reason counts, choice counts and the save bar total.
- **Action** (800, 26px, 0.02em): the Check my list button, uppercase. 22px in the setup save bar.
- **Body** (400, 15px, 1.5): reports and notices. Reports cap at 72ch. 14px on phones.
- **Strip Title** (700, 16px, 1.3): the role title on a strip; 14px and single line in a compact row.
- **Label** (600, 13px): buttons, segments, choices, meta lines.
- **Caption** (700, 12px): report labels ("Why it fits", "Gap", "Reach out") in Third Ink, table heads.
- **Tag** (700, 11px, 0.08em): the New tag. Uppercase.

### Named Rules
**The Numbers Are Display Rule.** Every count and score is set in Big Shoulders with tabular figures. Public Sans never carries a headline number.

**The Sentence Case Body Rule.** Uppercase belongs to the display face. Public Sans goes uppercase only at 11px and under, for the New tag and the fit unit on a tile; all other Public Sans copy stays in sentence case.

## Layout

The page is a centered column up to 1480px wide with 32px side padding (16px on phones). The top band is a three column grid: wordmark and mode, the resume tile (260px to 340px), and the 260px run box. Below it, one full width funnel strip of five cells, then the filter bar, then two boards side by side with a 28px gutter.

Each board is a column of tiers. A tier is a label row and one ruled panel of strips. Inside a strip, the tile sits in a fixed left column (76px, 60px or 48px by rank) with a 16px gap to the body. Report rows use a 92px label column; Reach out uses 104px.

Spacing runs on a tight 4, 6, 10, 14, 16 rhythm inside components, with 18px between tiers, 28px between boards and 48px between the setup steps rail and the form.

Responsive behavior: under 1180px the wordmark takes its own row. Under 980px the boards stack into one column and the setup steps become a wrapped row; the keyboard hint hides. Under 680px the funnel becomes three columns with the New cell spanning two, tiles shrink to 58px and 50px, report labels stack above their text, and the save bar button goes full width.

The setup screen is a 240px sticky numbered rail beside a form capped at 760px, with each question opened by a 3px ink rule. A fixed save bar with the same 3px rule sits at the bottom.

## Elevation & Depth

The board is flat. Depth comes from the ground and strip contrast and from hairlines, not shadows. There is one resting shadow, the magnet tile's contact shadow, which makes a tile read as an object on paper. Everything else lifts only in response to the user.

### Shadow Vocabulary
- **Magnet contact** (`box-shadow: 0 1px 2px rgba(20, 22, 24, 0.25)`): every score tile, always.
- **Lift** (`box-shadow: 0 1px 0 rgba(20, 22, 24, 0.06), 0 10px 24px -8px rgba(20, 22, 24, 0.28)`): the focused strip (with a 2px rise and an ink outline), the hovered Check my list button (1px rise), the hovered solid button, and a new strip as it drops onto the board.

### Named Rules
**The Lift Is Focus Rule.** Only the strip you are working on leaves the board. Never give strips, panels or tiers a shadow at rest.

## Shapes

Every corner is square (0px). Borders are 1px hairlines in Hairline or Soft Hairline, stepping up to 1px ink for controls and 3px ink for the rules under board names, setup questions and the save bar. Drop targets use a dashed border: 1px Third Ink on the resume tile, 1.5px on the setup drop zone, 2px paper on the overlay. The funnel cells are joined by small rotated square notches that point the count forward. A dealbreaker is drawn as a 5px red bar rotated -12 degrees across the tile.

## Components

### Buttons
Hard edged and literal: ink outline at rest, ink fill on hover.
- **Shape:** square (0px).
- **Check my list:** full ink block, 58px tall, Action type with a 18px refresh icon. Hover rises 1px with Lift. While a check runs it turns to #2e3236 with a spinning icon and a progress cursor.
- **Outline:** 1px ink border, transparent fill, Label type (Upload or Replace on the resume tile, Open posting on a strip, Choose file in setup). Hover inverts to ink.
- **Solid:** ink fill with paper text; hover adds Lift.
- **Focus:** a 2px ink outline offset 2px, everywhere.

### Filter segments and switch
- **Segments:** a row of buttons inside a 1px ink frame on paper, divided by hairlines. Hover fills with Enamel Board; pressed inverts to ink. A count follows each option at 70 percent opacity.
- **Switch:** a square 36 by 20px track with a square 14px ink knob. On, the track fills with Safety Yellow, because the only switch filters to New.
- **Keys:** small keycaps with a 2px bottom border spell out J, K and O.

### Funnel rail
Five cells across one paper strip: companies checked, roles found, passed filters, scored, and new. Each shows a Stat Numeral beside its label, joined by notches. The New cell is filled Safety Yellow.

### Tiered boards and strips
- **Board head:** Headline name and count on a 3px ink rule, with a one line description below.
- **Tier head:** a 12px square swatch in the tier color, Tier Label, the score range in caption type, a hairline, and the count.
- **Strip:** paper, 14px padding, Soft Hairline between neighbors inside one bordered panel. Hover brightens to Lit White. Keyboard focus lifts it 2px with Lift and a 1px ink outline.
- **Body:** Strip Title with an outline Open button at right, a meta line (New tag, company in ink, location, age, a hairline bordered track tag), then the report and Reach out links. Reach out links are underlined in Hairline and turn ink on hover, each with an 11px external icon.

### Score tile (signature)
A square magnet: 76px for strong, 60px for possible, 48px in a compact row (58px and 50px on phones). The numeral sits over a small uppercase "fit" unit (hidden in compact rows, "unscored" when scoring failed). A dealbreaker tile is slate with a red strike.

### Compact long shot rows
A long shot folds to one line: 48px tile, single line title with an ellipsis, a small meta line and a chevron. Opening it shows the full report and Open button indented to the text column; the chevron turns 180 degrees.

### Filtered out and errors
- **Filtered out:** a paper panel with a closed summary (title, how many never reached scoring, chevron). Open, it shows reason chips with display numeral counts and a ruled table of dropped roles with an ink head rule.
- **Errors and bad notices:** Strike Tint fill, 1px Strike Red border, Dried Red Ink headings.
- **Notice:** paper with a 1px ink border.
- **Loading:** a 3px bar with an ink segment sliding across Deep Enamel.

### Drop overlay
A full screen ink veil at 92 percent with a 2px dashed paper frame and the message in Display type. Fades in over 160ms.

### Setup choices and save bar
- **Steps rail:** numbered 30px square counters in display type; finished steps invert to ink.
- **Choices:** a grid of paper tiles (min 230px) with a 1px hairline, a 16px square check box and an optional display numeral count. Hover turns the border ink; checked inverts the whole tile to ink.
- **Fields and school tokens:** paper fields with a hairline that turns ink on focus. Schools are ink tokens with a remove button.
- **Save bar:** fixed to the bottom with a 3px ink top rule, a summary with a display numeral, and the Check my list button at 50px.

### Motion
Transitions run 140ms to 180ms on cubic-bezier(0.16, 1, 0.3, 1). After a check, strips settle up 6px; new strips drop in from above with a brief Lift. All of this is skipped when the user prefers reduced motion.

## Do's and Don'ts

### Do:
- **Do** let the score tile be the first thing on every strip, at 76px for strong fits, 60px for possible, 48px for long shots.
- **Do** keep strips of a tier inside one ruled panel, separated by Soft Hairline (#dcdfda).
- **Do** show selection by inverting to ink with paper text.
- **Do** set every number in Big Shoulders Display with tabular figures.
- **Do** keep text on any colored fill at 4.5:1 or better; the current tiles all clear it with white numerals.
- **Do** honor reduced motion by dropping the settle, drop in, spin and slide animations.

### Don't:
- **Don't** use Safety Yellow (#ffd60a) for anything except New since last check.
- **Don't** round a corner. The radius is 0px everywhere.
- **Don't** put a card inside a strip or float strips as separate cards with gaps and shadows.
- **Don't** shadow anything at rest except the score tile's contact shadow.
- **Don't** use the score colors for text, links or buttons.
- **Don't** use em dashes or en dashes in UI copy.
