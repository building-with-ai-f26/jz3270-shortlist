// The shared job boards (CLOUD-PLAN.md, "fetch once, rank per person"). Job boards are public and the same for
// everyone, so the hosted site fetches them once a day into the postings table, and each person's check only
// reads from it. Only the server writes postings (row level security lets signed-in people read them).
//
// For now the hosted site reads the starter companies on Greenhouse, Lever and Ashby (195 of 242). Workday
// limits how fast one address may ask, and a cloud host shares its addresses, so Workday and SmartRecruiters
// stay on the laptop app until a gentler daily fetch is built.
import { createRequire } from "node:module";
import { fetchAll } from "../sources.js";
import { asServer, ok } from "./supabase.js";

const require = createRequire(import.meta.url);
export const HOSTED_ATS = ["greenhouse", "lever", "ashby"];
// Only roles posted in the last 30 days are kept (the longest window a person can pick), plus undated ones.
export const KEEP_DAYS = 30;
const MAX_DESCRIPTION = 8000;
const BATCH = 500;

export function hostedStarter() {
  return require("../../config/starter-watchlist.json").companies.filter((c) => HOSTED_ATS.includes(c.ats));
}

function isoOrNull(value) {
  const t = value ? Date.parse(value) : NaN;
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// One fetched board becomes rows for the postings table. Greenhouse lists roles without their description,
// so those rows leave the description out (an upsert then keeps one filled in by an earlier check).
export function toRows(result, now = Date.now()) {
  const seen = new Date(now).toISOString();
  const oldest = now - KEEP_DAYS * 86400000;
  return result.postings
    .map((p) => ({ p, postedAt: isoOrNull(p.postedAt) }))
    .filter(({ postedAt }) => !postedAt || Date.parse(postedAt) >= oldest)
    .map(({ p, postedAt }) => {
      const row = {
        id: p.id,
        ats: result.entry.ats,
        board: result.entry.board,
        company: result.entry.company,
        title: (p.title || "").slice(0, 300) || "(untitled)",
        location: (p.location || "").slice(0, 300),
        url: p.url || null,
        department: (p.department || "").slice(0, 200),
        posted_at: postedAt,
        last_seen: seen,
        closed_at: null
      };
      if (p.text) row.description = p.text.slice(0, MAX_DESCRIPTION);
      return row;
    });
}

// PostgREST's "in" list, with each value quoted so commas or dots in a board name cannot break the filter.
export const inList = (values) => `(${values.map((v) => `"${String(v).replace(/["\\]/g, (c) => `\\${c}`)}"`).join(",")})`;
const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

export async function upsertPostings(rows, { env, fetchImpl } = {}) {
  // Rows with and without a description go separately: every row in one request must have the same columns.
  const groups = [rows.filter((r) => "description" in r), rows.filter((r) => !("description" in r))];
  for (const group of groups) {
    for (const batch of chunks(group, BATCH)) {
      await ok(await asServer("/rest/v1/postings?on_conflict=id", {
        method: "POST", body: batch, prefer: "resolution=merge-duplicates,return=minimal", env, fetchImpl
      }), "Saving postings");
    }
  }
}

// Fetches the boards, saves what is open and recent, marks roles that left a board (or aged past 30 days) as
// closed, and deletes roles closed for over 30 days. A board that fails keeps its roles as they were.
export async function refreshPostings(boards = hostedStarter(), { env = process.env, fetchImpl = fetch, now = Date.now(), onBoard } = {}) {
  const started = Date.now();
  const list = boards.filter((b) => HOSTED_ATS.includes(b.ats));
  const results = await fetchAll(list, fetchImpl, 8, { onBoard });
  const rows = results.filter((r) => !r.error).flatMap((r) => toRows(r, now));
  await upsertPostings(rows, { env, fetchImpl });

  const runStart = new Date(now).toISOString();
  for (const ats of HOSTED_ATS) {
    const fine = results.filter((r) => !r.error && r.entry.ats === ats).map((r) => r.entry.board);
    for (const group of chunks(fine, 60)) {
      const query = `ats=eq.${ats}&board=in.${encodeURIComponent(inList(group))}&last_seen=lt.${encodeURIComponent(runStart)}&closed_at=is.null`;
      await ok(await asServer(`/rest/v1/postings?${query}`, {
        method: "PATCH", body: { closed_at: runStart }, prefer: "return=minimal", env, fetchImpl
      }), "Closing postings");
    }
  }
  const forget = new Date(now - KEEP_DAYS * 86400000).toISOString();
  await ok(await asServer(`/rest/v1/postings?closed_at=lt.${encodeURIComponent(forget)}`, {
    method: "DELETE", prefer: "return=minimal", env, fetchImpl
  }), "Removing old postings");

  const errors = results.filter((r) => r.error).map((r) => ({ company: r.entry.company, error: r.error }));
  return {
    boards: list.length,
    boardsFailed: errors.length,
    errors: errors.slice(0, 20),
    found: results.reduce((n, r) => n + r.postings.length, 0),
    saved: rows.length,
    seconds: Math.round((Date.now() - started) / 1000)
  };
}
