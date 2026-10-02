-- ============================================================
-- Bros Before Boges — players' emails and GHIN numbers private, and only admins change matchups
-- and round scores (2027)
-- Order: 1. push the site update first. Its Admin page then says "Email and GHIN privacy isn't
--           switched on yet", which is how you know the new site is live.
--        2. then run this entire script once in the Supabase SQL Editor (it needs
--           payments_2027.sql, which has already run). Safe to run again.
-- Don't run it before the site update is live: the site from before that update reads emails
-- straight from the players table, so its Admin login, the Bookie's name linking, the Round
-- Tracker and the homepage's Golf profile would stop working until the page is reloaded with the
-- new site. (Nothing would be lost: those requests just fail.)
-- ============================================================
-- What it does:
--   1. Emails and GHIN numbers can't be read from the players table with the site's key any more:
--      not signed out, not signed in, not as an admin. Neither can any column that looks like
--      contact details (phone, address, ...), if the table has one. Names, handicaps, teams,
--      statuses and which login holds each name stay readable, as the site needs them.
--      Signed-in users can also still read the table's other columns (is_admin and the like);
--      signed-out visitors can't, as before.
--   2. Three functions hand out what each person may see:
--        my_player()              your own roster row, with your email and GHIN. A name you picked
--                                 that is waiting for the commissioner's OK comes back without them
--                                 (they're the real player's).
--        claim_roster_by_email()  links your login to the unclaimed roster name whose email is your
--                                 login's email (the Bookie and the Round Tracker call it for you).
--        admin_players()          the whole roster, emails and GHINs included: admins only.
--   3. Only admins can change the Ryder Cup matchups and the official round scores (Admin's
--      Matchups and Score Entry tabs). Until now anyone could change matchups, even signed out,
--      and any signed-in login (anyone can sign up) could change round scores. Everyone can still
--      read both. The old pairings table, which the site doesn't use, is admins-only too.
--   4. Removes the dashboard rule "Allow admins to update ryder_cup_scores". It finds admins by
--      looking up their email as the signed-in user, which can't work once emails are private (it
--      is what stopped this script the first time). payments_2027.sql's admin-only rule already
--      does its job, so the Ryder Cup total works exactly as before: admins save it, nobody else.
--   5. Closes a way to guess emails and GHINs. Any signed-in login could "save" a guessed email or
--      GHIN onto someone's roster row: the save went through when the guess was right (nothing
--      changed) and was refused when it was wrong, which gave the answer away. Now, when someone
--      who isn't an admin saves a roster row, the email and GHIN (and any other column they can't
--      read) keep their stored values, whatever was sent. So the answer never depends on them.
--      Non-admins still can't change anything on a roster row except linking a name to their own
--      login.
--   Nothing else changes. Admin still adds, edits and removes players, a login can still pick its
--   name, and RSVPs, the Bookie, scores and payments work as before. The SQL editor and the table
--   editor still see and change everything.
--
-- If players_privacy.sql (the 2026 version) is ever run again, it lets signed-out visitors read
-- GHIN numbers again. If rsvp_accounts.sql is run again, it puts back the older roster guard (the
-- one that gave guesses away). Either way, run this script again after it. The check at the end says so.

-- 0. Checks first. If one fails the script stops here, before changing anything ---------------
DO $$
DECLARE
  -- Private: email, ghin, and any column whose name looks like contact details (the same rule as
  -- section 3 and the check at the end)
  c_private CONSTANT text := '^(email|ghin)$|(^|_)(e_?mail|ghin|phone|mobile|cell|tel|sms|whatsapp|text|address|addr|street|city|zip|postal|postcode|birth|dob|ssn|venmo|paypal|zelle|cash_?app|emergency|note)';
  -- Section 2 removes this rule (it looks up emails as the signed-in user)
  c_old_cup CONSTANT text := 'Allow admins to update ryder_cup_scores';
  v_missing text;
  v_private text[];
  v_fns text[];
  v_bad text;
  v_tbl text;
BEGIN
  -- Needs payments_2027.sql (the "your own roster row" rule) and rsvp_accounts.sql
  IF to_regprocedure('public.is_trip_admin()') IS NULL
     OR to_regprocedure('public.payments_my_player()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.players'::regclass AND tgname = 'aab_players_claim_review')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.players'::regclass AND tgname = 'aaa_players_guard'
                      AND tgfoid = to_regprocedure('public.players_guard()')) THEN
    RAISE EXCEPTION 'Run payments_2027.sql first (this script uses its "your own roster row" rule), then run this again. Nothing was changed.';
  END IF;
  SELECT string_agg(c, ', ') INTO v_missing
  FROM unnest(ARRAY['id', 'name', 'email', 'ghin', 'handicap', 'team_id', 'status', 'is_admin', 'user_id']) c
  WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.players'::regclass
                      AND a.attname = c AND a.attnum > 0 AND NOT a.attisdropped);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'The players table has no % column, which this script expects. Nothing was changed.', v_missing;
  END IF;
  IF to_regclass('public.matchups') IS NULL OR to_regclass('public.player_round_scores') IS NULL
     OR to_regclass('public.ryder_cup_scores') IS NULL THEN
    RAISE EXCEPTION 'The matchups, player_round_scores or ryder_cup_scores table is missing, which this script expects. Nothing was changed.';
  END IF;

  -- A table rule (row security policy) that looks up a private column of players as the signed-in
  -- user, directly or through a function that runs as the signed-in user, would start failing.
  SELECT array_agg(a.attname::text ORDER BY a.attnum) INTO v_private
  FROM pg_attribute a
  WHERE a.attrelid = 'public.players'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attname ~* c_private;
  -- Functions that run as the caller (not SECURITY DEFINER) and look up a private column of players
  SELECT array_agg(DISTINCT p.proname::text) INTO v_fns
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL (SELECT regexp_replace(COALESCE(p.prosrc, ''), '''[^'']*''', '', 'g') AS txt) s
  WHERE NOT p.prosecdef AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND p.proname ~ '^[A-Za-z_][A-Za-z0-9_]*$'
    AND s.txt ~* '\mplayers\M' AND s.txt ~* ('\m(' || array_to_string(v_private, '|') || ')\M');
  SELECT string_agg(format('"%s" on %s.%s', pol.policyname, pol.schemaname, pol.tablename), '; '
                    ORDER BY pol.schemaname, pol.tablename, pol.policyname)
  INTO v_bad
  FROM pg_policies pol
  CROSS JOIN LATERAL (SELECT regexp_replace(COALESCE(pol.qual, '') || ' ' || COALESCE(pol.with_check, ''), '''[^'']*''', '', 'g') AS txt) s
  WHERE NOT (pol.schemaname = 'public' AND pol.tablename = 'ryder_cup_scores' AND pol.policyname = c_old_cup)
    AND ((s.txt ~* '\mplayers\M' AND s.txt ~* ('\m(' || array_to_string(v_private, '|') || ')\M'))
         OR s.txt ~* ('\m(' || array_to_string(ARRAY['payments_actor', 'payments_player_on_site'] || COALESCE(v_fns, '{}'), '|') || ')\M'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Nothing was changed. These table rules look up % in players as the signed-in user, and would stop working once that is private: %',
      array_to_string(v_private, ', '), v_bad;
  END IF;

  -- Without the old Cup rule, admins still need a rule that lets them change the Ryder Cup total
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ryder_cup_scores' AND policyname = c_old_cup)
     AND NOT EXISTS (SELECT 1 FROM pg_policies
                     WHERE schemaname = 'public' AND tablename = 'ryder_cup_scores' AND policyname <> c_old_cup
                       AND permissive = 'PERMISSIVE' AND cmd IN ('UPDATE', 'ALL')
                       AND roles && ARRAY['authenticated', 'public']::name[]) THEN
    RAISE EXCEPTION 'Nothing was changed. This script removes the rule "%" (it looks up emails, which become private), but no other rule lets admins change the Ryder Cup total. First run: CREATE POLICY ryder_cup_scores_auth_update ON public.ryder_cup_scores FOR UPDATE TO authenticated USING (true) WITH CHECK (true); (payments_2027.sql''s admin-only rule still keeps it to admins), then run this again.', c_old_cup;
  END IF;

  -- Section 2 turns row security on for matchups and player_round_scores. Where it's off today,
  -- that must not hide them from the boards that read them (everyone, signed in or not).
  FOREACH v_tbl IN ARRAY ARRAY['matchups', 'player_round_scores'] LOOP
    IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass('public.' || v_tbl))
       AND NOT (EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = v_tbl AND permissive = 'PERMISSIVE'
                          AND cmd IN ('SELECT', 'ALL') AND qual = 'true' AND roles && ARRAY['anon', 'public']::name[])
                AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = v_tbl AND permissive = 'PERMISSIVE'
                              AND cmd IN ('SELECT', 'ALL') AND qual = 'true' AND roles && ARRAY['authenticated', 'public']::name[])) THEN
      RAISE EXCEPTION 'Nothing was changed. Row security is off on %, and no rule lets everyone read it, so turning it on would empty the boards that show it. First run: CREATE POLICY "%_public_read" ON public.% FOR SELECT USING (true); then run this again.',
        v_tbl, v_tbl, v_tbl;
    END IF;
  END LOOP;
END $$;

-- 1. What each person may see ------------------------------------------------------------
-- Your own roster row (any status), or null when your login isn't linked to a name. Email and
-- GHIN only when the row is yours by payments_2027.sql's rule (payments_my_player): a confirmed
-- name, or a sign-up's own row. own_ok says which.
CREATE OR REPLACE FUNCTION public.my_player()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
           'id', p.id, 'name', p.name, 'status', p.status, 'team_id', p.team_id,
           'handicap', p.handicap, 'user_id', p.user_id, 'is_admin', COALESCE(p.is_admin, false),
           'own_ok', x.own,
           'email', CASE WHEN x.own THEN p.email END,
           'ghin', CASE WHEN x.own THEN p.ghin END)
  FROM public.players p
  CROSS JOIN LATERAL (SELECT COALESCE(p.id = public.payments_my_player(), false) AS own) x
  WHERE auth.uid() IS NOT NULL AND p.user_id = auth.uid()
  ORDER BY p.id
  LIMIT 1;
$$;
COMMENT ON FUNCTION public.my_player() IS 'The signed-in login''s own roster row; email and GHIN only when it is the login''s own (payments_my_player). Null when not linked.';

-- Link the signed-in login to the roster name nobody has claimed whose email is the login's email
-- (any case, spaces ignored; Confirm email is on, so the login owns that address). Returns
-- my_player() plus claimed (true when this call linked it), or null when no such name exists.
-- A login that is already linked gets its own row back (claimed false) and nothing changes.
-- (Runs as the owner, so players_guard doesn't check it: it does the same checks itself.)
CREATE OR REPLACE FUNCTION public.claim_roster_by_email()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text := lower(btrim(COALESCE(auth.jwt() ->> 'email', '')));
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Log in first.' USING ERRCODE = '28000';
  END IF;
  -- One link at a time per login
  PERFORM pg_advisory_xact_lock(hashtextextended('bbb.claim_roster_by_email:' || auth.uid()::text, 0));
  IF EXISTS (SELECT 1 FROM public.players WHERE user_id = auth.uid()) THEN
    RETURN public.my_player() || jsonb_build_object('claimed', false);
  END IF;
  IF v_email = '' THEN
    RETURN NULL;
  END IF;
  SELECT p.id INTO v_id FROM public.players p
  WHERE p.user_id IS NULL AND lower(btrim(p.email)) = v_email
  ORDER BY (COALESCE(p.status, 'confirmed') = 'confirmed') DESC, p.name, p.id
  LIMIT 1
  FOR UPDATE;
  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;
  UPDATE public.players SET user_id = auth.uid() WHERE id = v_id AND user_id IS NULL;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN public.my_player() || jsonb_build_object('claimed', true);
END;
$$;
COMMENT ON FUNCTION public.claim_roster_by_email() IS 'Links the signed-in login to the unclaimed roster name with its email; returns my_player() + claimed, or null.';

-- Admin: every roster row, every column, confirmed before potential, then by name (the order
-- Admin's roster always had).
CREATE OR REPLACE FUNCTION public.admin_players()
RETURNS SETOF public.players
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Log in first.' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_trip_admin() THEN
    RAISE EXCEPTION 'Admins only.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT p.* FROM public.players p ORDER BY p.status, p.name, p.id;
END;
$$;
COMMENT ON FUNCTION public.admin_players() IS 'Admins only: the whole roster with emails and GHINs (Admin''s roster and RSVP tabs).';

-- Only signed-in users can call these (Supabase lets everyone run new functions unless told otherwise)
REVOKE ALL ON FUNCTION public.my_player() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_roster_by_email() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_players() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_player() TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_roster_by_email() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_players() TO authenticated;

-- 2. Who can change matchups, round scores and the Ryder Cup total ----------------------------
-- The Cup total. This rule was made in the Supabase dashboard: it finds admins by looking up their
-- email as the signed-in user, which can't work once emails are private. It isn't needed:
-- payments_2027.sql's admin-only rules (ryder_cup_scores_admin_only_...) already let only admins
-- change the total, through the rules rls_policies.sql made. Without it, the Cup total works
-- exactly as before: admins save it from Admin, and nobody else can change it.
DROP POLICY IF EXISTS "Allow admins to update ryder_cup_scores" ON public.ryder_cup_scores;

-- Matchups (Admin's Matchups tab) and official round scores (Admin's Score Entry). Rules made in
-- the dashboard let anyone change matchups, even signed out, and any signed-in login change round
-- scores. Only Admin writes them. These rules apply on top of all the others (the way
-- payments_2027.sql locked the Cup total), so only admins can add, change or remove rows. Reading
-- is not touched: the homepage, Round Tracker and Bookie still show them to everyone. Row security
-- is turned on so the rules count (the checks in section 0 made sure that hides nothing).
ALTER TABLE public.matchups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "matchups_admin_only_insert" ON public.matchups;
CREATE POLICY "matchups_admin_only_insert" ON public.matchups AS RESTRICTIVE FOR INSERT
  TO anon, authenticated WITH CHECK (public.is_trip_admin());
DROP POLICY IF EXISTS "matchups_admin_only_update" ON public.matchups;
CREATE POLICY "matchups_admin_only_update" ON public.matchups AS RESTRICTIVE FOR UPDATE
  TO anon, authenticated USING (public.is_trip_admin()) WITH CHECK (public.is_trip_admin());
DROP POLICY IF EXISTS "matchups_admin_only_delete" ON public.matchups;
CREATE POLICY "matchups_admin_only_delete" ON public.matchups AS RESTRICTIVE FOR DELETE
  TO anon, authenticated USING (public.is_trip_admin());

ALTER TABLE public.player_round_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "player_round_scores_admin_only_insert" ON public.player_round_scores;
CREATE POLICY "player_round_scores_admin_only_insert" ON public.player_round_scores AS RESTRICTIVE FOR INSERT
  TO anon, authenticated WITH CHECK (public.is_trip_admin());
DROP POLICY IF EXISTS "player_round_scores_admin_only_update" ON public.player_round_scores;
CREATE POLICY "player_round_scores_admin_only_update" ON public.player_round_scores AS RESTRICTIVE FOR UPDATE
  TO anon, authenticated USING (public.is_trip_admin()) WITH CHECK (public.is_trip_admin());
DROP POLICY IF EXISTS "player_round_scores_admin_only_delete" ON public.player_round_scores;
CREATE POLICY "player_round_scores_admin_only_delete" ON public.player_round_scores AS RESTRICTIVE FOR DELETE
  TO anon, authenticated USING (public.is_trip_admin());

-- pairings: an old table the site doesn't use; any signed-in login could write it. Admins only.
DO $$
BEGIN
  IF to_regclass('public.pairings') IS NOT NULL THEN
    ALTER TABLE public.pairings ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "pairings_admin_only_insert" ON public.pairings;
    CREATE POLICY "pairings_admin_only_insert" ON public.pairings AS RESTRICTIVE FOR INSERT
      TO anon, authenticated WITH CHECK (public.is_trip_admin());
    DROP POLICY IF EXISTS "pairings_admin_only_update" ON public.pairings;
    CREATE POLICY "pairings_admin_only_update" ON public.pairings AS RESTRICTIVE FOR UPDATE
      TO anon, authenticated USING (public.is_trip_admin()) WITH CHECK (public.is_trip_admin());
    DROP POLICY IF EXISTS "pairings_admin_only_delete" ON public.pairings;
    CREATE POLICY "pairings_admin_only_delete" ON public.pairings AS RESTRICTIVE FOR DELETE
      TO anon, authenticated USING (public.is_trip_admin());
  END IF;
END $$;

-- 3. Who can read which columns of players -----------------------------------------------------
-- Private: email, ghin, and any column whose name looks like contact details. Everyone: the six
-- columns the homepage, Bookie and Round Tracker read. Signed-in users: every column that isn't
-- private (as before, minus the private ones). Writing is not touched: Admin still adds, edits and
-- removes players, and players_guard still stops everyone else. (Section 0 already made sure no
-- table rule needs a private column.)
DO $$
DECLARE
  c_public  CONSTANT text[] := ARRAY['id', 'name', 'handicap', 'team_id', 'status', 'user_id'];
  c_private CONSTANT text := '^(email|ghin)$|(^|_)(e_?mail|ghin|phone|mobile|cell|tel|sms|whatsapp|text|address|addr|street|city|zip|postal|postcode|birth|dob|ssn|venmo|paypal|zelle|cash_?app|emergency|note)';
  v_anon text;
  v_auth text;
BEGIN
  IF EXISTS (SELECT 1 FROM unnest(c_public) c WHERE c ~* c_private) THEN
    RAISE EXCEPTION 'privacy_2027.sql: a public column matches the private pattern. Nothing was changed.';
  END IF;
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_anon
  FROM pg_attribute a
  WHERE a.attrelid = 'public.players'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attname = ANY (c_public);
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_auth
  FROM pg_attribute a
  WHERE a.attrelid = 'public.players'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attname !~* c_private;

  -- A table-wide REVOKE also drops every column grant (players_privacy.sql's included)
  EXECUTE 'REVOKE SELECT ON TABLE public.players FROM PUBLIC, anon, authenticated';
  EXECUTE format('GRANT SELECT (%s) ON TABLE public.players TO anon', v_anon);
  EXECUTE format('GRANT SELECT (%s) ON TABLE public.players TO authenticated', v_auth);
END $$;

-- 4. Saving a roster row can't test a guessed email or GHIN ----------------------------------
-- rsvp_accounts.sql's players_guard, with one step added. The guard lets someone who isn't an admin
-- do one thing to a roster row: link an unclaimed name to their own login. It refuses anything else
-- by comparing the whole row before and after, so saving a guessed email or GHIN onto a row went
-- through when the guess was right (nothing changed) and was refused when it was wrong. Now the
-- columns that person can't read (email, GHIN and the rest of section 3's private columns) keep
-- their stored values first, whatever was sent, so the answer never depends on them. Everything
-- else is as before: admins, the SQL editor and the functions above change anything; everyone else
-- can only link a name to their own login. (If the undo snippet at the end is run, everything is
-- readable again and this step keeps nothing: the guard then works exactly like the old one.)
CREATE OR REPLACE FUNCTION public.players_guard()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  -- Only browser requests are checked (they run as the anon or authenticated role). The SQL
  -- editor, the table editor and the functions that run as their owner run as other roles.
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF current_user = 'authenticated' THEN
    IF public.is_trip_admin() THEN
      RETURN COALESCE(NEW, OLD);
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Only the commissioner can add players. New players sign up on The Bookie.' USING ERRCODE = '42501';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Only the commissioner can remove players.' USING ERRCODE = '42501';
  END IF;

  -- UPDATE: the one thing a signed-in player may do is link an unclaimed roster name to
  -- their own login (The Bookie's name picker). Signed-out visitors can't change anything.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Log in first.' USING ERRCODE = '42501';
  END IF;
  -- Columns this login can't read (email, GHIN, ...) keep their stored values, whatever the request
  -- sent: whether it goes through must never depend on them (privacy_2027.sql).
  NEW := jsonb_populate_record(NEW, COALESCE((
           SELECT jsonb_object_agg(a.attname, to_jsonb(OLD) -> a.attname::text)
           FROM pg_catalog.pg_attribute a
           WHERE a.attrelid = TG_RELID AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
             AND NOT has_column_privilege(current_user, TG_RELID, a.attnum, 'SELECT')), '{}'::jsonb));
  -- Everything except user_id must stay as it was (id included). Ignored: updated_at (in case
  -- something stamps it) and any database-generated columns (they read as NULL here).
  IF (to_jsonb(NEW) - 'user_id' - 'updated_at' - ARRAY(SELECT attname::text FROM pg_catalog.pg_attribute WHERE attrelid = TG_RELID AND attgenerated <> '' AND NOT attisdropped))
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'user_id' - 'updated_at' - ARRAY(SELECT attname::text FROM pg_catalog.pg_attribute WHERE attrelid = TG_RELID AND attgenerated <> '' AND NOT attisdropped)) THEN
    RAISE EXCEPTION 'Only the commissioner can change roster details.' USING ERRCODE = '42501';
  END IF;
  IF NEW.user_id IS NOT DISTINCT FROM OLD.user_id THEN
    RETURN NEW;
  END IF;
  IF OLD.user_id IS NOT NULL OR NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'That roster name is linked to another login.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.players WHERE user_id = auth.uid() AND id <> OLD.id) THEN
    RAISE EXCEPTION 'Your login is already linked to a roster name. Ask the commissioner to change it.' USING ERRCODE = '42501';
  END IF;
  -- An admin's row can only be linked by the login with that admin's email
  IF OLD.is_admin AND lower(btrim(COALESCE(OLD.email, ''))) IS DISTINCT FROM lower(auth.jwt() ->> 'email') THEN
    RAISE EXCEPTION 'That roster name is reserved. Ask the commissioner.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- 5. Tell the API about the new functions and rights right away -------------------------------
NOTIFY pgrst, 'reload schema';

-- 6. Check (read-only; the SQL editor shows this last result) ---------------------------------
-- Every row should say ok = true. You can run just this query again later (from WITH to the end).
--   'column' rows: one per column of players, who can read it.
--   'players guard': saving a roster row can't be used to test a guessed email or GHIN.
--   'names linked to another email': for your review, never a failure (see that row).
--   'writes to' rows: only admins change matchups, round scores and pairings.
--   function rows: run as their owner with a fixed search path, signed in only.
--   the other rows: nothing else hands out players' private columns, and nothing that runs as the
--   signed-in user still needs them.
WITH re AS (
  SELECT '^(email|ghin)$|(^|_)(e_?mail|ghin|phone|mobile|cell|tel|sms|whatsapp|text|address|addr|street|city|zip|postal|postcode|birth|dob|ssn|venmo|paypal|zelle|cash_?app|emergency|note)'::text AS private_re,
         ARRAY['id', 'name', 'handicap', 'team_id', 'status', 'user_id'] AS public_cols
), cols AS (
  SELECT a.attnum, a.attname::text AS col,
         CASE WHEN a.attname = ANY (re.public_cols) THEN 'public'
              WHEN a.attname ~* re.private_re THEN 'private'
              ELSE 'other' END AS kind,
         has_column_privilege('anon', a.attrelid, a.attnum, 'SELECT') AS anon_r,
         has_column_privilege('authenticated', a.attrelid, a.attnum, 'SELECT') AS auth_r,
         has_column_privilege('public', a.attrelid, a.attnum, 'SELECT') AS pub_r
  FROM re, pg_attribute a
  WHERE a.attrelid = to_regclass('public.players') AND a.attnum > 0 AND NOT a.attisdropped
), priv AS (
  SELECT COALESCE(array_agg(col), ARRAY['email', 'ghin']) AS cols FROM cols WHERE kind = 'private'
), caller_fns AS (
  SELECT p.oid, p.proname::text AS proname, n.nspname::text AS nspname
  FROM priv, pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL (SELECT regexp_replace(COALESCE(p.prosrc, ''), '''[^'']*''', '', 'g') AS txt) s
  WHERE NOT p.prosecdef AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND p.proname ~ '^[A-Za-z_][A-Za-z0-9_]*$'
    AND s.txt ~* '\mplayers\M' AND s.txt ~* ('\m(' || array_to_string(priv.cols, '|') || ')\M')
), bad_policies AS (
  SELECT format('"%s" on %s.%s', pol.policyname, pol.schemaname, pol.tablename) AS what
  FROM priv, pg_policies pol
  CROSS JOIN LATERAL (SELECT regexp_replace(COALESCE(pol.qual, '') || ' ' || COALESCE(pol.with_check, ''), '''[^'']*''', '', 'g') AS txt) s
  WHERE (s.txt ~* '\mplayers\M' AND s.txt ~* ('\m(' || array_to_string(priv.cols, '|') || ')\M'))
     OR s.txt ~* ('\m(' || array_to_string(ARRAY['payments_actor', 'payments_player_on_site'] || COALESCE((SELECT array_agg(DISTINCT proname) FROM caller_fns), '{}'), '|') || ')\M')
), invoker_fns AS (
  -- Site-callable functions, and triggers on the site's tables, that read private columns as the caller.
  -- players_guard only reads the row being written; the two payments helpers are only called from
  -- functions that run as their owner (and nobody can call them directly).
  SELECT f.oid::regprocedure::text AS what
  FROM caller_fns f
  JOIN pg_proc p ON p.oid = f.oid
  WHERE f.proname NOT IN ('players_guard', 'payments_actor', 'payments_player_on_site')
    AND CASE WHEN p.prorettype = 'trigger'::regtype
             THEN EXISTS (SELECT 1 FROM pg_trigger g JOIN pg_class tc ON tc.oid = g.tgrelid JOIN pg_namespace tn ON tn.oid = tc.relnamespace
                          WHERE g.tgfoid = p.oid AND NOT g.tgisinternal AND tn.nspname = 'public')
             ELSE p.prokind = 'f' AND f.nspname = 'public'
                  AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')) END
), views AS (
  SELECT DISTINCT format('%I.%I', vn.nspname, c.relname) AS what
  FROM pg_depend d
  JOIN pg_rewrite r ON d.classid = 'pg_rewrite'::regclass AND d.objid = r.oid
  JOIN pg_class c ON c.oid = r.ev_class
  JOIN pg_namespace vn ON vn.oid = c.relnamespace
  WHERE d.refobjid = to_regclass('public.players') AND c.oid <> to_regclass('public.players')
    AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('authenticated', c.oid, 'SELECT')
         OR has_any_column_privilege('anon', c.oid, 'SELECT') OR has_any_column_privilege('authenticated', c.oid, 'SELECT'))
    AND NOT (c.relkind = 'v' AND EXISTS (SELECT 1 FROM unnest(COALESCE(c.reloptions, '{}')) o WHERE o ~* '^security_invoker=(true|on|yes|1)$'))
), rowtype_fns AS (
  SELECT p.oid::regprocedure::text AS what
  FROM pg_proc p
  WHERE p.prorettype = (SELECT reltype FROM pg_class WHERE oid = to_regclass('public.players'))
    AND p.prosecdef
    AND p.oid IS DISTINCT FROM to_regprocedure('public.admin_players()')
    AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
), locked(n, tbl, admin_writes, public_reads) AS (
  -- The tables only admins change, which writes Admin makes to each, and whether everyone reads it
  VALUES (1, 'matchups', ARRAY['INSERT', 'UPDATE', 'DELETE'], true),
         (2, 'player_round_scores', ARRAY['INSERT', 'UPDATE'], true),
         (3, 'pairings', ARRAY[]::text[], false)
), lock_state AS (
  SELECT l.n, l.tbl, c.oid IS NOT NULL AS present, COALESCE(c.relrowsecurity, false) AS rls,
         (SELECT count(*) FROM pg_policies p
          WHERE p.schemaname = 'public' AND p.tablename = l.tbl AND p.permissive = 'RESTRICTIVE'
            AND p.policyname = l.tbl || '_admin_only_' || lower(p.cmd)
            AND p.roles @> ARRAY['anon', 'authenticated']::name[]
            AND CASE p.cmd WHEN 'INSERT' THEN p.with_check ~ '^(public\.)?is_trip_admin\(\)$'
                           WHEN 'UPDATE' THEN p.qual ~ '^(public\.)?is_trip_admin\(\)$' AND p.with_check ~ '^(public\.)?is_trip_admin\(\)$'
                           WHEN 'DELETE' THEN p.qual ~ '^(public\.)?is_trip_admin\(\)$'
                           ELSE false END) AS n_locks,
         ARRAY(SELECT lower(w) FROM unnest(l.admin_writes) w
               WHERE NOT EXISTS (SELECT 1 FROM pg_policies p
                                 WHERE p.schemaname = 'public' AND p.tablename = l.tbl AND p.permissive = 'PERMISSIVE'
                                   AND p.cmd IN (w, 'ALL') AND p.roles && ARRAY['authenticated', 'public']::name[])) AS admin_blocked,
         NOT l.public_reads OR EXISTS (SELECT 1 FROM pg_policies p
                                       WHERE p.schemaname = 'public' AND p.tablename = l.tbl AND p.permissive = 'PERMISSIVE'
                                         AND p.cmd IN ('SELECT', 'ALL') AND p.qual = 'true' AND p.roles && ARRAY['anon', 'public']::name[]) AS reads_ok
  FROM locked l
  LEFT JOIN pg_class c ON c.oid = to_regclass('public.' || l.tbl)
), guard AS (
  -- The roster guard is on players, switched on, and is this script's (section 4), not rsvp_accounts.sql's
  SELECT EXISTS (SELECT 1 FROM pg_trigger g
                 WHERE g.tgrelid = to_regclass('public.players') AND g.tgname = 'aaa_players_guard'
                   AND g.tgfoid = to_regprocedure('public.players_guard()') AND g.tgenabled IN ('O', 'A')) AS on_players,
         COALESCE((SELECT p.prosrc ~ 'jsonb_populate_record\(NEW' AND p.prosrc ~ 'has_column_privilege\(current_user, TG_RELID'
                   FROM pg_proc p WHERE p.oid = to_regprocedure('public.players_guard()')), false) AS keeps_private
), other_email AS (
  -- Confirmed names linked to a login with a different email: my_player() gives those logins the
  -- name's email and GHIN (it is their own row by payments_2027.sql's rule)
  SELECT p.name, p.email AS roster_email, u.email AS login_email
  FROM public.players p
  JOIN auth.users u ON u.id = p.user_id
  WHERE COALESCE(p.status, 'confirmed') = 'confirmed'
    AND lower(btrim(COALESCE(p.email, ''))) IS DISTINCT FROM lower(btrim(COALESCE(u.email, '')))
), want_functions(sig) AS (
  VALUES ('my_player()'), ('claim_roster_by_email()'), ('admin_players()')
)
SELECT 'needs payments_2027.sql' AS check_name,
       to_regprocedure('public.payments_my_player()') IS NOT NULL AND to_regprocedure('public.is_trip_admin()') IS NOT NULL AS ok,
       CASE WHEN to_regprocedure('public.payments_my_player()') IS NOT NULL AND to_regprocedure('public.is_trip_admin()') IS NOT NULL
            THEN 'payments_my_player() and is_trip_admin() found'
            ELSE 'MISSING: run rsvp_accounts.sql and payments_2027.sql, then this script' END AS detail
UNION ALL
(SELECT 'column ' || c.col,
       CASE c.kind WHEN 'public' THEN c.anon_r AND c.auth_r
                   WHEN 'private' THEN NOT (c.anon_r OR c.auth_r OR c.pub_r)
                   ELSE NOT (c.anon_r OR c.pub_r) END,
       CASE c.kind
         WHEN 'public' THEN CASE WHEN c.anon_r AND c.auth_r THEN 'everyone can read it (the site needs it)'
                                 ELSE 'MISSING: ' || CASE WHEN NOT c.anon_r THEN 'signed-out visitors' ELSE 'signed-in users' END
                                      || ' can''t read it, so the site breaks: run privacy_2027.sql again' END
         WHEN 'private' THEN CASE WHEN NOT (c.anon_r OR c.auth_r OR c.pub_r)
                                  THEN CASE WHEN c.col IN ('email', 'ghin') THEN 'private: only the player himself (my_player) and admins (admin_players)'
                                            ELSE 'private (looks like contact details): only admins (admin_players)' END
                                  ELSE 'READABLE by ' || concat_ws(' and ', CASE WHEN c.anon_r OR c.pub_r THEN 'signed-out visitors' END,
                                                                 CASE WHEN c.auth_r OR c.pub_r THEN 'every signed-in user' END)
                                       || CASE WHEN c.anon_r AND c.col = 'ghin' THEN ' (players_privacy.sql lets signed-out visitors read GHINs)' ELSE '' END
                                       || ': run privacy_2027.sql again' END
         ELSE CASE WHEN c.anon_r OR c.pub_r THEN 'READABLE by signed-out visitors: run privacy_2027.sql again'
                   WHEN c.auth_r THEN 'signed-in users can read it; signed-out visitors can''t'
                   ELSE 'only admins (admin_players): added after this script ran. Run it again if signed-in users should read it' END
       END
FROM cols c ORDER BY c.attnum)
UNION ALL
SELECT 'Admin can still save players',
       COALESCE(has_any_column_privilege('authenticated', to_regclass('public.players'), 'INSERT')
                AND has_any_column_privilege('authenticated', to_regclass('public.players'), 'UPDATE')
                AND has_table_privilege('authenticated', to_regclass('public.players'), 'DELETE'), false),
       CASE WHEN COALESCE(has_any_column_privilege('authenticated', to_regclass('public.players'), 'INSERT')
                AND has_any_column_privilege('authenticated', to_regclass('public.players'), 'UPDATE')
                AND has_table_privilege('authenticated', to_regclass('public.players'), 'DELETE'), false)
            THEN 'signed-in users can still write (players_guard lets only admins add, edit and remove)'
            ELSE 'MISSING: signed-in users can''t add, edit or remove players, so Admin can''t save' END
UNION ALL
SELECT 'players guard',
       g.on_players AND g.keeps_private,
       CASE WHEN NOT g.on_players
              THEN 'MISSING: the roster guard (trigger aaa_players_guard) is gone or switched off, so signed-in users can change roster rows: run rsvp_accounts.sql, then payments_2027.sql, then this script'
            WHEN NOT g.keeps_private
              THEN 'OPEN: this is the older roster guard (rsvp_accounts.sql ran again after this script), so a signed-in user can test a guessed email or GHIN by trying to save it: run privacy_2027.sql again'
            ELSE 'saving a roster row can''t test a guessed email or GHIN; only admins change roster details' END
FROM guard g
UNION ALL
SELECT 'names linked to another email',
       true,
       COALESCE('for your review, not a failure: ' || (SELECT count(*) FROM other_email)::text
                || ' confirmed name(s) linked to a login with a different email. Each of those logins sees that name''s email and GHIN as its own: '
                || (SELECT string_agg(format('%s (login %s, roster %s)', o.name, COALESCE(NULLIF(btrim(o.login_email), ''), 'no email'),
                                             COALESCE(NULLIF(btrim(o.roster_email), ''), 'empty')), '; ' ORDER BY o.name, o.login_email)
                    FROM other_email o)
                || '. Fine when each login really is that player (you approved it in Admin, or he picked his own name before payments_2027.sql ran). If one isn''t, unlink it in Admin.',
                'none: every confirmed name is linked to the login with its roster email, or to no login')
UNION ALL
SELECT 'rules reading private columns',
       NOT EXISTS (SELECT 1 FROM bad_policies),
       COALESCE('these table rules look them up as the signed-in user, which fails once they are private: ' || (SELECT string_agg(what, '; ' ORDER BY what) FROM bad_policies)
                || '. privacy_2027.sql removes "Allow admins to update ryder_cup_scores"; change any other one, then run it again', 'none')
UNION ALL
SELECT 'functions reading private columns as the caller',
       NOT EXISTS (SELECT 1 FROM invoker_fns),
       COALESCE('these run as the signed-in user and read private columns of players, so they now fail: ' || (SELECT string_agg(what, '; ' ORDER BY what) FROM invoker_fns), 'none')
UNION ALL
SELECT 'views over players',
       NOT EXISTS (SELECT 1 FROM views),
       COALESCE('the site''s key can read these, and they show players'' columns past the rules above: ' || (SELECT string_agg(what, '; ' ORDER BY what) FROM views), 'none')
UNION ALL
SELECT 'functions returning players rows',
       NOT EXISTS (SELECT 1 FROM rowtype_fns),
       COALESCE('these hand whole roster rows (emails and GHINs included) to anyone signed in: ' || (SELECT string_agg(what, '; ' ORDER BY what) FROM rowtype_fns), 'none besides admin_players()')
UNION ALL
SELECT 'live updates (Realtime)',
       NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'players'),
       CASE WHEN EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'players')
            THEN 'players is in Realtime, which the site doesn''t use. To be safe: ALTER PUBLICATION supabase_realtime DROP TABLE public.players;'
            ELSE 'players isn''t sent to Realtime' END
UNION ALL
(SELECT 'writes to ' || s.tbl,
       NOT s.present OR (s.rls AND s.n_locks = 3 AND cardinality(s.admin_blocked) = 0 AND s.reads_ok),
       CASE WHEN NOT s.present THEN 'no such table'
            WHEN NOT s.rls THEN 'OPEN: row security is off, so its rules don''t count and anyone can change it: run privacy_2027.sql again'
            WHEN s.n_locks < 3 THEN 'OPEN: not admins-only yet: run privacy_2027.sql'
            WHEN cardinality(s.admin_blocked) > 0 THEN 'MISSING: no rule lets admins ' || array_to_string(s.admin_blocked, ' or ') || ' rows, so Admin can''t save it'
            WHEN NOT s.reads_ok THEN 'MISSING: no rule lets everyone read it, so the boards that show it are empty'
            WHEN s.tbl = 'pairings' THEN 'only admins can change it (the site doesn''t use it)'
            ELSE 'only admins can change it (Admin); everyone can read it' END
FROM lock_state s ORDER BY s.n)
UNION ALL
SELECT 'function ' || f.sig,
       COALESCE(p.prosecdef
                AND 'search_path=public, pg_temp' = ANY (p.proconfig)
                AND NOT has_function_privilege('public', p.oid, 'EXECUTE')
                AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                AND has_function_privilege('authenticated', p.oid, 'EXECUTE'), false),
       CASE WHEN p.oid IS NULL THEN 'MISSING: run privacy_2027.sql' ELSE 'site function (signed-in only)' END
FROM want_functions f
LEFT JOIN pg_proc p ON p.oid = to_regprocedure('public.' || f.sig);

-- Handy for the commissioner (not run by this script):
-- Every column of players and its type (the check above says who can read each one)
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'players'
-- ORDER BY ordinal_position;
--
-- Who can read what through the site's key, column by column
-- SELECT a.attname AS column_name,
--        has_column_privilege('anon', a.attrelid, a.attnum, 'SELECT') AS signed_out_can_read,
--        has_column_privilege('authenticated', a.attrelid, a.attnum, 'SELECT') AS signed_in_can_read
-- FROM pg_attribute a
-- WHERE a.attrelid = 'public.players'::regclass AND a.attnum > 0 AND NOT a.attisdropped
-- ORDER BY a.attnum;
--
-- To undo the email and GHIN part (back to how it was: every signed-in user reads every column,
-- signed-out visitors read names, GHINs, handicaps, teams and statuses). The new site works either
-- way; the three functions can stay, and so can the admins-only rules from section 2 and the
-- roster guard from section 4 (with everything readable again, it works exactly like the old one).
-- REVOKE SELECT ON public.players FROM anon, authenticated;
-- GRANT SELECT ON public.players TO authenticated;
-- GRANT SELECT (id, name, ghin, handicap, team_id, status, user_id) ON public.players TO anon;
