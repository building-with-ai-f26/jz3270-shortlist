-- Signed-in people stop writing to their own rows directly through Supabase's database API (SECURITY.md,
-- the agent review). Until now they could insert, change and delete their own profile, preferences, watchlist
-- and decisions with their session token and the publishable key, which skipped the site's own checks and rate
-- limits (for example, deleting the profile row reset the upload limit). The hosted site's server functions
-- already make every one of these writes, after checking them: /api/resume (the profile), /api/setup
-- (preferences and "What I'm looking for") and /api/account. Nothing writes the watchlist or decisions yet; when
-- something does, it will be a server function too.
--
-- People keep reading their own rows, and row level security still limits every read to their own. The
-- "own rows" policies stay as a second fence, in case a later migration ever grants writes back.
revoke insert, update, delete on public.profiles, public.preferences, public.watchlist, public.decisions
  from authenticated;
revoke usage, select on sequence public.watchlist_id_seq from authenticated;
