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
export function asUser(user, path, { method = "GET", body, prefer, headers = {}, env = process.env, fetchImpl = fetch } = {}) {
  const cfg = supabaseEnv(env);
  return fetchImpl(`${cfg.url}${path}`, {
    method,
    headers: {
      apikey: cfg.publishableKey,
      Authorization: `Bearer ${user.token}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

export const NO_STORE = { "Cache-Control": "no-store" };

// The secret key, for what only the server may do: write postings, scores, runs and AI usage, store the encrypted
// resume, and delete an account. It skips row level security, so every caller passes a user id it got from
// userFromRequest, never one from the request body. Returns null when the key is missing or is not a secret key.
export function serverEnv(env = process.env) {
  const cfg = supabaseEnv(env);
  const secretKey = (env.SUPABASE_SECRET_KEY || "").trim();
  return cfg && looksSecret(secretKey) ? { ...cfg, secretKey } : null;
}

export function asServer(path, { method = "GET", body, prefer, headers = {}, env = process.env, fetchImpl = fetch } = {}) {
  const cfg = serverEnv(env);
  if (!cfg) throw new Error("SUPABASE_SECRET_KEY is not set for this environment.");
  return fetchImpl(`${cfg.url}${path}`, {
    method,
    headers: {
      apikey: cfg.secretKey,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

// Reads every row a query matches, 1,000 at a time (Supabase's page size), through `call(path, { headers })`,
// which is asUser or asServer with the person or settings already filled in.
export async function readAll(call, path, { pageSize = 1000, max = 50000 } = {}) {
  const rows = [];
  while (rows.length < max) {
    const res = await call(path, { headers: { Range: `${rows.length}-${rows.length + pageSize - 1}` } });
    if (!res.ok) throw new Error(`Database read failed (HTTP ${res.status})`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

// Throws with the database's own message, so a failed write is never silent.
export async function ok(res, what) {
  if (res.ok) return res;
  const detail = await res.text().catch(() => "");
  throw new Error(`${what} failed (HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""})`);
}
