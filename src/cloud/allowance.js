// The AI allowance on the hosted site (CLOUD-PLAN.md, step 5). AI scoring spends Jordan's OpenRouter key, so it
// has three limits, and keyword ranking carries on whenever one of them is reached:
//   1. each person: AI_ROLES_PER_DAY roles a day, at most AI_ROLES_PER_CHECK in one check;
//   2. the whole site: SITE_DAILY_USD dollars a day;
//   3. the key itself: its credit limit on OpenRouter (set there, not here).
// Days run from midnight to midnight New York time.
//
// The counts live in ai_usage (one row per person per day) and site_spend (one row per day), which only the server
// writes. A check asks for roles before it calls OpenRouter (reserveAI) and reports what it really used afterwards
// (settleAI), so checks running at the same time cannot pass a limit. While a check runs, each role it holds counts
// toward the site at RESERVE_USD_PER_ROLE, about 3 times the measured cost, and settling swaps in the real cost.
// If a check dies before settling, its hold stays, which errs toward spending less.
//
// Every change is a conditional write: the update only lands if the row still holds the numbers just read. If
// another check changed it first, nothing changes, and the change is read again and retried. This keeps the
// counts exact with plain database requests, without a database function.
import { asServer, ok } from "./supabase.js";

export const AI_ROLES_PER_DAY = 60;
export const AI_ROLES_PER_CHECK = 20;
export const SITE_DAILY_USD = 1;
export const RESERVE_USD_PER_ROLE = 0.002;
export const TIME_ZONE = "America/New_York";
const TRIES = 5;
const q = encodeURIComponent;

// AI scoring is on only where the server has a key. Keys are never sent to the page or written to a log.
export const aiOn = (env = process.env) => Boolean((env.OPENROUTER_API_KEY || "").trim());

// Today's date in New York, as YYYY-MM-DD.
export function aiDay(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}

const dollars = (n) => Number(Math.max(0, n).toFixed(6));
const asRow = (r = {}) => ({ roles_scored: Number(r.roles_scored) || 0, cost_usd: Number(r.cost_usd) || 0 });
const where = (match) => Object.entries(match).map(([k, v]) => `${k}=eq.${q(v)}`).join("&");

// A counter row (ai_usage or site_spend), made with zeros if it does not exist yet.
async function readRow(table, match, opts) {
  const path = `/rest/v1/${table}?select=roles_scored,cost_usd&${where(match)}`;
  let rows = await (await ok(await asServer(path, opts), "Reading AI usage")).json();
  if (!rows.length) {
    const cols = Object.keys(match).join(",");
    await ok(await asServer(`/rest/v1/${table}?on_conflict=${cols}`, {
      ...opts, method: "POST", body: match, prefer: "resolution=ignore-duplicates,return=minimal"
    }), "Starting today's AI usage");
    rows = await (await ok(await asServer(path, opts), "Reading AI usage")).json();
  }
  return asRow(rows[0]);
}

// Reads a counter row, asks `next(row)` for its new numbers (null for no change), and writes them only if the row
// has not changed since it was read. Returns the row as written (or as read, when nothing changed).
export async function changeRow(table, match, next, opts) {
  for (let i = 0; i < TRIES; i++) {
    const row = await readRow(table, match, opts);
    const want = next(row);
    if (!want) return row;
    const body = {};
    if ("roles_scored" in want) body.roles_scored = Math.max(0, Math.round(want.roles_scored));
    if ("cost_usd" in want) body.cost_usd = dollars(want.cost_usd);
    const unchanged = `${where(match)}&roles_scored=eq.${row.roles_scored}&cost_usd=eq.${row.cost_usd.toFixed(6)}`;
    const res = await ok(await asServer(`/rest/v1/${table}?${unchanged}`, {
      ...opts, method: "PATCH", body, prefer: "return=representation"
    }), "Updating AI usage");
    const written = await res.json();
    if (written.length) return asRow(written[0]);
  }
  throw new Error("AI usage is busy");
}

// How much AI scoring this person has left today, for the counter. The page learns only whether the site is
// paused, never what the site has spent.
export async function aiStatus(user, { env = process.env, fetchImpl = fetch, now = Date.now() } = {}) {
  const base = { on: aiOn(env), limit: AI_ROLES_PER_DAY, perCheck: AI_ROLES_PER_CHECK, left: 0, paused: null };
  if (!base.on) return base;
  const opts = { env, fetchImpl };
  const day = aiDay(now);
  const [mine, site] = await Promise.all([
    asServer(`/rest/v1/ai_usage?select=roles_scored&user_id=eq.${q(user.id)}&day=eq.${day}`, opts),
    asServer(`/rest/v1/site_spend?select=cost_usd&day=eq.${day}`, opts)
  ]);
  const used = asRow((await (await ok(mine, "Reading AI usage")).json())[0]).roles_scored;
  const spent = asRow((await (await ok(site, "Reading AI usage")).json())[0]).cost_usd;
  const left = Math.max(0, AI_ROLES_PER_DAY - used);
  const siteRoom = Math.floor((SITE_DAILY_USD - spent) / RESERVE_USD_PER_ROLE + 1e-9);
  return { ...base, left, paused: left === 0 ? "person" : siteRoom < 1 ? "site" : null };
}

// Holds up to `wanted` roles for one check: first from the person's allowance, then from the site's budget, and
// gives the person back whatever the site could not cover. Returns { day, granted, paused }.
export async function reserveAI(user, wanted, { env = process.env, fetchImpl = fetch, now = Date.now() } = {}) {
  const opts = { env, fetchImpl };
  const day = aiDay(now);
  if (!aiOn(env) || wanted <= 0) return { day, granted: 0, paused: null };
  const mine = { user_id: user.id, day };

  let held = 0;
  await changeRow("ai_usage", mine, (row) => {
    held = Math.min(wanted, AI_ROLES_PER_CHECK, Math.max(0, AI_ROLES_PER_DAY - row.roles_scored));
    return held ? { roles_scored: row.roles_scored + held } : null;
  }, opts);
  if (!held) return { day, granted: 0, paused: "person" };

  let granted = 0;
  try {
    await changeRow("site_spend", { day }, (row) => {
      const room = Math.floor((SITE_DAILY_USD - row.cost_usd) / RESERVE_USD_PER_ROLE + 1e-9);
      granted = Math.max(0, Math.min(held, room));
      return granted ? { roles_scored: row.roles_scored + granted, cost_usd: row.cost_usd + granted * RESERVE_USD_PER_ROLE } : null;
    }, opts);
  } catch (err) {
    granted = 0;
    await giveBack(mine, held, opts);
    throw err;
  }
  if (granted < held) await giveBack(mine, held - granted, opts);
  return { day, granted, paused: granted ? null : "site" };
}

async function giveBack(mine, roles, opts) {
  await changeRow("ai_usage", mine, (row) => ({ roles_scored: row.roles_scored - roles }), opts).catch(() => {});
}

// After the AI calls: `used` roles got a score and the calls cost `costUsd` in all (a failed call adds its cost
// but not a role). The unused part of the hold goes back, and the site's estimate becomes the real cost. Each part
// is tried on its own; one that fails leaves its hold in place. Returns true when both parts were saved.
export async function settleAI(user, hold, { used, costUsd }, { env = process.env, fetchImpl = fetch } = {}) {
  if (!hold?.granted) return true;
  const opts = { env, fetchImpl };
  const person = await changeRow("ai_usage", { user_id: user.id, day: hold.day }, (row) => ({
    roles_scored: row.roles_scored - hold.granted + used, cost_usd: row.cost_usd + costUsd
  }), opts).then(() => true, () => false);
  const site = await changeRow("site_spend", { day: hold.day }, (row) => ({
    roles_scored: row.roles_scored - hold.granted + used, cost_usd: row.cost_usd - hold.granted * RESERVE_USD_PER_ROLE + costUsd
  }), opts).then(() => true, () => false);
  return person && site;
}
