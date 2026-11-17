// Your score = the AI fit (how well a role matches the resume and "What I'm looking for"), adjusted by the
// user's own dials. The dials cost nothing: they never ask the model again, they only add or take away points.
// This file has no imports, so the server, the page (as /yourscore.js) and the static demo share the same math.

// "A little" is worth 5 points and "a lot" 10. All adjustments together stay within plus or minus 25,
// so the AI fit stays the backbone of the score.
export const POINTS = { 1: 5, 2: 10 };
export const CAP = 25;
const DREAM = 10;
const AVOID = -15;
// Titles above the level most post-MBA hires join at. "Manager" is left out on purpose: many MBA roles use it.
const SENIOR = /\b(senior|sr|lead|principal|staff|director|head of|vice president|vp)\b/i;
// Workday and SmartRecruiters are mostly used by large employers; startups mostly use Greenhouse, Lever or Ashby.
// It is an approximation, and the page says so.
const LARGE_ATS = new Set(["workday", "smartrecruiters"]);

export const EMPTY_WEIGHTS = { roles: {}, size: 0, topCity: 0, seniority: 0, programs: 0, freshness: 0, dream: [], avoid: [] };

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasWord = (text, phrase) => new RegExp(`(^|[^a-z0-9])${escapeRegex(phrase.trim())}(s|es)?(?![a-z0-9])`, "i").test(text || "");
const simple = (s) => String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

// role: { fit, title, company, location, cohort, ageDays, id or ats }.
// context: { families: [{ key, label, signals }], topCity: { label, words } }, built by the server from setup.
// Returns { score, parts }: score is null when the role has no fit, and parts explain every point.
export function yourScore(role, weights = EMPTY_WEIGHTS, context = {}) {
  const w = { ...EMPTY_WEIGHTS, ...weights };
  const parts = [];

  const family = (context.families || [])
    .map((f) => ({ f, level: w.roles?.[f.key] || 0 }))
    .filter(({ f, level }) => level > 0 && f.signals.some((s) => hasWord(role.title, s)))
    .sort((a, b) => b.level - a.level)[0];
  if (family) parts.push({ label: `${family.f.label} role`, points: POINTS[family.level] });

  const ats = role.ats || String(role.id || "").split(":")[0];
  const large = LARGE_ATS.has(ats);
  if (w.size > 0 && !large) parts.push({ label: "Startup or growth company (approx.)", points: POINTS[w.size] });
  if (w.size < 0 && large) parts.push({ label: "Large company (approx.)", points: POINTS[-w.size] });

  if (w.topCity > 0 && context.topCity && context.topCity.words.some((c) => hasWord(role.location, c))) {
    parts.push({ label: `In ${context.topCity.label}`, points: POINTS[w.topCity] });
  }
  if (w.seniority > 0 && SENIOR.test(role.title || "")) parts.push({ label: "Senior title", points: -POINTS[w.seniority] });
  if (w.programs > 0 && role.cohort === "2027 grad") parts.push({ label: "2027 or new grad role", points: POINTS[w.programs] });
  if (w.freshness > 0 && typeof role.ageDays === "number" && role.ageDays <= 7) {
    parts.push({ label: role.ageDays <= 3 ? "Posted in the last 3 days" : "Posted this week", points: role.ageDays <= 3 ? POINTS[w.freshness] : Math.round(POINTS[w.freshness] / 2) });
  }
  const company = simple(role.company);
  if (company && (w.dream || []).some((d) => simple(d) && company.includes(simple(d)))) parts.push({ label: "Dream company", points: DREAM });
  if (company && (w.avoid || []).some((d) => simple(d) && company.includes(simple(d)))) parts.push({ label: "Company to avoid", points: AVOID });

  if (role.fit === null || role.fit === undefined) return { score: null, parts };
  const raw = parts.reduce((sum, p) => sum + p.points, 0);
  const adjust = Math.max(-CAP, Math.min(CAP, raw));
  return { score: Math.max(0, Math.min(100, role.fit + adjust)), parts, capped: adjust !== raw };
}
