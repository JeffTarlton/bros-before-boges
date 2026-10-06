-- ============================================================
-- Bros Before Boges: pre-trip Supabase checkup. READ-ONLY.
-- Paste into the Supabase SQL Editor and run one block at a time.
-- Nothing here changes data. The commented-out lines are fixes you can
-- run on purpose once you've looked at the results.
-- ============================================================

-- 1. Which setup scripts have been run?
--    want: rsvp_table_ready = true   (rsvp_schema.sql)
--          courses_2027     = 4      (courses_2027_seed.sql)
--          wager_types includes 'prop' (bookie_2027.sql)
--          bet_rules_guarded = true   (bookie_2027.sql)
--          tracker_ready    = true    (tracker_2027.sql)
--          rsvp_accounts_ready = true (rsvp_accounts.sql)
--          emails_public    = false  (players_privacy.sql)
--          bets_public      = false  (bookie_crew_read_2027.sql)
SELECT
  EXISTS (SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'rsvps')              AS rsvp_table_ready,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'submit_rsvp')                 AS rsvp_accounts_ready,
  (SELECT count(*) FROM public.courses
   WHERE name IN ('Talking Stick - O''odham', 'We-Ko-Pa - Cholla', 'We-Ko-Pa - Saguaro',
                  'Camelback - Ambiente'))                                     AS courses_2027,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'wagers_type_check')                                        AS wager_types,
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'wagers_guard' AND NOT tgisinternal) AS bet_rules_guarded,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_confirmed_player')         AS tracker_ready,
  has_column_privilege('anon', 'public.players', 'email', 'SELECT')             AS emails_public,
  has_any_column_privilege('anon', 'public.wagers', 'SELECT')                   AS bets_public;

-- 2. Rounds still marked active. The Round Tracker now groups rounds by round number and
--    day, so old ones no longer get in the way; this is just housekeeping.
SELECT id, date, round_number, status
FROM public.rounds
WHERE status = 'active'
ORDER BY date;
-- Fix, once you've checked the list:
-- UPDATE public.rounds SET status = 'completed' WHERE status = 'active' AND date < '2027-04-01';

-- 3. Last year's Round 1 / Round 2 matchups. The Round Tracker offers these
--    until they're replaced in Admin > Matchups.
SELECT round_number, count(*) AS matchups
FROM public.matchups
GROUP BY round_number
ORDER BY round_number;

-- 4. Logins that aren't tied to a roster name. In The Bookie they now get a
--    "Which name on the roster is you?" picker; this shows who that will be.
SELECT u.email, u.created_at
FROM auth.users u
LEFT JOIN public.players p ON p.user_id = u.id
WHERE p.id IS NULL
ORDER BY u.created_at;

-- 5. Admins. Admin access is matched by the email on the roster row, so each
--    of these emails must be the one used to log in.
SELECT name, email, user_id IS NOT NULL AS bookie_linked
FROM public.players
WHERE is_admin;

-- 6. Row-level security on the tables the site writes to, and every policy.
--    Send this output along if you want the database locked down further.
SELECT c.relname AS table_name, c.relrowsecurity AS rls_on
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('players', 'wagers', 'wager_comments', 'rounds', 'scores', 'matchups',
                    'ryder_cup_scores', 'courses', 'rsvps', 'player_round_scores')
ORDER BY 1;

SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd, policyname;

-- 7. Resetting a password by hand. Supabase's built-in email only reaches
--    members of your Supabase team, so "Forgot password?" emails may never
--    reach the guys unless custom SMTP is set up. Replace both values, run it,
--    and send them the temporary password.
-- UPDATE auth.users
-- SET encrypted_password = extensions.crypt('Temp-Pass-2027', extensions.gen_salt('bf'))
-- WHERE lower(email) = lower('player@example.com');
