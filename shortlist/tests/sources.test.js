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
