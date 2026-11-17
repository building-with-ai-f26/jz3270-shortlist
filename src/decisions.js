// Decisions are what the user does with a role: saved it, applied, or not for me (with a reason).
// They are the data the accuracy check and the learning model will learn from, so each one keeps a
// snapshot of the role as Shortlist showed it. The snapshot comes from the app's own saved results,
// never from the page, and everything stays in data/.
import fs from "node:fs";
import path from "node:path";
import { paths, readJson } from "./pipeline.js";
import { matchesAny } from "./filter.js";
import { rankSignals } from "./setup.js";

export const DECISIONS = ["saved", "applied", "passed"];
export const PASS_REASONS = {
  function: "Wrong function",
  senior: "Too senior",
  location: "Wrong location",
  company: "Not interested in the company",
  other: "Something else"
};
// A rule is suggested once this many roles passed on for the same reason share a title word.
const SUGGEST_AT = 3;
// Words that say nothing about the job, so they are never suggested as a rule.
const STOP_WORDS = new Set(("and the for of with in at to an on or by us usa new york remote global team based " +
  "hybrid ii iii iv full time part year years").split(" "));

const file = (demo) => path.join(paths(demo).dataDir, "decisions.json");
export function readDecisions(demo = false) {
  return readJson(file(demo), { decisions: {}, dismissedRules: [] });
}

// Finds a role in the latest check or the latest explore results.
function findRole(id, demo) {
  const p = paths(demo);
  const latest = readJson(p.latest, { results: [], summary: {} });
  const hit = (latest.results || []).find((r) => r.id === id);
  if (hit) return { role: hit, from: "board", method: latest.summary?.method || null };
  const explored = demo ? null : readJson(p.explore, null);
  const found = explored && [...(explored.results || []), ...(explored.more || [])].find((r) => r.id === id);
  return found ? { role: found, from: "explore", method: explored.summary?.method || null } : null;
}

// What the learning model will need later, as Shortlist showed it at the moment of the decision.
function snapshot({ role, from, method }) {
  return {
    title: role.title, company: role.company, location: role.location || "", ats: role.id.split(":")[0],
    fit: role.fit ?? null, method, dealbreaker: Boolean(role.dealbreaker), track: role.track || null,
    cohort: role.cohort || null, ageDays: role.ageDays ?? null, from
  };
}

// decision is "saved", "applied", "passed" (with a reason from PASS_REASONS) or "clear" to undo.
export function decide(id, decision, reason, { demo = false, now = Date.now() } = {}) {
  if (typeof id !== "string" || !id) throw new Error("Pick a role first.");
  const store = readDecisions(demo);
  if (decision === "clear") {
    delete store.decisions[id];
  } else {
    if (!DECISIONS.includes(decision)) throw new Error(`Unknown decision: ${decision}`);
    if (decision === "passed" && !(reason in PASS_REASONS)) throw new Error("Pick why it is not for you.");
    const found = findRole(id, demo);
    if (!found) throw new Error("That role is not in your latest check or explore results.");
    store.decisions[id] = {
      decision, reason: decision === "passed" ? reason : null,
      at: new Date(now).toISOString(), role: snapshot(found)
    };
  }
  fs.mkdirSync(paths(demo).dataDir, { recursive: true });
  fs.writeFileSync(file(demo), JSON.stringify(store, null, 2) + "\n");
  return store.decisions[id] || null;
}

// Adds each role's decision to a list for the page.
export function withDecisions(list = [], demo = false) {
  const { decisions } = readDecisions(demo);
  return list.map((r) => (decisions[r.id] ? { ...r, decision: decisions[r.id].decision, reason: decisions[r.id].reason } : r));
}

const titleWords = (title = "") => [...new Set(title.split(/[^A-Za-z&+]+/).filter((w) => w.length >= 2 && !STOP_WORDS.has(w.toLowerCase())))];

// A title word shared by several roles passed on as "wrong function" or "too senior" becomes a suggested rule,
// unless it is already a rule, it is one of the words that let roles in, it names a chosen kind of role,
// it appears in a role the user saved or applied to, or the user dismissed it.
export function ruleSuggestions(prefs = {}, demo = false) {
  const { decisions, dismissedRules } = readDecisions(demo);
  const all = Object.values(decisions);
  const keep = new Set(all.filter((d) => d.decision !== "passed").flatMap((d) => titleWords(d.role.title).map((w) => w.toLowerCase())));
  const protectedWords = [...(prefs.titleInclude || []), ...rankSignals(prefs)];
  const counts = new Map();
  for (const d of all.filter((x) => x.decision === "passed" && ["function", "senior"].includes(x.reason))) {
    for (const w of titleWords(d.role.title)) {
      const k = w.toLowerCase();
      const entry = counts.get(k) || { word: w, count: 0, reasons: new Set() };
      entry.count++;
      entry.reasons.add(d.reason);
      counts.set(k, entry);
    }
  }
  return [...counts.entries()]
    .filter(([k, e]) => e.count >= SUGGEST_AT && !keep.has(k)
      && !matchesAny(e.word, prefs.titleExclude || []) && !matchesAny(e.word, protectedWords)
      && !(dismissedRules || []).includes(k))
    .map(([, e]) => ({ word: e.word, count: e.count, reason: e.reasons.has("senior") ? "senior" : "function" }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
}

// Adds a suggested word to the title rules, or dismisses it. Only a word on the current list is accepted.
export function applyRule(word, action) {
  const p = paths(false);
  const prefs = readJson(p.preferences, {});
  const match = ruleSuggestions(prefs).find((s) => s.word.toLowerCase() === String(word || "").toLowerCase());
  if (!match) throw new Error("That rule is not one of your current suggestions.");
  if (action === "add") {
    prefs.titleExclude = [...(prefs.titleExclude || []), match.word];
    fs.writeFileSync(p.preferences, JSON.stringify(prefs, null, 2) + "\n");
  } else if (action === "dismiss") {
    const store = readDecisions(false);
    store.dismissedRules = [...new Set([...(store.dismissedRules || []), match.word.toLowerCase()])];
    fs.writeFileSync(file(false), JSON.stringify(store, null, 2) + "\n");
  } else {
    throw new Error("Choose add or dismiss.");
  }
  return { word: match.word, action, titleExclude: prefs.titleExclude || [] };
}
