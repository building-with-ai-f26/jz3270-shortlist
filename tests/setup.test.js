import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildPreferences, readSetup, saveSetup, lookingForText, withLookingFor, ROLE_FAMILIES, CITIES } from "../src/setup.js";
import { prefilter } from "../src/filter.js";
import { status, ensurePersonalFiles } from "../src/pipeline.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "shortlist-setup-"));
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

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

test("the looking-for section is read and replaced without touching the resume", () => {
  const profile = "# Profile\n\n## Resume\n\nSQL, Python\n\n## What I'm looking for\n\nOld wish.\n";
  assert.equal(lookingForText(profile), "Old wish.");
  const next = withLookingFor(profile, "Product roles in Chicago.");
  assert.match(next, /SQL, Python/);
  assert.equal(lookingForText(next), "Product roles in Chicago.");
  assert.doesNotMatch(next, /Old wish/);
  assert.equal(lookingForText(withLookingFor("", "Anything")), "Anything");
});

test("a fresh install needs setup and shows an empty form, not the sample's choices", () => {
  const dir = tmp();
  process.env.SHORTLIST_DATA_DIR = dir;
  try {
    ensurePersonalFiles();
    assert.equal(status(false).needsSetup, true);
    assert.equal(status(true).needsSetup, false);
    const s = readSetup(dir);
    assert.equal(s.sampleResume, true);
    assert.deepEqual([s.roles, s.cities, s.schools, s.lookingFor], [[], [], [], ""]);
    assert.equal(s.options.roles.length, Object.keys(ROLE_FAMILIES).length);

    saveSetup({ roles: ["product"], cities: ["chicago"], schools: ["Booth"], lookingFor: "Product roles in Chicago." }, dir);
    assert.equal(status(false).needsSetup, false);
    // Saving the form does not make the fictional resume theirs. Only an upload does.
    assert.equal(readSetup(dir).sampleResume, true);
    const prefs = readJson(path.join(dir, "preferences.json"));
    assert.deepEqual(prefs.locations, ["Chicago"]);
    assert.deepEqual(prefs.networkSchools, ["Booth"]);
    const again = readSetup(dir);
    assert.deepEqual([again.roles, again.cities, again.schools, again.lookingFor],
      [["product"], ["chicago"], ["Booth"], "Product roles in Chicago."]);
  } finally {
    delete process.env.SHORTLIST_DATA_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("someone who already ran checks before setup existed is not sent through it, and sees their choices", () => {
  const dir = tmp();
  process.env.SHORTLIST_DATA_DIR = dir;
  try {
    fs.writeFileSync(path.join(dir, "preferences.json"), JSON.stringify({
      locations: ["New York", "NY", "Remote"], workdaySearch: ["MBA", "real estate"], networkSchools: ["NYU Stern"],
      titleInclude: ["MBA", "Rotational", "Leadership", "Program"]
    }));
    fs.writeFileSync(path.join(dir, "profile.md"), "## Resume\n\nMine\n\n## What I'm looking for\n\nNYC real estate.\n");
    fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ seen: {}, runs: [{}] }));
    assert.equal(status(false).needsSetup, false);
    const s = readSetup(dir);
    assert.deepEqual([s.roles, s.cities, s.schools, s.lookingFor],
      [["realEstate", "programs"], ["newYork", "remote"], ["NYU Stern"], "NYC real estate."]);
  } finally {
    delete process.env.SHORTLIST_DATA_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("saving setup leaves the profile alone unless looking-for changed, so saved scores still apply", () => {
  const dir = tmp();
  const profilePath = path.join(dir, "profile.md");
  fs.writeFileSync(profilePath, "## Resume\n\nMine\n\n## What I'm looking for\n\nSame.\n");
  const before = fs.statSync(profilePath).mtimeMs;
  const original = fs.readFileSync(profilePath, "utf8");
  saveSetup({ roles: ["finance"], lookingFor: "Same." }, dir);
  saveSetup({ roles: ["finance"], lookingFor: "   " }, dir);
  assert.equal(fs.readFileSync(profilePath, "utf8"), original);
  assert.equal(fs.statSync(profilePath).mtimeMs, before);
  assert.throws(() => saveSetup({ lookingFor: "x".repeat(2001) }, dir), /under 2000 characters/);
  assert.throws(() => saveSetup({ roles: ["astronaut"] }, dir), /Unknown role type/);
  fs.rmSync(dir, { recursive: true, force: true });
});
