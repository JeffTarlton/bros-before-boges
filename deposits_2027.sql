-- ============================================================
-- Bros Before Boges — the trip deposit: "Pay on Venmo", "I sent it", and an admin's
-- Confirm / Not received (2027)
-- Order: 1. push the site update first. Until this script has run, the homepage checklist says
--           "Paying on the site is being set up", and Admin's RSVPs tab says the "I sent it"
--           deposits are being set up.
--        2. then run this entire script once in the Supabase SQL Editor. It needs
--           payments_2027.sql, which has already run. Safe to run again: every claim, payment
--           and Venmo username already saved is kept.
-- Running it before the site update is harmless too (the old site never calls anything here).
-- ============================================================
-- What it does:
--   1. trip_payment_claims: each "I sent it" a player taps on the homepage after paying his
--      deposit on Venmo, and what an admin did with it. Venmo can't tell the site a payment went
--      through, so an admin checks the payee's Venmo and taps Confirm (which records the payment
--      in the Paid column, the same as adding it by hand) or Not received (the player sees "Not
--      received yet" and can tap I sent it again). The player can Undo his own while it waits.
--      The homepage ticks "Deposit paid" from the recorded payments, never from a claim.
--   2. Only signed-in, approved players can tap I sent it, and only for themselves. Signed-out
--      visitors, sign-ups waiting for approval and names somebody else picked can't, and never
--      get the payee's Venmo username either (my_deposit hands it only to approved players and
--      admins, the people who can already read Venmo usernames).
--   3. Each player reads only his own claims; admins read them all. Nobody can insert, edit or
--      delete claims directly from the browser: only through the functions below.
--   4. Westin Tucker collects the deposits, so his Venmo username (@Westin-Tucker) is saved on his
--      roster row, unless he or an admin already saved one (that one is kept). trip-config.js
--      names him the same way (payment.payTo: 'Westin Tucker'). If the payee ever changes,
--      change payment.payTo, the two names in section 5 and the check at the end together.
--      Only an APPROVED roster name counts as the payee. Anyone can sign up, so a sign-up still
--      waiting for approval that calls himself "Westin Tucker" (and saves his own Venmo) is never
--      used: he can't take the button away from everybody, or get the deposits sent to him.
--   The SQL editor and the table editor are not affected by anything here.
--
-- Functions the site calls (all signed-in only):
--   my_deposit(year, payee name)          the homepage's deposit line in one call
--   claim_deposit(year, amount)           "I sent it"
--   undo_deposit_claim(claim id)          Undo
--   admin_deposit_claims(year)            Admin: "Deposits to confirm"
--   admin_confirm_deposit(claim id, amount, paid on, note, add payment)   Admin: Confirm
--   admin_reject_deposit(claim id, note)  Admin: Not received
--   admin_reopen_deposit(claim id)        Admin: undo a Not received tapped by mistake
-- "Approved" means the same as for payments_2027.sql's crew: the roster row linked to the login
-- has status 'confirmed' (no status counts as confirmed). Admins are is_trip_admin(): a roster row
-- marked is_admin whose email is the one logged in.

-- 0. Needs payments_2027.sql ----------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.is_trip_admin()') IS NULL
     OR to_regprocedure('public.payments_my_player()') IS NULL
     OR to_regprocedure('public.payments_crew()') IS NULL
     OR to_regprocedure('public.payments_actor()') IS NULL
     OR to_regprocedure('public.admin_add_trip_payment(uuid,integer,numeric,date,text)') IS NULL
     OR to_regclass('public.trip_payments') IS NULL
     OR to_regclass('public.player_venmo') IS NULL
     OR to_regclass('public.roster_claim_holds') IS NULL THEN
    RAISE EXCEPTION 'Run payments_2027.sql first (it creates trip_payments, player_venmo and the payments functions), then run this again. Nothing was changed.';
  END IF;
END $$;

-- 1. "I sent it" claims ----------------------------------------------------------------------
-- A claim isn't money, so deleting a player deletes his claims. Once a claim is confirmed, its
-- trip payment already stops the player being deleted (payments_2027.sql).
CREATE TABLE IF NOT EXISTS public.trip_payment_claims (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_year       integer NOT NULL CONSTRAINT trip_payment_claims_year_check CHECK (trip_year BETWEEN 2020 AND 2100),
  player_id       uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  -- Room for a 'balance' kind later
  kind            text NOT NULL DEFAULT 'deposit' CONSTRAINT trip_payment_claims_kind_check CHECK (kind IN ('deposit')),
  amount          numeric(10,2) NOT NULL CONSTRAINT trip_payment_claims_amount_check CHECK (amount > 0 AND amount <= 10000),
  -- sent: waiting for an admin; confirmed / rejected: an admin's Confirm / Not received;
  -- withdrawn: the player's Undo
  status          text NOT NULL DEFAULT 'sent' CONSTRAINT trip_payment_claims_status_check CHECK (status IN ('sent', 'confirmed', 'rejected', 'withdrawn')),
  sent_at         timestamptz NOT NULL DEFAULT now(),
  -- The login that tapped it (a record only; the site never shows it)
  sent_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at     timestamptz,
  -- The admin who confirmed it or marked it not received, or the player himself for an Undo
  resolved_by     uuid REFERENCES public.players(id) ON DELETE SET NULL,
  -- The trip payment a Confirm recorded (cleared if that payment is deleted later)
  trip_payment_id uuid REFERENCES public.trip_payments(id) ON DELETE SET NULL,
  -- The admin's note. The player can read his own claim, so he sees it too.
  note            text CONSTRAINT trip_payment_claims_note_check CHECK (note IS NULL OR char_length(note) <= 200),
  CONSTRAINT trip_payment_claims_resolved_check CHECK ((status = 'sent') = (resolved_at IS NULL)),
  CONSTRAINT trip_payment_claims_payment_check CHECK (trip_payment_id IS NULL OR status = 'confirmed')
);
COMMENT ON TABLE public.trip_payment_claims IS 'Deposits players say they sent ("I sent it"), and what an admin did with each. Read: admins (all) and each player (own). Write: claim_deposit / undo_deposit_claim / admin_confirm_deposit / admin_reject_deposit only.';
-- One waiting claim per player per trip (two quick taps can't make two)
CREATE UNIQUE INDEX IF NOT EXISTS trip_payment_claims_one_open ON public.trip_payment_claims (player_id, trip_year, kind) WHERE status = 'sent';
CREATE INDEX IF NOT EXISTS trip_payment_claims_year_idx ON public.trip_payment_claims (trip_year, status, sent_at);
CREATE INDEX IF NOT EXISTS trip_payment_claims_player_idx ON public.trip_payment_claims (player_id, trip_year, sent_at);
CREATE INDEX IF NOT EXISTS trip_payment_claims_payment_idx ON public.trip_payment_claims (trip_payment_id);
CREATE INDEX IF NOT EXISTS trip_payment_claims_resolved_by_idx ON public.trip_payment_claims (resolved_by);

ALTER TABLE public.trip_payment_claims ENABLE ROW LEVEL SECURITY;
-- Supabase gives every new table to anon and authenticated with full rights; take that back.
-- Signed-in users get read access only, and the rule below decides which rows.
REVOKE ALL ON TABLE public.trip_payment_claims FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.trip_payment_claims TO authenticated;
DROP POLICY IF EXISTS "trip_payment_claims_admin_or_own_read" ON public.trip_payment_claims;
CREATE POLICY "trip_payment_claims_admin_or_own_read"
  ON public.trip_payment_claims FOR SELECT
  TO authenticated
  USING ((SELECT public.is_trip_admin()) OR player_id = (SELECT public.payments_my_player()));

-- 2. Internal helpers (not callable from the site) -------------------------------------------
-- The signed-in login's own APPROVED roster row (who may pay), or NULL: signed out, not linked,
-- a sign-up waiting for approval, or a name somebody else's login picked.
CREATE OR REPLACE FUNCTION public.deposit_payer()
RETURNS uuid
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  SELECT p.id FROM public.players p
  WHERE p.id = public.payments_my_player() AND COALESCE(p.status, 'confirmed') = 'confirmed';
$$;

-- A claim as the player sees it (leaves out which login tapped it and which admin resolved it)
CREATE OR REPLACE FUNCTION public.deposit_claim_json(c public.trip_payment_claims)
RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object('id', c.id, 'trip_year', c.trip_year, 'kind', c.kind, 'amount', c.amount,
                            'status', c.status, 'sent_at', c.sent_at, 'resolved_at', c.resolved_at,
                            'trip_payment_id', c.trip_payment_id, 'note', c.note);
$$;

-- 3. Player functions ------------------------------------------------------------------------
-- Everything the homepage's deposit line needs, in one call. p_payee: trip-config.js's
-- payment.payTo (a roster name; any case, extra spaces ignored). Returns
--   player_id, status  the roster row linked to this login (any status), or null
--   own_ok             that row is this login's own (false for a name somebody else's login picked)
--   can_pay            may tap I sent it (an approved name)
--   payee              {player_id, name, handle} of whoever collects it: approved players and
--                      admins only (handle null when he has no Venmo saved), else null
--   payee_problem      for approved players and admins: null, or why there's no Pay button:
--                      not_set (no payTo), not_found, ambiguous (two roster names match), no_venmo
--                      Only approved roster names count as the payee: a sign-up still waiting for
--                      approval never does, whatever he called himself. A name that is waiting only
--                      because somebody else's login picked it still counts (it was approved before
--                      the pick, the picker can't change its Venmo, and it goes back when unlinked).
--   claim              his latest deposit claim for that trip, or null
--   admin_open         admins only: claims waiting for an admin that trip
-- Signed in with no login id: everything null / false.
CREATE OR REPLACE FUNCTION public.my_deposit(p_trip_year integer, p_payee text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_linked_id uuid;
  v_linked_status text;
  v_own uuid := public.payments_my_player();
  v_pay uuid := public.deposit_payer();
  v_crew boolean := public.payments_crew();
  v_admin boolean := auth.uid() IS NOT NULL AND public.is_trip_admin();
  v_key text := '';
  v_n integer;
  v_payee jsonb;
  v_problem text;
  v_claim jsonb;
  v_open integer;
BEGIN
  IF p_trip_year IS NULL OR p_trip_year NOT BETWEEN 2020 AND 2100 THEN
    RAISE EXCEPTION 'Bad trip year.' USING ERRCODE = '22023';
  END IF;
  IF auth.uid() IS NOT NULL THEN
    SELECT p.id, COALESCE(p.status, 'confirmed') INTO v_linked_id, v_linked_status
    FROM public.players p WHERE p.user_id = auth.uid() ORDER BY p.id LIMIT 1;
  END IF;
  -- Where to pay: only for approved players and admins (the same people player_venmo lets read
  -- usernames). Matched here, so the page never matches names itself.
  IF v_crew THEN
    IF char_length(COALESCE(p_payee, '')) <= 500 THEN
      v_key := lower(btrim(regexp_replace(COALESCE(p_payee, ''), '\s+', ' ', 'g')));
    END IF;
    IF v_key = '' OR char_length(v_key) > 120 THEN
      v_problem := 'not_set';
    ELSE
      -- Approved names only (see payee_problem above): the same rule as section 5 and the check
      SELECT count(*) OVER (), jsonb_build_object('player_id', p.id, 'name', p.name, 'handle', v.handle)
      INTO v_n, v_payee
      FROM public.players p LEFT JOIN public.player_venmo v ON v.player_id = p.id
      WHERE lower(btrim(regexp_replace(p.name, '\s+', ' ', 'g'))) = v_key
        AND (COALESCE(p.status, 'confirmed') = 'confirmed'
             OR (p.status = 'potential' AND EXISTS (SELECT 1 FROM public.roster_claim_holds h
                   WHERE h.player_id = p.id AND h.user_id = p.user_id AND h.prior_status = 'confirmed')))
      ORDER BY p.id
      LIMIT 1;
      IF COALESCE(v_n, 0) = 0 THEN
        v_problem := 'not_found';
      ELSIF v_n > 1 THEN
        v_problem := 'ambiguous';
        v_payee := NULL;
      ELSIF v_payee ->> 'handle' IS NULL THEN
        v_problem := 'no_venmo';
      END IF;
    END IF;
  END IF;
  -- His latest deposit claim this trip (never another player's: a picked name still waiting
  -- for approval gets none)
  IF v_own IS NOT NULL THEN
    SELECT public.deposit_claim_json(c) INTO v_claim
    FROM public.trip_payment_claims c
    WHERE c.player_id = v_own AND c.trip_year = p_trip_year AND c.kind = 'deposit'
    ORDER BY c.sent_at DESC, c.id DESC
    LIMIT 1;
  END IF;
  IF v_admin THEN
    SELECT count(*) INTO v_open FROM public.trip_payment_claims c WHERE c.trip_year = p_trip_year AND c.status = 'sent';
  END IF;
  RETURN jsonb_build_object(
    'player_id', v_linked_id,
    'status', v_linked_status,
    'own_ok', COALESCE(v_linked_id = v_own, false),
    'can_pay', v_pay IS NOT NULL,
    'payee', v_payee,
    'payee_problem', v_problem,
    'claim', v_claim,
    'admin_open', v_open
  );
END;
$$;
COMMENT ON FUNCTION public.my_deposit(integer, text) IS 'The homepage deposit line: {player_id, status, own_ok, can_pay, payee (approved players and admins only), payee_problem, claim, admin_open}.';

-- "I sent it": the signed-in, approved player says he sent his deposit. Always for his own roster
-- name (there's no player argument). One waiting claim per player per trip: a second tap returns
-- the waiting one with "duplicate": true (only a new one, duplicate false, should send an alert).
CREATE OR REPLACE FUNCTION public.claim_deposit(p_trip_year integer, p_amount numeric)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_amount numeric := round(p_amount, 2);
  v_me uuid;
  v_row public.trip_payment_claims%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Log in first.' USING ERRCODE = '28000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.players WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Your login is not linked to a player yet.' USING ERRCODE = 'P0002';
  END IF;
  v_me := public.deposit_payer();
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Your roster name is waiting for the commissioner''s approval. You can pay your deposit once you''re approved.' USING ERRCODE = '42501';
  END IF;
  IF p_trip_year IS NULL OR p_trip_year NOT BETWEEN 2020 AND 2100 THEN
    RAISE EXCEPTION 'Bad trip year.' USING ERRCODE = '22023';
  END IF;
  -- (NaN and Infinity fail this too)
  IF v_amount IS NULL OR NOT (v_amount > 0 AND v_amount <= 10000) THEN
    RAISE EXCEPTION 'The amount should be between $0.01 and $10,000.' USING ERRCODE = '22023';
  END IF;

  -- One tap at a time per player and trip, so two quick taps can't both get in. FOR UPDATE: if his
  -- Undo or an admin is changing the waiting claim right now, wait for that and look again (so an
  -- I sent it that crosses an Undo makes a new claim instead of answering with the one being undone).
  PERFORM pg_advisory_xact_lock(hashtextextended('bbb_deposit_claims:' || v_me::text || ':' || p_trip_year, 0));
  SELECT * INTO v_row FROM public.trip_payment_claims c
  WHERE c.player_id = v_me AND c.trip_year = p_trip_year AND c.kind = 'deposit' AND c.status = 'sent'
  FOR UPDATE;
  IF FOUND THEN
    RETURN public.deposit_claim_json(v_row) || jsonb_build_object('duplicate', true);
  END IF;
  -- Keep the table a sensible size whatever a login sends: a trip year always fits in one read
  -- of the API (1,000 rows), and no single player can fill it
  IF (SELECT count(*) FROM public.trip_payment_claims c WHERE c.player_id = v_me AND c.trip_year = p_trip_year) >= 20 THEN
    RAISE EXCEPTION 'That''s a lot of taps on I sent it this trip. Text the commissioner.' USING ERRCODE = '54000';
  END IF;
  IF (SELECT count(*) FROM public.trip_payment_claims c WHERE c.trip_year = p_trip_year) >= 900 THEN
    RAISE EXCEPTION 'That''s a lot of deposit claims for one trip. Text the commissioner.' USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.trip_payment_claims (trip_year, player_id, kind, amount, sent_by)
  VALUES (p_trip_year, v_me, 'deposit', v_amount, auth.uid())
  RETURNING * INTO v_row;
  RETURN public.deposit_claim_json(v_row) || jsonb_build_object('duplicate', false);
END;
$$;
COMMENT ON FUNCTION public.claim_deposit(integer, numeric) IS '"I sent it" for the signed-in approved player''s own deposit. Returns the claim plus duplicate.';

-- Undo: the player takes back his own waiting "I sent it". A second Undo returns it with
-- "duplicate": true. Once an admin has confirmed it or marked it not received, it can't be undone.
CREATE OR REPLACE FUNCTION public.undo_deposit_claim(p_claim uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid;
  v_row public.trip_payment_claims%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Log in first.' USING ERRCODE = '28000';
  END IF;
  -- Checked before looking the claim up, so a name somebody else picked can't even tell
  -- whether an id exists
  v_me := public.payments_my_player();
  IF v_me IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.players WHERE user_id = auth.uid()) THEN
      RAISE EXCEPTION 'Your roster name is waiting for the commissioner''s approval. You can pay your deposit once you''re approved.' USING ERRCODE = '42501';
    END IF;
    RAISE EXCEPTION 'Your login is not linked to a player yet.' USING ERRCODE = 'P0002';
  END IF;
  -- The same row lock the admin's Confirm and Not received take, so they can't cross.
  -- Only his own: anyone else's id reads as "not there".
  SELECT * INTO v_row FROM public.trip_payment_claims c WHERE c.id = p_claim AND c.player_id = v_me FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That deposit claim isn''t there any more. Reload the page.' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status = 'withdrawn' THEN
    RETURN public.deposit_claim_json(v_row) || jsonb_build_object('duplicate', true);
  ELSIF v_row.status = 'confirmed' THEN
    RAISE EXCEPTION 'An admin already confirmed your deposit, so there''s nothing to undo.' USING ERRCODE = '55000';
  ELSIF v_row.status = 'rejected' THEN
    RAISE EXCEPTION 'An admin already marked it not received. Tap I sent it again once it goes through.' USING ERRCODE = '55000';
  END IF;
  UPDATE public.trip_payment_claims c SET status = 'withdrawn', resolved_at = now(), resolved_by = v_me
  WHERE c.id = v_row.id RETURNING * INTO v_row;
  RETURN public.deposit_claim_json(v_row) || jsonb_build_object('duplicate', false);
END;
$$;
COMMENT ON FUNCTION public.undo_deposit_claim(uuid) IS 'Undo: the signed-in player withdraws his own waiting deposit claim. Returns the claim plus duplicate.';

-- 4. Admin functions -------------------------------------------------------------------------
-- Every claim for a trip: waiting ones first (oldest first), then the rest (newest first), with
-- the player's name, his own Venmo username (to find him in the payee's Venmo), who resolved it,
-- and what he has paid toward that trip so far. No emails. amount is what he said he sent;
-- recorded_amount is the payment a Confirm recorded (it can differ: an admin types what arrived),
-- null when nothing is linked (closed as already in Paid, or that payment was deleted since).
DROP FUNCTION IF EXISTS public.admin_deposit_claims(integer);
CREATE FUNCTION public.admin_deposit_claims(p_trip_year integer)
RETURNS TABLE (id uuid, trip_year integer, player_id uuid, player_name text, kind text, amount numeric, status text,
               sent_at timestamptz, resolved_at timestamptz, resolved_by uuid, resolved_by_name text,
               trip_payment_id uuid, note text, venmo text, paid_total numeric, recorded_amount numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Log in first.' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_trip_admin() THEN
    RAISE EXCEPTION 'Admins only.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT c.id, c.trip_year, c.player_id, p.name::text, c.kind, c.amount, c.status, c.sent_at, c.resolved_at,
           c.resolved_by, r.name::text, c.trip_payment_id, c.note, v.handle,
           COALESCE((SELECT sum(tp.amount) FROM public.trip_payments tp
                     WHERE tp.player_id = c.player_id AND tp.trip_year = c.trip_year), 0)::numeric,
           rp.amount::numeric
    FROM public.trip_payment_claims c
    JOIN public.players p ON p.id = c.player_id
    LEFT JOIN public.players r ON r.id = c.resolved_by
    LEFT JOIN public.player_venmo v ON v.player_id = c.player_id
    LEFT JOIN public.trip_payments rp ON rp.id = c.trip_payment_id
    WHERE c.trip_year = p_trip_year
    ORDER BY (c.status = 'sent') DESC,
             CASE WHEN c.status = 'sent' THEN c.sent_at END ASC,
             COALESCE(c.resolved_at, c.sent_at) DESC,
             c.id;
END;
$$;
COMMENT ON FUNCTION public.admin_deposit_claims(integer) IS 'Admins: every deposit claim for a trip, waiting ones first, with name, Venmo username, paid so far and the amount a Confirm recorded.';

-- Confirm: the money showed up. Records the trip payment (admin_add_trip_payment, with all its
-- checks) and closes the claim, in one go: if either fails, neither happens. p_amount / p_paid_on
-- / p_note NULL: the claim's amount, the day he tapped I sent it (Arizona time), 'Deposit (Venmo)'.
-- p_add_payment false: it's already in his Paid column, so just close the claim. A second Confirm
-- returns the first with "duplicate": true (two admins at once record one payment).
-- Adding a payment is refused (55000) when one was already recorded for him that trip since he
-- tapped I sent it (another admin, or the Paid column, from a page loaded before that): it may
-- well be this same money. Reload, then close it without adding; if it really is other money,
-- close it and add this one in his Paid column.
CREATE OR REPLACE FUNCTION public.admin_confirm_deposit(p_claim uuid, p_amount numeric, p_paid_on date, p_note text, p_add_payment boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.trip_payment_claims%ROWTYPE;
  v_name text;
  v_note text := NULLIF(regexp_replace(COALESCE(p_note, ''), '^\s+|\s+$', '', 'g'), '');
  v_pay jsonb;
  v_since numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Log in first.' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_trip_admin() THEN
    RAISE EXCEPTION 'Admins only.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.trip_payment_claims c WHERE c.id = p_claim FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That deposit claim isn''t there any more. Reload the page.' USING ERRCODE = 'P0002';
  END IF;
  SELECT p.name INTO v_name FROM public.players p WHERE p.id = v_row.player_id;
  IF v_row.status = 'confirmed' THEN
    RETURN jsonb_build_object('claim', to_jsonb(v_row),
      'payment', (SELECT to_jsonb(tp) FROM public.trip_payments tp WHERE tp.id = v_row.trip_payment_id),
      'duplicate', true);
  ELSIF v_row.status = 'withdrawn' THEN
    RAISE EXCEPTION '% took back his I sent it, so there''s nothing to confirm. Reload the page.', v_name USING ERRCODE = '55000';
  ELSIF v_row.status = 'rejected' THEN
    RAISE EXCEPTION 'That one is already marked not received. Reload the page.' USING ERRCODE = '55000';
  END IF;
  IF char_length(v_note) > 200 THEN
    RAISE EXCEPTION 'Keep the note to 200 characters.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_add_payment, true) THEN
    SELECT sum(tp.amount) INTO v_since FROM public.trip_payments tp
    WHERE tp.player_id = v_row.player_id AND tp.trip_year = v_row.trip_year AND tp.created_at >= v_row.sent_at;
    IF v_since IS NOT NULL THEN
      RAISE EXCEPTION '% already has $% recorded since he tapped I sent it, so this may be the same money. Reload the page: if it is, close it without adding another payment; if not, close it and add this one in his Paid column.',
        v_name, CASE WHEN v_since = trunc(v_since) THEN to_char(v_since, 'FM9,999,990') ELSE to_char(v_since, 'FM9,999,990.00') END
        USING ERRCODE = '55000';
    END IF;
    v_pay := public.admin_add_trip_payment(v_row.player_id, v_row.trip_year, COALESCE(p_amount, v_row.amount),
               COALESCE(p_paid_on, (v_row.sent_at AT TIME ZONE 'America/Phoenix')::date),
               COALESCE(v_note, 'Deposit (Venmo)'));
  END IF;
  UPDATE public.trip_payment_claims c
  SET status = 'confirmed', resolved_at = now(), resolved_by = public.payments_actor(),
      trip_payment_id = (v_pay ->> 'id')::uuid, note = v_note
  WHERE c.id = v_row.id
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('claim', to_jsonb(v_row), 'payment', v_pay, 'duplicate', false);
END;
$$;
COMMENT ON FUNCTION public.admin_confirm_deposit(uuid, numeric, date, text, boolean) IS 'Admins: confirm a deposit claim, recording the trip payment (unless p_add_payment is false). Returns {claim, payment, duplicate}.';

-- Not received: the player sees "Not received yet" and can tap I sent it again once it goes
-- through. A second tap returns the first with "duplicate": true.
CREATE OR REPLACE FUNCTION public.admin_reject_deposit(p_claim uuid, p_note text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.trip_payment_claims%ROWTYPE;
  v_name text;
  v_note text := NULLIF(regexp_replace(COALESCE(p_note, ''), '^\s+|\s+$', '', 'g'), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Log in first.' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_trip_admin() THEN
    RAISE EXCEPTION 'Admins only.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.trip_payment_claims c WHERE c.id = p_claim FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That deposit claim isn''t there any more. Reload the page.' USING ERRCODE = 'P0002';
  END IF;
  SELECT p.name INTO v_name FROM public.players p WHERE p.id = v_row.player_id;
  IF v_row.status = 'rejected' THEN
    RETURN jsonb_build_object('claim', to_jsonb(v_row), 'duplicate', true);
  ELSIF v_row.status = 'confirmed' THEN
    RAISE EXCEPTION 'That one is already confirmed. If the money never came, delete the payment in his Paid column.' USING ERRCODE = '55000';
  ELSIF v_row.status = 'withdrawn' THEN
    RAISE EXCEPTION '% took back his I sent it already. Reload the page.', v_name USING ERRCODE = '55000';
  END IF;
  IF char_length(v_note) > 200 THEN
    RAISE EXCEPTION 'Keep the note to 200 characters.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.trip_payment_claims c
  SET status = 'rejected', resolved_at = now(), resolved_by = public.payments_actor(), note = v_note
  WHERE c.id = v_row.id
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('claim', to_jsonb(v_row), 'duplicate', false);
END;
$$;
COMMENT ON FUNCTION public.admin_reject_deposit(uuid, text) IS 'Admins: mark a deposit claim not received. Returns {claim, duplicate}.';

-- Reopen: undo a Not received tapped by mistake. The claim goes back to waiting (his "Sent <date>
-- · waiting for confirmation" comes back instead of "Not received yet", and the admin's note goes),
-- then Confirm it as usual. Only while it's still his latest claim for that trip: once he has
-- tapped I sent it again, handle that one instead. A second tap returns it with "duplicate": true.
-- A deliberate step of its own, so a Confirm that crosses another admin's Not received is still
-- refused rather than quietly overruling it.
CREATE OR REPLACE FUNCTION public.admin_reopen_deposit(p_claim uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.trip_payment_claims%ROWTYPE;
  v_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Log in first.' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_trip_admin() THEN
    RAISE EXCEPTION 'Admins only.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.trip_payment_claims c WHERE c.id = p_claim;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That deposit claim isn''t there any more. Reload the page.' USING ERRCODE = 'P0002';
  END IF;
  -- The same per-player lock I sent it takes (then the row), so a tap at the same moment either
  -- lands first (and this is refused below) or waits and finds this one waiting again
  PERFORM pg_advisory_xact_lock(hashtextextended('bbb_deposit_claims:' || v_row.player_id::text || ':' || v_row.trip_year, 0));
  SELECT * INTO v_row FROM public.trip_payment_claims c WHERE c.id = p_claim FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That deposit claim isn''t there any more. Reload the page.' USING ERRCODE = 'P0002';
  END IF;
  SELECT p.name INTO v_name FROM public.players p WHERE p.id = v_row.player_id;
  IF v_row.status = 'sent' THEN
    RETURN jsonb_build_object('claim', to_jsonb(v_row), 'duplicate', true);
  ELSIF v_row.status = 'confirmed' THEN
    RAISE EXCEPTION 'That one is already confirmed. Reload the page.' USING ERRCODE = '55000';
  ELSIF v_row.status = 'withdrawn' THEN
    RAISE EXCEPTION '% took back his I sent it, so there''s nothing to reopen. Reload the page.', v_name USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.trip_payment_claims c
             WHERE c.player_id = v_row.player_id AND c.trip_year = v_row.trip_year AND c.kind = v_row.kind
               AND c.id <> v_row.id AND (c.status = 'sent' OR (c.sent_at, c.id) > (v_row.sent_at, v_row.id))) THEN
    RAISE EXCEPTION '% has tapped I sent it again since, so handle that one instead. Reload the page.', v_name USING ERRCODE = '55000';
  END IF;
  UPDATE public.trip_payment_claims c
  SET status = 'sent', resolved_at = NULL, resolved_by = NULL, note = NULL
  WHERE c.id = v_row.id
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('claim', to_jsonb(v_row), 'duplicate', false);
END;
$$;
COMMENT ON FUNCTION public.admin_reopen_deposit(uuid) IS 'Admins: put a deposit claim marked not received back to waiting, while it is still the player''s latest for that trip. Returns {claim, duplicate}.';

-- 5. Where the deposit goes: Westin Tucker's Venmo ----------------------------------------------
-- Saved only when he has none: a username he or an admin saved since is kept. Nothing happens
-- when no approved roster name, or more than one, matches 'westin tucker' (any case, extra spaces
-- ignored); the check at the end says so. Sign-ups still waiting for approval never count (the
-- same rule as my_deposit). Change 'westin tucker' and 'Westin-Tucker' here, the payee row in
-- the check, and trip-config.js payment.payTo together.
-- (Approved players can already read every Venmo username, so this shows the handle only to them.)
DO $$
DECLARE
  v_ids uuid[];
BEGIN
  SELECT array_agg(p.id ORDER BY p.id) INTO v_ids FROM public.players p
  WHERE lower(btrim(regexp_replace(p.name, '\s+', ' ', 'g'))) = 'westin tucker'
    AND (COALESCE(p.status, 'confirmed') = 'confirmed'
         OR (p.status = 'potential' AND EXISTS (SELECT 1 FROM public.roster_claim_holds h
               WHERE h.player_id = p.id AND h.user_id = p.user_id AND h.prior_status = 'confirmed')));
  IF COALESCE(array_length(v_ids, 1), 0) = 1 THEN
    INSERT INTO public.player_venmo (player_id, handle, updated_at, updated_by)
    VALUES (v_ids[1], 'Westin-Tucker', now(), NULL)
    ON CONFLICT (player_id) DO NOTHING;
  END IF;
END $$;

-- 6. Only signed-in users can call these -----------------------------------------------------
-- (Supabase lets everyone, signed in or not, run new functions unless told otherwise.)
REVOKE ALL ON FUNCTION public.my_deposit(integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_deposit(integer, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.undo_deposit_claim(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_deposit_claims(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_confirm_deposit(uuid, numeric, date, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_reject_deposit(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_reopen_deposit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_deposit(integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_deposit(integer, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_deposit_claim(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_deposit_claims(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_confirm_deposit(uuid, numeric, date, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reject_deposit(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reopen_deposit(uuid) TO authenticated;
-- The internal helpers run only inside the functions above, never from the site
REVOKE ALL ON FUNCTION public.deposit_payer() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.deposit_claim_json(public.trip_payment_claims) FROM PUBLIC, anon, authenticated;

-- Tell the API about the new table and functions right away
NOTIFY pgrst, 'reload schema';

-- 7. Check (read-only; the SQL editor shows this last result) ----------------------------------
-- Every row except the 'note:' rows should say ok = true. 'note:' rows are for your information.
-- You can run just this query again later (from WITH to the end).
--   needs row:      payments_2027.sql has run.
--   table row:      row security on, signed-out visitors get nothing, signed-in users can only read
--                   (and only the rows the rule allows: admins all, players their own).
--   function rows:  site functions run as their owner with a fixed search path, can't be run
--                   signed out, can be run signed in; internal ones can't be run from the site.
--   payee row:      exactly one approved roster name "Westin Tucker", with Venmo @Westin-Tucker. If
--                   not, the detail says what's wrong, and nobody gets the Pay on Venmo button until
--                   it's fixed. It also names any sign-up waiting for approval with the same name
--                   (never used as the payee; approve it only if that login is really him).
WITH want_functions(sig, site) AS (
  VALUES ('my_deposit(integer,text)', true),
         ('claim_deposit(integer,numeric)', true),
         ('undo_deposit_claim(uuid)', true),
         ('admin_deposit_claims(integer)', true),
         ('admin_confirm_deposit(uuid,numeric,date,text,boolean)', true),
         ('admin_reject_deposit(uuid,text)', true),
         ('admin_reopen_deposit(uuid)', true),
         ('deposit_payer()', false),
         ('deposit_claim_json(public.trip_payment_claims)', false)
), named AS (
  -- Each roster name that matches the payee, with his Venmo, whether he can confirm in Admin, and
  -- whether it counts (approved, the same rule as my_deposit)
  SELECT p.id, p.name, COALESCE(p.is_admin, false) AS is_admin, NULLIF(btrim(p.email), '') AS email,
         v.handle,
         EXISTS (SELECT 1 FROM auth.users u WHERE NULLIF(btrim(p.email), '') IS NOT NULL
                   AND lower(btrim(u.email)) = lower(btrim(p.email))) AS has_login,
         (COALESCE(p.status, 'confirmed') = 'confirmed'
          OR (p.status = 'potential' AND EXISTS (SELECT 1 FROM public.roster_claim_holds h
                WHERE h.player_id = p.id AND h.user_id = p.user_id AND h.prior_status = 'confirmed'))) AS approved
  FROM public.players p LEFT JOIN public.player_venmo v ON v.player_id = p.id
  WHERE lower(btrim(regexp_replace(p.name, '\s+', ' ', 'g'))) = 'westin tucker'
), payee AS (
  SELECT * FROM named WHERE approved
), pay AS (
  -- One row whatever matched
  SELECT count(*) AS n, string_agg(name, ', ' ORDER BY id) AS names, min(handle) AS handle,
         bool_or(is_admin) AS is_admin, min(email) AS email, bool_or(has_login) AS has_login,
         (SELECT string_agg('"' || n2.name || '"', ', ' ORDER BY n2.id) FROM named n2 WHERE NOT n2.approved) AS waiting
  FROM payee
), tbl AS (
  SELECT c.oid FROM (SELECT 1) one LEFT JOIN pg_class c ON c.oid = to_regclass('public.trip_payment_claims')
)
SELECT 'needs payments_2027.sql' AS check_name,
       to_regprocedure('public.payments_my_player()') IS NOT NULL AND to_regprocedure('public.payments_crew()') IS NOT NULL
         AND to_regprocedure('public.payments_actor()') IS NOT NULL
         AND to_regprocedure('public.admin_add_trip_payment(uuid,integer,numeric,date,text)') IS NOT NULL
         AND to_regclass('public.trip_payments') IS NOT NULL AND to_regclass('public.player_venmo') IS NOT NULL
         AND to_regclass('public.roster_claim_holds') IS NOT NULL AS ok,
       CASE WHEN to_regclass('public.trip_payments') IS NULL OR to_regclass('public.player_venmo') IS NULL
              OR to_regclass('public.roster_claim_holds') IS NULL
              OR to_regprocedure('public.admin_add_trip_payment(uuid,integer,numeric,date,text)') IS NULL
            THEN 'MISSING: run payments_2027.sql, then this script'
            ELSE 'trip payments, Venmo usernames and the payments functions found' END AS detail
UNION ALL
SELECT 'table trip_payment_claims',
       COALESCE((SELECT c.relrowsecurity
         AND NOT has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
         AND NOT has_any_column_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
         AND has_table_privilege('authenticated', c.oid, 'SELECT')
         AND NOT has_table_privilege('authenticated', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
         AND NOT has_any_column_privilege('authenticated', c.oid, 'INSERT, UPDATE, REFERENCES')
         AND (SELECT count(*) FROM pg_policies pp WHERE pp.schemaname = 'public' AND pp.tablename = 'trip_payment_claims') = 1
         AND EXISTS (SELECT 1 FROM pg_policies pp WHERE pp.schemaname = 'public' AND pp.tablename = 'trip_payment_claims'
                       AND pp.policyname = 'trip_payment_claims_admin_or_own_read' AND pp.cmd = 'SELECT')
         AND EXISTS (SELECT 1 FROM pg_indexes i WHERE i.schemaname = 'public' AND i.indexname = 'trip_payment_claims_one_open')
         AND EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'f'
                       AND k.confrelid = 'public.players'::regclass AND k.confdeltype = 'c')
         AND EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'f'
                       AND k.confrelid = 'public.trip_payments'::regclass AND k.confdeltype = 'n')
         FROM pg_class c WHERE c.oid = (SELECT oid FROM tbl)), false),
       CASE WHEN (SELECT oid FROM tbl) IS NULL THEN 'MISSING: run deposits_2027.sql'
            -- row count without failing when the table is missing
            ELSE (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public.trip_payment_claims', false, true, '')))[1]::text
                 || ' claims; one waiting claim per player per trip; players read only their own' END
UNION ALL
SELECT 'function ' || f.sig,
       COALESCE(CASE WHEN f.site THEN
                  p.prosecdef
                  AND 'search_path=public, pg_temp' = ANY (p.proconfig)
                  AND NOT has_function_privilege('public', p.oid, 'EXECUTE')
                  AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                  AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                ELSE
                  NOT p.prosecdef
                  AND NOT has_function_privilege('public', p.oid, 'EXECUTE')
                  AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                  AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                END, false),
       CASE WHEN p.oid IS NULL THEN 'MISSING: run deposits_2027.sql'
            WHEN f.site THEN 'site function (signed-in only)'
            ELSE 'internal helper' END
FROM want_functions f
-- (to_regproc for the helper: to_regprocedure with an argument type that doesn't exist yet can fail)
LEFT JOIN pg_proc p ON p.oid = CASE WHEN f.sig LIKE 'deposit_claim_json%' THEN to_regproc('public.deposit_claim_json')::oid
                                    ELSE to_regprocedure('public.' || f.sig)::oid END
UNION ALL
SELECT 'payee Westin Tucker',
       COALESCE(x.n = 1 AND lower(x.handle) = 'westin-tucker', false),
       CASE WHEN x.n = 0
              THEN 'NOT FOUND: no roster name "Westin Tucker". Add him (or fix the name) in Admin, then run this again. Until then nobody gets the Pay on Venmo button.'
            WHEN x.n > 1
              THEN 'TWO roster names match "Westin Tucker" (' || x.names || '). Rename one, then run this again. Until then nobody gets the Pay on Venmo button.'
            WHEN x.handle IS NULL
              THEN 'Westin Tucker has no Venmo username saved. Run this again, or add @Westin-Tucker in Admin (Roster, Venmo). Until then nobody gets the Pay on Venmo button.'
            WHEN lower(x.handle) <> 'westin-tucker'
              THEN 'Westin Tucker''s Venmo is @' || x.handle || ', not @Westin-Tucker, so deposits go to @' || x.handle || '. If that''s wrong, fix it in Admin (Roster, Venmo).'
            ELSE 'deposits go to @' || x.handle || ' (only signed-in, approved players see it)' END
       || COALESCE(' WATCH OUT: a sign-up waiting for approval is also named ' || x.waiting || ' (never used as the payee). Approve it only if that login is really Westin.', '')
FROM pay x
UNION ALL
SELECT 'note: Westin Tucker confirms deposits',
       COALESCE(x.n = 1 AND x.is_admin AND x.email IS NOT NULL AND x.has_login, false),
       CASE WHEN x.n <> 1 THEN 'see the payee row above'
            WHEN NOT x.is_admin
              THEN 'He isn''t an admin, so another admin confirms each deposit after checking with him.'
            WHEN x.email IS NULL
              THEN 'His admin row has no email, so he can''t confirm deposits in Admin yet. Put his login email on his roster row (Admin, Roster) when he''s ready; another admin confirms meanwhile.'
            WHEN NOT x.has_login
              THEN 'His admin row has an email but no login yet. Once he signs up with ' || x.email || ' he can confirm deposits in Admin.'
            ELSE 'He can confirm deposits himself in Admin (RSVPs tab).' END
FROM pay x
UNION ALL
SELECT 'note: deposits waiting',
       true,
       CASE WHEN (SELECT oid FROM tbl) IS NULL THEN 'none (the claims table isn''t there yet)'
            ELSE (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public.trip_payment_claims WHERE status = ''sent''', false, true, '')))[1]::text
                 || ' waiting for an admin to confirm (Admin, RSVPs tab)' END;

-- Handy for the commissioner (not run by this script):
-- Who has paid what toward the 2027 trip, and any "I sent it" still waiting
-- SELECT p.name, COALESCE(sum(tp.amount), 0) AS paid,
--        (SELECT c.amount || ' sent ' || to_char(c.sent_at AT TIME ZONE 'America/Phoenix', 'Mon DD')
--           FROM public.trip_payment_claims c
--          WHERE c.player_id = p.id AND c.trip_year = 2027 AND c.status = 'sent') AS waiting
-- FROM public.players p LEFT JOIN public.trip_payments tp ON tp.player_id = p.id AND tp.trip_year = 2027
-- WHERE COALESCE(p.status, 'confirmed') = 'confirmed'
-- GROUP BY p.id, p.name ORDER BY p.name;
