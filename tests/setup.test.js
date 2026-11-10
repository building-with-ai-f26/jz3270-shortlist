import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPreferences, ROLE_FAMILIES, CITIES } from "../src/setup.js";
import { prefilter } from "../src/filter.js";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const posting = (title, location) => ({ title, location, text: "", postedAt: "2026-11-05T00:00:00Z" });

test("chosen roles add their title words and searches to the 2027 basics", () => {
  const p = buildPreferences({ roles: ["product"], cities: ["chicago"] });
  assert.ok(p.titleInclude.includes("MBA"));
  assert.ok(p.titleInclude.includes("Product Manager"));
  assert.ok(!p.titleInclude.includes("Real Estate"));
  assert.ok(p.workdaySearch.includes("product manager"));
  assert.ok(!p.workdaySearch.includes("real estate"));
  assert.deepEqual(p.locations, ["Chicago"]);
});

test("the filter keeps and drops what the choices say", () => {
  const p = buildPreferences({ roles: ["supplyChain"], cities: ["newYork", "remote"] });
  assert.equal(prefilter(posting("Supply Chain Manager", "New York, NY"), p, NOW).keep, true);
  assert.equal(prefilter(posting("Procurement Manager", "Remote, US"), p, NOW).keep, true);
  assert.equal(prefilter(posting("Supply Chain Manager", "Chicago, IL"), p, NOW).reason, "Location: Chicago, IL");
  assert.equal(prefilter(posting("Brand Manager", "New York, NY"), p, NOW).reason, "No target keyword in title");
});

test("no cities means no location filter, and no roles still keeps MBA and 2027 roles", () => {
  const p = buildPreferences({});
  assert.deepEqual(p.locations, []);
  assert.equal(prefilter(posting("MBA Associate", "Tokyo, Japan"), p, NOW).keep, true);
  assert.deepEqual(p.setup, { roles: [], cities: [] });
});

test("schools are trimmed, blanks and repeats dropped", () => {
  const p = buildPreferences({ schools: ["  Wharton ", "", "Wharton", "Booth"] });
  assert.deepEqual(p.networkSchools, ["Wharton", "Booth"]);
});

test("settings setup does not ask about are kept, and unknown choices are refused", () => {
  const p = buildPreferences({ roles: ["finance"] }, { maxToScore: 10, maxAgeDays: 30, titleInclude: ["Old"] });
  assert.equal(p.maxToScore, 10);
  assert.equal(p.maxAgeDays, 30);
  assert.ok(!p.titleInclude.includes("Old"));
  assert.equal(buildPreferences({}).maxToScore, 40);
  assert.throws(() => buildPreferences({ roles: ["astronaut"] }), /Unknown role type: astronaut/);
  assert.throws(() => buildPreferences({ cities: ["toronto"] }), /Unknown city: toronto/);
});

test("every role and city has a label and something to match", () => {
  for (const r of Object.values(ROLE_FAMILIES)) assert.ok(r.label && r.titles.length && r.searches.length);
  for (const c of Object.values(CITIES)) assert.ok(c.label && c.locations.length);
});
