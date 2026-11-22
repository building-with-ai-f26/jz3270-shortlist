// GET /api/config: the public values the page needs: this environment's Supabase address and publishable key
// (to sign people in), and the PostHog project key (for product analytics). All are safe in a browser; row level
// security guards the data, and a PostHog project key can only send events. It refuses to hand out anything that
// looks like a secret key, in case one was pasted into the wrong setting.
import { supabaseEnv, looksSecret, NO_STORE } from "../src/cloud/supabase.js";

// PostHog's project keys start with phc_; its personal API keys (phx_) can read everything, so never those.
export function analyticsConfig(env = process.env) {
  const key = (env.POSTHOG_KEY || "").trim();
  if (!key.startsWith("phc_")) return null;
  return { key, host: (env.POSTHOG_HOST || "https://us.i.posthog.com").trim(), environment: env.VERCEL_ENV || "local" };
}

export function GET() {
  const cfg = supabaseEnv();
  if (!cfg) {
    return Response.json({ error: "Sign-in is not set up for this environment yet." }, { status: 503, headers: NO_STORE });
  }
  if (looksSecret(cfg.publishableKey)) {
    return Response.json({ error: "Sign-in is misconfigured: the publishable key setting holds a secret key. Replace it in Vercel." }, { status: 500, headers: NO_STORE });
  }
  return Response.json({ supabaseUrl: cfg.url, publishableKey: cfg.publishableKey, analytics: analyticsConfig() }, { headers: NO_STORE });
}
