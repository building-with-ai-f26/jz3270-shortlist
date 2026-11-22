// DELETE /api/account: delete this person's account and every row that belongs to it. Every table's rows
// reference the account with "on delete cascade" (supabase/migrations), so removing the account removes the
// resume, choices, scores, decisions, checks and AI usage in one step. The body must say
// { "confirm": "delete my account" }, so a stray request cannot do it.
import { asServer, ok } from "../src/cloud/supabase.js";
import { handle, json, requireUser, readJsonBody, HttpError } from "../src/cloud/http.js";

export const CONFIRM = "delete my account";

export const DELETE = handle(async (request) => {
  const user = await requireUser(request);
  const body = await readJsonBody(request, 1000);
  if (body.confirm !== CONFIRM) throw new HttpError(`To delete your account, confirm with "${CONFIRM}".`);
  await ok(await asServer(`/auth/v1/admin/users/${encodeURIComponent(user.id)}`, { method: "DELETE" }), "Deleting your account");
  return json({ deleted: true });
});
