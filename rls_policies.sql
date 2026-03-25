-- ============================================================
-- Bros Before Boges — Row Level Security Policies
-- Run this entire script in the Supabase SQL Editor
-- ============================================================

-- ============================================================
-- COURSES: Enable RLS, allow anyone to read (reference data)
-- ============================================================
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "courses_public_read"
  ON public.courses FOR SELECT
  USING (true);

-- ============================================================
-- ROUNDS: Enable RLS, authenticated users can read/write
-- ============================================================
ALTER TABLE public.rounds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rounds_auth_select"
  ON public.rounds FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "rounds_auth_insert"
  ON public.rounds FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "rounds_auth_update"
  ON public.rounds FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- SCORES: Enable RLS, authenticated users can read/write
-- ============================================================
ALTER TABLE public.scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scores_auth_select"
  ON public.scores FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "scores_auth_insert"
  ON public.scores FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "scores_auth_update"
  ON public.scores FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- PAIRINGS: Enable RLS, authenticated users can read/write/delete
-- ============================================================
ALTER TABLE public.pairings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pairings_auth_select"
  ON public.pairings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "pairings_auth_insert"
  ON public.pairings FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "pairings_auth_delete"
  ON public.pairings FOR DELETE
  TO authenticated
  USING (true);

-- ============================================================
-- RYDER CUP SCORES: Enable RLS, authenticated users can read/write
-- ============================================================
ALTER TABLE public.ryder_cup_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ryder_cup_scores_public_read"
  ON public.ryder_cup_scores FOR SELECT
  USING (true);

CREATE POLICY "ryder_cup_scores_auth_insert"
  ON public.ryder_cup_scores FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "ryder_cup_scores_auth_update"
  ON public.ryder_cup_scores FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
