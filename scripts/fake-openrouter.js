// A stand-in for OpenRouter, for `npm run check-hosted` and `npm run dev-site`, so trying the hosted AI scoring on
// this laptop never spends anything. It answers every request to openrouter.ai itself, with a made-up fit and a
// made-up cost, and never passes one on to the network. Everything else (Supabase, job boards) goes through.
// The prompt carries a resume, so nothing here prints it.
export const FAKE_KEY = "fake-openrouter-key";
export const FAKE_COST = 0.0007;
// Each answer waits a moment, as a real one would (a real one takes about 4 seconds), so the progress on the cover
// screen has something to show.
const FAKE_WAIT_MS = 100;

// The same title always gets the same made-up fit, from 30 to 90.
function fitFor(title) {
  let h = 0;
  for (const ch of title) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 30 + (h % 61);
}

// Swaps the OpenRouter key for a fake one and wraps fetch. Returns a counter of the AI calls it answered.
export function useFakeOpenRouter() {
  process.env.OPENROUTER_API_KEY = FAKE_KEY;
  delete process.env.OPENROUTER_MODEL;
  const realFetch = globalThis.fetch;
  const stats = { calls: 0, picks: 0 };
  globalThis.fetch = async (input, opts = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "openrouter.ai" && !url.hostname.endsWith(".openrouter.ai")) return realFetch(input, opts);
    stats.calls++;
    const prompt = JSON.parse(opts.body || "{}").messages?.[1]?.content || "";
    // "Find roles for me" (src/cloud/picks.js) asks for picks; one key here is not on the list, so the check that
    // unknown keys are dropped runs on the real database too.
    if (prompt.includes("KINDS OF ROLE")) {
      stats.picks++;
      const content = JSON.stringify({ roles: ["product", "strategy", "notAKind"], cities: ["newYork"], why: "A made-up pick from the fake OpenRouter, for testing." });
      return Response.json({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 1600, completion_tokens: 60, cost: FAKE_COST } });
    }
    await new Promise((r) => setTimeout(r, FAKE_WAIT_MS));
    const title = (prompt.match(/^Title: (.*)$/m) || [])[1] || "";
    const content = JSON.stringify({ fit: fitFor(title), track: "Full-time", why: "A made-up fit from the fake OpenRouter, for testing.", gap: "None", dealbreaker: null, new_grad: false });
    return Response.json({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 900, completion_tokens: 120, cost: FAKE_COST } });
  };
  return stats;
}
