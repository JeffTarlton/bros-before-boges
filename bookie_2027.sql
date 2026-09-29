-- ============================================================
-- The Bookie: 2027 setup. Run once in the Supabase SQL Editor.
-- Safe to run again.
-- ============================================================

-- 1. Prop bets. The original table only allowed pool / h2h / main_event,
--    so "Prop Bet" failed with a wagers_type_check error.
ALTER TABLE public.wagers DROP CONSTRAINT IF EXISTS wagers_type_check;
ALTER TABLE public.wagers ADD CONSTRAINT wagers_type_check
  CHECK (type IN ('pool', 'h2h', 'prop', 'main_event'));

-- 2. A creator may delete a pool or prop nobody else has joined yet
--    (previously pools only), or a head-to-head that hasn't been accepted.
DROP POLICY IF EXISTS "Allow creator to delete open wagers" ON public.wagers;
CREATE POLICY "Allow creator to delete open wagers"
  ON public.wagers FOR DELETE
  TO authenticated
  USING (
    creator_id IN (SELECT id FROM public.players WHERE user_id = auth.uid()) AND (
      (type = 'h2h' AND status = 'proposed') OR
      (type IN ('pool', 'prop') AND jsonb_array_length(participants) <= 1)
    )
  );
