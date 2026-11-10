// The app page shows a resume, job titles and scores, so analytics must only ever send named events with
// a short list of safe properties. These checks read the page source, so a later edit cannot quietly widen that.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const allowed = Object.fromEntries([...page.matchAll(/^\s+(\w+): \[([^\]]*)\],?$/gm)]
  .filter(([, name]) => /_/.test(name))
  .map(([, name, list]) => [name, list.split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean)]));

test("only track() talks to PostHog, with click capture and session recording off", () => {
  assert.equal(page.match(/posthog\.capture\(/g).length, 1, "posthog.capture is called only inside track()");
  assert.match(page, /autocapture: false/);
  assert.match(page, /disable_session_recording: true/);
  assert.match(page, /capture_dead_clicks: false/);
  assert.match(page, /before_send: /, "a last filter drops any event that is not on the list");
  assert.ok(Object.keys(allowed).length >= 5, "the EVENTS list was found");
});

test("every tracked event is listed, and sends only listed properties", () => {
  const calls = [...page.matchAll(/track\("(\w+)", \{([^}]*)\}/g)];
  assert.ok(calls.length >= 6, "the event calls were found");
  for (const [, event, body] of calls) {
    assert.ok(allowed[event], `${event} is in EVENTS`);
    const keys = body.split(",").map((part) => part.trim().split(":")[0].trim()).filter(Boolean);
    for (const k of keys) assert.ok(allowed[event].includes(k), `${event} sends "${k}", which is not in its list`);
  }
});

test("nothing that could carry a resume, a score or a company name is on any list", () => {
  const all = Object.values(allowed).flat();
  for (const banned of ["fit", "score", "title", "company", "resume", "text", "school", "schools", "roles", "cities", "sectors", "url"]) {
    assert.ok(!all.includes(banned), `"${banned}" must never be sent`);
  }
});
