// POST /api/check: run this person's check (src/cloud/check.js) and answer with their board.
// GET /api/check: their last board, or null before their first check. Rate limited per person.
import { runCloudCheck, latestCheck } from "../src/cloud/check.js";
import { handle, json, requireUser } from "../src/cloud/http.js";

export const POST = handle(async (request) => json(await runCloudCheck(await requireUser(request))));

export const GET = handle(async (request) => json({ latest: await latestCheck(await requireUser(request)) }));
