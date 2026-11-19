-- Shortlist's first database schema (CLOUD-PLAN.md, step 2).
--
-- Privacy rules, enforced by Postgres itself with row level security:
--   * A signed-in person reads and changes only rows with their own user_id.
--   * Scores, check summaries and AI usage are written only by the server; people can read their own.
--   * Job postings are public data: any signed-in person can read them, only the server writes them.
--   * Site-wide AI spending is server only. Nobody else can read it.
--   * Signed-out visitors (the "anon" role) can read nothing at all.
-- Deleting a person from auth.users deletes all of their rows ("on delete cascade").

-- Keeps updated_at current on every change.
create or replace function public.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- The resume and "What I'm looking for". The server encrypts the resume text before saving it (step 3),
-- so this table never holds a resume in plain text.
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  resume_ciphertext text,
  resume_file_name text,
  resume_uploaded_at timestamptz,
  looking_for text not null default '' check (char_length(looking_for) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Setup choices, dials and filter rules: the same shape as data/preferences.json in the local app.
create table public.preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create trigger preferences_touch before update on public.preferences
  for each row execute function public.touch_updated_at();

-- The companies on each person's list.
create table public.watchlist (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  company text not null check (char_length(company) between 1 and 120),
  ats text not null check (ats in ('greenhouse', 'lever', 'ashby', 'workday', 'smartrecruiters')),
  board text not null check (char_length(board) between 1 and 300),
  sector text,
  added_at timestamptz not null default now(),
  unique (user_id, ats, board)
);
create index watchlist_user_idx on public.watchlist (user_id);
create index watchlist_board_idx on public.watchlist (ats, board);

-- Public job postings, fetched by the server once for every watched company. The id matches the local app
-- ("greenhouse:<board>:<job id>"). Descriptions are filled in only for roles about to be scored.
create table public.postings (
  id text primary key,
  ats text not null,
  board text not null,
  company text not null,
  title text not null,
  location text,
  url text,
  department text,
  posted_at timestamptz,
  description text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  closed_at timestamptz
);
create index postings_board_idx on public.postings (ats, board);
create index postings_last_seen_idx on public.postings (last_seen);

-- Each person's scores, AI and keyword kept apart as in the local app. cache_key ties a score to the resume
-- version and model, so a role is paid for once per resume. A posting's scores go when the posting does.
create table public.scores (
  user_id uuid not null references auth.users (id) on delete cascade,
  posting_id text not null references public.postings (id) on delete cascade,
  method text not null check (method in ('ai', 'keywords')),
  cache_key text not null,
  fit integer check (fit between 0 and 100),
  track text,
  why text,
  gap text,
  dealbreaker text,
  cohort text,
  model text,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  cost_usd numeric(10, 6) not null default 0,
  scored_at timestamptz not null default now(),
  primary key (user_id, posting_id, method)
);

-- Saved, applied, or passed with a reason. The snapshot keeps the role as it was shown, so a decision
-- outlives the posting (no link to postings on purpose).
create table public.decisions (
  user_id uuid not null references auth.users (id) on delete cascade,
  posting_id text not null,
  decision text not null check (decision in ('saved', 'applied', 'passed')),
  reason text check (reason in ('function', 'senior', 'location', 'company', 'other')),
  snapshot jsonb not null default '{}'::jsonb,
  decided_at timestamptz not null default now(),
  primary key (user_id, posting_id),
  check (decision <> 'passed' or reason is not null)
);

-- Each check's summary: counts, cost, model.
create table public.runs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  run_at timestamptz not null default now(),
  summary jsonb not null default '{}'::jsonb
);
create index runs_user_idx on public.runs (user_id, run_at desc);

-- AI scoring per person per day, for the "AI checks left today" counter.
create table public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  roles_scored integer not null default 0,
  cost_usd numeric(10, 6) not null default 0,
  primary key (user_id, day)
);

-- AI scoring across everyone per day, for the site-wide cap.
create table public.site_spend (
  day date primary key,
  roles_scored integer not null default 0,
  cost_usd numeric(10, 6) not null default 0
);

-- Row level security on every table. With it on, a request sees only rows a policy allows; none means none.
alter table public.profiles enable row level security;
alter table public.preferences enable row level security;
alter table public.watchlist enable row level security;
alter table public.postings enable row level security;
alter table public.scores enable row level security;
alter table public.decisions enable row level security;
alter table public.runs enable row level security;
alter table public.ai_usage enable row level security;
alter table public.site_spend enable row level security;

-- Rows a person may read and change: their own. "(select auth.uid())" is the signed-in person's id.
create policy "Own profile" on public.profiles for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Own preferences" on public.preferences for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Own watchlist" on public.watchlist for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Own decisions" on public.decisions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Rows a person may only read: their own. The server writes these.
create policy "Read own scores" on public.scores for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Read own runs" on public.runs for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Read own AI usage" on public.ai_usage for select to authenticated
  using (user_id = (select auth.uid()));

-- Public postings: any signed-in person may read them.
create policy "Signed-in people read postings" on public.postings for select to authenticated
  using (true);

-- site_spend has no policy on purpose: only the server's secret key, which skips row level security, reaches it.

-- A second lock behind the policies: signed-out visitors get no table access at all, and signed-in people
-- cannot write the server's tables even if a policy were added by mistake.
revoke all on public.profiles, public.preferences, public.watchlist, public.postings, public.scores,
  public.decisions, public.runs, public.ai_usage, public.site_spend from anon;
revoke insert, update, delete, truncate on public.postings, public.scores, public.runs, public.ai_usage
  from authenticated;
revoke all on public.site_spend from authenticated;
