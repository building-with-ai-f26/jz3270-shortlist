import { test } from "node:test";
import assert from "node:assert/strict";
import { peopleLinks, peopleCompanyName, schoolLabel, teamFor, searchUrl } from "../src/people.js";

test("company names drop my watchlist suffixes", () => {
  assert.equal(peopleCompanyName("Adobe University"), "Adobe");
  assert.equal(peopleCompanyName("Blackstone Campus"), "Blackstone");
  assert.equal(peopleCompanyName("Prologis"), "Prologis");
});

test("school labels stay short", () => {
  assert.equal(schoolLabel("Columbia University"), "Columbia");
  assert.equal(schoolLabel("University of Michigan"), "Michigan");
  assert.equal(schoolLabel("NYU Stern"), "NYU Stern");
});

test("teamFor maps titles to a team to search", () => {
  assert.equal(teamFor("MBA Associate, Supply Chain Strategy"), "supply chain");
  assert.equal(teamFor("Acquisitions Associate"), "real estate");
  assert.equal(teamFor("Software Engineer"), null);
});

test("search links are LinkedIn people searches and nothing else", () => {
  const url = new URL(searchUrl("NYU Stern Prologis"));
  assert.equal(url.origin + url.pathname, "https://www.linkedin.com/search/results/people/");
  assert.equal(url.searchParams.get("keywords"), "NYU Stern Prologis");
  assert.equal(new URL(searchUrl("Prologis", ["S"])).searchParams.get("network"), '["S"]');
});

test("each role gets 4 or 5 links built from my schools", () => {
  const grad = peopleLinks({ company: "Northwind Robotics", title: "MBA Associate, Supply Chain (Class of 2027)", cohort: "2027 grad" },
    { networkSchools: ["NYU Stern", "Columbia University"] });
  assert.deepEqual(grad.map((l) => l.label),
    ["NYU Stern alumni", "Columbia alumni", "2nd-degree connections", "University recruiters", "Supply chain team"]);
  assert.match(grad[1].url, /Columbia\+University\+Northwind/);

  const open = peopleLinks({ company: "Acme", title: "Analyst", cohort: "Open now" }, {});
  assert.deepEqual(open.map((l) => l.label), ["NYU Stern alumni", "2nd-degree connections", "Recruiters", "MBAs there"]);
  assert.deepEqual(peopleLinks({ company: "" }, {}), []);
});
