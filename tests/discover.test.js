// Board discovery, tested with fake job board answers so nothing goes over the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { slugVariants, parseCompanyLine, discoverCompany, discoverAll } from "../src/discover.js";

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

// A fake internet: only the boards listed here exist. Ashby answers "200, no jobs" for any name,
// which is exactly the false positive discovery must not accept.
function fakeBoards(boards) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    for (const b of boards) {
      if (b.ats === "greenhouse" && url === `https://boards-api.greenhouse.io/v1/boards/${b.board}`) return json({ name: b.name });
      if (b.ats === "greenhouse" && url === `https://boards-api.greenhouse.io/v1/boards/${b.board}/jobs`) return json({ jobs: b.jobs });
      if (b.ats === "lever" && url.startsWith(`https://api.lever.co/v0/postings/${b.board}?`)) return json(b.jobs);
    }
    if (url.startsWith("https://api.ashbyhq.com/")) return json({ jobs: [] });
    return json({ error: "not found" }, 404);
  };
  return { fetchImpl, calls };
}

test("guesses board names from a company name, full name first", () => {
  assert.deepEqual(slugVariants("Anduril Industries").slice(0, 3), ["andurilindustries", "anduril", "anduril-industries"]);
  assert.ok(slugVariants("DoorDash").includes("doordashusa"));
  assert.ok(slugVariants("Placer.ai").includes("placerai"));
  assert.equal(slugVariants("Scale AI")[0], "scaleai");
});

test("reads plain names, manual board entries, and ignores comments", () => {
  assert.deepEqual(parseCompanyLine("  Stripe "), { name: "Stripe" });
  assert.deepEqual(parseCompanyLine("Commonwealth Fusion Systems | greenhouse:cfsenergy"), { name: "Commonwealth Fusion Systems", ats: "greenhouse", board: "cfsenergy" });
  assert.equal(parseCompanyLine("# AI labs"), null);
  assert.equal(parseCompanyLine(""), null);
});

test("finds a Greenhouse board under a less obvious name", async () => {
  const { fetchImpl } = fakeBoards([{ ats: "greenhouse", board: "doordashusa", name: "DoorDash USA", jobs: [{ title: "Strategy Associate" }] }]);
  const hit = await discoverCompany("DoorDash", fetchImpl);
  assert.equal(hit.ats, "greenhouse");
  assert.equal(hit.board, "doordashusa");
  assert.equal(hit.boardName, "DoorDash USA");
});

test("finds a Lever board", async () => {
  const { fetchImpl } = fakeBoards([{ ats: "lever", board: "palantir", jobs: [{ text: "Deployment Strategist" }] }]);
  const hit = await discoverCompany("Palantir", fetchImpl);
  assert.deepEqual([hit.ats, hit.board, hit.sample], ["lever", "palantir", "Deployment Strategist"]);
});

test("does not accept a board that answers with zero jobs", async () => {
  const { fetchImpl } = fakeBoards([]);
  assert.equal(await discoverCompany("Nonexistent Robotics", fetchImpl), null);
});

test("adds new companies, skips ones already listed, keeps manual entries, and reports misses", async () => {
  const { fetchImpl } = fakeBoards([{ ats: "greenhouse", board: "stripe", name: "Stripe", jobs: [{ title: "Strategy & Ops" }] }]);
  const existing = [{ company: "Anthropic", ats: "greenhouse", board: "anthropic" }];
  const lines = ["Anthropic", "Stripe", "Nonexistent Robotics", "Commonwealth Fusion Systems | greenhouse:cfsenergy", "# comment"];
  const r = await discoverAll(lines, existing, { fetchImpl });
  assert.equal(r.skipped, 1);
  assert.deepEqual(r.notFound, ["Nonexistent Robotics"]);
  assert.deepEqual(r.watchlist.map((w) => w.board).sort(), ["anthropic", "cfsenergy", "stripe"]);
});
