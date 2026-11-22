// PostHog on the hosted site (Build 3). It loads only when Vercel has POSTHOG_KEY set (a public project key).
// The page shows a resume's file name, job titles and email addresses, so:
//   - nobody is identified, and automatic click capture, heatmaps, surveys and performance capture are off;
//   - session replay records with every piece of text and every input masked, so a replay shows the layout and
//     the clicks, never a resume line, a job title or an email;
//   - track() sends only the events and properties listed here (counts and kinds), and before_send drops anything
//     else. Never add resume text, titles, companies, schools, emails or choices.
// The loader is PostHog's standard one, kept in this file so the page runs no inline script.
window.shortlistAnalytics = (() => {
  const EVENTS = {
    sign_in_started: ["method"],
    resume_uploaded: ["file_type"],
    setup_saved: ["roles_count", "cities_count", "sectors_count", "first_time"],
    check_run: ["ranked", "new_count", "scoring"],
    posting_opened: ["column"],
    people_link_opened: ["link_type"],
    resume_removed: [],
    account_deleted: []
  };
  // Page views, and $snapshot, which carries the (masked) session replay.
  const SYSTEM_EVENTS = ["$pageview", "$pageleave", "$snapshot"];

  function start(cfg) {
    if (!cfg?.key || window.posthog?.__loaded) return;
    // PostHog's standard loader: queues calls until array.js arrives from PostHog's servers.
    !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once unregister identify reset get_distinct_id opt_in_capturing opt_out_capturing has_opted_out_capturing set_config".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
    window.posthog.init(cfg.key, {
      api_host: cfg.host,
      person_profiles: "identified_only",
      autocapture: false,
      rageclick: false,
      capture_dead_clicks: false,
      capture_performance: false,
      enable_heatmaps: false,
      disable_surveys: true,
      capture_pageview: true,
      disable_session_recording: false,
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: "*",
        recordCrossOriginIframes: false
      },
      before_send: (event) => (event && (EVENTS[event.event] || SYSTEM_EVENTS.includes(event.event)) ? event : null)
    });
    window.posthog.register({ app: "hosted", environment: cfg.environment });
  }

  function track(event, props = {}) {
    if (!window.posthog || !EVENTS[event]) return;
    const safe = {};
    for (const k of EVENTS[event]) if (props[k] !== undefined) safe[k] = props[k];
    window.posthog.capture(event, safe);
  }

  return { start, track, EVENTS };
})();
