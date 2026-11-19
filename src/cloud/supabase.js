// The hosted app's server functions talk to Supabase with plain fetch; only the browser uses Supabase's library.
// The server never trusts a session because the browser says so: it asks Supabase who the token belongs to,
// and reads and writes as that person, so the database's row level security applies to every request.

// The public settings for this environment: Vercel sets them per environment (Preview uses the dev project,
// Production the prod one). Returns null when they are missing.
export function supabaseEnv(env = process.env) {
  const url = (env.SUPABASE_URL || "").trim().replace(/\/$/, "");
  const publishableKey = (env.SUPABASE_PUBLISHABLE_KEY || "").trim();
  return url && publishableKey ? { url, publishableKey } : null;
}

// A secret key skips every privacy rule, so it must never reach a browser. This catches one pasted into the
// publishable slot: Supabase's newer secret keys start with sb_secret_, and the older service_role key is a
// token whose payload says role "service_role".
export function looksSecret(key = "") {
  if (key.startsWith("sb_secret_")) return true;
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")).role === "service_role";
  } catch {
    return false;
  }
}

// The signed-in person behind a request, as Supabase confirms it, or null.
export async function userFromRequest(request, { env = process.env, fetchImpl = fetch } = {}) {
  const cfg = supabaseEnv(env);
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!cfg || !token) return null;
  const res = await fetchImpl(`${cfg.url}/auth/v1/user`, { headers: { apikey: cfg.publishableKey, Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const user = await res.json().catch(() => null);
  return user?.id ? { id: user.id, email: user.email || null, token } : null;
}

// A request to Supabase's database API as the signed-in person, so row level security decides what they reach.
export function asUser(user, path, { method = "GET", body, prefer, env = process.env, fetchImpl = fetch } = {}) {
  const cfg = supabaseEnv(env);
  return fetchImpl(`${cfg.url}${path}`, {
    method,
    headers: {
      apikey: cfg.publishableKey,
      Authorization: `Bearer ${user.token}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

export const NO_STORE = { "Cache-Control": "no-store" };
