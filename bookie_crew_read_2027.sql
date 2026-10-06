-- ============================================================
-- Bros before Boges — The Bookie's bets and trash talk: crew only (2027)
-- Order: 1. run this entire script once in the Supabase SQL Editor FIRST. It works with the site
--           that's live now (The Bookie, the homepage's "bets need you" count and Admin only read bets
--           as a confirmed player or an admin). It needs payments_2027.sql (payments_crew) and
--           bookie_2027.sql (the bet rules), which have already run. Safe to run again.
--        2. then push the site update: privacy.html says bets are for the crew only, so it must not
--           go live before this has run; The Bookie also says "You were logged out" in words if a
--           login ends in the middle of an action, and puts up the right wall for a player who stops
--           being crew while the page is open.
-- ============================================================
-- Why: The Bookie only shows the board once you're logged in as a confirmed player, but the database
-- itself still let anyone read every bet and every comment with the site's public key, signed out
-- included (bookie_schema.sql's "Allow public read access" rules, from before accounts existed).
--
-- What it does:
--   1. Signed out: no access to wagers or wager_comments at all.
--   2. Signed in: bets and comments only for the crew, payments_crew(): a login linked to a
--      confirmed roster name, or an admin (the same people who see Venmo usernames and Paid marks).
--      New sign-ups waiting for the commissioner see none; they can't bet or comment either.
--   3. The crew test is also a RESTRICTIVE rule (it applies on top of every other read rule), so an
--      old script re-run (bookie_schema.sql, upgrade_bookie_v2.sql) or a rule made in the dashboard
--      can't open them up again. The check at the end lists any such leftover rule.
--   Writes are unchanged: the existing insert/update/delete rules and wagers_guard still decide who
--   may post, join, accept, settle or comment, exactly as before. The notification triggers
--   (push_2027.sql) run as the table's owner, which these rules don't apply to.
--
-- What it can't hide: anyone can sign up, and a signed-in login that isn't crew can still learn
-- roughly HOW MANY bets and comments there are (the API's estimated counts, and whether a blind
-- update hits a bet rule), never what any of them say or who's on them. Hiding even that would mean
-- serving the board through a function instead of the table, a bigger change to The Bookie.

-- 0. Checks first. If one fails the script stops here, before changing anything ---------------
DO $$
BEGIN
  IF to_regclass('public.wagers') IS NULL OR to_regclass('public.wager_comments') IS NULL THEN
    RAISE EXCEPTION 'The Bookie''s tables are missing (bookie_schema.sql). Nothing was changed.';
  END IF;
  IF to_regprocedure('public.is_trip_admin()') IS NULL THEN
    RAISE EXCEPTION 'Run rsvp_accounts.sql first (it creates is_trip_admin), then run this again. Nothing was changed.';
  END IF;
  IF to_regprocedure('public.payments_crew()') IS NULL THEN
    RAISE EXCEPTION 'Run payments_2027.sql first (it creates payments_crew), then run this again. Nothing was changed.';
  END IF;
  IF NOT (SELECT p.prosecdef AND p.prorettype = 'boolean'::regtype FROM pg_proc p WHERE p.oid = to_regprocedure('public.payments_crew()')) THEN
    RAISE EXCEPTION 'public.payments_crew() isn''t the version payments_2027.sql makes (a SECURITY DEFINER boolean). Run payments_2027.sql again, then this. Nothing was changed.';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.payments_crew()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Signed-in users can''t run payments_crew(), so nobody could read bets. Run payments_2027.sql again, then this. Nothing was changed.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.wagers'::regclass AND tgname = 'wagers_guard' AND tgenabled <> 'D') THEN
    RAISE EXCEPTION 'The bet rules (wagers_guard) aren''t on. Run bookie_2027.sql first, then this. Nothing was changed.';
  END IF;
END $$;

-- 1. Row security on (it already is; this makes sure) ------------------------------------------
ALTER TABLE public.wagers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wager_comments ENABLE ROW LEVEL SECURITY;

-- 2. The old "anyone can read" rules go --------------------------------------------------------
DROP POLICY IF EXISTS "Allow public read access to wagers" ON public.wagers;
DROP POLICY IF EXISTS "Allow public read access to wager_comments" ON public.wager_comments;

-- 3. Crew only ---------------------------------------------------------------------------------
-- (SELECT ...) around the function: worked out once per request, not once per row.
-- Signed-out visitors get their own rule, USING (false): they aren't allowed to run payments_crew().

-- Bets
DROP POLICY IF EXISTS "wagers_crew_read" ON public.wagers;
CREATE POLICY "wagers_crew_read"
  ON public.wagers FOR SELECT
  TO authenticated
  USING ((SELECT public.payments_crew()));

DROP POLICY IF EXISTS "wagers_crew_only_read" ON public.wagers;
CREATE POLICY "wagers_crew_only_read"
  ON public.wagers AS RESTRICTIVE FOR SELECT
  TO authenticated
  USING ((SELECT public.payments_crew()));

DROP POLICY IF EXISTS "wagers_signed_out_no_read" ON public.wagers;
CREATE POLICY "wagers_signed_out_no_read"
  ON public.wagers AS RESTRICTIVE FOR SELECT
  TO anon
  USING (false);

-- Trash talk
DROP POLICY IF EXISTS "wager_comments_crew_read" ON public.wager_comments;
CREATE POLICY "wager_comments_crew_read"
  ON public.wager_comments FOR SELECT
  TO authenticated
  USING ((SELECT public.payments_crew()));

DROP POLICY IF EXISTS "wager_comments_crew_only_read" ON public.wager_comments;
CREATE POLICY "wager_comments_crew_only_read"
  ON public.wager_comments AS RESTRICTIVE FOR SELECT
  TO authenticated
  USING ((SELECT public.payments_crew()));

DROP POLICY IF EXISTS "wager_comments_signed_out_no_read" ON public.wager_comments;
CREATE POLICY "wager_comments_signed_out_no_read"
  ON public.wager_comments AS RESTRICTIVE FOR SELECT
  TO anon
  USING (false);

-- 4. Table rights: signed-out visitors can't read either table at all (this also clears any
--    column-by-column read rights). Signed-in users keep reading (the rules above decide which rows).
--    Insert, update and delete rights are left exactly as they were.
REVOKE SELECT ON TABLE public.wagers, public.wager_comments FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.wagers, public.wager_comments TO authenticated;

-- 5. Tell the API about the change right away ---------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- 6. Check (read-only; the SQL editor shows this last result). Every row should say ok = true. ----
WITH t(tbl) AS (VALUES ('public.wagers'::regclass), ('public.wager_comments'::regclass)),
pol AS (
  SELECT c.oid AS tbl, p.polname, p.polpermissive, p.polcmd,
         ARRAY(SELECT CASE WHEN r = 0 THEN 'public' ELSE pg_get_userbyid(r)::text END FROM unnest(p.polroles) r)::text[] AS roles,
         COALESCE(pg_get_expr(p.polqual, p.polrelid), '') AS qual
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
  WHERE c.oid IN (SELECT tbl FROM t)
)
SELECT 'row security on' AS check_name,
       (SELECT bool_and(c.relrowsecurity) FROM pg_class c WHERE c.oid IN (SELECT tbl FROM t)) AS ok,
       'wagers and wager_comments: every rule below only works while this is on' AS detail
UNION ALL
SELECT 'crew read rule',
       (SELECT count(*) FROM pol WHERE polpermissive AND polcmd = 'r' AND roles = ARRAY['authenticated'] AND qual ~ '\mpayments_crew\(\)') = 2,
       'wagers_crew_read, wager_comments_crew_read: signed in and crew'
UNION ALL
SELECT 'crew-only rule on top of every other',
       (SELECT count(*) FROM pol WHERE NOT polpermissive AND polcmd = 'r' AND roles = ARRAY['authenticated'] AND qual ~ '\mpayments_crew\(\)') = 2,
       'wagers_crew_only_read, wager_comments_crew_only_read (restrictive)'
UNION ALL
SELECT 'signed out: no rows, whatever else is there',
       (SELECT count(*) FROM pol WHERE NOT polpermissive AND polcmd = 'r' AND roles = ARRAY['anon'] AND qual = 'false') = 2,
       'wagers_signed_out_no_read, wager_comments_signed_out_no_read (restrictive)'
UNION ALL
SELECT 'signed out: no read rights at all',
       NOT (has_any_column_privilege('anon', 'public.wagers', 'SELECT') OR has_any_column_privilege('anon', 'public.wager_comments', 'SELECT')
            OR has_any_column_privilege('public', 'public.wagers', 'SELECT') OR has_any_column_privilege('public', 'public.wager_comments', 'SELECT')),
       'anon and PUBLIC have no SELECT on either table (or any of their columns)'
UNION ALL
SELECT 'signed in: rights as before',
       has_table_privilege('authenticated', 'public.wagers', 'SELECT') AND has_table_privilege('authenticated', 'public.wagers', 'INSERT')
       AND has_table_privilege('authenticated', 'public.wagers', 'UPDATE') AND has_table_privilege('authenticated', 'public.wagers', 'DELETE')
       AND has_table_privilege('authenticated', 'public.wager_comments', 'SELECT') AND has_table_privilege('authenticated', 'public.wager_comments', 'INSERT'),
       'authenticated: wagers SELECT, INSERT, UPDATE, DELETE; wager_comments SELECT, INSERT (each checked on its own)'
UNION ALL
SELECT 'the crew test itself',
       NOT has_function_privilege('anon', 'public.payments_crew()', 'EXECUTE') AND has_function_privilege('authenticated', 'public.payments_crew()', 'EXECUTE'),
       'payments_crew(): signed in only'
UNION ALL
SELECT 'other read rules (harmless now)',
       true,
       COALESCE((SELECT string_agg(format('%s: %s', tbl::regclass, polname), '; ' ORDER BY tbl::regclass::text, polname)
                 FROM pol WHERE polpermissive AND polcmd IN ('r', '*') AND polname NOT IN ('wagers_crew_read', 'wager_comments_crew_read')),
                'none') || ' (the crew-only rules apply on top of any listed here)'
UNION ALL
SELECT 'the bet rules still on',
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.wagers'::regclass AND tgname = 'wagers_guard' AND tgenabled <> 'D'),
       'wagers_guard (bookie_2027.sql)'
UNION ALL
SELECT 'notifications can still read bets',
       COALESCE((SELECT (p.proowner = c.relowner AND NOT c.relforcerowsecurity) OR r.rolsuper OR r.rolbypassrls
                 FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner, pg_class c
                 WHERE p.oid = to_regprocedure('public.push_on_comment()') AND c.oid = 'public.wagers'::regclass), true),
       CASE WHEN to_regprocedure('public.push_on_comment()') IS NULL THEN 'push_2027.sql not run yet: nothing to check'
            ELSE 'push_on_comment runs as the table owner, which these rules don''t apply to' END
UNION ALL
SELECT 'no way around it',
       NOT EXISTS (
         -- a view over either table that runs as its owner (no security_invoker = true/on/yes/1)
         -- and that the site's roles can read, even just some columns of
         SELECT 1 FROM pg_depend d
         JOIN pg_rewrite rw ON d.classid = 'pg_rewrite'::regclass AND d.objid = rw.oid
         JOIN pg_class v ON v.oid = rw.ev_class AND v.relkind IN ('v', 'm')
         WHERE d.refobjid IN ('public.wagers'::regclass, 'public.wager_comments'::regclass)
           AND v.oid NOT IN ('public.wagers'::regclass, 'public.wager_comments'::regclass)
           AND (v.relkind = 'm' OR NOT EXISTS (SELECT 1 FROM unnest(COALESCE(v.reloptions, '{}'::text[])) o
                                               WHERE o ~* '^security_invoker=(true|on|yes|1)$'))
           AND (has_any_column_privilege('anon', v.oid, 'SELECT') OR has_any_column_privilege('authenticated', v.oid, 'SELECT'))
       ) AND NOT EXISTS (
         -- a function running as its owner, callable from the site, that reads either table: found by
         -- its recorded dependencies (BEGIN ATOMIC bodies) or by its text with comments taken out
         SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.prosecdef AND p.prorettype <> 'trigger'::regtype
           AND (EXISTS (SELECT 1 FROM pg_depend d
                        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid
                          AND d.refobjid IN ('public.wagers'::regclass, 'public.wager_comments'::regclass))
                OR regexp_replace(regexp_replace(p.prosrc, '/\*.*?\*/', '', 'g'), '--[^\n]*', '', 'g') ~* '\mwager(s|_comments)\M')
           AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
       ),
       'no view or site-callable owner-rights function hands out bets past these rules'
UNION ALL
SELECT 'not in Realtime',
       NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename IN ('wagers', 'wager_comments')),
       'the site doesn''t use Realtime; if this says false: ALTER PUBLICATION supabase_realtime DROP TABLE public.wagers, public.wager_comments;';
