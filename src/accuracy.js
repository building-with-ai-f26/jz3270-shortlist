// The accuracy check asks one question of the user's decisions: does the AI fit score rank the roles
// they saved or applied to above the roles they passed on? This is the riskiest assumption in the PRD,
// tested with the user's own judgment. It reads data/decisions.json and calls no model, so it is free.

// A decision counts as a yes when the user saved or applied, and a no when they passed.
const YES = new Set(["saved", "applied"]);
// Passing because of the company or the location says nothing about how well the job fits the resume,
// so the fairer cut only counts passes about the job itself.
const JOB_REASONS = new Set(["function", "senior", "other"]);
const BANDS = [[0, 50, "Under 50"], [50, 60, "50 to 59"], [60, 70, "60 to 69"], [70, 101, "70 and up"]];
// Below this many of each, the numbers are shown but the verdict says there is not enough data yet.
const MIN_EACH = 5;

// AUC: pick one yes and one no at random; how often does the yes have the higher fit? Ties count half.
// 0.5 is a coin flip, 1.0 means every yes outscored every no.
export function auc(yes, no) {
  if (!yes.length || !no.length) return null;
  let wins = 0;
  for (const a of yes) for (const b of no) wins += a > b ? 1 : a === b ? 0.5 : 0;
  return wins / (yes.length * no.length);
}

// How much to trust the AUC at this sample size: resample the decisions 2,000 times and keep the middle 90%.
// A fixed seed means the same decisions always give the same range.
export function aucRange(rows, rounds = 2000) {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const values = [];
  for (let i = 0; i < rounds; i++) {
    const sample = rows.map(() => rows[Math.floor(rand() * rows.length)]);
    const v = auc(sample.filter((r) => r.yes).map((r) => r.fit), sample.filter((r) => !r.yes).map((r) => r.fit));
    if (v !== null) values.push(v);
  }
  if (values.length < rounds / 2) return null;
  values.sort((a, b) => a - b);
  return [values[Math.floor(values.length * 0.05)], values[Math.floor(values.length * 0.95)]];
}

const round = (x, places = 2) => (x === null || x === undefined ? null : Math.round(x * 10 ** places) / 10 ** places);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function measure(rows) {
  const yes = rows.filter((r) => r.yes);
  const no = rows.filter((r) => !r.yes);
  const score = auc(yes.map((r) => r.fit), no.map((r) => r.fit));
  // The top k by fit, against the overall yes rate. k is 10 once there are 20 decisions, less before.
  const k = Math.min(10, Math.max(1, Math.floor(rows.length / 2)));
  const top = [...rows].sort((a, b) => b.fit - a.fit).slice(0, k);
  return {
    decisions: rows.length,
    yes: yes.length,
    no: no.length,
    auc: round(score),
    aucRange: score === null ? null : aucRange(rows)?.map((x) => round(x)),
    avgFitYes: round(mean(yes.map((r) => r.fit)), 1),
    avgFitNo: round(mean(no.map((r) => r.fit)), 1),
    topK: { k, yes: top.filter((r) => r.yes).length },
    yesRate: rows.length ? round(yes.length / rows.length) : null,
    bands: BANDS.map(([lo, hi, label]) => {
      const inBand = rows.filter((r) => r.fit >= lo && r.fit < hi);
      return { label, decisions: inBand.length, yes: inBand.filter((r) => r.yes).length };
    }),
    enough: yes.length >= MIN_EACH && no.length >= MIN_EACH
  };
}

// A plain sentence for the page and the terminal.
function verdict(m) {
  if (!m.enough) return `Not enough decisions yet: this needs at least ${MIN_EACH} saves or applications and ${MIN_EACH} passes.`;
  const sure = m.aucRange && m.aucRange[0] > 0.5;
  const strength = m.auc >= 0.7 ? "separates your saves from your passes well" : m.auc >= 0.6 ? "somewhat separates your saves from your passes" : "barely separates your saves from your passes, close to a coin flip";
  return `The AI fit ${strength}.${sure ? "" : " With this many decisions, a coin flip cannot be ruled out yet."}`;
}

// decisions: the object stored in data/decisions.json under "decisions".
// Only roles scored by the AI count, since keyword scores rank roles against each other and mean something else.
// rescore, when given, turns a decision's role snapshot into "your score" (the AI fit plus the user's dials),
// so the report can show whether the dials rank the user's choices better than the AI fit alone.
export function accuracyReport(decisions = {}, rescore = null) {
  const scored = Object.values(decisions).filter((d) => d.role?.method === "ai" && typeof d.role.fit === "number");
  const rows = scored.map((d) => ({ fit: d.role.fit, yes: YES.has(d.decision), reason: d.reason }));
  const all = measure(rows);
  const jobOnly = measure(rows.filter((r) => r.yes || JOB_REASONS.has(r.reason)));
  const fits = rows.map((r) => r.fit);
  const range = fits.length ? [Math.min(...fits), Math.max(...fits)] : null;
  // The test is only fair if decisions cover low scores as well as high ones.
  const narrow = range && (range[0] >= 50 || range[1] - range[0] < 25);
  let yours = null;
  if (rescore) {
    const rows2 = scored.map((d) => ({ fit: rescore(d.role), yes: YES.has(d.decision), reason: d.reason })).filter((r) => typeof r.fit === "number");
    // Only worth showing when the dials actually move at least one score.
    if (rows2.some((r, i) => r.fit !== rows[i]?.fit)) yours = { ...measure(rows2), verdict: verdict(measure(rows2)) };
  }
  return {
    yours,
    all: { ...all, verdict: verdict(all) },
    jobOnly: { ...jobOnly, verdict: verdict(jobOnly) },
    fitRange: range,
    coverage: narrow ? `All your decisions are on roles scored ${range[0]} to ${range[1]}. Mark some long shots (under 50) too, so the test covers the whole range.` : null,
    keywordDecisionsLeftOut: Object.values(decisions).length - scored.length
  };
}
