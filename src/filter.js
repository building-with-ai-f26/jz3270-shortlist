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

function matchesAny(value, words) {
  const lower = (value || "").toLowerCase();
  return words.find((w) => lower.includes(w.toLowerCase())) || null;
}

function daysSince(iso, now) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((now - t) / 86400000);
}

export function prefilter(posting, prefs, now = Date.now()) {
  const track = classifyTrack(posting.title, posting.text);
  const ageDays = daysSince(posting.postedAt, now);
  const base = { ...posting, track, ageDays };

  const excluded = matchesAny(posting.title, prefs.titleExclude || []);
  if (excluded) return { keep: false, posting: base, reason: `Title has "${excluded}"` };

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
