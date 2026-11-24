// GET /api/setup: the choices on offer (kinds of role, cities, how recent, sectors of companies) and this
// person's picks. POST /api/setup: save their picks. The same choices as the laptop app's setup (src/setup.js),
// turned into the same preferences the filter reads. Read as the person (row level security); saved by the server
// only after every choice is checked, so the saved preferences are always ones this route built.
//
// POST /api/setup with { auto: true } is "Find roles for me": the server reads the resume, picks the kinds of role
// and cities (src/cloud/picks.js: one AI question, or free word matching), and saves them with every sector and
// AUTO_AGE_DAYS, keeping the school and "What I'm looking for". The reason for the picks goes back to the page but
// is not saved, since it is drawn from the resume, which is stored only encrypted.
import { asUser, asServer, ok } from "../src/cloud/supabase.js";
import { ROLE_FAMILIES, CITIES, AGE_CHOICES, STARTER_SECTORS, buildPreferences } from "../src/setup.js";
import { hostedStarter } from "../src/cloud/postings.js";
import { checkPrefs } from "../src/cloud/check.js";
import { decryptResume, encryptionKey } from "../src/cloud/crypto.js";
import { choosePicks } from "../src/cloud/picks.js";
import { aiStatus } from "../src/cloud/allowance.js";
import { handle, json, requireUser, readJsonBody, HttpError } from "../src/cloud/http.js";

const q = encodeURIComponent;
const MAX_LOOKING_FOR = 2000;
// A per-person rate limit on saving, from the time of the last save.
const SAVE_GAP_MS = 2000;
export const AUTO_AGE_DAYS = 14;

function choices() {
  const starter = hostedStarter();
  return {
    roles: Object.entries(ROLE_FAMILIES).map(([key, r]) => ({ key, label: r.label })),
    cities: Object.entries(CITIES).map(([key, c]) => ({ key, label: c.label })),
    ages: AGE_CHOICES,
    sectors: Object.entries(STARTER_SECTORS).map(([key, label]) => ({ key, label, companies: starter.filter((c) => c.sector === key).length }))
  };
}

async function current(user) {
  const [prefsRes, profileRes] = await Promise.all([
    asUser(user, `/rest/v1/preferences?select=prefs,updated_at&user_id=eq.${q(user.id)}`),
    asUser(user, `/rest/v1/profiles?select=looking_for&user_id=eq.${q(user.id)}`)
  ]);
  await ok(prefsRes, "Reading your choices");
  await ok(profileRes, "Reading your profile");
  const row = (await prefsRes.json())[0];
  return { prefs: row?.prefs || null, updatedAt: row?.updated_at || null, lookingFor: (await profileRes.json())[0]?.looking_for || "" };
}

export const GET = handle(async (request) => {
  const user = await requireUser(request);
  const { prefs, lookingFor } = await current(user);
  return json({
    choices: choices(),
    picked: prefs?.setup ? {
      roles: prefs.setup.roles || [],
      cities: prefs.setup.cities || [],
      sectors: prefs.setup.sectors || [],
      maxAgeDays: prefs.maxAgeDays || 14,
      school: (prefs.networkSchools || [])[0] || "",
      lookingFor,
      auto: prefs.setup.auto || null
    } : null
  });
});

// Saved settings this screen does not ask about are kept, unless they fail the check's own rules; then saving
// starts clean, so damaged choices are repaired by saving again.
function keptSettings(saved) {
  try { return checkPrefs(saved || {}); } catch { return {}; }
}
const tooSoon = (updatedAt) => updatedAt && Date.now() - Date.parse(updatedAt) < SAVE_GAP_MS;

function savePrefs(user, prefs) {
  return asServer("/rest/v1/preferences?on_conflict=user_id", {
    method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { user_id: user.id, prefs }
  }).then((res) => ok(res, "Saving your choices"));
}

// "Find roles for me".
async function chooseForMe(user) {
  const { prefs: saved, updatedAt, lookingFor } = await current(user);
  if (tooSoon(updatedAt)) throw new HttpError("Saving too fast. Wait a moment and try again.", 429);
  const existing = keptSettings(saved);
  const res = await ok(await asUser(user, `/rest/v1/profiles?select=resume_ciphertext&user_id=eq.${q(user.id)}`), "Reading your resume");
  const stored = (await res.json())[0]?.resume_ciphertext;
  if (!stored) throw new HttpError("Upload your resume first.");
  const resume = decryptResume(stored, user.id, encryptionKey());

  const picks = await choosePicks(user, { resume, lookingFor });
  const sectors = Object.keys(STARTER_SECTORS);
  const prefs = buildPreferences({
    roles: picks.roles, cities: picks.cities, maxAgeDays: AUTO_AGE_DAYS, schools: existing.networkSchools || [], scoring: "keywords"
  }, existing);
  prefs.setup = { ...prefs.setup, sectors, auto: picks.by };
  await savePrefs(user, prefs);

  return {
    saved: true,
    companies: hostedStarter().length,
    picked: { roles: picks.roles, cities: picks.cities, sectors, maxAgeDays: AUTO_AGE_DAYS, school: (prefs.networkSchools || [])[0] || "", lookingFor, auto: picks.by },
    chosen: { by: picks.by, why: picks.why, paused: picks.paused, costUsd: Number(picks.costUsd.toFixed(6)) },
    ai: await aiStatus(user).catch(() => null)
  };
}

export const POST = handle(async (request) => {
  const user = await requireUser(request);
  const body = await readJsonBody(request);
  if (body.auto === true) return json(await chooseForMe(user));
  const sectors = [...new Set(Array.isArray(body.sectors) ? body.sectors : [])];
  const unknown = sectors.filter((s) => !(s in STARTER_SECTORS));
  if (unknown.length) throw new HttpError(`Unknown sector: ${unknown.join(", ")}`);
  if (!sectors.length) throw new HttpError("Pick at least one sector of companies.");
  const lookingFor = String(body.lookingFor || "").trim();
  if (lookingFor.length > MAX_LOOKING_FOR) throw new HttpError(`Keep "What I'm looking for" under ${MAX_LOOKING_FOR} characters.`);

  const { prefs: saved, updatedAt, lookingFor: savedLookingFor } = await current(user);
  const existing = keptSettings(saved);
  if (tooSoon(updatedAt)) throw new HttpError("Saving too fast. Wait a moment and try again.", 429);

  let prefs;
  try {
    prefs = buildPreferences({
      roles: body.roles || [],
      cities: body.cities || [],
      maxAgeDays: body.maxAgeDays ?? 14,
      schools: body.school ? [String(body.school)] : [],
      scoring: "keywords"
    }, existing);
  } catch (err) {
    throw new HttpError(err.message);
  }
  prefs.setup = { ...prefs.setup, sectors };
  await savePrefs(user, prefs);
  if (lookingFor !== savedLookingFor) {
    await ok(await asServer("/rest/v1/profiles?on_conflict=user_id", {
      method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { user_id: user.id, looking_for: lookingFor }
    }), "Saving what you are looking for");
  }
  const companies = hostedStarter().filter((c) => sectors.includes(c.sector)).length;
  return json({ saved: true, companies });
});
