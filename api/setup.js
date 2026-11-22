// GET /api/setup: the choices on offer (kinds of role, cities, how recent, sectors of companies) and this
// person's picks. POST /api/setup: save their picks. The same choices as the laptop app's setup (src/setup.js),
// turned into the same preferences the filter reads. Saved as the person, so row level security applies.
import { asUser, ok } from "../src/cloud/supabase.js";
import { ROLE_FAMILIES, CITIES, AGE_CHOICES, STARTER_SECTORS, buildPreferences } from "../src/setup.js";
import { hostedStarter } from "../src/cloud/postings.js";
import { handle, json, requireUser, readJsonBody, HttpError } from "../src/cloud/http.js";

const q = encodeURIComponent;
const MAX_LOOKING_FOR = 2000;
// A per-person rate limit on saving, from the time of the last save.
const SAVE_GAP_MS = 2000;

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
      lookingFor
    } : null
  });
});

export const POST = handle(async (request) => {
  const user = await requireUser(request);
  const body = await readJsonBody(request);
  const sectors = [...new Set(Array.isArray(body.sectors) ? body.sectors : [])];
  const unknown = sectors.filter((s) => !(s in STARTER_SECTORS));
  if (unknown.length) throw new HttpError(`Unknown sector: ${unknown.join(", ")}`);
  if (!sectors.length) throw new HttpError("Pick at least one sector of companies.");
  const lookingFor = String(body.lookingFor || "").trim();
  if (lookingFor.length > MAX_LOOKING_FOR) throw new HttpError(`Keep "What I'm looking for" under ${MAX_LOOKING_FOR} characters.`);

  const { prefs: existing, updatedAt } = await current(user);
  if (updatedAt && Date.now() - Date.parse(updatedAt) < SAVE_GAP_MS) throw new HttpError("Saving too fast. Wait a moment and try again.", 429);

  let prefs;
  try {
    prefs = buildPreferences({
      roles: body.roles || [],
      cities: body.cities || [],
      maxAgeDays: body.maxAgeDays ?? 14,
      schools: body.school ? [String(body.school)] : [],
      scoring: "keywords"
    }, existing || {});
  } catch (err) {
    throw new HttpError(err.message);
  }
  prefs.setup = { ...prefs.setup, sectors };

  await ok(await asUser(user, "/rest/v1/preferences?on_conflict=user_id", {
    method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { user_id: user.id, prefs }
  }), "Saving your choices");
  await ok(await asUser(user, "/rest/v1/profiles?on_conflict=user_id", {
    method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { user_id: user.id, looking_for: lookingFor }
  }), "Saving what you are looking for");
  const companies = hostedStarter().filter((c) => sectors.includes(c.sector)).length;
  return json({ saved: true, companies });
});
