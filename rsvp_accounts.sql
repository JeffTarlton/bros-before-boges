-- ============================================================
-- Bros Before Boges — RSVPs tied to player accounts
-- Run this entire script once in the Supabase SQL Editor, AFTER rsvp_schema.sql,
-- right after the matching site update is live (the new site shows "RSVPs are being
-- set up" until this has run; the old site can't RSVP once it has). Safe to run again.
-- ============================================================
-- What it changes:
--   * Every RSVP now belongs to a player account (the same login as The Bookie).
--     The site no longer writes RSVPs directly: it calls submit_rsvp(), which looks up
--     the signed-in player and stores their roster name, so nobody can RSVP as someone else.
--   * New guys (not on the roster yet) can create an account; join_roster() adds them as
--     'potential' so the commissioner approves them in Admin → RSVPs (approve_player()).
--   * Players can update their own GHIN and handicap (update_my_profile) and read back
--     their own latest RSVP, note included (my_rsvp). The public head count reads each
--     player's latest answer through rsvp_latest.
--   * Admins get every RSVP, including the private notes (admin_rsvps).
--   * The players table is guarded: from the browser, only an admin can add, remove or edit
--     players. Everyone else can only claim an unclaimed roster name for their own login
--     (The Bookie's name picker). The SQL editor and table editor are not affected.

-- 1. Link RSVPs to players and logins -----------------------------------------
ALTER TABLE public.rsvps ADD COLUMN IF NOT EXISTS player_id uuid REFERENCES public.players(id) ON DELETE SET NULL;
ALTER TABLE public.rsvps ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS rsvps_player_created_idx ON public.rsvps (player_id, created_at);

-- RSVPs made before accounts were required (no user_id): match them to confirmed roster
-- names. Unapproved self-sign-ups never inherit an old RSVP (or its private note).
UPDATE public.rsvps r
SET player_id = p.id
FROM public.players p
WHERE r.player_id IS NULL
  AND r.user_id IS NULL
  AND p.status = 'confirmed'
  AND lower(regexp_replace(btrim(p.name), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(r.name), '\s+', ' ', 'g'));

-- 2. Who can read and write RSVPs ------------------------------------------------
-- Everyone can still read the head count (not the notes, not who made the row).
REVOKE SELECT ON public.rsvps FROM anon, authenticated;
GRANT SELECT (id, created_at, trip_year, name, status, sunday_round, player_id) ON public.rsvps TO anon, authenticated;

-- Nobody inserts directly any more; submit_rsvp() does it for the signed-in player.
DROP POLICY IF EXISTS "rsvps_public_insert" ON public.rsvps;
REVOKE INSERT ON public.rsvps FROM anon, authenticated;

-- RSVP names now come from the roster (which allows short names like "TJ"), not a typed box.
ALTER TABLE public.rsvps DROP CONSTRAINT IF EXISTS rsvps_name_check;
ALTER TABLE public.rsvps ADD CONSTRAINT rsvps_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 120);

-- 3. Who's an admin ---------------------------------------------------------------
-- A player row marked is_admin whose email matches the signed-in login (the same rule the
-- Admin page uses).
CREATE OR REPLACE FUNCTION public.is_trip_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.players
    WHERE is_admin
      AND auth.jwt() ->> 'email' IS NOT NULL
      AND lower(btrim(email)) = lower(auth.jwt() ->> 'email')
  );
$$;

-- 4. Guard the players table ----------------------------------------------------------
-- Without this, any signed-up login could claim an unclaimed roster row and, in the same
-- request, mark it is_admin, change its email or confirm itself.
CREATE OR REPLACE FUNCTION public.players_guard()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  -- Only browser requests are checked (they run as the anon or authenticated role). The SQL
  -- editor, the table editor and this script's own functions run as other roles.
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
  -- Everything except user_id must stay as it was (id included). Ignored: updated_at (in case
  -- something stamps it) and any database-generated columns (they read as NULL here).
  IF (to_jsonb(NEW) - 'user_id' - 'updated_at' - ARRAY(SELECT attname::text FROM pg_attribute WHERE attrelid = TG_RELID AND attgenerated <> '' AND NOT attisdropped))
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'user_id' - 'updated_at' - ARRAY(SELECT attname::text FROM pg_attribute WHERE attrelid = TG_RELID AND attgenerated <> '' AND NOT attisdropped)) THEN
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

-- Named to run before any other BEFORE trigger on players (they fire in name order), so it
-- sees the request exactly as sent.
DROP TRIGGER IF EXISTS players_guard ON public.players;
DROP TRIGGER IF EXISTS aaa_players_guard ON public.players;
CREATE TRIGGER aaa_players_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.players
  FOR EACH ROW EXECUTE FUNCTION public.players_guard();

-- One roster row per login (also stops two quick requests linking twice). Skipped, with a
-- notice, if some login is already linked to two rows: the final check below lists them.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.players WHERE user_id IS NOT NULL GROUP BY user_id HAVING count(*) > 1) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS players_one_row_per_login ON public.players (user_id) WHERE user_id IS NOT NULL;
  ELSE
    RAISE NOTICE 'A login is linked to more than one player; fix that, then run this script again.';
  END IF;
END $$;

-- 5. RSVP as the signed-in player ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_rsvp(p_trip_year integer, p_status text, p_sunday boolean, p_note text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_player public.players%ROWTYPE;
  v_row public.rsvps%ROWTYPE;
  v_cap integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Log in to RSVP.' USING ERRCODE = '28000';
  END IF;
  -- FOR UPDATE: one RSVP at a time per player, so the cap below can't be raced
  SELECT * INTO v_player FROM public.players WHERE user_id = auth.uid() LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Your login is not linked to a player yet.' USING ERRCODE = 'P0002';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('in', 'maybe', 'out') THEN
    RAISE EXCEPTION 'Pick in, probably, or can''t make it.' USING ERRCODE = '22023';
  END IF;
  IF p_trip_year IS NULL OR p_trip_year NOT BETWEEN 2020 AND 2100 THEN
    RAISE EXCEPTION 'Bad trip year.' USING ERRCODE = '22023';
  END IF;
  -- Every change is kept as history; cap it so a login can't flood the table. New sign-ups
  -- waiting for approval get a smaller allowance.
  v_cap := CASE WHEN v_player.status = 'confirmed' THEN 50 ELSE 10 END;
  IF (SELECT count(*) FROM public.rsvps WHERE player_id = v_player.id AND trip_year = p_trip_year) >= v_cap THEN
    RAISE EXCEPTION 'That''s a lot of RSVP changes. Text the commissioner to update yours.' USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.rsvps (trip_year, name, status, sunday_round, note, player_id, user_id)
  VALUES (
    p_trip_year,
    v_player.name,
    p_status,
    COALESCE(p_sunday, false) AND p_status <> 'out',
    NULLIF(left(btrim(COALESCE(p_note, '')), 280), ''),
    v_player.id,
    auth.uid()
  )
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id', v_row.id, 'created_at', v_row.created_at, 'name', v_player.name,
    'player_id', v_player.id, 'player_status', v_player.status
  );
END;
$$;

-- The public head count: each player's latest answer for a trip, one row per player (no
-- notes). Reading history rows instead could let a flood of old rows crowd out real answers.
CREATE OR REPLACE FUNCTION public.rsvp_latest(p_trip_year integer)
RETURNS TABLE (id uuid, created_at timestamptz, trip_year integer, name text, status text, sunday_round boolean, player_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  -- Confirmed players first, so they always fit inside the API's row cap
  SELECT l.id, l.created_at, l.trip_year, l.name, l.status, l.sunday_round, l.player_id
  FROM (
    SELECT DISTINCT ON (COALESCE(r.player_id::text, lower(regexp_replace(btrim(r.name), '\s+', ' ', 'g'))))
           r.id, r.created_at, r.trip_year, r.name, r.status, r.sunday_round, r.player_id,
           COALESCE(p.status = 'confirmed', false) AS confirmed
    FROM public.rsvps r
    LEFT JOIN public.players p ON p.id = r.player_id
    WHERE r.trip_year = p_trip_year
    ORDER BY COALESCE(r.player_id::text, lower(regexp_replace(btrim(r.name), '\s+', ' ', 'g'))), r.created_at DESC
  ) l
  ORDER BY l.confirmed DESC, l.created_at DESC;
$$;

-- The signed-in player's own latest RSVP for a trip, note included (to prefill the form).
CREATE OR REPLACE FUNCTION public.my_rsvp(p_trip_year integer)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT to_jsonb(latest) FROM (
    SELECT r.status, r.sunday_round, r.note, r.created_at
    FROM public.rsvps r
    JOIN public.players p ON p.id = r.player_id
    WHERE p.user_id = auth.uid() AND r.trip_year = p_trip_year
    ORDER BY r.created_at DESC
    LIMIT 1
  ) latest;
$$;

-- 6. A new guy adds himself to the roster (as 'potential', for the commissioner to approve) ---
CREATE OR REPLACE FUNCTION public.join_roster(p_name text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_name text := regexp_replace(btrim(COALESCE(p_name, '')), '\s+', ' ', 'g');
  v_player public.players%ROWTYPE;
  v_same public.players%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Log in first.' USING ERRCODE = '28000';
  END IF;

  -- Already linked: nothing to do
  SELECT * INTO v_player FROM public.players WHERE user_id = auth.uid() LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('id', v_player.id, 'name', v_player.name, 'status', v_player.status, 'created', false);
  END IF;

  IF char_length(v_name) NOT BETWEEN 3 AND 60 OR position(' ' IN v_name) = 0 THEN
    RAISE EXCEPTION 'Enter your first and last name.' USING ERRCODE = '22023';
  END IF;
  -- Already on the roster under this email (e.g. the commissioner added him): use that name
  SELECT * INTO v_same FROM public.players
  WHERE user_id IS NULL AND auth.jwt() ->> 'email' IS NOT NULL
    AND lower(btrim(email)) = lower(auth.jwt() ->> 'email')
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Your email is already on the roster as %. Pick that name from the list instead.', v_same.name USING ERRCODE = '23505';
  END IF;
  SELECT * INTO v_same FROM public.players WHERE lower(btrim(name)) = lower(v_name) LIMIT 1;
  IF FOUND THEN
    IF v_same.user_id IS NOT NULL THEN
      RAISE EXCEPTION '% already has an account. Log in with that account instead, or tap “Forgot password?”.', v_same.name USING ERRCODE = '23505';
    END IF;
    RAISE EXCEPTION '% is already on the roster. Pick that name from the list instead.', v_same.name USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.players (name, email, status, user_id)
  VALUES (v_name, auth.jwt() ->> 'email', 'potential', auth.uid())
  RETURNING * INTO v_player;

  RETURN jsonb_build_object('id', v_player.id, 'name', v_player.name, 'status', v_player.status, 'created', true);
END;
$$;

-- 7. A player updates their own GHIN and handicap (plus handicaps are stored as negatives) ---
CREATE OR REPLACE FUNCTION public.update_my_profile(p_ghin text, p_handicap numeric)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ghin text := NULLIF(btrim(COALESCE(p_ghin, '')), '');
  v_player public.players%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Log in first.' USING ERRCODE = '28000';
  END IF;
  IF v_ghin IS NOT NULL AND v_ghin !~ '^[0-9]{5,12}$' THEN
    RAISE EXCEPTION 'A GHIN number is 5 to 12 digits.' USING ERRCODE = '22023';
  END IF;
  IF p_handicap IS NOT NULL AND (p_handicap < -10 OR p_handicap > 54) THEN
    RAISE EXCEPTION 'Handicap should be between +10 and 54.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.players
  SET ghin = v_ghin, handicap = round(p_handicap, 1)
  WHERE user_id = auth.uid()
  RETURNING * INTO v_player;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Your login is not linked to a player yet.' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object('id', v_player.id, 'name', v_player.name, 'ghin', v_player.ghin, 'handicap', v_player.handicap);
END;
$$;

-- 8. Admin: every RSVP for a trip (notes included), and approving new players --------------
CREATE OR REPLACE FUNCTION public.admin_rsvps(p_trip_year integer)
RETURNS SETOF public.rsvps
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_trip_admin() THEN
    RAISE EXCEPTION 'Admins only.' USING ERRCODE = '42501';
  END IF;
  -- Each player's 20 newest answers: confirmed players first, then everyone's latest answer,
  -- then older history, newest first. The API caps how many rows come back, so this keeps
  -- each real player's current answer inside that cap even if unapproved sign-ups pile up.
  RETURN QUERY
    SELECT (x.r).* FROM (
      SELECT r,
             COALESCE(p.status = 'confirmed', false) AS confirmed,
             row_number() OVER (PARTITION BY COALESCE(r.player_id::text, lower(btrim(r.name))) ORDER BY r.created_at DESC) AS nth
      FROM public.rsvps r
      LEFT JOIN public.players p ON p.id = r.player_id
      WHERE r.trip_year = p_trip_year
    ) x
    WHERE x.nth <= 20
    ORDER BY x.confirmed DESC, (x.nth = 1) DESC, (x.r).created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_player(p_player_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_player public.players%ROWTYPE;
BEGIN
  IF NOT public.is_trip_admin() THEN
    RAISE EXCEPTION 'Admins only.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.players SET status = 'confirmed' WHERE id = p_player_id RETURNING * INTO v_player;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That player isn''t on the roster any more.' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object('id', v_player.id, 'name', v_player.name, 'status', v_player.status);
END;
$$;

-- 9. Only signed-in users can call these ------------------------------------------------
REVOKE ALL ON FUNCTION public.is_trip_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_rsvp(integer, text, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_rsvp(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rsvp_latest(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rsvp_latest(integer) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.join_roster(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_my_profile(text, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_rsvps(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_player(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_trip_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_rsvp(integer, text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_rsvp(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_roster(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_profile(text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_rsvps(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_player(uuid) TO authenticated;

-- Tell the API about the new columns and functions right away
NOTIFY pgrst, 'reload schema';

-- Checks (the SQL editor shows this last result):
--   * "RSVP not matched" rows are RSVPs made before accounts whose name isn't on the roster.
--   * "admin" rows: each admin needs the email they log in with. With "Confirm email" off, an
--     admin email that has no login yet could be claimed by whoever signs up with it first, so
--     every admin should say "has a login" (log in once), or turn "Confirm email" on.
--   * "login linked twice" rows: one login holds two roster names; clear user_id on the wrong
--     one in the table editor, then run this script again.
SELECT 'RSVP not matched' AS check_name, r.name AS who, r.created_at::text AS detail
FROM public.rsvps r WHERE r.player_id IS NULL AND r.user_id IS NULL
UNION ALL
SELECT 'admin', p.name || ' <' || COALESCE(p.email, 'no email') || '>',
       CASE WHEN EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = lower(btrim(p.email)))
            THEN 'has a login' ELSE 'NO LOGIN YET: log in once, or turn on Confirm email' END
FROM public.players p WHERE p.is_admin
UNION ALL
SELECT 'login linked twice', string_agg(p.name, ' + ' ORDER BY p.name), p.user_id::text
FROM public.players p WHERE p.user_id IS NOT NULL GROUP BY p.user_id HAVING count(*) > 1;
