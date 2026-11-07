// Checks scoring without spending money: the OpenRouter call is replaced with a fake response.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScore, scoreWithAI, scoreAll } from "../src/score.js";

const posting = { id: "a", company: "Co", title: "Strategy Associate", location: "New York, NY", track: "Full-time", ageDays: 2, text: "MBA 2027. Supply chain strategy." };

test("parses JSON even when the model wraps it in prose or code fences", () => {
  const s = parseScore("Here you go:\n```json\n{\"fit\": 82.4, \"track\": \"Program\", \"why\": \"Sourcing experience\", \"gap\": \"None\", \"dealbreaker\": null}\n```");
  assert.equal(s.fit, 82);
  assert.equal(s.track, "Program");
  assert.equal(s.gap, null);
  assert.equal(s.dealbreaker, null);
});

test("clamps out-of-range scores and ignores unknown tracks", () => {
  const s = parseScore("{\"fit\": 140, \"track\": \"Gig\", \"why\": \"x\"}");
  assert.equal(s.fit, 100);
  assert.equal(s.track, null);
});

test("rejects a response with no JSON", () => {
  assert.throws(() => parseScore("I can't score this."), /No JSON/);
});

test("reads token counts and dollar cost from OpenRouter's usage field", async () => {
  let sentBody = null;
  const fakeFetch = async (url, opts) => {
    sentBody = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "{\"fit\": 77, \"track\": \"Full-time\", \"why\": \"Ran procurement across 60 vendors\", \"gap\": \"No SQL\", \"dealbreaker\": null}" } }],
        usage: { prompt_tokens: 1200, completion_tokens: 80, cost: 0.00016 }
      })
    };
  };
  const s = await scoreWithAI("profile text", posting, { fetchImpl: fakeFetch, model: "test/model", apiKey: "k" });
  assert.equal(s.fit, 77);
  assert.equal(s.usage.tokensIn, 1200);
  assert.equal(s.usage.costUsd, 0.00016);
  assert.equal(sentBody.model, "test/model");
  assert.equal(sentBody.temperature, 0);
});

test("an API error on one posting is recorded, not fatal", async () => {
  const failing = async () => ({ ok: false, status: 402, json: async () => ({ error: { message: "Insufficient credits" } }) });
  const { scored } = await scoreAll("profile", [posting], { useAI: true, fetchImpl: failing, apiKey: "k", model: "m" });
  assert.equal(scored[0].fit, null);
  assert.match(scored[0].error, /Insufficient credits/);
});

test("the cap limits how many postings get a paid call", async () => {
  let calls = 0;
  const counting = async () => {
    calls++;
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "{\"fit\": 50, \"why\": \"x\"}" } }], usage: {} }) };
  };
  const many = Array.from({ length: 10 }, (_, i) => ({ ...posting, id: String(i), ageDays: i }));
  const { scored, skipped } = await scoreAll("profile", many, { useAI: true, maxToScore: 4, fetchImpl: counting, apiKey: "k", model: "m" });
  assert.equal(calls, 4);
  assert.equal(scored.length, 4);
  assert.equal(skipped, 6);
  assert.deepEqual(scored.map((s) => s.ageDays), [0, 1, 2, 3], "freshest postings are scored first");
});

const reply = (content, finish, usage = { prompt_tokens: 1000, completion_tokens: 600, cost: 0.0004 }) => ({
  ok: true, status: 200, json: async () => ({ choices: [{ message: { content }, finish_reason: finish }], usage })
});

test("retries with a bigger budget when the first reply is empty (model spent it all thinking)", async () => {
  const budgets = [];
  const fake = async (url, opts) => {
    budgets.push(JSON.parse(opts.body).max_tokens);
    return budgets.length === 1 ? reply("", "length") : reply("{\"fit\": 71, \"why\": \"Rotations match ops background\"}", "stop");
  };
  const s = await scoreWithAI("profile", posting, { fetchImpl: fake, model: "m", apiKey: "k" });
  assert.deepEqual(budgets, [1200, 3000]);
  assert.equal(s.fit, 71);
  assert.equal(s.usage.tokensOut, 1200, "usage from both calls is counted");
  assert.ok(Math.abs(s.usage.costUsd - 0.0008) < 1e-12);
});

test("retries when the reply was cut off mid-JSON", async () => {
  let calls = 0;
  const fake = async () => (++calls === 1 ? reply("{\"fit\": 6", "length") : reply("{\"fit\": 64, \"why\": \"x\"}", "stop"));
  const s = await scoreWithAI("profile", posting, { fetchImpl: fake, model: "m", apiKey: "k" });
  assert.equal(calls, 2);
  assert.equal(s.fit, 64);
});

test("does not retry a good first reply", async () => {
  let calls = 0;
  const fake = async () => { calls++; return reply("{\"fit\": 80, \"why\": \"x\"}", "stop"); };
  await scoreWithAI("profile", posting, { fetchImpl: fake, model: "m", apiKey: "k" });
  assert.equal(calls, 1);
});

test("if both tries come back empty, the error says why and the cost still counts", async () => {
  const fake = async () => reply("", "length");
  const { scored, totals } = await scoreAll("profile", [posting], { useAI: true, fetchImpl: fake, apiKey: "k", model: "m" });
  assert.match(scored[0].error, /Empty model response \(stopped: length\)/);
  assert.ok(totals.costUsd > 0, "failed calls are not free, so they show up in the run cost");
});

test("handles content sent as a list of parts", async () => {
  const fake = async () => reply([{ type: "text", text: "{\"fit\": 55, " }, { type: "text", text: "\"why\": \"x\"}" }], "stop");
  const s = await scoreWithAI("profile", posting, { fetchImpl: fake, model: "m", apiKey: "k" });
  assert.equal(s.fit, 55);
});
