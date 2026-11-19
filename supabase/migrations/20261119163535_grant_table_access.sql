-- Table access for Supabase's API roles (CLOUD-PLAN.md, step 2).
--
-- This project gives its API roles no table access by default: npm run check-rls found every request
-- refused with "permission denied for table", even with the server's secret key. Grants open the doors;
-- row level security (the first migration) still decides which rows each request can see or change.
--   authenticated  signed-in people: read and change their own four tables, read the server's tables
--   service_role   the server's secret key: everything
--   anon           signed-out visitors: nothing (no grant here on purpose)

grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete on public.profiles, public.preferences, public.watchlist, public.decisions
  to authenticated;
grant select on public.postings, public.scores, public.runs, public.ai_usage
  to authenticated;

grant select, insert, update, delete on public.profiles, public.preferences, public.watchlist, public.postings,
  public.scores, public.decisions, public.runs, public.ai_usage, public.site_spend
  to service_role;

-- The id counters behind watchlist and runs.
grant usage, select on sequence public.watchlist_id_seq to authenticated;
grant usage, select on all sequences in schema public to service_role;
