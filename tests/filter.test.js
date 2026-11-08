// Deterministic checks for the free filter. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTrack, prefilter } from "../src/filter.js";

const prefs = {
  tracks: ["Full-time", "Program", "Internship", "Fellowship", "Pre-doc"],
  locations: ["New York", "NJ", "Los Angeles", "Remote"],
  titleInclude: ["Associate", "Analyst", "Intern", "Fellow", "Program", "Research"],
  titleExclude: ["Director", "Engineer", "Vice President"],
  maxAgeDays: 45
};
const now = Date.parse("2026-11-07T12:00:00Z");
const daysAgo = (n) => new Date(now - n * 86400000).toISOString();
const posting = (over = {}) => ({ id: "x", company: "Co", title: "Strategy Associate", location: "New York, NY", postedAt: daysAgo(3), text: "", ...over });

test("classifies tracks from the title first", () => {
  assert.equal(classifyTrack("Strategic Sourcing Intern, Summer 2027 (MBA)"), "Internship");
  assert.equal(classifyTrack("Summer Analyst, Real Estate (2027)"), "Internship");
  assert.equal(classifyTrack("Urban Analytics Fellow (2027 Cohort)"), "Fellowship");
  assert.equal(classifyTrack("Pre-Doctoral Research Fellow, Urban Economics"), "Pre-doc");
  assert.equal(classifyTrack("Rotational Leadership Program, MBA 2027"), "Program");
  assert.equal(classifyTrack("Real Estate Acquisitions Associate"), "Full-time");
});

test("a full-time title stays full-time even if the description mentions interns", () => {
  assert.equal(classifyTrack("Operations Associate", "You will manage two interns each summer."), "Full-time");
});

test("keeps a posting that clears every rule", () => {
  const r = prefilter(posting(), prefs, now);
  assert.equal(r.keep, true);
  assert.equal(r.posting.ageDays, 3);
});

test("drops excluded titles and says why", () => {
  const r = prefilter(posting({ title: "Director of Interconnection" }), prefs, now);
  assert.equal(r.keep, false);
  assert.match(r.reason, /Director/);
});

test("drops locations outside the list", () => {
  const r = prefilter(posting({ location: "Austin, TX" }), prefs, now);
  assert.equal(r.keep, false);
  assert.equal(r.reason, "Location: Austin, TX");
});

test("known gap: a suburb missing from the list is dropped (Torrance is in LA County)", () => {
  const r = prefilter(posting({ title: "Sourcing Intern", location: "Torrance, CA" }), prefs, now);
  assert.equal(r.keep, false, "documents current behavior; fix by matching metro areas, not city names");
});

test("drops stale postings", () => {
  const r = prefilter(posting({ postedAt: daysAgo(60) }), prefs, now);
  assert.equal(r.keep, false);
  assert.equal(r.reason, "Posted 60 days ago");
});

test("keeps a posting with no date rather than guessing", () => {
  assert.equal(prefilter(posting({ postedAt: null }), prefs, now).keep, true);
});

test("matches whole words, so Intern no longer matches International", () => {
  const r = prefilter(posting({ title: "Applied AI Architect, International Policy" }), { ...prefs, titleInclude: ["Intern"] }, now);
  assert.equal(r.keep, false);
  assert.equal(r.reason, "No target keyword in title");
});

test("plurals and -ship still count as the same word", () => {
  const p = { ...prefs, titleInclude: ["Intern", "Fellow"] };
  assert.equal(prefilter(posting({ title: "Strategic Sourcing Internship" }), p, now).keep, true);
  assert.equal(prefilter(posting({ title: "Urban Analytics Fellowship" }), p, now).keep, true);
});

test("an exclusion followed by a comma still excludes, but not inside a longer word", () => {
  const p = { ...prefs, titleExclude: ["Lead ", "VP,"] };
  assert.match(prefilter(posting({ title: "Brand Strategy Lead, Naming" }), p, now).reason, /Title has "Lead"/);
  assert.equal(prefilter(posting({ title: "Rotational Leadership Program" }), p, now).keep, true);
  assert.equal(prefilter(posting({ title: "VP, Sales Strategy" }), p, now).keep, false);
});

test("short location codes no longer match inside other words", () => {
  const p = { ...prefs, locations: ["NY"] };
  assert.equal(prefilter(posting({ location: "Munich, Germany" }), p, now).keep, false);
  assert.equal(prefilter(posting({ location: "Sunnyvale, CA" }), p, now).keep, false);
  assert.equal(prefilter(posting({ location: "New York, NY" }), p, now).keep, true);
});

import { classifyCohort } from "../src/filter.js";

test("sorts roles into the 2027 grad column or the open-now column", () => {
  assert.equal(classifyCohort("Rotational Leadership Program, MBA 2027"), "2027 grad");
  assert.equal(classifyCohort("Business Analyst, New Grad"), "2027 grad");
  assert.equal(classifyCohort("Strategy Associate", "This role will start in summer 2027."), "2027 grad");
  assert.equal(classifyCohort("Strategy & Ops Associate", "Open to MBA candidates graduating in 2027."), "2027 grad");
  assert.equal(classifyCohort("Associate, Data Center Development", "2-4 years in real estate development."), "Open now");
});

test("a passing mention of graduates does not move an experienced role", () => {
  assert.equal(classifyCohort("Director of Strategy", "Mentor recent graduates on our team."), "Open now");
  assert.equal(classifyCohort("Operations Lead", "We train new graduates every year."), "Open now");
});
