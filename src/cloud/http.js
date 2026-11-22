// Small helpers every hosted route shares: JSON answers that are never cached, the signed-in person, and one
// way of turning an error into an answer. Errors meant for the person (a status set on purpose) are shown as
// they are; anything unexpected becomes a plain "try again" and its message goes only to the server log, which
// never sees resume text.
import { userFromRequest, NO_STORE } from "./supabase.js";

export class HttpError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export const json = (body, status = 200) => Response.json(body, { status, headers: NO_STORE });

export async function requireUser(request, opts) {
  const user = await userFromRequest(request, opts);
  if (!user) throw new HttpError("Sign in first.", 401);
  return user;
}

// Reads a JSON body of at most maxBytes.
export async function readJsonBody(request, maxBytes = 20000) {
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError("That request is too large.", 413);
  try { return text ? JSON.parse(text) : {}; } catch { throw new HttpError("That request was not valid JSON."); }
}

export function handle(fn) {
  return async (request) => {
    try {
      return await fn(request);
    } catch (err) {
      if (err.status) return json({ error: err.message }, err.status);
      console.error(`${new URL(request.url).pathname}: ${err.message}`);
      return json({ error: "Something went wrong on our side. Please try again in a minute." }, 500);
    }
  };
}
