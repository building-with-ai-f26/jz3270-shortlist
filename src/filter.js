// The filter is the free, rule-based first pass. It runs before any AI call, so every posting
// it drops is a posting I don't pay to score. Every drop keeps its reason, so the user can see
// what was cut and catch a rule that is too strict.

const TRACK_RULES = [
  { track: "Pre-doc", pattern: /pre-?doc|predoctoral|pre-doctoral|research (assistant|associate|professional)/i },
  { track: "Fellowship", pattern: /\bfellow(ship)?\b/i },
  { track: "Internship", pattern: /\bintern(ship)?\b|summer (associate|analyst)|co-op\b/i },
  { track: "Program", pattern: /rotation(al)?|leadership (development )?program|early career|new grad|\bmba\b.*program|program.*\bmba\b|associate program/i }
];

// The title decides the track first, because a description can mention "interns" for a full-time role.
export function classifyTrack(title, text = "") {
  for (const rule of TRACK_RULES) {
    if (rule.pattern.test(title)) return rule.track;
  }
  const head = text.slice(0, 600);
  for (const rule of TRACK_RULES) {
    if (rule.track !== "Internship" && rule.pattern.test(head)) return rule.track;
  }
  return "Full-time";
}

// The cohort splits results into two columns: roles built for people graduating around 2027
// ("2027 grad") and every other open full-time role ("Open now").
// The title is checked first; the description adds phrases that rarely appear in experienced-hire postings.
export const COHORTS = { grad: "2027 grad", open: "Open now" };
const GRAD_TITLE = /\b(new|recent|university|college|campus)[\s-]+grad(uate)?s?\b|\bnew[\s-]grad\b|\bearly[\s-]career\b|\bentry[\s-]level\b|\bclass of 202[67]\b|\b2027\b|\bmba\b|\brotation(al)?\b|leadership (development )?program|\b(associate|graduate) program\b/i;
const GRAD_TEXT = /class of 2027|graduating (in |by )?(may |june |spring |summer )?2027|2027 grad(uate)?s?\b|graduat(e|es|ing) in (may |june |spring |summer )?2027|(start|starting|begin|beginning)( date)?( in)?( the)? (summer|fall|june|july|august|september) (of )?2027|\bnew grad\b(?!uate)|(for|open to|designed for|targeted at|aimed at) (new|recent|upcoming) (college |university )?grad(uate)?s?\b|campus hire|early[- ]career program|(mba|master'?s) (candidates|students|graduates) (graduating|expected)|expected graduation (date )?(in |of |between |by )?[^.]{0,30}2027/i;

export function classifyCohort(title, text = "") {
  return GRAD_TITLE.test(title || "") || GRAD_TEXT.test(text || "") ? COHORTS.grad : COHORTS.open;
}

// I match whole words, not pieces of words. A plain "contains" check let "Intern" match
// "International" and "NY" match "Germany". Plurals and "-ship" still count, so "Intern"
// matches "Internship" and "Fellow" matches "Fellowship".
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patternCache = new Map();

function wordPattern(word) {
  if (!patternCache.has(word)) {
    const core = word.trim().replace(/[\s,.;:]+$/, "");
    patternCache.set(word, core ? new RegExp(`(^|[^a-z0-9])${escapeRegex(core)}(s|es|ship|ships)?(?![a-z0-9])`, "i") : null);
  }
  return patternCache.get(word);
}

export function matchesAny(value, words) {
  const text = value || "";
  return words.find((w) => wordPattern(w)?.test(text)) || null;
}

function daysSince(iso, now) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((now - t) / 86400000);
}

export function prefilter(posting, prefs, now = Date.now()) {
  const track = classifyTrack(posting.title, posting.text);
  const cohort = classifyCohort(posting.title, posting.text);
  const ageDays = daysSince(posting.postedAt, now);
  const base = { ...posting, track, cohort, ageDays };

  const excluded = matchesAny(posting.title, prefs.titleExclude || []);
  if (excluded) return { keep: false, posting: base, reason: `Title has "${excluded.trim().replace(/[,.;:]+$/, "")}"` };

  if ((prefs.tracks || []).length && !prefs.tracks.includes(track)) {
    return { keep: false, posting: base, reason: `Track is ${track}` };
  }

  const locations = prefs.locations || [];
  if (locations.length && posting.location) {
    const hit = matchesAny(posting.location, locations);
    if (!hit) return { keep: false, posting: base, reason: `Location: ${posting.location}` };
  }

  if (prefs.maxAgeDays && ageDays !== null && ageDays > prefs.maxAgeDays) {
    return { keep: false, posting: base, reason: `Posted ${ageDays} days ago` };
  }

  const included = prefs.titleInclude || [];
  if (included.length && !matchesAny(posting.title, included)) {
    return { keep: false, posting: base, reason: "No target keyword in title" };
  }

  return { keep: true, posting: base, reason: null };
}

export function runFilter(postings, prefs, now = Date.now()) {
  const kept = [];
  const dropped = [];
  for (const p of postings) {
    const r = prefilter(p, prefs, now);
    if (r.keep) kept.push(r.posting);
    else dropped.push({ ...r.posting, reason: r.reason, text: undefined });
  }
  return { kept, dropped };
}
