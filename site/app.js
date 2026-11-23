// The hosted site (CLOUD-PLAN.md, steps 3 and 5). Supabase's library signs people in with Google or an email
// link and keeps the session in this browser; every request to /api/* carries the session, and the server checks
// it with Supabase again before doing anything. Signed in, the page has three steps (resume, what you want,
// Check my list) and then the board.
//
// Safety: everything from the server or a job board goes in with textContent through el(), never as HTML, and
// a link is only kept when it starts with https://, so a posting cannot run script on this page.
(() => {
  const $ = (id) => document.getElementById(id);
  const CARD_VIEWS = ["loading", "signedOut", "unavailable"];
  const showCard = (id) => { for (const v of CARD_VIEWS) $(v).hidden = v !== id; };
  const say = (text, bad = false) => { $("msg").textContent = text || ""; $("msg").classList.toggle("bad", bad); };
  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const GRAD = "2027 grad";
  // Product analytics (site/analytics.js): counts and kinds only, never resume text, titles or choices.
  const track = (event, props) => window.shortlistAnalytics?.track(event, props);
  const fileType = (name) => (/\.pdf$/i.test(name) ? "pdf" : /\.docx$/i.test(name) ? "docx" : "text");
  const linkType = (label) => (/alumni/i.test(label) ? "alumni" : /2nd-degree/i.test(label) ? "connections" : /recruit/i.test(label) ? "recruiters" : /MBAs/i.test(label) ? "mbas" : "team");
  const SHOW_FIRST = 20;

  let toastTimer;
  function toast(text, bad = false) {
    const t = $("toast");
    t.textContent = text;
    t.classList.toggle("bad", bad);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, bad ? 9000 : 4500);
  }

  // Builds an element. Strings become text, "on..." props become listeners, and href is kept only for https.
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "className") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "href") { if (/^https:\/\//i.test(v)) node.href = v; }
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : String(v));
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c instanceof Node ? c : String(c));
    return node;
  }

  const day = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");
  function ago(iso) {
    const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (!(mins >= 1)) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} hr ago`;
    const days = Math.round(hrs / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }
  const posted = (d) => (d === null || d === undefined ? "" : d <= 0 ? "posted today" : `posted ${d} day${d === 1 ? "" : "s"} ago`);

  let client;
  let session = null;
  let me = null;
  let setup = null;
  let board = null;
  // How much AI scoring this person has left today: { on, limit, perCheck, left, paused }, or null.
  let ai = null;
  let editing = false;
  let picks = { roles: new Set(), cities: new Set(), sectors: new Set(), age: 14 };

  async function api(path, { method = "GET", body, headers = {} } = {}) {
    const isFile = body instanceof Blob;
    const res = await fetch(path, {
      method,
      headers: { Authorization: `Bearer ${session.access_token}`, ...(body !== undefined && !isFile ? { "Content-Type": "application/json" } : {}), ...headers },
      body: isFile ? body : body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Something went wrong (HTTP ${res.status}).`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // ---------- Signed out or in ----------

  async function render(s) {
    session = s;
    if (!s) {
      $("app").hidden = true;
      $("account").hidden = true;
      $("landing").hidden = false;
      return showCard("signedOut");
    }
    try {
      const [m, st, last] = await Promise.all([api("/api/me"), api("/api/setup"), api("/api/check")]);
      me = m;
      setup = st;
      board = last.latest;
      ai = last.ai || null;
      $("who").textContent = me.email || "your account";
      $("landing").hidden = true;
      $("account").hidden = false;
      $("app").hidden = false;
      // Tidy the address bar after coming back from Google or an email link.
      if (location.search) history.replaceState(null, "", location.pathname);
      loadPicks();
      renderResume();
      renderWants();
      renderBoard();
      updateGo();
    } catch (err) {
      $("app").hidden = true;
      $("account").hidden = true;
      $("landing").hidden = false;
      showCard("signedOut");
      say(`Your sign-in could not be checked (${err.message}). Please sign in again.`, true);
    }
  }

  // ---------- Step 1: the resume ----------

  function renderResume() {
    const has = Boolean(me.hasResume);
    $("resumeNone").hidden = has;
    $("resumeOnFile").hidden = !has;
    $("stepResume").classList.toggle("done", has);
    if (has) {
      $("resumeName").textContent = me.resumeFileName;
      $("resumeWhen").textContent = `Uploaded ${day(me.resumeUploadedAt)}, stored encrypted`;
    }
  }

  async function upload(file) {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) return toast("That file is over 4 MB. Save a smaller PDF or the Word version.", true);
    toast(`Reading ${file.name}...`);
    try {
      const r = await api("/api/resume", { method: "POST", body: file, headers: { "X-File-Name": encodeURIComponent(file.name) } });
      me = { ...me, hasResume: true, resumeFileName: r.resumeFileName, resumeUploadedAt: r.resumeUploadedAt };
      renderResume();
      updateGo();
      track("resume_uploaded", { file_type: fileType(r.resumeFileName) });
      toast(`Got it: ${r.characters.toLocaleString("en-US")} characters of resume text, contact details removed, stored encrypted.`);
    } catch (err) {
      toast(err.message, true);
    } finally {
      $("resumeFile").value = "";
    }
  }

  // ---------- Step 2: what you want ----------

  function loadPicks() {
    const p = setup.picked;
    picks = { roles: new Set(p?.roles || []), cities: new Set(p?.cities || []), sectors: new Set(p?.sectors || []), age: p?.maxAgeDays || 14 };
    $("school").value = p?.school || "";
    $("lookingFor").value = p?.lookingFor || "";
    editing = !p;
  }

  const labelsOf = (list, keys) => list.filter((x) => keys.has(x.key)).map((x) => x.label);
  const companiesPicked = () => setup.choices.sectors.filter((s) => picks.sectors.has(s.key)).reduce((n, s) => n + s.companies, 0);

  // A chip toggles itself in place, so focus stays on it.
  function toggleChip(set, key) {
    return (e) => {
      if (set.has(key)) set.delete(key); else set.add(key);
      e.currentTarget.setAttribute("aria-pressed", String(set.has(key)));
    };
  }
  function chip(label, pressed, onclick, small) {
    return el("button", { type: "button", className: "chip", "aria-pressed": String(pressed), onclick }, label, small ? el("small", { text: ` ${small}` }) : null);
  }
  function renderChips() {
    const c = setup.choices;
    $("roles").replaceChildren(...c.roles.map((r) => chip(r.label, picks.roles.has(r.key), toggleChip(picks.roles, r.key))));
    $("cities").replaceChildren(...c.cities.map((r) => chip(r.label, picks.cities.has(r.key), toggleChip(picks.cities, r.key))));
    $("sectors").replaceChildren(...c.sectors.map((s) => chip(s.label, picks.sectors.has(s.key), toggleChip(picks.sectors, s.key), String(s.companies))));
    $("ages").replaceChildren(...c.ages.map((a) => chip(`${a} days`, picks.age === a, (e) => {
      picks.age = a;
      for (const b of $("ages").children) b.setAttribute("aria-pressed", String(b === e.currentTarget));
    })));
  }

  function renderWants() {
    const saved = Boolean(setup.picked);
    $("stepWants").classList.toggle("done", saved);
    $("wantsSummary").hidden = !saved || editing;
    $("wantsForm").hidden = saved && !editing;
    if (saved && !editing) {
      const roles = labelsOf(setup.choices.roles, picks.roles);
      const cities = labelsOf(setup.choices.cities, picks.cities);
      const sectors = labelsOf(setup.choices.sectors, picks.sectors);
      $("wantsLine").textContent = [
        roles.length ? roles.join(", ") : "MBA and 2027 roles of any kind",
        cities.length ? cities.join(", ") : "any city",
        `posted in the last ${picks.age} days`,
        `${sectors.join(", ")} (${companiesPicked()} companies)`
      ].join(" · ");
    } else {
      renderChips();
    }
  }

  async function saveWants(e) {
    e.preventDefault();
    if (!picks.sectors.size) return toast("Pick at least one sector of companies.", true);
    $("saveWants").disabled = true;
    try {
      const body = {
        roles: [...picks.roles], cities: [...picks.cities], sectors: [...picks.sectors], maxAgeDays: picks.age,
        school: $("school").value.trim(), lookingFor: $("lookingFor").value.trim()
      };
      const r = await api("/api/setup", { method: "POST", body });
      track("setup_saved", { roles_count: body.roles.length, cities_count: body.cities.length, sectors_count: body.sectors.length, first_time: !setup.picked });
      setup.picked = { ...body };
      editing = false;
      renderWants();
      updateGo();
      toast(`Saved. Your checks cover ${r.companies} companies.`);
    } catch (err) {
      toast(err.message, true);
    } finally {
      $("saveWants").disabled = false;
    }
  }

  // ---------- Step 3: the check ----------

  function updateGo() {
    const ready = Boolean(me?.hasResume && setup?.picked);
    $("checkBtn").disabled = !ready;
    $("checkHint").textContent = !me?.hasResume
      ? "Upload your resume first."
      : !setup?.picked
        ? "Pick what you want, then save."
        : `Covers ${companiesPicked()} companies on Greenhouse, Lever and Ashby. ${aiReady() ? "Takes up to half a minute." : "Free, and takes a few seconds."}`;
    renderAiLeft();
  }

  // ---------- The AI allowance ----------

  // AI scoring will run on the next check: the site has it on, and neither this person nor the site is out.
  const aiReady = () => Boolean(ai?.on && ai.left > 0 && !ai.paused);

  // The counter under Check my list. The site's own spending is never sent to the page, only whether it is paused.
  function renderAiLeft() {
    const box = $("aiLeft");
    box.hidden = !ai?.on;
    if (!ai?.on) return;
    const share = Math.max(0, Math.min(1, ai.left / ai.limit));
    const meter = el("span", { className: "meter", "aria-hidden": "true" }, el("i", { style: `width: ${Math.round(share * 100)}%` }));
    let words;
    if (ai.paused === "site") {
      words = ["AI scoring is paused for everyone until midnight New York time, because the site's daily budget is used up. New roles are ranked by shared words."];
    } else if (ai.left <= 0) {
      words = [`You have used today's ${ai.limit} AI scores. New roles are ranked by shared words until midnight New York time.`];
    } else {
      words = ["AI scoring: ", el("b", { text: `${ai.left} of ${ai.limit}` }),
        ` roles left today. Each check AI-scores up to ${ai.perCheck} new roles. Resets at midnight New York time.`];
    }
    box.classList.toggle("out", !aiReady());
    box.replaceChildren(meter, el("span", {}, ...words));
  }

  async function runCheck() {
    $("checkBtn").disabled = true;
    // A quick check never flashes the cover; a slower one gets it after a quarter second.
    const cover = setTimeout(() => {
      $("checkingText").textContent = aiReady()
        ? `Ranking roles from ${companiesPicked()} companies, and AI-scoring up to ${Math.min(ai.perCheck, ai.left)} new ones against your resume`
        : `Ranking roles from ${companiesPicked()} companies against your resume`;
      $("checking").hidden = false;
      $("app").inert = true;
    }, 250);
    try {
      board = await api("/api/check", { method: "POST" });
      if (board.ai) ai = board.ai;
      track("check_run", {
        ranked: board.summary.scored, new_count: board.summary.newCount, scoring: board.summary.method,
        ai_scored: board.summary.aiScoredThisRun || 0, ai_paused: board.summary.aiPaused || "none"
      });
      renderBoard();
      $("board").scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
    } catch (err) {
      toast(err.message, true);
    } finally {
      clearTimeout(cover);
      $("checking").hidden = true;
      $("app").inert = false;
      updateGo();
    }
  }

  // ---------- The board ----------

  // Keyword scores measure word overlap with the resume, not fit, so roles are tiered against each other,
  // as on the laptop app: the top quarter, the next third, and the rest.
  const TIERS = [
    { key: "strong", name: "Closest match", range: "top quarter by keyword overlap" },
    { key: "possible", name: "Some overlap", range: "the next third" },
    { key: "long", name: "Little overlap", range: "the rest, and dealbreakers" }
  ];
  // An AI fit is a judgment of the role against the resume, so once a board has any, roles are tiered by fit, as
  // on the laptop app. Roles without one yet keep their keyword rank in a group of their own.
  const AI_TIERS = [
    { key: "strong", name: "Strong fit", range: "AI fit 75 and up" },
    { key: "possible", name: "Possible", range: "AI fit 50 to 74" },
    { key: "long", name: "Long shot", range: "under 50, and dealbreakers" },
    { key: "waiting", name: "Not AI-scored yet", range: "ranked by shared words for now" }
  ];
  let aiBoard = false;
  let cuts = { strong: Infinity, possible: Infinity };
  function setCuts(results) {
    aiBoard = results.some((r) => r.method === "ai");
    const fits = results.filter((r) => r.method !== "ai" && !r.dealbreaker && r.fit > 0).map((r) => r.fit).sort((a, b) => b - a);
    const at = (share) => (fits.length ? fits[Math.max(0, Math.ceil(fits.length * share) - 1)] : Infinity);
    cuts = { strong: at(0.25), possible: at(0.6) };
  }
  function tier(r) {
    if (aiBoard) {
      if (r.method !== "ai") return "waiting";
      if (r.dealbreaker) return "long";
      return r.fit >= 75 ? "strong" : r.fit >= 50 ? "possible" : "long";
    }
    if (r.dealbreaker || !(r.fit > 0)) return "long";
    if (r.fit >= cuts.strong) return "strong";
    if (r.fit >= cuts.possible) return "possible";
    return "long";
  }

  function roleCard(r) {
    const t = tier(r);
    const meta = el("p", { className: "meta" },
      r.isNew ? el("span", { className: "newtag", text: "NEW" }) : null,
      el("b", { text: r.company }),
      r.location ? el("span", { text: r.location }) : null,
      posted(r.ageDays) ? el("span", { text: posted(r.ageDays) }) : null);
    const people = (r.people || []).filter((p) => /^https:\/\//.test(p.url));
    const column = r.cohort === GRAD ? "grad" : "open";
    const links = el("p", { className: "rlinks" },
      r.url ? el("a", { href: r.url, target: "_blank", rel: "noopener noreferrer", text: "Open posting ↗", onclick: () => track("posting_opened", { column }) }) : null,
      people.length ? el("span", { text: "Reach out:" }) : null,
      people.map((p) => el("a", { href: p.url, target: "_blank", rel: "noopener noreferrer", text: p.label, onclick: () => track("people_link_opened", { link_type: linkType(p.label) }) })));
    const byAI = r.method === "ai";
    return el("article", { className: "role" },
      el("div", { className: `fit ${t}`, "aria-label": `${byAI ? "AI fit" : "Keyword score"} ${r.fit ?? 0}` },
        el("b", { text: String(r.fit ?? 0) }), el("small", { text: byAI ? "fit" : "match" })),
      el("div", {},
        el("h3", { text: r.title }),
        meta,
        r.dealbreaker ? el("p", { className: "bar", text: r.dealbreaker }) : null,
        r.why ? el("p", { className: "why", text: r.why }) : null,
        byAI && r.gap ? el("p", { className: "gap", text: `Gap: ${r.gap}` }) : null,
        links));
  }

  function fillColumn(listId, roles, showAll = false) {
    const shown = showAll ? roles : roles.slice(0, SHOW_FIRST);
    const nodes = [];
    for (const t of aiBoard ? AI_TIERS : TIERS) {
      const inTier = shown.filter((r) => tier(r) === t.key);
      if (!inTier.length) continue;
      nodes.push(el("p", { className: `tier ${t.key}` }, el("i", { "aria-hidden": "true" }), el("b", { text: t.name }), el("span", { text: t.range })));
      nodes.push(...inTier.map(roleCard));
    }
    if (!roles.length) nodes.push(el("p", { className: "note", text: "Nothing here yet. Try more kinds of role, cities or sectors." }));
    if (!showAll && roles.length > SHOW_FIRST) {
      nodes.push(el("button", { type: "button", className: "btn more", text: `Show all ${roles.length}`, onclick: () => fillColumn(listId, roles, true) }));
    }
    $(listId).replaceChildren(...nodes);
  }

  const count = (n, label, extra = "") => el("div", { className: `count ${extra}` }, el("b", { text: Number(n || 0).toLocaleString("en-US") }), el("span", { text: label }));

  function renderBoard() {
    $("board").hidden = !board;
    if (!board) return;
    const s = board.summary;
    const results = board.results || [];
    setCuts(results);
    $("counts").replaceChildren(
      count(s.companies, "Companies checked"),
      count(s.found, "Open roles found"),
      count(s.passedFilter, "Passed your filters"),
      count(s.scored, "Ranked so far"),
      count(s.newCount, "New since last check", "new"));
    $("methodNote").textContent = methodNote(s);
    const grad = results.filter((r) => r.cohort === GRAD);
    const open = results.filter((r) => r.cohort !== GRAD);
    $("gradCount").textContent = String(grad.length);
    $("openCount").textContent = String(open.length);
    fillColumn("gradList", grad);
    fillColumn("openList", open);
    const dropped = board.droppedByReason || [];
    const total = dropped.reduce((n, d) => n + d.count, 0);
    $("filteredTitle").textContent = `Filtered out (${total.toLocaleString("en-US")}), and why`;
    $("filteredList").replaceChildren(...dropped.map((d) => el("li", { text: `${d.count.toLocaleString("en-US")}: ${d.reason}` })));
  }

  // What made this board's scores, what this check cost, and what is still waiting.
  function methodNote(s) {
    const parts = [`Checked ${ago(s.runAt)}.`];
    if (s.aiScoredThisRun) {
      parts.push(`This check AI-scored ${s.aiScoredThisRun} role${s.aiScoredThisRun === 1 ? "" : "s"} for $${Number(s.costUsd || 0).toFixed(3)}.` +
        (ai?.on ? ` ${ai.left} of ${ai.limit} left today.` : ""));
    }
    if (aiBoard) {
      parts.push("AI fits come from Claude Haiku 5.5 reading each posting against your resume and what you are looking for. Roles without one yet are ranked by the words they share with your resume.");
      if (s.aiWaiting) parts.push(`${s.aiWaiting} ranked role${s.aiWaiting === 1 ? "" : "s"} wait for AI scoring on your next checks.`);
    } else {
      parts.push("Ranked by how many words each role shares with your resume, which is free; scores compare roles with each other and are not a verdict on fit.");
    }
    if (s.aiPaused === "busy") parts.push("AI scoring was busy, so this check ranked new roles by shared words. Try again in a minute.");
    if (s.aiFailed) parts.push(`${s.aiFailed} AI answer${s.aiFailed === 1 ? "" : "s"} could not be read; those roles are tried again next time.`);
    if (s.waiting) parts.push(`${s.waiting} more roles get ranked on your next checks.`);
    return parts.join(" ");
  }

  // ---------- Your data ----------

  async function startOver() {
    if (!window.confirm("Remove your resume and every score and check made from it? Your choices stay.")) return;
    try {
      await api("/api/resume", { method: "DELETE" });
      track("resume_removed");
      me = { ...me, hasResume: false, resumeFileName: null, resumeUploadedAt: null };
      board = null;
      renderResume();
      renderBoard();
      updateGo();
      toast("Removed. Upload a resume to start again.");
      window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function deleteAccount() {
    const typed = window.prompt('This deletes your account and all your data, at once and for good. Type "delete my account" to go ahead.');
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== "delete my account") return toast("Not deleted: the words did not match.", true);
    try {
      await api("/api/account", { method: "DELETE", body: { confirm: "delete my account" } });
      track("account_deleted");
      window.posthog?.reset?.();
      await client.auth.signOut();
      say("Your account and all its data are deleted.");
    } catch (err) {
      toast(err.message, true);
    }
  }

  // ---------- Start ----------

  async function start() {
    let config;
    try {
      const res = await fetch("/api/config");
      config = await res.json();
      if (!res.ok) throw new Error(config.error || `HTTP ${res.status}`);
    } catch (err) {
      $("unavailableText").textContent = err.message || "Sign-in is not switched on here yet.";
      return showCard("unavailable");
    }

    window.shortlistAnalytics?.start(config.analytics);

    // PKCE: the sign-in comes back as a one-time code that only this browser can turn into a session.
    client = window.supabase.createClient(config.supabaseUrl, config.publishableKey, {
      auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

    // Fires once on load with the current session, then on every sign-in, refresh and sign-out. A refresh only
    // swaps the token. Work is deferred so it never runs inside Supabase's own callback.
    client.auth.onAuthStateChange((event, s) => {
      if (event === "TOKEN_REFRESHED") { session = s; return; }
      setTimeout(() => render(s), 0);
    });

    $("google").addEventListener("click", async () => {
      say("Opening Google...");
      track("sign_in_started", { method: "google" });
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
      else {
        track("sign_in_started", { method: "email" });
        say(`Check ${email} for a sign-in link, and open it in this browser.`);
      }
    });

    $("signOut").addEventListener("click", async () => {
      await client.auth.signOut();
      say("Signed out.");
    });

    $("resumeFile").addEventListener("change", (e) => upload(e.target.files[0]));
    const drop = $("drop");
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); upload(e.dataTransfer.files[0]); });
    $("wantsForm").addEventListener("submit", saveWants);
    $("wantsEdit").addEventListener("click", () => { editing = true; renderWants(); });
    $("checkBtn").addEventListener("click", runCheck);
    $("startOver").addEventListener("click", startOver);
    $("deleteAccount").addEventListener("click", deleteAccount);
  }

  start();
})();
