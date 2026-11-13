-- ============================================================
-- Bros Before Boges — Group numbers and tee times for each match (2027)
-- Order: 1. run this entire script once in the Supabase SQL Editor (it needs privacy_2027.sql,
--           which has already run). Safe to run again. It's safe before the site update too:
--           the site that's live now only writes the matchup columns it already knows.
--        2. then push the site update. Admin's Matchups tab then shows a Group and a Tee time on
--           each match. (Pushed first, the tab says "Groups and tee times need one database
--           update" instead, and everything else in Admin works as before.)
-- ============================================================
-- What it does:
--   1. Two new columns on the matchups table, empty on every match until Admin sets them:
--        group_number  which group the match plays in, 1 to 20 (Admin offers 1 to 10)
--        tee_time      that group's tee time as HH:MM on the 24-hour clock, like 07:20. Text, not a
--                      time, so the site gets back exactly what Admin saved (no seconds to trim).
--   2. Two checks, so only those values can be stored: a group from 1 to 20, and a time like
--      07:20 or 13:05. Either can be left empty.
--   3. Who can change matchups stays as privacy_2027.sql set it: everyone can read them, and only
--      admins can add, change or remove them, the two new columns included. Match 1, 2, 3 keep
--      their numbers (they go by when each match was made, not by group).
--   Nothing else changes.

-- 0. Checks first. If one fails the script stops here, before changing anything ---------------
DO $$
DECLARE
  v_bad text;
BEGIN
  IF to_regclass('public.matchups') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'public' AND tablename = 'matchups' AND policyname = 'matchups_admin_only_update') THEN
    RAISE EXCEPTION 'Run privacy_2027.sql first, then run this again. Nothing was changed.';
  END IF;
  -- A column with one of these names made another way (in the table editor, say) would not take
  -- the checks below
  SELECT string_agg(format('%s is %s', a.attname, format_type(a.atttypid, a.atttypmod)), ', ') INTO v_bad
  FROM pg_attribute a
  WHERE a.attrelid = 'public.matchups'::regclass AND a.attnum > 0 AND NOT a.attisdropped
    AND ((a.attname = 'group_number' AND a.atttypid <> 'smallint'::regtype)
         OR (a.attname = 'tee_time' AND a.atttypid <> 'text'::regtype));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'The matchups table already has a column this script adds, of another type (%). Nothing was changed.', v_bad;
  END IF;
END $$;

-- 1. The two columns ---------------------------------------------------------------------------
ALTER TABLE public.matchups ADD COLUMN IF NOT EXISTS group_number smallint;
ALTER TABLE public.matchups ADD COLUMN IF NOT EXISTS tee_time text;

-- 2. Only good values (dropped and made again, so a re-run leaves exactly these) ----------------
ALTER TABLE public.matchups DROP CONSTRAINT IF EXISTS matchups_group_number_range;
ALTER TABLE public.matchups ADD CONSTRAINT matchups_group_number_range
  CHECK (group_number IS NULL OR group_number BETWEEN 1 AND 20);
ALTER TABLE public.matchups DROP CONSTRAINT IF EXISTS matchups_tee_time_format;
ALTER TABLE public.matchups ADD CONSTRAINT matchups_tee_time_format
  CHECK (tee_time IS NULL OR tee_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

COMMENT ON COLUMN public.matchups.group_number IS 'Which group the match plays in (1 to 20), set in Admin''s Matchups tab. Empty until set.';
COMMENT ON COLUMN public.matchups.tee_time IS 'The match''s tee time as HH:MM on the 24-hour clock (e.g. 07:20), set in Admin''s Matchups tab. Empty until set.';

-- 3. Tell the API about the new columns right away ----------------------------------------------
NOTIFY pgrst, 'reload schema';

-- 4. Check (read-only; the SQL editor shows this last result). Every row should say ok = true. ----
SELECT 'column group_number' AS check_name,
       COALESCE((SELECT a.atttypid = 'smallint'::regtype FROM pg_attribute a
                 WHERE a.attrelid = to_regclass('public.matchups') AND a.attname = 'group_number' AND NOT a.attisdropped), false) AS ok,
       'which group the match plays in (smallint)' AS detail
UNION ALL
SELECT 'column tee_time',
       COALESCE((SELECT a.atttypid = 'text'::regtype FROM pg_attribute a
                 WHERE a.attrelid = to_regclass('public.matchups') AND a.attname = 'tee_time' AND NOT a.attisdropped), false),
       'the tee time, like 07:20 (text)'
UNION ALL
SELECT 'group number check',
       EXISTS (SELECT 1 FROM pg_constraint
               WHERE conrelid = to_regclass('public.matchups') AND conname = 'matchups_group_number_range' AND contype = 'c' AND convalidated),
       '1 to 20, or empty'
UNION ALL
SELECT 'tee time check',
       EXISTS (SELECT 1 FROM pg_constraint
               WHERE conrelid = to_regclass('public.matchups') AND conname = 'matchups_tee_time_format' AND contype = 'c' AND convalidated),
       'HH:MM on the 24-hour clock, or empty'
UNION ALL
SELECT 'only admins change matchups',
       (SELECT count(*) FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'matchups' AND permissive = 'RESTRICTIVE'
          AND policyname IN ('matchups_admin_only_insert', 'matchups_admin_only_update', 'matchups_admin_only_delete')) = 3
       AND COALESCE((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass('public.matchups')), false),
       'add, change, remove: admins only (privacy_2027.sql), the new columns included'
UNION ALL
SELECT 'everyone reads them, Admin saves them',
       -- (one right per call: a list of rights asks whether any of them is held, not all)
       (SELECT bool_and(has_column_privilege(r.who, 'public.matchups', c.col, r.what))
        FROM (VALUES ('anon', 'SELECT'), ('authenticated', 'SELECT'), ('authenticated', 'INSERT'), ('authenticated', 'UPDATE')) r(who, what)
        CROSS JOIN (VALUES ('group_number'), ('tee_time')) c(col)),
       'the Round Tracker reads them; the admin-only rules above decide who saves'
UNION ALL
SELECT 'how matches are numbered',
       true,
       'id is ' || COALESCE((SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
                             WHERE a.attrelid = to_regclass('public.matchups') AND a.attname = 'id' AND NOT a.attisdropped), 'missing')
       || CASE WHEN EXISTS (SELECT 1 FROM pg_attribute a
                            WHERE a.attrelid = to_regclass('public.matchups') AND a.attname = 'created_at' AND NOT a.attisdropped)
               THEN '; created_at exists, so Match 1, 2, 3 go by when each match was made'
               ELSE '; there is no created_at, so Match 1, 2, 3 go by id' END
UNION ALL
SELECT 'set so far',
       true,
       (SELECT count(*) FILTER (WHERE group_number IS NOT NULL)::text || ' of ' || count(*)::text || ' matches have a group, '
               || count(*) FILTER (WHERE tee_time IS NOT NULL)::text || ' a tee time'
        FROM public.matchups);
