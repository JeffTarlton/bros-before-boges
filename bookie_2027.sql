-- ============================================================
-- The Bookie: 2027 setup. Run once in the Supabase SQL Editor,
-- after rsvp_accounts.sql. Safe to run again.
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

-- 3. Bet rules, enforced by the database -------------------------------------------------
-- The page only shows the right buttons (the player challenged accepts, a pool's creator
-- closes and settles it, and so on), but the table itself let ANY signed-in login, including
-- a brand-new sign-up, rewrite any bet through the API: flip a winner, change an amount, or
-- post a bet in someone else's name. This trigger holds every browser request to the same
-- rules as the page. Admins (is_trip_admin) can still fix anything, as can the SQL editor
-- and the table editor.
DO $$
BEGIN
  IF to_regprocedure('public.is_trip_admin()') IS NULL THEN
    RAISE EXCEPTION 'Run rsvp_accounts.sql first (it creates is_trip_admin), then run this again.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.wagers_guard()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  me uuid;
  old_parts jsonb;
  new_parts jsonb;
  on_bet boolean;       -- head-to-head: the caller is the challenger or the player challenged
  winners_same boolean;
BEGIN
  -- Only browser requests are checked (they run as the anon or authenticated role)
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF current_user = 'authenticated' THEN
    IF public.is_trip_admin() THEN
      RETURN COALESCE(NEW, OLD);
    END IF;
  END IF;

  -- The caller's confirmed roster spot. Signed-out visitors, logins not linked to a name and
  -- new sign-ups the commissioner hasn't confirmed can't bet.
  IF auth.uid() IS NOT NULL THEN
    SELECT id INTO me FROM public.players
     WHERE user_id = auth.uid() AND COALESCE(status, 'confirmed') = 'confirmed'
     ORDER BY id LIMIT 1;
  END IF;
  IF me IS NULL THEN
    RAISE EXCEPTION 'Only confirmed players can bet. Log in, or ask the commissioner to confirm you.' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD; -- the delete policy already limits this to the creator's untouched bets
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.creator_id IS DISTINCT FROM me THEN
      RAISE EXCEPTION 'You can only propose bets as yourself.' USING ERRCODE = '42501';
    END IF;
    IF NEW.type IS NULL OR NEW.type NOT IN ('pool', 'h2h', 'prop')
       OR (NEW.type = 'h2h' AND NEW.status IS DISTINCT FROM 'proposed')
       OR (NEW.type <> 'h2h' AND NEW.status IS DISTINCT FROM 'open')
       OR NEW.participants IS DISTINCT FROM jsonb_build_array(me)
       OR NEW.winner_id IS NOT NULL
       OR COALESCE(NEW.winner_ids, '[]'::jsonb) <> '[]'::jsonb
       OR NEW.amount IS NULL OR NEW.amount < 1 THEN
      RAISE EXCEPTION 'That isn''t a valid new bet.' USING ERRCODE = '42501';
    END IF;
    IF NEW.type = 'h2h' AND (NEW.target_id IS NULL OR NEW.target_id = me
       OR NEW.odds IS NULL OR abs(NEW.odds) < 100 OR abs(NEW.odds) > 10000) THEN
      RAISE EXCEPTION 'A challenge needs another player and odds of 100 or more.' USING ERRCODE = '42501';
    END IF;
    IF NEW.type <> 'h2h' AND NEW.target_id IS NOT NULL THEN
      RAISE EXCEPTION 'Only a head-to-head challenges a player.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE. A bet's terms (who, what, how much, the line, when) never change; only its
  -- status, players and winners do. Generated columns are left out of the comparison.
  IF (to_jsonb(NEW) - 'status' - 'participants' - 'winner_id' - 'winner_ids' - 'updated_at'
        - ARRAY(SELECT attname::text FROM pg_attribute WHERE attrelid = TG_RELID AND attgenerated <> '' AND NOT attisdropped))
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'status' - 'participants' - 'winner_id' - 'winner_ids' - 'updated_at'
        - ARRAY(SELECT attname::text FROM pg_attribute WHERE attrelid = TG_RELID AND attgenerated <> '' AND NOT attisdropped)) THEN
    RAISE EXCEPTION 'A bet''s terms can''t be changed once it''s posted.' USING ERRCODE = '42501';
  END IF;

  old_parts := COALESCE(OLD.participants, '[]'::jsonb);
  new_parts := COALESCE(NEW.participants, '[]'::jsonb);
  on_bet := me = OLD.creator_id OR me IS NOT DISTINCT FROM OLD.target_id;
  winners_same := NEW.winner_id IS NOT DISTINCT FROM OLD.winner_id
              AND COALESCE(NEW.winner_ids, '[]'::jsonb) = COALESCE(OLD.winner_ids, '[]'::jsonb);

  -- Nothing actually changing (a repeated request)
  IF NEW.status IS NOT DISTINCT FROM OLD.status AND new_parts = old_parts AND winners_same THEN
    RETURN NEW;
  END IF;

  -- An open pool or prop: players join or leave, themselves only
  IF OLD.type IN ('pool', 'prop') AND OLD.status = 'open' AND NEW.status = 'open' AND winners_same THEN
    IF NOT old_parts @> jsonb_build_array(me) AND new_parts = old_parts || jsonb_build_array(me) THEN
      RETURN NEW; -- join
    END IF;
    IF me <> OLD.creator_id AND old_parts @> jsonb_build_array(me)
       AND new_parts = (SELECT COALESCE(jsonb_agg(e ORDER BY n), '[]'::jsonb)
                          FROM jsonb_array_elements(old_parts) WITH ORDINALITY AS x(e, n)
                         WHERE e <> to_jsonb(me)) THEN
      RETURN NEW; -- leave
    END IF;
    RAISE EXCEPTION 'You can only add or remove yourself.' USING ERRCODE = '42501';
  END IF;

  -- A challenge: the player challenged accepts; either player calls it off
  IF OLD.type = 'h2h' AND OLD.status = 'proposed' THEN
    IF NEW.status = 'active' AND me IS NOT DISTINCT FROM OLD.target_id AND winners_same
       AND new_parts = jsonb_build_array(OLD.creator_id, me) THEN
      RETURN NEW;
    END IF;
    IF NEW.status = 'canceled' AND on_bet AND winners_same AND new_parts = old_parts THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Only the player challenged can accept or decline a challenge.' USING ERRCODE = '42501';
  END IF;

  IF new_parts <> old_parts THEN
    RAISE EXCEPTION 'Players can''t join or leave once betting has closed.' USING ERRCODE = '42501';
  END IF;

  -- An open pool or prop: its creator closes betting or calls it off
  IF OLD.type IN ('pool', 'prop') AND OLD.status = 'open' AND NEW.status IN ('active', 'canceled') THEN
    IF me = OLD.creator_id AND winners_same THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Only the bet''s creator can close or cancel it.' USING ERRCODE = '42501';
  END IF;

  -- A live bet: settle, push or void it. Head-to-head: either player. Pool or prop: its creator.
  IF OLD.status = 'active' AND NEW.status IN ('settled', 'push', 'canceled') THEN
    IF NOT ((OLD.type = 'h2h' AND on_bet) OR (OLD.type <> 'h2h' AND me = OLD.creator_id)) THEN
      RAISE EXCEPTION 'Only the players in a head-to-head, or a pool''s creator, can settle it.' USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'settled' THEN
      -- Winners come from the players in the bet; a head-to-head has exactly one
      IF NEW.winner_id IS NULL OR jsonb_typeof(NEW.winner_ids) IS DISTINCT FROM 'array'
         OR jsonb_array_length(NEW.winner_ids) = 0
         OR NOT old_parts @> NEW.winner_ids
         OR NOT NEW.winner_ids @> jsonb_build_array(NEW.winner_id)
         OR (OLD.type = 'h2h' AND jsonb_array_length(NEW.winner_ids) <> 1) THEN
        RAISE EXCEPTION 'Pick the winners from the players in the bet.' USING ERRCODE = '42501';
      END IF;
    ELSIF NOT winners_same THEN
      RAISE EXCEPTION 'A push or a voided bet has no winner.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'That change isn''t allowed. Ask an admin.' USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS wagers_guard ON public.wagers;
CREATE TRIGGER wagers_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.wagers
  FOR EACH ROW EXECUTE FUNCTION public.wagers_guard();

-- Tell the API about the changes right away
NOTIFY pgrst, 'reload schema';
