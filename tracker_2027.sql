-- ============================================================
-- Round Tracker: 2027 setup. Run once in the Supabase SQL Editor,
-- after rsvp_accounts.sql. Safe to run again.
-- ============================================================
-- The tracker works without this. It adds:
--   1. The live leaderboard for everyone, signed in or not (rounds, scores, matchups readable).
--   2. Only confirmed players can create rounds or enter scores. Until now any signed-in
--      login, including a brand-new sign-up, could change any score.
--   3. Hole scores must be 1 to 20.
--   4. One scorecard row per player per round, and one round per round number per day
--      for 2027 (so two groups starting at the same moment can't split a round in two).
--   5. Scorecard totals worked out by the database from the holes, so a phone with an old
--      copy of the card can never leave a wrong total behind.

-- Who counts as a confirmed player: a roster row linked to this login
CREATE OR REPLACE FUNCTION public.is_confirmed_player()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.players WHERE user_id = auth.uid() AND COALESCE(status, 'confirmed') = 'confirmed'
  );
$$;
REVOKE ALL ON FUNCTION public.is_confirmed_player() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_confirmed_player() TO anon, authenticated;

-- 1. Live leaderboard for everyone ----------------------------------------------------
GRANT SELECT ON public.rounds, public.scores, public.matchups TO anon, authenticated;

DROP POLICY IF EXISTS "tracker_public_read" ON public.rounds;
CREATE POLICY "tracker_public_read" ON public.rounds FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "tracker_public_read" ON public.scores;
CREATE POLICY "tracker_public_read" ON public.scores FOR SELECT TO anon, authenticated USING (true);
-- (Matchups: only matters if row security is on for that table; harmless otherwise.)
DROP POLICY IF EXISTS "tracker_public_read" ON public.matchups;
CREATE POLICY "tracker_public_read" ON public.matchups FOR SELECT TO anon, authenticated USING (true);

-- 2. Only confirmed players write ----------------------------------------------------
ALTER TABLE public.rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scores ENABLE ROW LEVEL SECURITY;

-- The older, looser policies from rls_policies.sql
DROP POLICY IF EXISTS "rounds_auth_insert" ON public.rounds;
DROP POLICY IF EXISTS "rounds_auth_update" ON public.rounds;
DROP POLICY IF EXISTS "scores_auth_insert" ON public.scores;
DROP POLICY IF EXISTS "scores_auth_update" ON public.scores;

DROP POLICY IF EXISTS "tracker_players_insert" ON public.rounds;
CREATE POLICY "tracker_players_insert" ON public.rounds FOR INSERT TO authenticated
  WITH CHECK (public.is_confirmed_player());
DROP POLICY IF EXISTS "tracker_players_update" ON public.rounds;
CREATE POLICY "tracker_players_update" ON public.rounds FOR UPDATE TO authenticated
  USING (public.is_confirmed_player()) WITH CHECK (public.is_confirmed_player());
DROP POLICY IF EXISTS "tracker_players_insert" ON public.scores;
CREATE POLICY "tracker_players_insert" ON public.scores FOR INSERT TO authenticated
  WITH CHECK (public.is_confirmed_player());
DROP POLICY IF EXISTS "tracker_players_update" ON public.scores;
CREATE POLICY "tracker_players_update" ON public.scores FOR UPDATE TO authenticated
  USING (public.is_confirmed_player()) WITH CHECK (public.is_confirmed_player());

-- Belt and braces: whatever other policies exist on these tables, writes from the website
-- need a confirmed player (restrictive policies apply on top of all the others).
DROP POLICY IF EXISTS "tracker_confirmed_only_insert" ON public.rounds;
CREATE POLICY "tracker_confirmed_only_insert" ON public.rounds AS RESTRICTIVE FOR INSERT TO anon, authenticated
  WITH CHECK (public.is_confirmed_player());
DROP POLICY IF EXISTS "tracker_confirmed_only_update" ON public.rounds;
CREATE POLICY "tracker_confirmed_only_update" ON public.rounds AS RESTRICTIVE FOR UPDATE TO anon, authenticated
  USING (public.is_confirmed_player()) WITH CHECK (public.is_confirmed_player());
DROP POLICY IF EXISTS "tracker_confirmed_only_delete" ON public.rounds;
CREATE POLICY "tracker_confirmed_only_delete" ON public.rounds AS RESTRICTIVE FOR DELETE TO anon, authenticated
  USING (public.is_trip_admin());
DROP POLICY IF EXISTS "tracker_confirmed_only_insert" ON public.scores;
CREATE POLICY "tracker_confirmed_only_insert" ON public.scores AS RESTRICTIVE FOR INSERT TO anon, authenticated
  WITH CHECK (public.is_confirmed_player());
DROP POLICY IF EXISTS "tracker_confirmed_only_update" ON public.scores;
CREATE POLICY "tracker_confirmed_only_update" ON public.scores AS RESTRICTIVE FOR UPDATE TO anon, authenticated
  USING (public.is_confirmed_player()) WITH CHECK (public.is_confirmed_player());
DROP POLICY IF EXISTS "tracker_confirmed_only_delete" ON public.scores;
CREATE POLICY "tracker_confirmed_only_delete" ON public.scores AS RESTRICTIVE FOR DELETE TO anon, authenticated
  USING (public.is_trip_admin());

-- 3. Hole scores 1 to 20 (existing rows aren't checked) --------------------------------
ALTER TABLE public.scores DROP CONSTRAINT IF EXISTS scores_holes_range;
ALTER TABLE public.scores ADD CONSTRAINT scores_holes_range CHECK (
  (h1 IS NULL OR h1 BETWEEN 1 AND 20) AND (h2 IS NULL OR h2 BETWEEN 1 AND 20) AND
  (h3 IS NULL OR h3 BETWEEN 1 AND 20) AND (h4 IS NULL OR h4 BETWEEN 1 AND 20) AND
  (h5 IS NULL OR h5 BETWEEN 1 AND 20) AND (h6 IS NULL OR h6 BETWEEN 1 AND 20) AND
  (h7 IS NULL OR h7 BETWEEN 1 AND 20) AND (h8 IS NULL OR h8 BETWEEN 1 AND 20) AND
  (h9 IS NULL OR h9 BETWEEN 1 AND 20) AND (h10 IS NULL OR h10 BETWEEN 1 AND 20) AND
  (h11 IS NULL OR h11 BETWEEN 1 AND 20) AND (h12 IS NULL OR h12 BETWEEN 1 AND 20) AND
  (h13 IS NULL OR h13 BETWEEN 1 AND 20) AND (h14 IS NULL OR h14 BETWEEN 1 AND 20) AND
  (h15 IS NULL OR h15 BETWEEN 1 AND 20) AND (h16 IS NULL OR h16 BETWEEN 1 AND 20) AND
  (h17 IS NULL OR h17 BETWEEN 1 AND 20) AND (h18 IS NULL OR h18 BETWEEN 1 AND 20)
) NOT VALID;

-- 4. No duplicates ----------------------------------------------------------------------
-- Skipped, with a notice, if old data already has duplicates (the tracker copes either way).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.scores GROUP BY round_id, player_id HAVING count(*) > 1) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS scores_one_row_per_player ON public.scores (round_id, player_id);
  ELSE
    RAISE NOTICE 'Some player has two scorecards in one round; the one-row-per-player rule was skipped.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rounds WHERE date >= '2027-01-01' GROUP BY round_number, date HAVING count(*) > 1) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS rounds_one_per_day_2027 ON public.rounds (round_number, date) WHERE date >= '2027-01-01';
  ELSE
    RAISE NOTICE 'A 2027 round number already has two rounds on one day; the one-per-day rule was skipped.';
  END IF;
END $$;

-- 5. Totals always match the holes ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scores_totals()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  card jsonb := to_jsonb(NEW);
  course jsonb;
  strokes integer := 0;
  to_par integer := 0;
  v integer;
  par integer;
BEGIN
  SELECT to_jsonb(c) INTO course
    FROM public.rounds r JOIN public.courses c ON c.id = r.course_id
   WHERE r.id = NEW.round_id;
  FOR i IN 1..18 LOOP
    v := (card ->> ('h' || i))::integer;
    IF v IS NOT NULL THEN
      strokes := strokes + v;
      par := (course ->> ('h' || i || '_par'))::integer;
      IF par IS NOT NULL THEN
        to_par := to_par + v - par;
      END IF;
    END IF;
  END LOOP;
  NEW.total_score := strokes;
  NEW.total_to_par := to_par;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS scores_totals ON public.scores;
CREATE TRIGGER scores_totals
  BEFORE INSERT OR UPDATE ON public.scores
  FOR EACH ROW EXECUTE FUNCTION public.scores_totals();

-- Tell the API about the changes right away
NOTIFY pgrst, 'reload schema';
