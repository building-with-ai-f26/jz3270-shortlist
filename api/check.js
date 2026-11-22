// POST /api/check: run this person's check (src/cloud/check.js) and answer with their board and how much AI scoring
// they have left today. GET /api/check: their last board (null before their first check) and the same counter.
// Rate limited per person, one check at a time.
import { runCloudCheck, latestCheck } from "../src/cloud/check.js";
import { aiStatus } from "../src/cloud/allowance.js";
import { handle, json, requireUser } from "../src/cloud/http.js";

export const POST = handle(async (request) => json(await runCloudCheck(await requireUser(request))));

export const GET = handle(async (request) => {
  const user = await requireUser(request);
  const [latest, ai] = await Promise.all([latestCheck(user), aiStatus(user).catch(() => null)]);
  return json({ latest, ai });
});
