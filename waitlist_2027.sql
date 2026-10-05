-- ============================================================
-- Bros Before Boges — spots and the waitlist (sign-up order for the head count)
-- Run this entire script once in the Supabase SQL Editor, AFTER rsvp_accounts.sql, once the
-- matching site update is live. Safe to run again.
-- ============================================================
-- What it changes:
--   * rsvp_latest() (the public head count) now also returns in_since: when a player's current
--     answer is In, the moment they said In and stayed In. The site fills the trip's spots
--     (trip-config.js → rsvp.spots) in that order and puts everyone after that on the waitlist.
--     Changing a note or the Sunday answer keeps a player's place; going Probably or Out and
--     then back In starts the clock again (they rejoin at the back).
--   * Until this has run, the site orders by each player's latest answer time instead, so a
--     note change could move someone. Nothing else changes: same columns, same callers.

-- The return type gains a column, so the function has to be dropped first (CREATE OR REPLACE
-- can't change it). The site's fallback covers the moment in between.
DROP FUNCTION IF EXISTS public.rsvp_latest(integer);

CREATE FUNCTION public.rsvp_latest(p_trip_year integer)
RETURNS TABLE (id uuid, created_at timestamptz, trip_year integer, name text, status text, sunday_round boolean, player_id uuid, in_since timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH answers AS (
    SELECT r.id, r.created_at, r.trip_year, r.name, r.status, r.sunday_round, r.player_id,
           COALESCE(r.player_id::text, lower(regexp_replace(btrim(r.name), '\s+', ' ', 'g'))) AS who,
           COALESCE(p.status = 'confirmed', false) AS confirmed
    FROM public.rsvps r
    LEFT JOIN public.players p ON p.id = r.player_id
    WHERE r.trip_year = p_trip_year
  ),
  latest AS (
    SELECT DISTINCT ON (a.who) a.*
    FROM answers a
    ORDER BY a.who, a.created_at DESC
  )
  -- Confirmed players first, so they always fit inside the API's row cap
  SELECT l.id, l.created_at, l.trip_year, l.name, l.status, l.sunday_round, l.player_id,
         CASE WHEN l.status = 'in' THEN (
           -- The first In after the player's last non-In answer (or their first In ever)
           SELECT min(x.created_at) FROM answers x
           WHERE x.who = l.who AND x.status = 'in'
             AND x.created_at > COALESCE(
               (SELECT max(y.created_at) FROM answers y WHERE y.who = l.who AND y.status <> 'in'),
               '-infinity'::timestamptz)
         ) END AS in_since
  FROM latest l
  ORDER BY l.confirmed DESC, l.created_at DESC;
$$;

-- Same callers as before: anyone can read the head count
REVOKE ALL ON FUNCTION public.rsvp_latest(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rsvp_latest(integer) TO anon, authenticated;

-- Tell the API about the new column right away
NOTIFY pgrst, 'reload schema';

-- Check (the SQL editor shows this last result): every player who is In, in waitlist order.
-- "spot" counts confirmed players only, the same way the site does.
SELECT row_number() OVER (ORDER BY l.in_since, l.created_at) AS spot, l.name, l.in_since, l.created_at AS latest_answer,
       CASE WHEN p.status = 'confirmed' THEN 'confirmed' ELSE COALESCE(p.status, 'not on roster') || ' (holds no spot until approved)' END AS roster
FROM public.rsvp_latest((SELECT COALESCE(max(trip_year), extract(year FROM now())::int) FROM public.rsvps)) l
LEFT JOIN public.players p ON p.id = l.player_id
WHERE l.status = 'in' AND p.status = 'confirmed'
ORDER BY l.in_since, l.created_at;
