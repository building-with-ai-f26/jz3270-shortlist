// Scoring turns "passed the filter" into "worth my time". With an OpenRouter key, a model reads
// the full posting against the profile. Without one, I fall back to keyword overlap so the app
// still runs (useful for demos and for checking the pipeline without spending anything).

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const DEFAULT_MODEL = "anthropic/claude-haiku-5.5";
const TRACKS = ["Full-time", "Program", "Internship", "Fellowship", "Pre-doc"];

// ---------- AI scoring ----------

const SYSTEM_PROMPT = `You screen job postings for one candidate.
Be strict and honest. A high score means the candidate clears the posting's stated bar (degree, years of experience, graduation timing, location) AND the work matches what they have actually done.
Do not reward keyword overlap alone. Reply with a single JSON object and nothing else.`;

export function buildPrompt(profile, posting) {
  const text = (posting.text || "").slice(0, 3500);
  return `CANDIDATE PROFILE
${profile}

POSTING
Company: ${posting.company}
Title: ${posting.title}
Location: ${posting.location || "Not listed"}
Track (rule-based guess): ${posting.track}
Description:
${text}

Return JSON with exactly these keys:
{
  "fit": integer 0-100,
  "track": one of ${JSON.stringify(TRACKS)},
  "why": one sentence naming the strongest specific match between the profile and this role,
  "gap": one sentence naming the biggest gap, or "None",
  "dealbreaker": short phrase if the candidate clearly fails a hard requirement (for example "Undergraduates only" or "Requires 5+ years in REPE"), otherwise null
}`;
}

// Models sometimes wrap JSON in prose or code fences, so I pull out the first {...} block.
export function parseScore(content) {
  if (!content) throw new Error("Empty model response");
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in model response");
  const raw = JSON.parse(content.slice(start, end + 1));

  const fit = Math.max(0, Math.min(100, Math.round(Number(raw.fit))));
  if (Number.isNaN(fit)) throw new Error("Model returned a non-numeric fit");
  return {
    fit,
    track: TRACKS.includes(raw.track) ? raw.track : null,
    why: String(raw.why || "").trim(),
    gap: raw.gap && String(raw.gap).trim() !== "None" ? String(raw.gap).trim() : null,
    dealbreaker: raw.dealbreaker ? String(raw.dealbreaker).trim() : null
  };
}

// OpenRouter usually returns content as a string, but some providers send a list of parts.
function extractContent(message) {
  const c = message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((part) => (typeof part === "string" ? part : part?.text || "")).join("");
  return "";
}

async function callOpenRouter(messages, maxTokens, { fetchImpl, model, apiKey }) {
  const res = await fetchImpl(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "Shortlist (NYU Stern Building with AI)"
    },
    body: JSON.stringify({ model, temperature: 0, max_tokens: maxTokens, messages })
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || `HTTP ${res.status}`;
    throw new Error(`OpenRouter: ${msg}`);
  }
  const choice = json.choices?.[0] || {};
  const usage = json.usage || {};
  return {
    content: extractContent(choice.message),
    finishReason: choice.finish_reason || choice.native_finish_reason || null,
    usage: {
      tokensIn: usage.prompt_tokens || 0,
      tokensOut: usage.completion_tokens || 0,
      // OpenRouter reports the dollar cost of each call in usage.cost.
      costUsd: typeof usage.cost === "number" ? usage.cost : 0
    }
  };
}

// Newer models can "think" before answering, and that thinking counts against max_tokens.
// If the first reply comes back empty or cut off, I retry once with a bigger budget.
// Output tokens cost very little, so the larger budget only matters on the rare retry.
export const TOKEN_BUDGETS = [1200, 3000];

export async function scoreWithAI(profile, posting, { fetchImpl = fetch, model, apiKey } = {}) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildPrompt(profile, posting) }
  ];
  const usage = { tokensIn: 0, tokensOut: 0, costUsd: 0 };
  let last = null;

  for (const budget of TOKEN_BUDGETS) {
    last = await callOpenRouter(messages, budget, { fetchImpl, model, apiKey });
    usage.tokensIn += last.usage.tokensIn;
    usage.tokensOut += last.usage.tokensOut;
    usage.costUsd += last.usage.costUsd;
    if (last.content.trim() && last.finishReason !== "length") break;
  }

  try {
    if (!last.content.trim()) throw new Error(`Empty model response (stopped: ${last.finishReason || "unknown"})`);
    return { ...parseScore(last.content), usage };
  } catch (err) {
    // I keep the usage on the error so failed calls still count toward the run's cost.
    err.usage = usage;
    throw err;
  }
}

// ---------- Keyword fallback ----------

const STOPWORDS = new Set(("about above after again also among an and any are as at be been being both but by can could " +
  "did does doing during each else ever every for from further had has have having here how into its itself just " +
  "more most must next once only other our ours over own same should some such than that their them then there these " +
  "they this those through under until upon very was were what when where which while who whom why will with within " +
  "would your yours you role team work working years year experience strong ability skills including across using help " +
  "join company candidate candidates position responsibilities requirements qualifications preferred required plus new " +
  "will well looking build building support make making based other within like etc per the may class open real pro " +
  "locations models able want seeking ideal day days week weeks month months").split(" "));

function terms(text) {
  return (text || "").toLowerCase().match(/[a-z][a-z+#&.-]{2,}/g)?.map((t) => t.replace(/[.-]+$/, "")).filter((t) => t.length >= 3 && !STOPWORDS.has(t)) || [];
}

const HARD_BARS = [
  { pattern: /\b(undergraduates?|bachelor'?s? students?) only\b|current(ly)? (enrolled )?undergraduates?\b|rising (junior|senior)s?/i, label: "Undergraduate role" },
  { pattern: /\bph\.?d\.? (is )?required\b|completed ph\.?d/i, label: "PhD required" },
  { pattern: /\b([5-9]|1\d)\+? years\b/i, label: "Asks for 5+ years" }
];

export function scoreWithKeywords(profile, posting, idf) {
  const profileTerms = new Set(terms(profile));
  const postingTerms = [...new Set(terms(`${posting.title} ${posting.title} ${posting.text}`))];

  // I weight rare words (high idf) more, so "underwriting" counts for more than "operations".
  const overlap = postingTerms.filter((t) => profileTerms.has(t));
  const gained = overlap.reduce((s, t) => s + (idf.get(t) || 1), 0);
  const possible = postingTerms.map((t) => idf.get(t) || 1).sort((a, b) => b - a).slice(0, 40).reduce((s, v) => s + v, 0) || 1;
  let fit = Math.round(Math.min(1, (gained / possible) * 2.2) * 100);

  const bar = HARD_BARS.find((b) => b.pattern.test(posting.text || ""));
  if (bar) fit = Math.min(fit, 35);

  const top = overlap.sort((a, b) => (idf.get(b) || 1) - (idf.get(a) || 1)).slice(0, 5);
  return {
    fit,
    track: null,
    why: top.length ? `Keyword overlap: ${top.join(", ")}` : "Little keyword overlap with your profile",
    gap: null,
    dealbreaker: bar ? bar.label : null,
    usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 }
  };
}

function buildIdf(postings) {
  const df = new Map();
  for (const p of postings) {
    for (const t of new Set(terms(`${p.title} ${p.text}`))) df.set(t, (df.get(t) || 0) + 1);
  }
  const n = postings.length || 1;
  const idf = new Map();
  for (const [t, c] of df) idf.set(t, Math.log(1 + n / c));
  return idf;
}

// ---------- Orchestration ----------

// A small worker pool keeps a long list fast without flooding the API.
async function pool(items, size, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
  return results;
}

export async function scoreAll(profile, postings, opts = {}) {
  const { useAI, maxToScore = 40, fetchImpl = fetch } = opts;
  const model = opts.model || process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  const apiKey = opts.apiKey || process.env.OPENROUTER_API_KEY;

  // I score the freshest postings first and cap the count, so one run has a known worst-case cost.
  const queue = [...postings].sort((a, b) => (a.ageDays ?? 999) - (b.ageDays ?? 999)).slice(0, maxToScore);
  const skipped = postings.length - queue.length;
  const idf = useAI ? null : buildIdf(postings);

  const scored = await pool(queue, 4, async (p) => {
    try {
      const s = useAI
        ? await scoreWithAI(profile, p, { fetchImpl, model, apiKey })
        : scoreWithKeywords(profile, p, idf);
      return { ...p, ...s, track: s.track || p.track, text: undefined, error: null };
    } catch (err) {
      return { ...p, fit: null, why: null, gap: null, dealbreaker: null, usage: err.usage || { tokensIn: 0, tokensOut: 0, costUsd: 0 }, text: undefined, error: err.message };
    }
  });

  const totals = scored.reduce((t, s) => ({
    tokensIn: t.tokensIn + s.usage.tokensIn,
    tokensOut: t.tokensOut + s.usage.tokensOut,
    costUsd: t.costUsd + s.usage.costUsd
  }), { tokensIn: 0, tokensOut: 0, costUsd: 0 });

  return { scored, skipped, totals, method: useAI ? "ai" : "keywords", model: useAI ? model : null };
}
