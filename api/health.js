// GET /api/health on the hosted site: says the app is up, which environment answered (preview or production)
// and which commit it runs, so a preview link and a rollback can be checked at a glance. It never returns a
// secret or any other environment value. Vercel runs each file in api/ as a function; the local app
// (npm start) does not use this folder.
export function GET() {
  return Response.json(
    {
      ok: true,
      environment: process.env.VERCEL_ENV || "local",
      commit: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) || null
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
