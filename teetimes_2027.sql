-- ============================================================
-- Bros Before Boges — tee times, set in Admin instead of trip-config.js (2027)
-- Order: 1. push the site update first. Admin's Tee times tab then says "Tee times aren't set up
--           yet", which is how you know the new site is live.
--        2. then run this entire script once in the Supabase SQL Editor (it needs
--           rsvp_accounts.sql, which has already run). Safe to run again.
-- ============================================================
-- What it does:
--   1. A small table, trip_tee_times: one tee time (and an optional short note, e.g. "4 groups,
--      10 min apart") per round of a trip. A round is a slot's `tee` key in trip-config.js's
--      itinerary ('practice', 'r1', 'r2', 'r3', 'sunday'). Nobody reads or writes the table
--      directly with the site's key, signed in or not.
--   2. trip_tee_times(year), for everyone: the year's tee times, which the homepage's itinerary and
--      Today card show in place of "tee time TBA". The schedule is public, so these are too.
--   3. admin_set_tee_time(year, round, time, note), admins only (Admin's Tee times tab): saves a
--      round's tee time, or clears it when the time is blank.
--   Nothing else changes.

-- 0. Checks first. If one fails the script stops here, before changing anything ---------------
DO $$
BEGIN
  IF to_regprocedure('public.is_trip_admin()') IS NULL THEN
    RAISE EXCEPTION 'Run rsvp_accounts.sql first, then run this again. Nothing was changed.';
  END IF;
END $$;

-- 1. The table ---------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trip_tee_times (
  trip_year integer NOT NULL CHECK (trip_year BETWEEN 2000 AND 2100),
  round_key text NOT NULL CHECK (round_key ~ '^[a-z0-9-]{1,20}$'),
  tee_time time NOT NULL,
  note text CHECK (note IS NULL OR char_length(note) <= 80),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (trip_year, round_key)
);
COMMENT ON TABLE public.trip_tee_times IS 'One tee time per round of a trip. Read through trip_tee_times(), written through admin_set_tee_time().';

-- Row security on with no rules, and no table rights for the site's roles: only the two functions
-- below (which run as the owner) touch it. (Supabase gives new tables to anon and authenticated.)
ALTER TABLE public.trip_tee_times ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.trip_tee_times FROM PUBLIC, anon, authenticated;

-- 2. Everyone reads them ------------------------------------------------------------------------
-- { "r1": { "time": "08:10", "note": "4 groups, 10 min apart" }, ... } ({} when none are set)
CREATE OR REPLACE FUNCTION public.trip_tee_times(p_trip_year integer)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(jsonb_object_agg(t.round_key, jsonb_build_object('time', to_char(t.tee_time, 'HH24:MI'), 'note', t.note)), '{}'::jsonb)
  FROM public.trip_tee_times t
  WHERE t.trip_year = p_trip_year;
$$;
COMMENT ON FUNCTION public.trip_tee_times(integer) IS 'A trip''s tee times by round, for the homepage schedule.';

-- 3. Admins set or clear one ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_tee_time(p_trip_year integer, p_round text, p_time text, p_note text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_round text := lower(btrim(COALESCE(p_round, '')));
  v_time text := NULLIF(btrim(COALESCE(p_time, '')), '');
  v_note text := NULLIF(btrim(regexp_replace(COALESCE(p_note, ''), '\s+', ' ', 'g')), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Log in first.' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_trip_admin() THEN
    RAISE EXCEPTION 'Admins only.' USING ERRCODE = '42501';
  END IF;
  IF p_trip_year IS NULL OR p_trip_year NOT BETWEEN 2000 AND 2100 THEN
    RAISE EXCEPTION 'Which trip year is this tee time for?' USING ERRCODE = '22023';
  END IF;
  IF v_round !~ '^[a-z0-9-]{1,20}$' THEN
    RAISE EXCEPTION 'Which round is this tee time for?' USING ERRCODE = '22023';
  END IF;
  IF v_time IS NULL THEN
    DELETE FROM public.trip_tee_times WHERE trip_year = p_trip_year AND round_key = v_round;
  ELSE
    IF v_time !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' THEN
      RAISE EXCEPTION 'Pick the tee time from the time box (like 8:10 AM).' USING ERRCODE = '22023';
    END IF;
    IF char_length(COALESCE(v_note, '')) > 80 THEN
      RAISE EXCEPTION 'Keep the note to 80 characters.' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.trip_tee_times (trip_year, round_key, tee_time, note, updated_at, updated_by)
    VALUES (p_trip_year, v_round, v_time::time, v_note, now(), auth.uid())
    ON CONFLICT (trip_year, round_key) DO UPDATE
      SET tee_time = EXCLUDED.tee_time, note = EXCLUDED.note, updated_at = now(), updated_by = EXCLUDED.updated_by;
  END IF;
  RETURN public.trip_tee_times(p_trip_year);
END;
$$;
COMMENT ON FUNCTION public.admin_set_tee_time(integer, text, text, text) IS 'Admins only: saves a round''s tee time (HH:MM) and note, or clears it when the time is blank.';

-- Everyone may read them; only signed-in users may try to set one (admins only, above)
REVOKE ALL ON FUNCTION public.trip_tee_times(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_tee_time(integer, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trip_tee_times(integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_tee_time(integer, text, text, text) TO authenticated;

-- 4. Tell the API about the new functions right away ----------------------------------------------
NOTIFY pgrst, 'reload schema';

-- 5. Check (read-only; the SQL editor shows this last result). Every row should say ok = true. ----
SELECT 'table trip_tee_times' AS check_name,
       COALESCE((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass('public.trip_tee_times')), false) AS ok,
       'exists, row security on' AS detail
UNION ALL
SELECT 'nobody reads or writes it directly',
       NOT (has_table_privilege('anon', 'public.trip_tee_times', 'SELECT') OR has_table_privilege('authenticated', 'public.trip_tee_times', 'SELECT')
            OR has_table_privilege('anon', 'public.trip_tee_times', 'INSERT') OR has_table_privilege('authenticated', 'public.trip_tee_times', 'INSERT')
            OR has_table_privilege('anon', 'public.trip_tee_times', 'UPDATE') OR has_table_privilege('authenticated', 'public.trip_tee_times', 'UPDATE')
            OR has_table_privilege('anon', 'public.trip_tee_times', 'DELETE') OR has_table_privilege('authenticated', 'public.trip_tee_times', 'DELETE')),
       'only through trip_tee_times() and admin_set_tee_time()'
UNION ALL
SELECT 'function trip_tee_times',
       COALESCE((SELECT p.prosecdef AND has_function_privilege('anon', p.oid, 'EXECUTE') AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                 FROM pg_proc p WHERE p.oid = to_regprocedure('public.trip_tee_times(integer)')), false),
       'everyone may read them'
UNION ALL
SELECT 'function admin_set_tee_time',
       COALESCE((SELECT p.prosecdef AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                 FROM pg_proc p WHERE p.oid = to_regprocedure('public.admin_set_tee_time(integer,text,text,text)')), false),
       'signed in only, and it refuses anyone who isn''t an admin'
UNION ALL
SELECT 'who can set them (admins)',
       EXISTS (SELECT 1 FROM public.players WHERE is_admin),
       COALESCE((SELECT string_agg(name, ', ' ORDER BY name) FROM public.players WHERE is_admin), 'nobody is an admin yet');
