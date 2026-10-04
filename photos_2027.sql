-- ============================================================
-- Bros Before Boges — the trip's shared photo album link, for the signed-in crew only (2027)
-- Order: 1. push the site update first. Admin's Photos tab then says "The photo album isn't set
--           up yet", which is how you know the new site is live.
--        2. then run this entire script once in the Supabase SQL Editor (it needs
--           rsvp_accounts.sql and payments_2027.sql, which have already run). Safe to run again.
-- ============================================================
-- What it does:
--   1. A small table, trip_albums: one shared album link (Google Photos, iCloud, ...) per trip year.
--      Nobody reads or writes it directly with the site's key, signed in or not.
--   2. trip_album(year), for everyone: whether that trip has an album, and the link itself only for
--      a signed-in player on the confirmed roster, or an admin. Signed-out visitors (the homepage
--      offers them "Log in to add your photos") and new sign-ups still waiting for approval learn
--      only that there is one.
--   3. admin_set_trip_album(year, link), admins only (Admin's Photos tab): saves an https link, or
--      removes it when the link is blank.
--   Nothing else changes.

-- 0. Checks first. If one fails the script stops here, before changing anything ---------------
DO $$
BEGIN
  IF to_regprocedure('public.is_trip_admin()') IS NULL OR to_regprocedure('public.payments_crew()') IS NULL THEN
    RAISE EXCEPTION 'Run rsvp_accounts.sql and payments_2027.sql first, then run this again. Nothing was changed.';
  END IF;
END $$;

-- 1. The table ---------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trip_albums (
  trip_year integer PRIMARY KEY CHECK (trip_year BETWEEN 2000 AND 2100),
  share_url text NOT NULL CHECK (char_length(share_url) <= 1000 AND share_url ~ '^https://[^[:space:]<>"'']+$'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
COMMENT ON TABLE public.trip_albums IS 'One shared photo album link per trip year. Read through trip_album(), written through admin_set_trip_album().';

-- Row security on with no rules, and no table rights for the site's roles: only the two functions
-- below (which run as the owner) touch it. (Supabase gives new tables to anon and authenticated.)
ALTER TABLE public.trip_albums ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.trip_albums FROM PUBLIC, anon, authenticated;

-- 2. Who sees what ------------------------------------------------------------------------------
-- {exists, url, crew}: url only for the confirmed crew and admins (payments_crew), null otherwise.
CREATE OR REPLACE FUNCTION public.trip_album(p_trip_year integer)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
           'exists', a.trip_year IS NOT NULL,
           'url', CASE WHEN a.trip_year IS NOT NULL AND c.crew THEN a.share_url END,
           'crew', c.crew)
  FROM (SELECT public.payments_crew() AS crew) c
  LEFT JOIN public.trip_albums a ON a.trip_year = p_trip_year;
$$;
COMMENT ON FUNCTION public.trip_album(integer) IS 'Whether a trip has a shared photo album; the link only for the confirmed crew and admins.';

-- 3. Admins set or remove it ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_trip_album(p_trip_year integer, p_url text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_url text := NULLIF(btrim(COALESCE(p_url, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Log in first.' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_trip_admin() THEN
    RAISE EXCEPTION 'Admins only.' USING ERRCODE = '42501';
  END IF;
  IF p_trip_year IS NULL OR p_trip_year NOT BETWEEN 2000 AND 2100 THEN
    RAISE EXCEPTION 'Which trip year is this album for?' USING ERRCODE = '22023';
  END IF;
  IF v_url IS NULL THEN
    DELETE FROM public.trip_albums WHERE trip_year = p_trip_year;
  ELSE
    IF char_length(v_url) > 1000 OR v_url !~ '^https://[^[:space:]<>"'']+$' THEN
      RAISE EXCEPTION 'The album link has to start with https:// and have no spaces.' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.trip_albums (trip_year, share_url, updated_at, updated_by)
    VALUES (p_trip_year, v_url, now(), auth.uid())
    ON CONFLICT (trip_year) DO UPDATE SET share_url = EXCLUDED.share_url, updated_at = now(), updated_by = EXCLUDED.updated_by;
  END IF;
  RETURN public.trip_album(p_trip_year);
END;
$$;
COMMENT ON FUNCTION public.admin_set_trip_album(integer, text) IS 'Admins only: saves a trip''s shared photo album link (https), or removes it when blank.';

-- Everyone may ask whether there's an album; only signed-in users may try to set one (admins only, above)
REVOKE ALL ON FUNCTION public.trip_album(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_trip_album(integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trip_album(integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_trip_album(integer, text) TO authenticated;

-- 4. Tell the API about the new functions right away ----------------------------------------------
NOTIFY pgrst, 'reload schema';

-- 5. Check (read-only; the SQL editor shows this last result). Every row should say ok = true. ----
SELECT 'table trip_albums' AS check_name,
       COALESCE((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass('public.trip_albums')), false) AS ok,
       'exists, row security on' AS detail
UNION ALL
SELECT 'nobody reads or writes it directly',
       NOT (has_table_privilege('anon', 'public.trip_albums', 'SELECT') OR has_table_privilege('authenticated', 'public.trip_albums', 'SELECT')
            OR has_table_privilege('anon', 'public.trip_albums', 'INSERT') OR has_table_privilege('authenticated', 'public.trip_albums', 'INSERT')
            OR has_table_privilege('anon', 'public.trip_albums', 'UPDATE') OR has_table_privilege('authenticated', 'public.trip_albums', 'UPDATE')
            OR has_table_privilege('anon', 'public.trip_albums', 'DELETE') OR has_table_privilege('authenticated', 'public.trip_albums', 'DELETE')),
       'only through trip_album() and admin_set_trip_album()'
UNION ALL
SELECT 'function trip_album',
       COALESCE((SELECT p.prosecdef AND has_function_privilege('anon', p.oid, 'EXECUTE') AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                 FROM pg_proc p WHERE p.oid = to_regprocedure('public.trip_album(integer)')), false),
       'everyone may ask; the link only for the crew'
UNION ALL
SELECT 'function admin_set_trip_album',
       COALESCE((SELECT p.prosecdef AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                 FROM pg_proc p WHERE p.oid = to_regprocedure('public.admin_set_trip_album(integer,text)')), false),
       'signed in only, and it refuses anyone who isn''t an admin'
UNION ALL
SELECT 'album link saved for 2027',
       true,
       COALESCE((SELECT 'yes, updated ' || to_char(updated_at, 'Mon DD') FROM public.trip_albums WHERE trip_year = 2027), 'not yet: paste it in Admin, Photos tab');
