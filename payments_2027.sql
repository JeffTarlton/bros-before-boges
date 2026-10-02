-- ============================================================
-- Bros Before Boges — Venmo usernames, "Paid" tracking (2027), and roster-name approval
-- Run this entire script once in the Supabase SQL Editor, AFTER rsvp_accounts.sql,
-- right after the matching site update is live (the new site says payments are
-- "being set up" until this has run, and its Admin page shows who signed in as each new
-- name). Safe to run again: every Venmo username and payment already recorded is kept.
-- ============================================================
-- What it does:
--   1. Picking a roster name now needs the commissioner's OK, unless the email matches.
--      When someone signs in and picks a roster name nobody has claimed yet (The Bookie's
--      name picker), and that roster row's email isn't the email they log in with, the
--      name is held as 'potential' until the commissioner approves it, like a new sign-up.
--      If the emails match, nothing changes. Names already linked to a login are not touched.
--      The commissioner either approves that login (Admin names the login, so a stranger
--      can't be approved by mistake) or unlinks it, and the name goes back to how it was.
--      A held name can't be deleted from the site, and nobody with trip payments can be.
--   2. A held name can't act as that player: no RSVPs, GHIN/handicap changes or Bookie
--      comments under his name, and no reading his RSVP note (his Venmo username and
--      payments below too). With bookie_2027.sql and tracker_2027.sql it can't bet or enter
--      scores either; the check at the end says if either of those hasn't been run.
--   3. player_venmo: each player's Venmo username. A player sets their own (set_my_venmo),
--      an admin can set anyone's (admin_set_venmo). Only signed-in CONFIRMED players and
--      admins can read them. Signed-out visitors and sign-ups still waiting for approval
--      can't (anyone on the internet can sign up), though a new sign-up can read back his own.
--   4. bookie_payments: the Bookie's Settle up "Paid" marks. Either player on a payment
--      (the one paying or the one being paid), or an admin, can mark it paid (mark_paid)
--      and undo it (undo_paid). The site subtracts each recorded payment from the two
--      players' balances, so Settle up recomputes. Readable by confirmed players and admins.
--   5. trip_payments: what each player has paid toward the trip. Only admins record and
--      delete them (admin_add_trip_payment / admin_delete_trip_payment) and see everyone's;
--      a signed-in player sees only their own (my_trip_payments, or reading the table).
--   6. The official Ryder Cup total (ryder_cup_scores) can only be changed by an admin.
--      Until now any signed-in login could rewrite it, even one with no roster name.
--   The three payments tables can only be changed through those functions: nobody, signed
--   in or not, can insert, edit or delete rows directly from the browser. The SQL editor and
--   the table editor are not affected by anything here.
--
-- "Confirmed" means the same as for the Round Tracker and The Bookie: the roster row linked to
-- the login has status 'confirmed' (a row with no status counts as confirmed, as it does there;
-- only the commissioner can create one). Because of section 1, a login can only be linked to a
-- confirmed name if the commissioner approved it, the emails match, or it was linked before
-- this script ran. Admins are is_trip_admin() from rsvp_accounts.sql: a roster row marked
-- is_admin whose email is the one logged in.

-- 0. Needs rsvp_accounts.sql (is_trip_admin, the players guard, one roster row per login) ---
DO $$
BEGIN
  IF to_regprocedure('public.is_trip_admin()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.players'::regclass AND tgname = 'aaa_players_guard') THEN
    RAISE EXCEPTION 'Run rsvp_accounts.sql first (it creates is_trip_admin and the players guard), then run this again.';
  END IF;
END $$;

-- 1. Picking someone's roster name waits for approval ---------------------------------------
-- rsvp_accounts.sql lets any signed-in login link itself to a roster name nobody has claimed yet
-- (players_guard allows exactly that, for The Bookie's name picker). Anyone can sign up, so on
-- its own that turns a stranger who picks "Dan" into confirmed Dan: betting, entering scores,
-- seeing everyone's Venmo username and marking Dan's payments.
-- So when a signed-in login that isn't an admin links a roster name to ITSELF, and that row's
-- email isn't the login's email (any case, spaces ignored; a row with no email never matches),
-- the row's status becomes 'potential' and the status it had is kept here. Confirm email is on,
-- so a matching email proves the login is that person, and those picks stay exactly as they were.
-- Then the commissioner either:
--   * approves that login. From the site, a picked name whose roster email isn't the login's can
--     only be approved by naming the login (admin_approve_pick, which the Admin page calls with
--     the login it shows). approve_player and setting the status in Admin's editors are refused
--     for it, so an Admin page that doesn't show the login can't approve a stranger by mistake.
--     The SQL editor can still approve it (UPDATE ... SET status = 'confirmed').
--   * or unlinks it (admin_release_claim, or clearing user_id in the table editor). However the
--     link goes (the login is deleted, too), the name goes back to the status it had before the
--     pick, unless that same change sets the status itself.
-- From the site, a held name can't be deleted (Admin's Potential tab would otherwise offer to
-- delete a real player as if he were a junk sign-up): unlink the login first. And nobody with
-- trip payments recorded can be deleted (section 6 keeps those records).
-- Not affected: names already linked to a login, admins picking a name (they may edit anything;
-- an admin's own row can only be linked by the login with that admin's email, which is an
-- admin), join_roster (it adds a new row, already 'potential', with the login's own email),
-- update_my_profile, and the SQL editor / table editor (no login).
-- A pick never raises a status: a 'potential' name stays 'potential' until approved.
-- Triggers on a table run in name order, so this one (aab_...) runs right after
-- aaa_players_guard: the guard still sees the request exactly as sent (a status change of its
-- own would be refused there).

-- The status a held name had before somebody else's login picked it. Nobody reads this from the
-- site (admin_roster_logins shows it to admins).
CREATE TABLE IF NOT EXISTS public.roster_claim_holds (
  player_id    uuid PRIMARY KEY REFERENCES public.players(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL,          -- the login that picked it
  prior_status text NOT NULL,          -- what the name was before ('confirmed' when it had none)
  held_at      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.roster_claim_holds IS 'Roster names held for approval because another login picked them, with the status each had before. Kept by players_claim_review; no site access.';
ALTER TABLE public.roster_claim_holds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.roster_claim_holds FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.players_claim_review()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_jwt_email text := lower(btrim(COALESCE(auth.jwt() ->> 'email', '')));
  v_login text;                               -- the email of the login linked to the row
  v_hold public.roster_claim_holds%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Trip payments are money records: delete those first (admin_delete_trip_payment)
    IF to_regclass('public.trip_payments') IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM public.trip_payments tp WHERE tp.player_id = OLD.id) THEN
        RAISE EXCEPTION '% has trip payments recorded, so he can''t be removed. If he''s really off the trip, delete his trip payments first.', OLD.name USING ERRCODE = '23503';
      END IF;
    END IF;
    -- From the site: a name somebody else's login picked may be a real player
    IF auth.uid() IS NOT NULL AND OLD.user_id IS NOT NULL AND OLD.status = 'potential' THEN
      SELECT u.email INTO v_login FROM auth.users u WHERE u.id = OLD.user_id;
      IF NOT (lower(btrim(COALESCE(OLD.email, ''))) <> ''
              AND lower(btrim(COALESCE(OLD.email, ''))) = lower(btrim(COALESCE(v_login, '')))) THEN
        RAISE EXCEPTION '% is signed in as %, but his roster email is %, so this may be a real player''s name somebody else picked. Unlink that login first (the name goes back to how it was), then remove the name if you still want to.',
          OLD.name, COALESCE(NULLIF(btrim(v_login), ''), 'a login with no email'), COALESCE(NULLIF(btrim(OLD.email), ''), 'empty') USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  -- The name is unlinked, or moved to another login: a hold from a pick ends with that pick,
  -- and the name goes back to the status it had (unless this same change sets the status)
  IF OLD.user_id IS NOT NULL AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    DELETE FROM public.roster_claim_holds h WHERE h.player_id = OLD.id RETURNING h.* INTO v_hold;
    IF v_hold.user_id = OLD.user_id AND OLD.status = 'potential' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
      NEW.status := v_hold.prior_status;
    END IF;
  END IF;

  -- A signed-in login that isn't an admin picks an unclaimed name for itself
  IF OLD.user_id IS NULL AND NEW.user_id IS NOT NULL AND NEW.user_id = auth.uid() AND NOT public.is_trip_admin() THEN
    IF lower(btrim(COALESCE(OLD.email, ''))) = '' OR lower(btrim(COALESCE(OLD.email, ''))) <> v_jwt_email THEN
      INSERT INTO public.roster_claim_holds AS h (player_id, user_id, prior_status)
      VALUES (OLD.id, NEW.user_id, COALESCE(OLD.status, 'confirmed'))
      ON CONFLICT (player_id) DO UPDATE
        SET user_id = EXCLUDED.user_id, prior_status = EXCLUDED.prior_status, held_at = now();
      NEW.status := 'potential';
    END IF;
    RETURN NEW;
  END IF;

  -- Approving a linked name (potential -> confirmed, same login). From the site, the login has to
  -- be the roster email's, or named by the admin (admin_approve_pick).
  IF OLD.user_id IS NOT NULL AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
     AND OLD.status = 'potential' AND COALESCE(NEW.status, 'confirmed') = 'confirmed' THEN
    IF auth.uid() IS NOT NULL THEN
      SELECT u.email INTO v_login FROM auth.users u WHERE u.id = OLD.user_id;
      IF NOT (lower(btrim(COALESCE(NEW.email, ''))) <> ''
              AND lower(btrim(COALESCE(NEW.email, ''))) = lower(btrim(COALESCE(v_login, ''))))
         AND current_setting('bbb.approve_pick', true) IS DISTINCT FROM (OLD.id::text || ':' || OLD.user_id::text) THEN
        RAISE EXCEPTION 'Check who this is before approving: % signed in as %, but his roster email is %. If that''s really him, approve that login where Admin shows it. If not, unlink it (the name goes back to how it was).',
          OLD.name, COALESCE(NULLIF(btrim(v_login), ''), 'a login with no email'), COALESCE(NULLIF(btrim(NEW.email), ''), 'empty') USING ERRCODE = '42501';
      END IF;
    END IF;
    DELETE FROM public.roster_claim_holds h WHERE h.player_id = OLD.id;
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.players_claim_review() IS 'Trigger: a non-admin login picking an unclaimed name whose email is not its own holds it as potential; unlinking ends the hold; approving it from the site needs the login named; a held name cannot be deleted from the site, and nobody with trip payments can be deleted.';

DROP TRIGGER IF EXISTS aab_players_claim_review ON public.players;
CREATE TRIGGER aab_players_claim_review
  BEFORE UPDATE OR DELETE ON public.players
  FOR EACH ROW
  EXECUTE FUNCTION public.players_claim_review();

-- 2. Who's asking ----------------------------------------------------------------------
-- The signed-in login's own roster row for the "your own" rules below, or NULL (signed out or
-- not linked). A confirmed row always counts. A row still waiting for approval counts only when
-- its email is this login's email: true for every new sign-up (join_roster saves the login's
-- email on his new row), but not for someone else's name picked from the roster. That row's
-- Venmo username, trip payments, RSVPs and notes belong to the real player, so the login that
-- picked it can't read or change them until the commissioner approves it. Signed-in users can
-- run it; it only ever tells you your own player id.
CREATE OR REPLACE FUNCTION public.payments_my_player()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p.id FROM public.players p
  WHERE auth.uid() IS NOT NULL AND p.user_id = auth.uid()
    AND (COALESCE(p.status, 'confirmed') = 'confirmed'
         OR (NULLIF(btrim(p.email), '') IS NOT NULL
             AND lower(btrim(p.email)) = lower(btrim(auth.jwt() ->> 'email'))))
  ORDER BY p.id
  LIMIT 1;
$$;
COMMENT ON FUNCTION public.payments_my_player() IS 'The signed-in login''s own roster row id: its confirmed row, or its unapproved row when that row''s email is the login''s email. Else NULL. Used by the "your own" rules (payments, RSVPs, profile).';

-- True for a signed-in player linked to a confirmed roster name, or an admin: who may see Venmo
-- usernames and the Bookie's paid marks. False for signed-out visitors, logins not linked to a
-- name, and names waiting for the commissioner's approval (new sign-ups and picked names).
CREATE OR REPLACE FUNCTION public.payments_crew()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.players p
      WHERE p.user_id = auth.uid() AND COALESCE(p.status, 'confirmed') = 'confirmed'
    )
    OR public.is_trip_admin()
  );
$$;
COMMENT ON FUNCTION public.payments_crew() IS 'True for a signed-in login linked to a confirmed roster name, or an admin (who may see Venmo usernames and Bookie payments).';

-- Everything the site needs to know about the signed-in login in one call:
--   player_id  the roster row linked to this login (any status), or null
--   status     that row's status ('confirmed' when it has none), or null
--   own_ok     may set its own Venmo username, RSVP and see its own trip payments (a confirmed
--              name, or a new sign-up waiting for approval; false for a picked name still waiting)
--   crew       may see usernames and Paid marks, and mark/undo their own payments
--   admin      is_trip_admin()
CREATE OR REPLACE FUNCTION public.payments_me()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'player_id', p.id,
    'status', CASE WHEN p.id IS NULL THEN NULL ELSE COALESCE(p.status, 'confirmed') END,
    'own_ok', COALESCE(p.id = public.payments_my_player(), false),
    'crew', public.payments_crew(),
    'admin', auth.uid() IS NOT NULL AND public.is_trip_admin()
  )
  FROM (SELECT 1) one
  LEFT JOIN LATERAL (
    SELECT x.id, x.status FROM public.players x
    WHERE auth.uid() IS NOT NULL AND x.user_id = auth.uid()
    ORDER BY x.id LIMIT 1
  ) p ON true;
$$;
COMMENT ON FUNCTION public.payments_me() IS 'The signed-in login''s payments standing: {player_id, status, own_ok, crew, admin}.';

-- Internal (not callable from the site): the roster row to stamp as "marked by" / "set by".
-- The caller's own row, or for an admin whose login isn't linked to a name, the admin row
-- that matches their email.
CREATE OR REPLACE FUNCTION public.payments_actor()
RETURNS uuid
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    public.payments_my_player(),
    (SELECT p.id FROM public.players p
      WHERE p.is_admin AND NULLIF(btrim(auth.jwt() ->> 'email'), '') IS NOT NULL
        AND lower(btrim(p.email)) = lower(btrim(auth.jwt() ->> 'email'))
      ORDER BY p.id LIMIT 1)
  );
$$;

-- Internal: can this player see and undo Paid marks on the site? A confirmed roster name linked
-- to a login, or an admin row whose email has a login. A payer may only mark "I paid X" when X
-- can, so X can always see it and undo it.
CREATE OR REPLACE FUNCTION public.payments_player_on_site(p_player uuid)
RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.players p
    JOIN auth.users u ON u.id = p.user_id
    WHERE p.id = p_player AND COALESCE(p.status, 'confirmed') = 'confirmed'
  ) OR EXISTS (
    SELECT 1 FROM public.players p
    JOIN auth.users u ON lower(btrim(u.email)) = lower(btrim(p.email))
    WHERE p.id = p_player AND p.is_admin AND NULLIF(btrim(p.email), '') IS NOT NULL
  );
$$;

-- 3. A held name can't act as that player ----------------------------------------------------
-- rsvp_accounts.sql's RSVP and profile functions, and the Bookie's comment rule, only ask "is
-- this name linked to your login?", at any status. A login holding someone else's name (section
-- 1) must not RSVP as him, change his GHIN or handicap, read his RSVP note or post comments under
-- his name. So these use the same "your own row" rule as the payments (payments_my_player: a
-- confirmed name, or a new sign-up's own row). Everything else in each function is as in
-- rsvp_accounts.sql (plus pg_temp pinned last in the search path, like the functions below). If
-- rsvp_accounts.sql is ever run again, run this script again after it (the check at the end says so).

-- The signed-in player's own latest RSVP for a trip, note included (to prefill the form). On a
-- name still waiting for approval, only answers this login gave itself.
CREATE OR REPLACE FUNCTION public.my_rsvp(p_trip_year integer)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT to_jsonb(latest) FROM (
    SELECT r.status, r.sunday_round, r.note, r.created_at
    FROM public.rsvps r
    JOIN public.players p ON p.id = r.player_id
    WHERE p.user_id = auth.uid() AND r.trip_year = p_trip_year
      AND (p.id = public.payments_my_player() OR r.user_id = auth.uid())
    ORDER BY r.created_at DESC
    LIMIT 1
  ) latest;
$$;

-- RSVP as the signed-in player (not on a name somebody else's login is holding)
CREATE OR REPLACE FUNCTION public.submit_rsvp(p_trip_year integer, p_status text, p_sunday boolean, p_note text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
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
  IF public.payments_my_player() IS DISTINCT FROM v_player.id THEN
    RAISE EXCEPTION 'Your roster name is waiting for the commissioner''s approval. You can RSVP once you''re approved.' USING ERRCODE = '42501';
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

-- A player updates their own GHIN and handicap (not on a name somebody else's login is holding)
CREATE OR REPLACE FUNCTION public.update_my_profile(p_ghin text, p_handicap numeric)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
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
  IF EXISTS (SELECT 1 FROM public.players WHERE user_id = auth.uid()) AND public.payments_my_player() IS NULL THEN
    RAISE EXCEPTION 'Your roster name is waiting for the commissioner''s approval. You can update your GHIN and handicap once you''re approved.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.players
  SET ghin = v_ghin, handicap = round(p_handicap, 1)
  WHERE id = public.payments_my_player()
  RETURNING * INTO v_player;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Your login is not linked to a player yet.' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object('id', v_player.id, 'name', v_player.name, 'ghin', v_player.ghin, 'handicap', v_player.handicap);
END;
$$;

-- Bookie comments: only as your own confirmed name. Added on top of the Bookie's own insert rule
-- (restrictive rules apply on top of all the others), so re-running an old Bookie script that
-- redoes that rule doesn't undo this. The Bookie only lets confirmed players comment anyway.
DROP POLICY IF EXISTS "wager_comments_confirmed_only" ON public.wager_comments;
CREATE POLICY "wager_comments_confirmed_only"
  ON public.wager_comments AS RESTRICTIVE FOR INSERT
  TO anon, authenticated
  WITH CHECK (player_id IN (
    SELECT p.id FROM public.players p
    WHERE p.user_id = auth.uid() AND COALESCE(p.status, 'confirmed') = 'confirmed'
  ));

-- 4. Venmo usernames -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.player_venmo (
  player_id  uuid PRIMARY KEY REFERENCES public.players(id) ON DELETE CASCADE,
  -- Stored without the @. Venmo usernames are 5 to 30 letters, numbers, hyphens and underscores.
  handle     text NOT NULL CONSTRAINT player_venmo_handle_format CHECK (handle ~ '^[A-Za-z0-9_-]{5,30}$'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Who set it: the player themself, or the admin who did it for them
  updated_by uuid REFERENCES public.players(id) ON DELETE SET NULL
);
COMMENT ON TABLE public.player_venmo IS 'Venmo usernames (no @). Read: confirmed players and admins (and your own). Write: set_my_venmo / admin_set_venmo only.';

ALTER TABLE public.player_venmo ENABLE ROW LEVEL SECURITY;

-- Supabase gives every new table to anon and authenticated with full rights; take that back.
-- Signed-in users get read access only, and the rule below decides which rows.
REVOKE ALL ON TABLE public.player_venmo FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.player_venmo TO authenticated;

DROP POLICY IF EXISTS "player_venmo_crew_read" ON public.player_venmo;
CREATE POLICY "player_venmo_crew_read"
  ON public.player_venmo FOR SELECT
  TO authenticated
  USING ((SELECT public.payments_crew()) OR player_id = (SELECT public.payments_my_player()));

-- Internal: clean up what was typed. Trims spaces, accepts a pasted venmo.com link or a
-- leading @, and returns NULL for "clear it". Anything that still isn't a Venmo username
-- is refused, so only these characters ever reach the page or a venmo.com link.
CREATE OR REPLACE FUNCTION public.payments_clean_venmo(p_handle text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp
AS $$
DECLARE
  v text := regexp_replace(COALESCE(p_handle, ''), '^\s+|\s+$', '', 'g');
BEGIN
  IF char_length(v) > 100 THEN
    RAISE EXCEPTION 'A Venmo username is 5 to 30 letters, numbers, hyphens or underscores, like @Jeff-Tarlton.' USING ERRCODE = '22023';
  END IF;
  v := regexp_replace(v, '^(https?://)?(www\.|account\.)?venmo\.com/(u/)?', '', 'i');
  v := regexp_replace(v, '^@', '');
  IF v = '' THEN
    RETURN NULL;
  END IF;
  IF v !~ '^[A-Za-z0-9_-]{5,30}$' THEN
    RAISE EXCEPTION 'A Venmo username is 5 to 30 letters, numbers, hyphens or underscores, like @Jeff-Tarlton.' USING ERRCODE = '22023';
  END IF;
  RETURN v;
END;
$$;

-- Internal: save (or with a NULL handle, remove) one player's username
CREATE OR REPLACE FUNCTION public.payments_save_venmo(p_player uuid, p_handle text, p_by uuid)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.player_venmo%ROWTYPE;
BEGIN
  IF p_handle IS NULL THEN
    DELETE FROM public.player_venmo WHERE player_id = p_player;
    RETURN jsonb_build_object('player_id', p_player, 'handle', NULL, 'updated_at', NULL, 'updated_by', NULL);
  END IF;
  INSERT INTO public.player_venmo AS v (player_id, handle, updated_at, updated_by)
  VALUES (p_player, p_handle, now(), p_by)
  ON CONFLICT (player_id) DO UPDATE
    SET handle = EXCLUDED.handle, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('player_id', v_row.player_id, 'handle', v_row.handle,
                            'updated_at', v_row.updated_at, 'updated_by', v_row.updated_by);
END;
$$;

-- A player sets (or clears, with NULL or '') their own Venmo username: any confirmed player, and
-- new sign-ups waiting for approval. A login that picked someone else's name waits for approval.
CREATE OR REPLACE FUNCTION public.set_my_venmo(p_handle text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_player uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Log in first.' USING ERRCODE = '28000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.players WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Your login is not linked to a player yet.' USING ERRCODE = 'P0002';
  END IF;
  -- A name picked from the roster by some other login must not redirect that player's money
  v_player := public.payments_my_player();
  IF v_player IS NULL THEN
    RAISE EXCEPTION 'Your roster name is waiting for the commissioner''s approval. You can add your Venmo once you''re approved.' USING ERRCODE = '42501';
  END IF;
  RETURN public.payments_save_venmo(v_player, public.payments_clean_venmo(p_handle), v_player);
END;
$$;

-- An admin sets (or clears) anyone's Venmo username
CREATE OR REPLACE FUNCTION public.admin_set_venmo(p_player uuid, p_handle text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_handle text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Log in first.' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_trip_admin() THEN
    RAISE EXCEPTION 'Admins only.' USING ERRCODE = '42501';
  END IF;
  v_handle := public.payments_clean_venmo(p_handle);
  IF p_player IS NULL OR NOT EXISTS (SELECT 1 FROM public.players WHERE id = p_player) THEN
    RAISE EXCEPTION 'That player isn''t on the roster any more.' USING ERRCODE = 'P0002';
  END IF;
  RETURN public.payments_save_venmo(p_player, v_handle, public.payments_actor());
END;
$$;

-- 5. The Bookie's Settle up: "Paid" ----------------------------------------------------------
-- Each row is money that changed hands: from_player paid to_player. The site subtracts it from
-- both players' balances for that trip, so the netted Settle up list recomputes; undoing a mark
-- deletes the row.
CREATE TABLE IF NOT EXISTS public.bookie_payments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_year   integer NOT NULL CONSTRAINT bookie_payments_year_check CHECK (trip_year BETWEEN 2020 AND 2100),
  from_player uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  to_player   uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  amount      numeric(10,2) NOT NULL CONSTRAINT bookie_payments_amount_check CHECK (amount > 0 AND amount <= 5000),
  -- Who tapped "Paid": one of the two players, or an admin
  marked_by   uuid REFERENCES public.players(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bookie_payments_two_players CHECK (from_player <> to_player)
);
COMMENT ON TABLE public.bookie_payments IS 'Bookie Settle up payments marked paid. Read: confirmed players and admins. Write: mark_paid / undo_paid only.';
CREATE INDEX IF NOT EXISTS bookie_payments_year_idx ON public.bookie_payments (trip_year, created_at);
CREATE INDEX IF NOT EXISTS bookie_payments_from_idx ON public.bookie_payments (from_player);
CREATE INDEX IF NOT EXISTS bookie_payments_to_idx ON public.bookie_payments (to_player);
CREATE INDEX IF NOT EXISTS bookie_payments_marked_by_idx ON public.bookie_payments (trip_year, marked_by);

ALTER TABLE public.bookie_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bookie_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.bookie_payments TO authenticated;

DROP POLICY IF EXISTS "bookie_payments_crew_read" ON public.bookie_payments;
CREATE POLICY "bookie_payments_crew_read"
  ON public.bookie_payments FOR SELECT
  TO authenticated
  USING ((SELECT public.payments_crew()));

-- Mark a Settle up payment paid. The caller must be the payer or the player being paid (and
-- confirmed), or an admin. "I paid X" also needs X to be on the site (so X can see it and undo
-- it); "X paid me" is always fine, since it only lowers what the caller is owed. A second tap
-- on the same payment within two minutes (a double tap, or both players tapping at once)
-- returns the first mark with "duplicate": true instead of recording it twice.
CREATE OR REPLACE FUNCTION public.mark_paid(p_trip_year integer, p_from uuid, p_to uuid, p_amount numeric)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_amount numeric := round(p_amount, 2);
  v_admin boolean;
  v_me uuid;
  v_row public.bookie_payments%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Log in first.' USING ERRCODE = '28000';
  END IF;
  IF NOT public.payments_crew() THEN
    RAISE EXCEPTION 'Only confirmed players can mark payments. Ask the commissioner to confirm you.' USING ERRCODE = '42501';
  END IF;
  IF p_trip_year IS NULL OR p_trip_year NOT BETWEEN 2020 AND 2100 THEN
    RAISE EXCEPTION 'Bad trip year.' USING ERRCODE = '22023';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from = p_to THEN
    RAISE EXCEPTION 'A payment needs two different players.' USING ERRCODE = '22023';
  END IF;
  -- (NaN and Infinity fail this too)
  IF v_amount IS NULL OR NOT (v_amount > 0 AND v_amount <= 5000) THEN
    RAISE EXCEPTION 'The amount should be between $0.01 and $5,000.' USING ERRCODE = '22023';
  END IF;

  -- One of the two players on it (linked, confirmed), or an admin
  v_admin := public.is_trip_admin();
  SELECT id INTO v_me FROM public.players
  WHERE id = public.payments_my_player() AND id IN (p_from, p_to) AND COALESCE(status, 'confirmed') = 'confirmed';
  IF v_me IS NULL THEN
    IF NOT v_admin THEN
      RAISE EXCEPTION 'Only the two players on a payment (or an admin) can mark it paid.' USING ERRCODE = '42501';
    END IF;
    v_me := public.payments_actor();
  END IF;
  IF (SELECT count(*) FROM public.players WHERE id IN (p_from, p_to)) < 2 THEN
    RAISE EXCEPTION 'That player isn''t on the roster any more.' USING ERRCODE = 'P0002';
  END IF;
  -- "I paid X": X has to be able to see it and undo it (an admin can mark it for anyone)
  IF NOT v_admin AND v_me = p_from AND NOT public.payments_player_on_site(p_to) THEN
    RAISE EXCEPTION 'The player you paid can''t see Paid marks on the site yet, so ask the commissioner to mark this one.' USING ERRCODE = '42501';
  END IF;

  -- One change at a time between these two players (undo_paid takes the same lock), so two
  -- taps can't both get in and a Paid tap can't be answered by a mark that's being undone
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'bbb_bookie_payments:' || p_trip_year || ':' || least(p_from::text, p_to::text) || ':' || greatest(p_from::text, p_to::text), 0));

  SELECT * INTO v_row FROM public.bookie_payments
  WHERE trip_year = p_trip_year AND from_player = p_from AND to_player = p_to AND amount = v_amount
    AND created_at > now() - interval '2 minutes'
  ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN to_jsonb(v_row) || jsonb_build_object('duplicate', true);
  END IF;

  -- Keep the table a sensible size whatever a login sends: a trip year always fits in one read
  -- of the API (1,000 rows), and no single login or pair of players can fill it
  IF (SELECT count(*) FROM public.bookie_payments
      WHERE trip_year = p_trip_year
        AND ((from_player = p_from AND to_player = p_to) OR (from_player = p_to AND to_player = p_from))) >= 100 THEN
    RAISE EXCEPTION 'That''s a lot of payments between those two. Text the commissioner.' USING ERRCODE = '54000';
  END IF;
  IF (SELECT count(*) FROM public.bookie_payments WHERE trip_year = p_trip_year AND marked_by = v_me) >= 150 THEN
    RAISE EXCEPTION 'You''ve marked a lot of payments this trip. Text the commissioner.' USING ERRCODE = '54000';
  END IF;
  IF (SELECT count(*) FROM public.bookie_payments WHERE trip_year = p_trip_year) >= 900 THEN
    RAISE EXCEPTION 'That''s a lot of payments for one trip. Text the commissioner.' USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.bookie_payments (trip_year, from_player, to_player, amount, marked_by)
  VALUES (p_trip_year, p_from, p_to, v_amount, v_me)
  RETURNING * INTO v_row;
  RETURN to_jsonb(v_row) || jsonb_build_object('duplicate', false);
END;
$$;

-- Undo a "Paid" mark: either player on that payment (linked, confirmed), or an admin.
-- Returns the id of the mark removed.
CREATE OR REPLACE FUNCTION public.undo_paid(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.bookie_payments%ROWTYPE;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Log in first.' USING ERRCODE = '28000';
  END IF;
  -- Checked before looking the mark up, so outsiders can't even tell whether an id exists
  IF NOT public.payments_crew() THEN
    RAISE EXCEPTION 'Only confirmed players can mark payments. Ask the commissioner to confirm you.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.bookie_payments WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That payment isn''t marked paid any more.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM public.players
       WHERE id = public.payments_my_player() AND id IN (v_row.from_player, v_row.to_player)
         AND COALESCE(status, 'confirmed') = 'confirmed')
     AND NOT public.is_trip_admin() THEN
    RAISE EXCEPTION 'Only the two players on a payment (or an admin) can undo it.' USING ERRCODE = '42501';
  END IF;

  -- The same lock mark_paid takes, so a Paid tap waits for this undo instead of being told
  -- "already marked" by the row this is removing
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'bbb_bookie_payments:' || v_row.trip_year || ':' || least(v_row.from_player::text, v_row.to_player::text) || ':' || greatest(v_row.from_player::text, v_row.to_player::text), 0));
  DELETE FROM public.bookie_payments WHERE id = v_row.id RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    -- The other player undid it a moment ago
    RAISE EXCEPTION 'That payment isn''t marked paid any more.' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_id;
END;
$$;

-- 6. Trip-cost payments -------------------------------------------------------------------------
-- Money records: a player with trip payments can't be deleted (ON DELETE RESTRICT; section 1
-- says so in words). Delete his payments first if he's really off the trip.
CREATE TABLE IF NOT EXISTS public.trip_payments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_year  integer NOT NULL CONSTRAINT trip_payments_year_check CHECK (trip_year BETWEEN 2020 AND 2100),
  player_id  uuid NOT NULL REFERENCES public.players(id) ON DELETE RESTRICT,
  amount     numeric(10,2) NOT NULL CONSTRAINT trip_payments_amount_check CHECK (amount > 0 AND amount <= 10000),
  paid_on    date NOT NULL DEFAULT current_date,
  -- Shown to the player too, on the homepage
  note       text CONSTRAINT trip_payments_note_check CHECK (note IS NULL OR char_length(note) <= 200),
  created_by uuid REFERENCES public.players(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.trip_payments IS 'Trip-cost payments. Read: admins (all) and each player (own). Write: admin_add_trip_payment / admin_delete_trip_payment only.';
CREATE INDEX IF NOT EXISTS trip_payments_player_year_idx ON public.trip_payments (player_id, trip_year);
CREATE INDEX IF NOT EXISTS trip_payments_year_idx ON public.trip_payments (trip_year, paid_on);

ALTER TABLE public.trip_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.trip_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.trip_payments TO authenticated;

DROP POLICY IF EXISTS "trip_payments_admin_or_own_read" ON public.trip_payments;
CREATE POLICY "trip_payments_admin_or_own_read"
  ON public.trip_payments FOR SELECT
  TO authenticated
  USING ((SELECT public.is_trip_admin()) OR player_id = (SELECT public.payments_my_player()));

-- Admin: record a payment toward the trip (paid_on defaults to today, UTC; send the date)
CREATE OR REPLACE FUNCTION public.admin_add_trip_payment(p_player uuid, p_trip_year integer, p_amount numeric, p_paid_on date, p_note text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_amount numeric := round(p_amount, 2);
  v_paid_on date := COALESCE(p_paid_on, current_date);
  v_note text := NULLIF(regexp_replace(COALESCE(p_note, ''), '^\s+|\s+$', '', 'g'), '');
  v_row public.trip_payments%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Log in first.' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_trip_admin() THEN
    RAISE EXCEPTION 'Admins only.' USING ERRCODE = '42501';
  END IF;
  IF p_trip_year IS NULL OR p_trip_year NOT BETWEEN 2020 AND 2100 THEN
    RAISE EXCEPTION 'Bad trip year.' USING ERRCODE = '22023';
  END IF;
  IF v_amount IS NULL OR NOT (v_amount > 0 AND v_amount <= 10000) THEN
    RAISE EXCEPTION 'The amount should be between $0.01 and $10,000.' USING ERRCODE = '22023';
  END IF;
  IF v_paid_on < DATE '2020-01-01' OR v_paid_on > current_date + 366 THEN
    RAISE EXCEPTION 'That payment date doesn''t look right.' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_note) > 200 THEN
    RAISE EXCEPTION 'Keep the note to 200 characters.' USING ERRCODE = '22023';
  END IF;
  IF p_player IS NULL OR NOT EXISTS (SELECT 1 FROM public.players WHERE id = p_player) THEN
    RAISE EXCEPTION 'That player isn''t on the roster any more.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.trip_payments (trip_year, player_id, amount, paid_on, note, created_by)
  VALUES (p_trip_year, p_player, v_amount, v_paid_on, v_note, public.payments_actor())
  RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END;
$$;

-- Admin: delete a trip payment recorded by mistake. Returns the id removed.
CREATE OR REPLACE FUNCTION public.admin_delete_trip_payment(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Log in first.' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_trip_admin() THEN
    RAISE EXCEPTION 'Admins only.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.trip_payments WHERE id = p_id RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'That payment was already deleted.' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_id;
END;
$$;

-- The signed-in player's own trip payments for a year, oldest first (none if not linked, or
-- if the login picked someone else's name and is still waiting for approval)
CREATE OR REPLACE FUNCTION public.my_trip_payments(p_trip_year integer)
RETURNS TABLE (id uuid, trip_year integer, amount numeric, paid_on date, note text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT tp.id, tp.trip_year, tp.amount, tp.paid_on, tp.note, tp.created_at
  FROM public.trip_payments tp
  WHERE tp.player_id = public.payments_my_player() AND tp.trip_year = p_trip_year
  ORDER BY tp.paid_on, tp.created_at;
$$;

-- 7. Admin: who is behind each linked roster name, approving a login, unlinking one -------------
-- Every roster name linked to a login, with the email that login signs in with, and for a name
-- held because another login picked it (section 1), the status it had before (status_before_pick;
-- null otherwise). Names waiting for approval first, then mismatches, then by name.
-- (Replaces admin_payment_logins() from the first draft of this script.)
DROP FUNCTION IF EXISTS public.admin_payment_logins();
DROP FUNCTION IF EXISTS public.admin_roster_logins();
CREATE FUNCTION public.admin_roster_logins()
RETURNS TABLE (player_id uuid, name text, status text, roster_email text, login_email text, email_match boolean, status_before_pick text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Log in first.' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_trip_admin() THEN
    RAISE EXCEPTION 'Admins only.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT x.id, x.name::text, x.st, x.email::text, x.login_email, x.ok, x.before
    FROM (
      SELECT p.id, p.name, COALESCE(p.status, 'confirmed')::text AS st, p.email, u.email::text AS login_email,
             COALESCE(NULLIF(btrim(u.email), '') IS NOT NULL AND lower(btrim(p.email)) = lower(btrim(u.email)), false) AS ok,
             CASE WHEN p.status = 'potential' THEN h.prior_status END AS before
      FROM public.players p
      LEFT JOIN auth.users u ON u.id = p.user_id
      LEFT JOIN public.roster_claim_holds h ON h.player_id = p.id AND h.user_id = p.user_id
      WHERE p.user_id IS NOT NULL
    ) x
    ORDER BY (x.st = 'confirmed'), x.ok, x.name;
END;
$$;

-- Approve the login linked to a name, naming that login (p_login_email: the login_email
-- admin_roster_logins showed). This is how the site approves a name whose roster email isn't the
-- login's: approve_player and Admin's editors are refused for those (section 1). If the name is now
-- linked to a different login, or none, it says so instead (reload and look again).
CREATE OR REPLACE FUNCTION public.admin_approve_pick(p_player uuid, p_login_email text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_player public.players%ROWTYPE;
  v_login text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Log in first.' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_trip_admin() THEN
    RAISE EXCEPTION 'Admins only.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_player FROM public.players WHERE id = p_player FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That player isn''t on the roster any more.' USING ERRCODE = 'P0002';
  END IF;
  IF v_player.user_id IS NULL THEN
    RAISE EXCEPTION 'Nobody is signed in as % any more. Reload the page.', v_player.name USING ERRCODE = 'P0002';
  END IF;
  SELECT u.email INTO v_login FROM auth.users u WHERE u.id = v_player.user_id;
  IF lower(btrim(COALESCE(v_login, ''))) IS DISTINCT FROM lower(btrim(COALESCE(p_login_email, ''))) THEN
    RAISE EXCEPTION '% is signed in with a different login now. Reload the page and check again.', v_player.name USING ERRCODE = 'P0002';
  END IF;
  PERFORM set_config('bbb.approve_pick', v_player.id::text || ':' || v_player.user_id::text, true);
  UPDATE public.players SET status = 'confirmed' WHERE id = v_player.id RETURNING * INTO v_player;
  PERFORM set_config('bbb.approve_pick', '', true);
  RETURN jsonb_build_object('id', v_player.id, 'name', v_player.name, 'status', v_player.status);
END;
$$;

-- "Not him": unlink the login from a name. A name held because that login picked it goes back to
-- the status it had before (section 1); any other name keeps its status. The login can sign in
-- again and pick a name or join as new. Returns {id, name, status, login_email}.
CREATE OR REPLACE FUNCTION public.admin_release_claim(p_player uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_player public.players%ROWTYPE;
  v_login text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Log in first.' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_trip_admin() THEN
    RAISE EXCEPTION 'Admins only.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_player FROM public.players WHERE id = p_player FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That player isn''t on the roster any more.' USING ERRCODE = 'P0002';
  END IF;
  IF v_player.user_id IS NULL THEN
    RAISE EXCEPTION 'Nobody is signed in as % any more.', v_player.name USING ERRCODE = 'P0002';
  END IF;
  SELECT u.email INTO v_login FROM auth.users u WHERE u.id = v_player.user_id;
  UPDATE public.players SET user_id = NULL WHERE id = v_player.id RETURNING * INTO v_player;
  RETURN jsonb_build_object('id', v_player.id, 'name', v_player.name, 'status', COALESCE(v_player.status, 'confirmed'), 'login_email', v_login);
END;
$$;

-- 8. The official Ryder Cup total: admins only ------------------------------------------------
-- rls_policies.sql let any signed-in login (anyone can sign up) insert or rewrite
-- ryder_cup_scores, the total the homepage, Round Tracker and Bookie show. Only Admin writes it.
-- Restrictive rules apply on top of whatever other rules the table has (rls_policies.sql turned row
-- security on for it and lets everyone read it; the check at the end says if that's not so).
DROP POLICY IF EXISTS "ryder_cup_scores_admin_only_insert" ON public.ryder_cup_scores;
CREATE POLICY "ryder_cup_scores_admin_only_insert" ON public.ryder_cup_scores AS RESTRICTIVE FOR INSERT
  TO anon, authenticated WITH CHECK (public.is_trip_admin());
DROP POLICY IF EXISTS "ryder_cup_scores_admin_only_update" ON public.ryder_cup_scores;
CREATE POLICY "ryder_cup_scores_admin_only_update" ON public.ryder_cup_scores AS RESTRICTIVE FOR UPDATE
  TO anon, authenticated USING (public.is_trip_admin()) WITH CHECK (public.is_trip_admin());
DROP POLICY IF EXISTS "ryder_cup_scores_admin_only_delete" ON public.ryder_cup_scores;
CREATE POLICY "ryder_cup_scores_admin_only_delete" ON public.ryder_cup_scores AS RESTRICTIVE FOR DELETE
  TO anon, authenticated USING (public.is_trip_admin());

-- 9. Only signed-in users can call these -----------------------------------------------------
-- (Supabase lets everyone, signed in or not, run new functions unless told otherwise.)
REVOKE ALL ON FUNCTION public.payments_my_player() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.payments_crew() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.payments_me() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_my_venmo(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_venmo(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_paid(integer, uuid, uuid, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.undo_paid(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_add_trip_payment(uuid, integer, numeric, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_delete_trip_payment(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_trip_payments(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_roster_logins() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_approve_pick(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_release_claim(uuid) FROM PUBLIC, anon;
-- (as rsvp_accounts.sql had them)
REVOKE ALL ON FUNCTION public.my_rsvp(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_rsvp(integer, text, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_my_profile(text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payments_my_player() TO authenticated;
GRANT EXECUTE ON FUNCTION public.payments_crew() TO authenticated;
GRANT EXECUTE ON FUNCTION public.payments_me() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_venmo(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_venmo(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_paid(integer, uuid, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_paid(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_add_trip_payment(uuid, integer, numeric, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_trip_payment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_trip_payments(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_roster_logins() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_approve_pick(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_release_claim(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_rsvp(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_rsvp(integer, text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_profile(text, numeric) TO authenticated;

-- The internal helpers run only inside the functions above, never from the site. (A trigger
-- still runs without this right; nobody can call the trigger function directly.)
REVOKE ALL ON FUNCTION public.players_claim_review() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payments_actor() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payments_player_on_site(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payments_clean_venmo(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payments_save_venmo(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

-- Tell the API about the new tables and functions right away
NOTIFY pgrst, 'reload schema';

-- 10. Check (read-only; the SQL editor shows this last result) ---------------------------------
-- Every setup row (everything except 'to approve' rows) should say ok = true.
-- You can run just this query again later (from WITH to the end).
--   'needs ...' rows: the other setup scripts this relies on. bookie_2027.sql keeps a held name
--                  (and anyone else who isn't a confirmed player) out of betting; tracker_2027.sql
--                  out of scores.
--   trigger row:   the roster-name approval rule is on, right after rsvp_accounts.sql's guard.
--   'held names' row: section 3 is in place. If it says otherwise, rsvp_accounts.sql or an old
--                  Bookie script ran after this one: run this script again.
--   table rows:    row security on, signed-out visitors get nothing, signed-in users can only
--                  read (and only the rows the rule allows), the one read rule in place.
--   function rows: site functions run as their owner with a fixed search path, can't be run
--                  signed out, can be run signed in; internal ones can't be run from the site.
--   'to approve' rows (ok = false) are roster names somebody picked whose roster email isn't
--                  their login's email, held for your approval. The detail says what to do. The
--                  row disappears once handled.
WITH want_tables(name) AS (
  VALUES ('player_venmo'), ('bookie_payments'), ('trip_payments')
), want_functions(sig, site) AS (
  VALUES ('payments_my_player()', true),
         ('payments_crew()', true),
         ('payments_me()', true),
         ('set_my_venmo(text)', true),
         ('admin_set_venmo(uuid,text)', true),
         ('mark_paid(integer,uuid,uuid,numeric)', true),
         ('undo_paid(uuid)', true),
         ('admin_add_trip_payment(uuid,integer,numeric,date,text)', true),
         ('admin_delete_trip_payment(uuid)', true),
         ('my_trip_payments(integer)', true),
         ('admin_roster_logins()', true),
         ('admin_approve_pick(uuid,text)', true),
         ('admin_release_claim(uuid)', true),
         ('players_claim_review()', false),
         ('payments_actor()', false),
         ('payments_player_on_site(uuid)', false),
         ('payments_clean_venmo(text)', false),
         ('payments_save_venmo(uuid,text,uuid)', false)
), trg AS (
  -- tgtype bits: 1 = per row, 2 = before, 8 = delete, 16 = update
  SELECT g.tgname, g.tgenabled <> 'D' AND (g.tgtype & 19) = 19 AND (g.tgname <> 'aab_players_claim_review' OR (g.tgtype & 8) = 8) AS ok
  FROM pg_trigger g
  WHERE g.tgrelid = to_regclass('public.players') AND g.tgname IN ('aaa_players_guard', 'aab_players_claim_review')
), held AS (
  SELECT count(*) FILTER (WHERE p.prosrc LIKE '%payments_my_player()%') = 3
         AND EXISTS (SELECT 1 FROM pg_policies pp WHERE pp.schemaname = 'public' AND pp.tablename = 'wager_comments'
                       AND pp.policyname = 'wager_comments_confirmed_only' AND pp.permissive = 'RESTRICTIVE' AND pp.cmd = 'INSERT') AS ok
  FROM unnest(ARRAY['public.my_rsvp(integer)', 'public.submit_rsvp(integer,text,boolean,text)', 'public.update_my_profile(text,numeric)']) s(sig)
  LEFT JOIN pg_proc p ON p.oid = to_regprocedure(s.sig)
), cup AS (
  SELECT COALESCE(c.relrowsecurity, false)
         AND (SELECT count(*) FROM pg_policies pp WHERE pp.schemaname = 'public' AND pp.tablename = 'ryder_cup_scores'
                AND pp.permissive = 'RESTRICTIVE' AND pp.policyname LIKE 'ryder_cup_scores_admin_only_%') = 3 AS ok
  FROM (SELECT 1) one LEFT JOIN pg_class c ON c.oid = to_regclass('public.ryder_cup_scores')
), holds AS (
  SELECT c.oid,
         COALESCE(c.relrowsecurity
           AND NOT has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
           AND NOT has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
           AND (SELECT count(*) FROM pg_policies pp WHERE pp.schemaname = 'public' AND pp.tablename = 'roster_claim_holds') = 0, false) AS ok
  FROM (SELECT 1) one LEFT JOIN pg_class c ON c.oid = to_regclass('public.roster_claim_holds')
)
SELECT 'needs rsvp_accounts.sql' AS check_name,
       to_regprocedure('public.is_trip_admin()') IS NOT NULL AND EXISTS (SELECT 1 FROM trg WHERE tgname = 'aaa_players_guard') AS ok,
       CASE WHEN to_regprocedure('public.is_trip_admin()') IS NULL OR NOT EXISTS (SELECT 1 FROM trg WHERE tgname = 'aaa_players_guard')
            THEN 'MISSING is_trip_admin() or the players guard: run rsvp_accounts.sql' ELSE 'is_trip_admin() and the players guard found' END AS detail
UNION ALL
SELECT 'needs bookie_2027.sql (bet rules)',
       EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = to_regclass('public.wagers') AND g.tgname = 'wagers_guard' AND g.tgenabled <> 'D'),
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = to_regclass('public.wagers') AND g.tgname = 'wagers_guard' AND g.tgenabled <> 'D')
            THEN 'only confirmed players bet, as themselves (a held name can''t)'
            ELSE 'NOT RUN YET: run bookie_2027.sql. Without it any signed-in login can post or join bets as anyone, held names included.' END
UNION ALL
SELECT 'needs tracker_2027.sql (score rules)',
       to_regprocedure('public.is_confirmed_player()') IS NOT NULL
         AND EXISTS (SELECT 1 FROM pg_policies pp WHERE pp.schemaname = 'public' AND pp.tablename = 'scores' AND pp.policyname = 'tracker_confirmed_only_insert'),
       CASE WHEN to_regprocedure('public.is_confirmed_player()') IS NOT NULL
              AND EXISTS (SELECT 1 FROM pg_policies pp WHERE pp.schemaname = 'public' AND pp.tablename = 'scores' AND pp.policyname = 'tracker_confirmed_only_insert')
            THEN 'only confirmed players enter scores (a held name can''t)'
            ELSE 'NOT RUN YET: run tracker_2027.sql. Without it any signed-in login can change scores, held names included.' END
UNION ALL
SELECT 'trigger aab_players_claim_review',
       COALESCE((SELECT ok FROM trg WHERE tgname = 'aab_players_claim_review'), false)
         AND COALESCE((SELECT ok FROM trg WHERE tgname = 'aaa_players_guard'), false),
       CASE WHEN NOT EXISTS (SELECT 1 FROM trg WHERE tgname = 'aab_players_claim_review') THEN 'MISSING: run payments_2027.sql'
            ELSE 'a picked roster name whose email isn''t the login''s waits for approval (runs after aaa_players_guard)' END
UNION ALL
SELECT 'table roster_claim_holds',
       (SELECT ok FROM holds),
       CASE WHEN (SELECT oid FROM holds) IS NULL THEN 'MISSING: run payments_2027.sql'
            ELSE (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public.roster_claim_holds', false, true, '')))[1]::text || ' held names on record (no site access)'
       END
UNION ALL
SELECT 'held names: RSVP, profile, comments',
       (SELECT ok FROM held),
       CASE WHEN (SELECT ok FROM held) THEN 'a held name can''t RSVP, change the GHIN/handicap, read the RSVP note or comment as that player'
            ELSE 'MISSING (or rsvp_accounts.sql / an old Bookie script ran after this): run payments_2027.sql' END
UNION ALL
SELECT 'Cup total: admins only',
       (SELECT ok FROM cup),
       CASE WHEN (SELECT ok FROM cup) THEN 'only admins can change ryder_cup_scores'
            WHEN NOT COALESCE((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass('public.ryder_cup_scores')), false)
              THEN 'NOT RUN YET: row security is off on ryder_cup_scores; run rls_policies.sql, then this script again'
            ELSE 'MISSING: run payments_2027.sql' END
UNION ALL
SELECT 'table ' || t.name,
       COALESCE(c.relrowsecurity
         AND NOT has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
         AND has_table_privilege('authenticated', c.oid, 'SELECT')
         AND NOT has_table_privilege('authenticated', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
         AND (SELECT count(*) FROM pg_policies pp WHERE pp.schemaname = 'public' AND pp.tablename = t.name) = 1
         -- trip payments block deleting a player (ON DELETE RESTRICT)
         AND (t.name <> 'trip_payments' OR EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'f'
                                                     AND k.confrelid = 'public.players'::regclass AND k.confdeltype = 'r')), false),
       CASE WHEN c.oid IS NULL THEN 'MISSING: run payments_2027.sql'
            -- row count without failing when a table is missing
            ELSE (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %s', c.oid::regclass), false, true, '')))[1]::text || ' rows'
       END
FROM want_tables t
LEFT JOIN pg_class c ON c.oid = to_regclass('public.' || t.name)
UNION ALL
SELECT 'function ' || f.sig,
       COALESCE(CASE WHEN f.site THEN
                  p.prosecdef
                  AND 'search_path=public, pg_temp' = ANY (p.proconfig)
                  AND NOT has_function_privilege('public', p.oid, 'EXECUTE')
                  AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                  AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                ELSE
                  NOT has_function_privilege('public', p.oid, 'EXECUTE')
                  AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                  AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                END, false),
       CASE WHEN p.oid IS NULL THEN 'MISSING: run payments_2027.sql'
            WHEN f.site THEN 'site function (signed-in only)'
            WHEN f.sig = 'players_claim_review()' THEN 'trigger function (internal)'
            ELSE 'internal helper' END
FROM want_functions f
LEFT JOIN pg_proc p ON p.oid = to_regprocedure('public.' || f.sig)
UNION ALL
SELECT 'to approve: ' || p.name,
       false,
       p.name || ' was picked by the login ' || COALESCE(NULLIF(btrim(u.email), ''), '(no email)') || ', but the roster email is '
         || COALESCE(NULLIF(btrim(p.email), ''), '(empty)') || '. If that login is really him, approve it in Admin, or here: UPDATE public.players SET status = ''confirmed'' WHERE id = '''
         || p.id || '''; If it isn''t, unlink it in Admin, or here: UPDATE public.players SET user_id = NULL WHERE id = ''' || p.id
         || '''; and the name goes back to how it was before the pick.'
FROM public.players p
LEFT JOIN auth.users u ON u.id = p.user_id
WHERE p.user_id IS NOT NULL
  AND p.status = 'potential'
  AND NOT COALESCE(NULLIF(btrim(p.email), '') IS NOT NULL AND lower(btrim(p.email)) = lower(btrim(u.email)), false);

-- Handy for the commissioner (not run by this script):
-- Who hasn't added a Venmo yet
-- SELECT p.name, p.status FROM public.players p
-- LEFT JOIN public.player_venmo v ON v.player_id = p.id
-- WHERE v.player_id IS NULL ORDER BY p.status, p.name;
--
-- Before the first run: logins whose email is already on a roster name nobody has picked. Each can
-- pick that name without waiting for approval, because the emails match. Any login made while
-- "Confirm email" was off never proved it owns that address, so check the ones created before you
-- turned it on: if one isn't really that player, delete that login (Authentication -> Users).
-- SELECT p.name, u.email, u.created_at, u.email_confirmed_at, u.raw_app_meta_data ->> 'provider' AS provider
-- FROM auth.users u JOIN public.players p ON lower(btrim(p.email)) = lower(btrim(u.email))
-- WHERE p.user_id IS NULL
-- ORDER BY u.created_at;
--
-- Confirmed names linked to a login whose email isn't the roster email: names picked before this
-- script ran (it leaves those alone), plus picks you've approved since. If one of those logins
-- isn't really him, unlink it (Admin, or clear user_id on his row). Anything that login did as
-- him (RSVPs: rsvps.user_id; GHIN/handicap; Bookie comments) stays, so check those too.
-- SELECT p.name, u.email AS login_email, p.email AS roster_email
-- FROM public.players p JOIN auth.users u ON u.id = p.user_id
-- WHERE COALESCE(p.status, 'confirmed') = 'confirmed'
--   AND lower(btrim(COALESCE(p.email, ''))) IS DISTINCT FROM lower(btrim(COALESCE(u.email, '')))
-- ORDER BY p.name;
