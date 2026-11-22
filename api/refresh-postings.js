// GET /api/refresh-postings: the daily fetch of the shared job boards (src/cloud/postings.js). Vercel's cron
// calls it once a day on production (vercel.json) with "Authorization: Bearer <CRON_SECRET>"; any other caller
// is refused. Jordan can also start it from Vercel (Settings, Cron Jobs, Run). On a laptop, use
// `npm run refresh-postings`, which fills the development database.
import crypto from "node:crypto";
import { refreshPostings } from "../src/cloud/postings.js";
import { handle, json, HttpError } from "../src/cloud/http.js";

function authorized(request, secret = process.env.CRON_SECRET || "") {
  const sent = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return secret.length >= 16 && sent.length === expected.length && crypto.timingSafeEqual(sent, expected);
}

export const GET = handle(async (request) => {
  if (!authorized(request)) throw new HttpError("Not allowed.", 401);
  return json(await refreshPostings());
});
