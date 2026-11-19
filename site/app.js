// The hosted site's sign-in (CLOUD-PLAN.md, step 3a). Supabase's library signs people in with Google or an
// email link and keeps the session in this browser. Every time, the server checks the session again with
// Supabase (/api/me) before showing anything about the account. All text from the server goes in with
// textContent, never as HTML.
(() => {
  const $ = (id) => document.getElementById(id);
  const VIEWS = ["loading", "signedOut", "signedIn", "unavailable"];
  const show = (id) => { for (const v of VIEWS) $(v).hidden = v !== id; };
  const say = (text, bad = false) => { $("msg").textContent = text || ""; $("msg").classList.toggle("bad", bad); };

  async function start() {
    let config;
    try {
      const res = await fetch("/api/config");
      config = await res.json();
      if (!res.ok) throw new Error(config.error || `HTTP ${res.status}`);
    } catch (err) {
      $("unavailableText").textContent = err.message || "Sign-in is not switched on here yet.";
      return show("unavailable");
    }

    // PKCE: the sign-in comes back as a one-time code that only this browser can turn into a session.
    const client = window.supabase.createClient(config.supabaseUrl, config.publishableKey, {
      auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

    async function render(session) {
      if (!session) return show("signedOut");
      try {
        const res = await fetch("/api/me", { headers: { Authorization: `Bearer ${session.access_token}` } });
        const me = await res.json();
        if (!res.ok) throw new Error(me.error || `HTTP ${res.status}`);
        $("who").textContent = me.email || "your account";
        $("resumeState").textContent = me.hasResume
          ? `Resume on file: ${me.resumeFileName}.`
          : "Next: upload your resume. That arrives in the next update.";
        show("signedIn");
        // Tidy the address bar after coming back from Google or an email link.
        if (location.search) history.replaceState(null, "", location.pathname);
      } catch (err) {
        show("signedOut");
        say(`Your sign-in could not be checked (${err.message}). Please sign in again.`, true);
      }
    }

    // Fires once on load with the current session, then on every sign-in and sign-out. Work is deferred so it
    // never runs inside Supabase's own callback.
    client.auth.onAuthStateChange((_event, session) => { setTimeout(() => render(session), 0); });

    $("google").addEventListener("click", async () => {
      say("Opening Google...");
      const { error } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${location.origin}/` } });
      if (error) say(`Google sign-in did not start: ${error.message}`, true);
    });

    $("emailForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = $("email").value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return say("Enter a full email address.", true);
      $("emailBtn").disabled = true;
      say("Sending...");
      const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}/` } });
      $("emailBtn").disabled = false;
      if (error) say(`The link could not be sent: ${error.message}`, true);
      else say(`Check ${email} for a sign-in link, and open it in this browser.`);
    });

    $("signOut").addEventListener("click", async () => {
      await client.auth.signOut();
      say("Signed out.");
    });
  }

  start();
})();
