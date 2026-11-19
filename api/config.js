// GET /api/config: the two public values the page needs to sign people in (this environment's Supabase address
// and publishable key). They are safe in a browser; row level security guards the data. It refuses to hand out
// anything that looks like a secret key, in case one was pasted into the wrong setting.
import { supabaseEnv, looksSecret, NO_STORE } from "../src/cloud/supabase.js";

export function GET() {
  const cfg = supabaseEnv();
  if (!cfg) {
    return Response.json({ error: "Sign-in is not set up for this environment yet." }, { status: 503, headers: NO_STORE });
  }
  if (looksSecret(cfg.publishableKey)) {
    return Response.json({ error: "Sign-in is misconfigured: the publishable key setting holds a secret key. Replace it in Vercel." }, { status: 500, headers: NO_STORE });
  }
  return Response.json({ supabaseUrl: cfg.url, publishableKey: cfg.publishableKey }, { headers: NO_STORE });
}
