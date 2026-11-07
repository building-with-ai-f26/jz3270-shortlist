// Checks that each ATS format turns into the same posting shape, using the saved fixtures.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalize, htmlToText, fetchBoard } from "../src/sources.js";

const fixtures = JSON.parse(fs.readFileSync(new URL("../fixtures/sample-postings.json", import.meta.url), "utf8"));
const board = (ats) => fixtures.boards.find((b) => b.ats === ats);

test("Greenhouse's double-encoded HTML becomes plain text", () => {
  assert.equal(htmlToText("&lt;p&gt;Build &amp;amp; ship&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Excel&lt;/li&gt;&lt;/ul&gt;"), "Build & ship\n- Excel");
});

for (const ats of ["greenhouse", "lever", "ashby"]) {
  test(`${ats} postings normalize to the common shape`, () => {
    const b = board(ats);
    const out = normalize(ats, b.response, { company: b.company, ats, board: b.board });
    assert.ok(out.length > 0);
    for (const p of out) {
      assert.match(p.id, new RegExp(`^${ats}:${b.board}:`));
      assert.equal(p.company, b.company);
      assert.ok(p.title.length > 0, "title");
      assert.ok(p.url.startsWith("https://"), "url");
      assert.ok(p.text.length > 0, "text");
      assert.ok(!/<[a-z]/i.test(p.text), "no HTML left in text");
    }
  });
}

test("Ashby remote roles are labeled once, not twice", () => {
  const b = fixtures.boards.find((x) => x.board === "riverbend");
  const out = normalize("ashby", b.response, { company: b.company, ats: "ashby", board: b.board });
  const remote = out.find((p) => p.title.startsWith("Pre-Doctoral"));
  assert.equal(remote.location, "Remote - US");
});

test("a wrong board slug returns a readable error instead of crashing the run", async () => {
  const fake404 = async () => ({ ok: false, status: 404, json: async () => ({}) });
  const r = await fetchBoard({ company: "Typo Inc", ats: "greenhouse", board: "typo" }, fake404);
  assert.equal(r.postings.length, 0);
  assert.match(r.error, /not found/);
});

test("a network failure on one board is contained", async () => {
  const boom = async () => { throw new Error("ECONNRESET"); };
  const r = await fetchBoard({ company: "Co", ats: "lever", board: "co" }, boom);
  assert.match(r.error, /ECONNRESET/);
});

import { fetchAll, fillDetails } from "../src/sources.js";

test("Greenhouse boards are listed without descriptions to keep big lists light", async () => {
  let asked = "";
  const fake = async (url) => { asked = url; return { ok: true, status: 200, json: async () => ({ jobs: [] }) }; };
  await fetchBoard({ company: "Co", ats: "greenhouse", board: "co" }, fake);
  assert.equal(asked, "https://boards-api.greenhouse.io/v1/boards/co/jobs");
});

test("descriptions are fetched only for Greenhouse postings that lack one", async () => {
  const asked = [];
  const fake = async (url) => {
    asked.push(url);
    if (url.endsWith("/jobs/42")) return { ok: true, status: 200, json: async () => ({ content: "&lt;p&gt;Own sourcing strategy&lt;/p&gt;" }) };
    return { ok: false, status: 500, json: async () => ({}) };
  };
  const out = await fillDetails([
    { id: "greenhouse:co:42", source: "greenhouse", text: "" },
    { id: "greenhouse:co:43", source: "greenhouse", text: "" },
    { id: "lever:co:a1", source: "lever", text: "Already has text" }
  ], fake);
  assert.equal(out[0].text, "Own sourcing strategy");
  assert.equal(out[1].text, "", "a failed detail call keeps the posting instead of dropping it");
  assert.equal(out[2].text, "Already has text");
  assert.equal(asked.length, 2, "Lever postings are not re-fetched");
});

test("checks at most 8 boards at once", async () => {
  let inFlight = 0;
  let peak = 0;
  const fake = async () => {
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return { ok: true, status: 200, json: async () => ({ jobs: [] }) };
  };
  const list = Array.from({ length: 30 }, (_, i) => ({ company: `Co${i}`, ats: "greenhouse", board: `co${i}` }));
  const results = await fetchAll(list, fake);
  assert.equal(results.length, 30);
  assert.ok(peak <= 8, `peak was ${peak}`);
});

test("a board that never answers is reported as a timeout, not a crash", async () => {
  const slow = async () => { const e = new Error("aborted"); e.name = "TimeoutError"; throw e; };
  const r = await fetchBoard({ company: "Slow Co", ats: "lever", board: "slow" }, slow);
  assert.match(r.error, /no answer after 20 seconds/);
});
