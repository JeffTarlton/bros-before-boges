-- ============================================================
-- Bros before Boges — phone notifications (2027)
-- Order: 1. push the site update first (manifest, sw.js, push.js, api/push.js). Until this script
--           has run, every page hides its notification controls and Admin → Announcements says so.
--        2. set the six env vars in Vercel (Settings → Environment Variables) from .env.local and
--           redeploy: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, SUPABASE_URL,
--           SUPABASE_SERVICE_ROLE_KEY, PUSH_WEBHOOK_SECRET.
--        3. run this entire script once in the Supabase SQL Editor (it needs rsvp_accounts.sql,
--           payments_2027.sql, waitlist_2027.sql and teetimes_2027.sql, which have run). Safe to run again.
--        4. Supabase dashboard → Integrations → Database Webhooks → Create a new hook:
--             Name            push
--             Table           public.notifications
--             Events          Insert (only)
--             Type            HTTP Request, method POST
--             URL             https://bros-before-boges.vercel.app/api/push
--             Timeout         5000
--             HTTP Headers    x-bbb-secret = the PUSH_WEBHOOK_SECRET you gave Vercel
--           (The secret lives in the dashboard and in Vercel, never in this repo.)
--        5. On your phone: add the site to the home screen, open it from there, turn on
--           notifications (homepage checklist, or the bell in The Bookie), then Admin →
--           Announcements → "Send me a test".
-- ============================================================
-- What it does:
--   1. push_subscriptions: the phones each player turned notifications on for. Nobody reads or
--      writes it with the site's key; players save and remove their own through
--      save_push_subscription / delete_push_subscription, and api/push.js reads it with the
--      service role.
--   2. notifications: the outbox. One row per player per thing to tell him, queued by the
--      triggers below; the webhook hands each new row to api/push.js, which sends it and stamps
--      sent_at. Rows older than 30 days are cleared as new ones are queued.
--   3. notify_players(): who gets a row. Only a confirmed roster name linked to a login (the crew:
--      a sign-up waiting for approval hears nothing until "You're on the roster", and a name whose
--      login was removed hears nothing). Never the player who did the thing, never a player with no
--      phone turned on, and never the same tag twice within 20 seconds (The Bookie writes a
--      "Declined the challenge." comment right after a decline; the status push wins). When a
--      name's login changes, the phones saved under it are forgotten (zzz_push_forget_phones).
--   4. The triggers, each wrapped so a notification bug can never block a bet, an RSVP or a save:
--        wagers          challenged · accepted · declined / pulled · betting closed · settled ·
--                        push / called off · reopened (admin)
--        wager_comments  trash talk on a bet you're in
--        bookie_payments a Paid mark that involves you
--        trip_tee_times  tee times posted (one banner, however many rounds are saved)
--        players         your roster name approved; and if you'd already said In, the crew hears
--        rsvps           "<First> is in for Scottsdale 2027" the first time a player says In, and
--                        "A spot opened up" to whoever moves off the waitlist
--        announcements   whatever the commissioner types in Admin → Announcements
--   5. Admin: admin_send_announcement, admin_announcements, admin_push_summary, admin_test_push.
--      Crew: players_with_push (The Bookie says "Kyle gets a notification" after a challenge),
--      my_push_count.
--   Nothing else changes.

-- 0. Checks first. If one fails the script stops here, before changing anything ---------------
DO $$
BEGIN
  IF to_regprocedure('public.is_trip_admin()') IS NULL THEN
    RAISE EXCEPTION 'Run rsvp_accounts.sql first, then run this again. Nothing was changed.';
  END IF;
  IF to_regprocedure('public.payments_my_player()') IS NULL THEN
    RAISE EXCEPTION 'Run payments_2027.sql first, then run this again. Nothing was changed.';
  END IF;
  IF to_regclass('public.trip_tee_times') IS NULL THEN
    RAISE EXCEPTION 'Run teetimes_2027.sql first, then run this again. Nothing was changed.';
  END IF;
  IF to_regclass('public.bookie_payments') IS NULL OR to_regclass('public.wager_comments') IS NULL THEN
    RAISE EXCEPTION 'The Bookie''s tables are missing (bookie_schema.sql, payments_2027.sql). Nothing was changed.';
  END IF;
END $$;

-- A link a notification may open: a page on this site only. "/", "/bookie", "/#schedule" pass;
-- "//evil.example" and "/\evil.example" (which browsers read as another site), spaces and control
-- characters don't. The service worker checks again before it opens anything.
CREATE OR REPLACE FUNCTION public.push_safe_url(p_url text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT COALESCE(p_url, '') ~ '^/([^/\\[:space:][:cntrl:]][^\\[:space:][:cntrl:]]{0,198})?$';
$$;

-- A phone's push address: only the real push services' (Google for Chrome and Android, Apple for
-- Safari and iPhones, Mozilla for Firefox, Microsoft for Edge on Windows). api/push.js sends a request
-- to this address, so anything else (a made-up "phone" pointing at some other server) is refused here
-- and again in api/push.js.
CREATE OR REPLACE FUNCTION public.push_safe_endpoint(p_endpoint text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT char_length(COALESCE(p_endpoint, '')) BETWEEN 30 AND 2000
     AND p_endpoint ~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]{1,63}\.notify\.windows\.com)/[^[:space:][:cntrl:]]+$';
$$;

-- A subscription's keys are base64url text (letters, digits, - and _)
CREATE OR REPLACE FUNCTION public.push_safe_key(p_key text, p_max integer)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT COALESCE(p_key, '') ~ '^[A-Za-z0-9_-]+=*$' AND char_length(p_key) <= p_max;
$$;

-- 1. The phones ---------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id    uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  -- The push service's address for this phone (unique: one row per phone, whoever is logged in)
  endpoint     text NOT NULL UNIQUE,
  p256dh       text NOT NULL,
  auth         text NOT NULL,
  user_agent   text CONSTRAINT push_subscriptions_ua_check CHECK (user_agent IS NULL OR char_length(user_agent) <= 300),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  -- Set by api/push.js when the push service rejects the phone outright; cleared when the phone saves again
  failed_at    timestamptz,
  fail_reason  text CONSTRAINT push_subscriptions_fail_check CHECK (fail_reason IS NULL OR char_length(fail_reason) <= 200)
);
COMMENT ON TABLE public.push_subscriptions IS 'Phones with notifications on, one row per phone. Write: save_push_subscription / delete_push_subscription. Read: api/push.js (service role) only.';
CREATE INDEX IF NOT EXISTS push_subscriptions_player_idx ON public.push_subscriptions (player_id);

-- (Added this way so a re-run of this script replaces older versions of the checks)
ALTER TABLE public.push_subscriptions DROP CONSTRAINT IF EXISTS push_subscriptions_endpoint_check;
ALTER TABLE public.push_subscriptions ADD CONSTRAINT push_subscriptions_endpoint_check CHECK (public.push_safe_endpoint(endpoint));
ALTER TABLE public.push_subscriptions DROP CONSTRAINT IF EXISTS push_subscriptions_p256dh_check;
ALTER TABLE public.push_subscriptions ADD CONSTRAINT push_subscriptions_p256dh_check CHECK (public.push_safe_key(p256dh, 300));
ALTER TABLE public.push_subscriptions DROP CONSTRAINT IF EXISTS push_subscriptions_auth_check;
ALTER TABLE public.push_subscriptions ADD CONSTRAINT push_subscriptions_auth_check CHECK (public.push_safe_key(auth, 100));
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.push_subscriptions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.push_subscriptions TO service_role;

-- 2. The outbox ---------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  kind       text NOT NULL CONSTRAINT notifications_kind_check CHECK (kind ~ '^[a-z]{1,20}$'),
  title      text NOT NULL CONSTRAINT notifications_title_check CHECK (char_length(title) BETWEEN 1 AND 80),
  body       text CONSTRAINT notifications_body_check CHECK (body IS NULL OR char_length(body) <= 200),
  -- Where a tap lands: a path on the site
  url        text NOT NULL DEFAULT '/',
  -- Same tag: the newer banner replaces the older one on the phone
  tag        text CONSTRAINT notifications_tag_check CHECK (tag IS NULL OR char_length(tag) <= 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at    timestamptz,
  result     text CONSTRAINT notifications_result_check CHECK (result IS NULL OR char_length(result) <= 200)
);
COMMENT ON TABLE public.notifications IS 'Outbox: one row per player per notification. Queued by triggers (notify_players), sent by api/push.js through the Database Webhook, which sets sent_at.';
CREATE INDEX IF NOT EXISTS notifications_player_idx ON public.notifications (player_id, created_at);
CREATE INDEX IF NOT EXISTS notifications_created_idx ON public.notifications (created_at);
CREATE INDEX IF NOT EXISTS notifications_unsent_idx ON public.notifications (created_at) WHERE sent_at IS NULL;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_url_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_url_check CHECK (public.push_safe_url(url));
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.notifications FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.notifications TO service_role;

-- Commissioner announcements (Admin → Announcements)
CREATE TABLE IF NOT EXISTS public.announcements (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_year  integer NOT NULL CONSTRAINT announcements_year_check CHECK (trip_year BETWEEN 2000 AND 2100),
  title      text NOT NULL CONSTRAINT announcements_title_check CHECK (char_length(title) BETWEEN 1 AND 80),
  body       text CONSTRAINT announcements_body_check CHECK (body IS NULL OR char_length(body) <= 200),
  url        text NOT NULL DEFAULT '/',
  -- How many players it was queued for (set by admin_send_announcement once the trigger has run)
  recipients integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.players(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.announcements IS 'What the commissioner sent from Admin → Announcements. Write: admin_send_announcement. Read: admin_announcements.';
CREATE INDEX IF NOT EXISTS announcements_year_idx ON public.announcements (trip_year, created_at);

ALTER TABLE public.announcements DROP CONSTRAINT IF EXISTS announcements_url_check;
ALTER TABLE public.announcements ADD CONSTRAINT announcements_url_check CHECK (public.push_safe_url(url));
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.announcements FROM PUBLIC, anon, authenticated;

-- 3. Internal helpers (not callable from the site) ----------------------------------------------
-- The player behind this request: the roster row linked to the login (a confirmed one first), or
-- for an admin whose login isn't linked to a name, the admin row with that login's email. NULL in
-- the SQL editor and for the service role, so a change made there tells everyone on the bet.
CREATE OR REPLACE FUNCTION public.push_actor()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT p.id FROM public.players p
      WHERE auth.uid() IS NOT NULL AND p.user_id = auth.uid()
      ORDER BY (COALESCE(p.status, 'confirmed') = 'confirmed') DESC, p.id LIMIT 1),
    (SELECT p.id FROM public.players p
      WHERE p.is_admin AND NULLIF(btrim(auth.jwt() ->> 'email'), '') IS NOT NULL
        AND lower(btrim(p.email)) = lower(btrim(auth.jwt() ->> 'email'))
      ORDER BY p.id LIMIT 1)
  );
$$;

-- The trip the notifications are about. Keep the fallback in step with trip-config.js → trip.year.
CREATE OR REPLACE FUNCTION public.push_trip_year()
RETURNS integer
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT max(r.trip_year) FROM public.rsvps r), 2027);
$$;

-- "Scottsdale 2027" in the banners. Keep in step with trip-config.js → trip.locationShort / trip.year.
CREATE OR REPLACE FUNCTION public.push_trip_label()
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT 'Scottsdale 2027';
$$;

-- How many can come: the same number as trip-config.js → rsvp.spots (NULL there means no cap: use NULL here too)
CREATE OR REPLACE FUNCTION public.push_spots()
RETURNS integer
LANGUAGE sql IMMUTABLE
AS $$
  SELECT 20;
$$;

CREATE OR REPLACE FUNCTION public.push_first_name(p_player uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT NULLIF(split_part(btrim(p.name), ' ', 1), '') FROM public.players p WHERE p.id = p_player), 'Someone');
$$;

-- Who can get notifications at all: a confirmed roster name linked to a login (the crew, as for
-- bets and messages). notify_players, players_with_push and Admin's counts all use this one rule.
CREATE OR REPLACE FUNCTION public.push_can_receive(p_player uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.players pl
                 WHERE pl.id = p_player AND COALESCE(pl.status, 'confirmed') = 'confirmed' AND pl.user_id IS NOT NULL);
$$;

-- Everyone with a phone turned on who can get notifications, except one player (NULL: everyone)
CREATE OR REPLACE FUNCTION public.push_everyone_but(p_except uuid)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(array_agg(DISTINCT s.player_id), '{}'::uuid[])
  FROM public.push_subscriptions s
  WHERE s.failed_at IS NULL AND (p_except IS NULL OR s.player_id <> p_except)
    AND public.push_can_receive(s.player_id);
$$;

-- Who holds a spot: confirmed players who are In, in the order they said In (the same order as
-- rsvp_latest()'s in_since, waitlist_2027.sql), the first push_spots() of them. p_skip_rsvp leaves
-- one answer out and p_unconfirmed treats one player as not yet confirmed: "before this change".
CREATE OR REPLACE FUNCTION public.push_spot_holders(p_trip_year integer, p_skip_rsvp uuid, p_unconfirmed uuid)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH answers AS (
    SELECT r.id, r.created_at, r.status, r.player_id
    FROM public.rsvps r
    JOIN public.players p ON p.id = r.player_id
    WHERE r.trip_year = p_trip_year
      AND (p_skip_rsvp IS NULL OR r.id <> p_skip_rsvp)
      AND COALESCE(p.status, 'confirmed') = 'confirmed'
      AND (p_unconfirmed IS NULL OR p.id <> p_unconfirmed)
  ),
  latest AS (
    SELECT DISTINCT ON (a.player_id) a.*
    FROM answers a
    ORDER BY a.player_id, a.created_at DESC
  ),
  holders AS (
    SELECT l.player_id, l.created_at,
           (SELECT min(x.created_at) FROM answers x
             WHERE x.player_id = l.player_id AND x.status = 'in'
               AND x.created_at > COALESCE(
                 (SELECT max(y.created_at) FROM answers y WHERE y.player_id = l.player_id AND y.status <> 'in'),
                 '-infinity'::timestamptz)) AS in_since
    FROM latest l
    WHERE l.status = 'in'
  )
  SELECT COALESCE(array_agg(h.player_id), '{}'::uuid[])
  FROM (SELECT player_id FROM holders ORDER BY in_since, created_at LIMIT public.push_spots()) h;
$$;

-- How many confirmed players are In for a trip (spots and waitlist together)
CREATE OR REPLACE FUNCTION public.push_in_count(p_trip_year integer)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT count(*)::integer FROM (
    SELECT DISTINCT ON (r.player_id) r.status
    FROM public.rsvps r
    JOIN public.players p ON p.id = r.player_id
    WHERE r.trip_year = p_trip_year AND COALESCE(p.status, 'confirmed') = 'confirmed'
    ORDER BY r.player_id, r.created_at DESC
  ) t WHERE t.status = 'in';
$$;

-- Queue one notification for each of these players. Skips players who aren't confirmed, the player who did the thing (unless
-- p_include_actor), players with no phone turned on, and a player who already has a row with the
-- same tag from the last 20 seconds. Returns how many rows were queued.
CREATE OR REPLACE FUNCTION public.notify_players(p_recipients uuid[], p_kind text, p_title text, p_body text, p_url text, p_tag text, p_include_actor boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid;
  v_count integer := 0;
BEGIN
  IF p_recipients IS NULL OR NULLIF(btrim(COALESCE(p_title, '')), '') IS NULL THEN
    RETURN 0;
  END IF;
  v_actor := CASE WHEN p_include_actor THEN NULL ELSE public.push_actor() END;
  -- Old rows go as new ones arrive, so the table stays small
  DELETE FROM public.notifications WHERE created_at < now() - interval '30 days';
  INSERT INTO public.notifications (player_id, kind, title, body, url, tag)
  SELECT r.id, p_kind, left(btrim(p_title), 80), NULLIF(left(btrim(COALESCE(p_body, '')), 200), ''),
         CASE WHEN public.push_safe_url(p_url) THEN p_url ELSE '/' END, NULLIF(left(p_tag, 80), '')
  FROM (SELECT DISTINCT unnest(p_recipients) AS id) r
  WHERE r.id IS NOT NULL
    AND r.id IS DISTINCT FROM v_actor
    AND EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.player_id = r.id AND s.failed_at IS NULL)
    -- The crew only (push_can_receive): bets, trash talk and announcements aren't for a sign-up
    -- waiting for approval, nor for a name whose login was removed. "You're on the roster" still
    -- reaches a new player, because it's sent once his status is already confirmed.
    AND public.push_can_receive(r.id)
    AND NOT (NULLIF(p_tag, '') IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.notifications n
          WHERE n.player_id = r.id AND n.tag = p_tag AND n.created_at > now() - interval '20 seconds'));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Everyone on a bet: its creator, the player challenged, and anyone who bought in
CREATE OR REPLACE FUNCTION public.push_bet_players(p_wager public.wagers)
RETURNS uuid[]
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(array_agg(DISTINCT t.x), '{}'::uuid[]) FROM (
    SELECT p_wager.creator_id AS x
    UNION SELECT p_wager.target_id
    UNION SELECT (e #>> '{}')::uuid FROM jsonb_array_elements(COALESCE(p_wager.participants, '[]'::jsonb)) e
          WHERE jsonb_typeof(e) = 'string' AND (e #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) t WHERE t.x IS NOT NULL;
$$;

-- $20, $12.50
CREATE OR REPLACE FUNCTION public.push_money(p_amount numeric)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE WHEN p_amount IS NULL THEN ''
              WHEN p_amount = floor(p_amount) THEN '$' || p_amount::bigint
              ELSE '$' || to_char(p_amount, 'FM999999990.00') END;
$$;

-- 4. The triggers -------------------------------------------------------------------------------
-- The Bookie: a bet's life, from the challenge to the result
CREATE OR REPLACE FUNCTION public.push_on_wager()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid;
  v_all uuid[];
  v_desc text;
  v_url text;
  v_tag text;
  v_amount text;
  v_creator text;
  v_target text;
  v_body text;
BEGIN
  BEGIN
    v_actor := public.push_actor();
    v_all := public.push_bet_players(NEW);
    v_desc := left(regexp_replace(btrim(COALESCE(NEW.description, '')), '\s+', ' ', 'g'), 60);
    v_url := '/bookie?bet=' || NEW.id;
    v_tag := 'bet-' || NEW.id;
    v_amount := public.push_money(NEW.amount);
    v_creator := public.push_first_name(NEW.creator_id);
    v_target := public.push_first_name(NEW.target_id);

    IF TG_OP = 'INSERT' THEN
      IF NEW.type = 'h2h' AND NEW.status = 'proposed' AND NEW.target_id IS NOT NULL THEN
        PERFORM public.notify_players(ARRAY[NEW.target_id], 'challenge', v_creator || ' challenged you',
          v_amount || ' on: ' || v_desc || '. Accept or decline in The Bookie.', v_url, v_tag);
      END IF;
      RETURN NULL;
    END IF;

    -- Joining or leaving a pool, or a repeated request: nothing to say
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
      RETURN NULL;
    END IF;

    IF OLD.status = 'proposed' AND OLD.type = 'h2h' THEN
      IF NEW.status = 'active' THEN
        PERFORM public.notify_players(ARRAY[NEW.creator_id], 'accepted', v_target || ' accepted',
          v_amount || ' on: ' || v_desc || '. It''s on.', v_url, v_tag);
      ELSIF NEW.status = 'canceled' THEN
        IF v_actor IS NOT DISTINCT FROM NEW.creator_id THEN
          PERFORM public.notify_players(ARRAY[NEW.target_id], 'declined', v_creator || ' pulled the challenge', v_desc, v_url, v_tag);
        ELSE
          PERFORM public.notify_players(ARRAY[NEW.creator_id], 'declined', v_target || ' declined', v_desc, v_url, v_tag);
        END IF;
      END IF;
      RETURN NULL;
    END IF;

    IF OLD.status = 'open' AND NEW.status = 'active' THEN
      PERFORM public.notify_players(v_all, 'closed', 'Betting closed: ' || v_desc, 'No more buy-ins. It settles after the round.', v_url, v_tag);
    ELSIF NEW.status = 'settled' THEN
      IF NEW.type = 'h2h' THEN
        v_body := public.push_first_name(NEW.winner_id) || CASE WHEN COALESCE(abs(NEW.odds), 100) = 100 THEN ' won ' || v_amount || '.' ELSE ' won.' END;
      ELSE
        SELECT 'Winners: ' || string_agg(public.push_first_name((e #>> '{}')::uuid), ', ') || '.' INTO v_body
        FROM jsonb_array_elements(COALESCE(NEW.winner_ids, '[]'::jsonb)) e
        WHERE jsonb_typeof(e) = 'string' AND (e #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
        v_body := COALESCE(v_body, public.push_first_name(NEW.winner_id) || ' won.');
      END IF;
      PERFORM public.notify_players(v_all, 'settled', 'Settled: ' || v_desc, v_body, v_url, v_tag);
    ELSIF NEW.status = 'push' THEN
      PERFORM public.notify_players(v_all, 'voided', 'Push: ' || v_desc, 'No money changes hands.', v_url, v_tag);
    ELSIF NEW.status = 'canceled' THEN
      PERFORM public.notify_players(v_all, 'voided', 'Called off: ' || v_desc, 'No money changes hands.', v_url, v_tag);
    ELSIF OLD.status IN ('settled', 'push', 'canceled') AND NEW.status = 'active' THEN
      PERFORM public.notify_players(v_all, 'reopened', 'Reopened: ' || v_desc, 'The commissioner reopened it. It needs settling again.', v_url, v_tag);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'push_on_wager: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS zzz_push_on_wager ON public.wagers;
CREATE TRIGGER zzz_push_on_wager
  AFTER INSERT OR UPDATE ON public.wagers
  FOR EACH ROW EXECUTE FUNCTION public.push_on_wager();

-- The Bookie: trash talk on a bet you're in
CREATE OR REPLACE FUNCTION public.push_on_comment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_wager public.wagers%ROWTYPE;
  v_who uuid[];
BEGIN
  BEGIN
    SELECT * INTO v_wager FROM public.wagers w WHERE w.id = NEW.wager_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    v_who := array_remove(public.push_bet_players(v_wager), NEW.player_id);
    PERFORM public.notify_players(v_who, 'comment',
      public.push_first_name(NEW.player_id) || ' on: ' || left(regexp_replace(btrim(COALESCE(v_wager.description, '')), '\s+', ' ', 'g'), 60),
      left(regexp_replace(btrim(COALESCE(NEW.message, '')), '\s+', ' ', 'g'), 120),
      '/bookie?bet=' || v_wager.id, 'bet-' || v_wager.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'push_on_comment: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS zzz_push_on_comment ON public.wager_comments;
CREATE TRIGGER zzz_push_on_comment
  AFTER INSERT ON public.wager_comments
  FOR EACH ROW EXECUTE FUNCTION public.push_on_comment();

-- The Bookie: a Paid mark. "I paid X" tells X; "X paid me" tells X; an admin's mark tells both.
CREATE OR REPLACE FUNCTION public.push_on_paid()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_marker uuid;
  v_amount text;
  v_from text;
  v_to text;
  v_url text := '/bookie#ledger-panel';
  v_tag text;
BEGIN
  BEGIN
    v_marker := COALESCE(NEW.marked_by, public.push_actor());
    v_amount := public.push_money(NEW.amount);
    v_from := public.push_first_name(NEW.from_player);
    v_to := public.push_first_name(NEW.to_player);
    v_tag := 'paid-' || NEW.from_player || '-' || NEW.to_player;
    IF v_marker = NEW.from_player THEN
      PERFORM public.notify_players(ARRAY[NEW.to_player], 'paid', v_from || ' marked ' || v_amount || ' paid to you', 'Check Settle up in The Bookie.', v_url, v_tag);
    ELSIF v_marker = NEW.to_player THEN
      PERFORM public.notify_players(ARRAY[NEW.from_player], 'paid', v_to || ' marked you paid ' || v_amount, 'Check Settle up in The Bookie.', v_url, v_tag);
    ELSE
      PERFORM public.notify_players(ARRAY[NEW.from_player, NEW.to_player], 'paid', 'Paid: ' || v_from || ' to ' || v_to || ', ' || v_amount,
        'Marked by the commissioner. Check Settle up in The Bookie.', v_url, v_tag);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'push_on_paid: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS zzz_push_on_paid ON public.bookie_payments;
CREATE TRIGGER zzz_push_on_paid
  AFTER INSERT ON public.bookie_payments
  FOR EACH ROW EXECUTE FUNCTION public.push_on_paid();

-- Tee times: everyone but the admin saving them, one banner however many rounds get saved in a row (same tag)
CREATE OR REPLACE FUNCTION public.push_on_tee_time()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_round text;
  v_time text;
BEGIN
  BEGIN
    IF TG_OP = 'UPDATE' AND NEW.tee_time IS NOT DISTINCT FROM OLD.tee_time AND NEW.note IS NOT DISTINCT FROM OLD.note THEN
      RETURN NULL;
    END IF;
    v_round := CASE WHEN NEW.round_key ~ '^r[0-9]+$' THEN 'Round ' || substr(NEW.round_key, 2)
                    WHEN NEW.round_key = 'practice' THEN 'The practice round'
                    WHEN NEW.round_key = 'sunday' THEN 'Sunday''s round'
                    ELSE initcap(NEW.round_key) END;
    v_time := ltrim(to_char(NEW.tee_time, 'HH12:MI AM'), '0');
    PERFORM public.notify_players(public.push_everyone_but(NULL), 'teetimes', 'Tee times are posted',
      v_round || ' tees off at ' || v_time || COALESCE(' (' || NEW.note || ')', '') || '. Check the schedule for the latest.', '/#schedule', 'teetimes');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'push_on_tee_time: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS zzz_push_on_tee_time ON public.trip_tee_times;
CREATE TRIGGER zzz_push_on_tee_time
  AFTER INSERT OR UPDATE ON public.trip_tee_times
  FOR EACH ROW EXECUTE FUNCTION public.push_on_tee_time();

-- The crew hears a player is In: the first time he says it (rsvps), or when the commissioner
-- approves a sign-up who had already said it (players)
CREATE OR REPLACE FUNCTION public.push_say_hello(p_player uuid, p_trip_year integer)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_in integer := public.push_in_count(p_trip_year);
BEGIN
  PERFORM public.notify_players(public.push_everyone_but(p_player), 'hello',
    public.push_first_name(p_player) || ' is in for ' || public.push_trip_label(),
    CASE WHEN v_in > 1 THEN 'That makes ' || v_in || ' in. Say hello.' ELSE 'Say hello.' END,
    '/#attendees', 'hello-' || p_player);
END;
$$;

-- Whoever holds a spot now and didn't before: "A spot opened up"
CREATE OR REPLACE FUNCTION public.push_spot_changes(p_before uuid[], p_after uuid[], p_except uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_moved uuid[];
BEGIN
  SELECT COALESCE(array_agg(x), '{}'::uuid[]) INTO v_moved
  FROM unnest(p_after) x
  WHERE NOT (x = ANY(p_before)) AND (p_except IS NULL OR x <> p_except);
  IF COALESCE(array_length(v_moved, 1), 0) > 0 THEN
    PERFORM public.notify_players(v_moved, 'spot', 'A spot opened up: you''re in',
      'You moved off the waitlist for ' || public.push_trip_label() || '. See your checklist.', '/#checklist', 'spot');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.push_on_rsvp()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
BEGIN
  BEGIN
    IF NEW.player_id IS NULL THEN RETURN NULL; END IF;
    SELECT COALESCE(p.status, 'confirmed') INTO v_status FROM public.players p WHERE p.id = NEW.player_id;
    -- A sign-up still waiting for approval holds no spot; approve_player's trigger below says hello then
    IF v_status IS DISTINCT FROM 'confirmed' THEN RETURN NULL; END IF;
    IF NEW.status = 'in' AND NOT EXISTS (
         SELECT 1 FROM public.rsvps r
         WHERE r.player_id = NEW.player_id AND r.trip_year = NEW.trip_year AND r.status = 'in' AND r.id <> NEW.id) THEN
      PERFORM public.push_say_hello(NEW.player_id, NEW.trip_year);
    END IF;
    PERFORM public.push_spot_changes(
      public.push_spot_holders(NEW.trip_year, NEW.id, NULL),
      public.push_spot_holders(NEW.trip_year, NULL, NULL),
      NEW.player_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'push_on_rsvp: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS zzz_push_on_rsvp ON public.rsvps;
CREATE TRIGGER zzz_push_on_rsvp
  AFTER INSERT ON public.rsvps
  FOR EACH ROW EXECUTE FUNCTION public.push_on_rsvp();

-- Approved: tell him, and if he'd already said In, tell the crew and whoever he moves
CREATE OR REPLACE FUNCTION public.push_on_player_status()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_year integer;
  v_latest text;
BEGIN
  BEGIN
    IF NOT (COALESCE(NEW.status, 'confirmed') = 'confirmed' AND COALESCE(OLD.status, 'confirmed') <> 'confirmed') THEN
      RETURN NULL;
    END IF;
    v_year := public.push_trip_year();
    PERFORM public.notify_players(ARRAY[NEW.id], 'approved', 'You''re on the roster',
      'The commissioner approved you. RSVP and add your handicap from your checklist.', '/#checklist', 'approved');
    SELECT r.status INTO v_latest FROM public.rsvps r
    WHERE r.player_id = NEW.id AND r.trip_year = v_year ORDER BY r.created_at DESC LIMIT 1;
    IF v_latest = 'in' THEN
      PERFORM public.push_say_hello(NEW.id, v_year);
    END IF;
    PERFORM public.push_spot_changes(
      public.push_spot_holders(v_year, NULL, NEW.id),
      public.push_spot_holders(v_year, NULL, NULL),
      NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'push_on_player_status: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;

-- A name's login changed (unlinked by the commissioner, or linked to someone else): the phones saved
-- under that name belonged to the old login, so they're forgotten. The new login turns them on again.
CREATE OR REPLACE FUNCTION public.push_forget_phones()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  BEGIN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      DELETE FROM public.push_subscriptions WHERE player_id = NEW.id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'push_forget_phones: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS zzz_push_forget_phones ON public.players;
CREATE TRIGGER zzz_push_forget_phones
  AFTER UPDATE OF user_id ON public.players
  FOR EACH ROW EXECUTE FUNCTION public.push_forget_phones();

DROP TRIGGER IF EXISTS zzz_push_on_player_status ON public.players;
CREATE TRIGGER zzz_push_on_player_status
  AFTER UPDATE OF status ON public.players
  FOR EACH ROW EXECUTE FUNCTION public.push_on_player_status();

-- Announcements: everyone, the commissioner included
CREATE OR REPLACE FUNCTION public.push_on_announcement()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  BEGIN
    PERFORM public.notify_players(public.push_everyone_but(NULL), 'announcement', NEW.title, NEW.body, NEW.url, 'announcement-' || NEW.id, true);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'push_on_announcement: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS zzz_push_on_announcement ON public.announcements;
CREATE TRIGGER zzz_push_on_announcement
  AFTER INSERT ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.push_on_announcement();

-- 5. What the site calls -------------------------------------------------------------------------
-- This phone, under the signed-in player (a confirmed name, or a new sign-up's own row). Saving
-- again refreshes it; a phone that changes hands moves to the new login.
CREATE OR REPLACE FUNCTION public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_player uuid;
  v_devices integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Log in first.' USING ERRCODE = '28000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.players WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Your login is not linked to a player yet.' USING ERRCODE = 'P0002';
  END IF;
  v_player := public.payments_my_player();
  IF v_player IS NULL THEN
    RAISE EXCEPTION 'Your roster name is waiting for the commissioner''s approval. You can turn on notifications once you''re approved.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.push_safe_endpoint(p_endpoint) OR NOT public.push_safe_key(p_p256dh, 300) OR NOT public.push_safe_key(p_auth, 100) THEN
    RAISE EXCEPTION 'That isn''t a valid subscription.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.push_subscriptions AS s (player_id, endpoint, p256dh, auth, user_agent, created_at, last_seen_at)
  VALUES (v_player, p_endpoint, p_p256dh, p_auth, NULLIF(left(btrim(COALESCE(p_user_agent, '')), 300), ''), now(), now())
  ON CONFLICT (endpoint) DO UPDATE
    SET player_id = EXCLUDED.player_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
        user_agent = EXCLUDED.user_agent, last_seen_at = now(), failed_at = NULL, fail_reason = NULL;

  -- At most 10 phones a player: the ones not seen longest go
  DELETE FROM public.push_subscriptions
  WHERE id IN (SELECT id FROM public.push_subscriptions WHERE player_id = v_player ORDER BY last_seen_at DESC OFFSET 10);

  SELECT count(*) INTO v_devices FROM public.push_subscriptions WHERE player_id = v_player AND failed_at IS NULL;
  RETURN jsonb_build_object('player_id', v_player, 'devices', v_devices);
END;
$$;

-- This phone, off
CREATE OR REPLACE FUNCTION public.delete_push_subscription(p_endpoint text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_player uuid;
  v_gone integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Log in first.' USING ERRCODE = '28000';
  END IF;
  v_player := public.payments_my_player();
  IF v_player IS NULL THEN
    RETURN false;
  END IF;
  DELETE FROM public.push_subscriptions WHERE endpoint = p_endpoint AND player_id = v_player;
  GET DIAGNOSTICS v_gone = ROW_COUNT;
  RETURN v_gone > 0;
END;
$$;

-- How many phones the signed-in player has on
CREATE OR REPLACE FUNCTION public.my_push_count()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT count(*)::integer FROM public.push_subscriptions s
  WHERE s.player_id = public.payments_my_player() AND s.failed_at IS NULL;
$$;

-- Which players have a phone on (The Bookie: "Kyle gets a notification"). Signed-in crew only.
CREATE OR REPLACE FUNCTION public.players_with_push()
RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.payments_crew() THEN
    RETURN '{}'::uuid[];
  END IF;
  RETURN public.push_everyone_but(NULL);
END;
$$;

-- Admin: { players_on, devices, players_total, names, waiting }. Counts only who can get them (the
-- crew); waiting is how many sign-ups still waiting for approval have turned them on (they start
-- getting them once approved).
CREATE OR REPLACE FUNCTION public.admin_push_summary()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_trip_admin() THEN
    RAISE EXCEPTION 'Admins only.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'players_on', (SELECT count(DISTINCT s.player_id) FROM public.push_subscriptions s WHERE s.failed_at IS NULL AND public.push_can_receive(s.player_id)),
    'devices', (SELECT count(*) FROM public.push_subscriptions s WHERE s.failed_at IS NULL AND public.push_can_receive(s.player_id)),
    'players_total', (SELECT count(*) FROM public.players p WHERE COALESCE(p.status, 'confirmed') = 'confirmed'),
    'names', (SELECT COALESCE(jsonb_agg(x.name ORDER BY x.name), '[]'::jsonb) FROM (
                SELECT DISTINCT p.name FROM public.push_subscriptions s JOIN public.players p ON p.id = s.player_id
                WHERE s.failed_at IS NULL AND public.push_can_receive(s.player_id)) x),
    'waiting', (SELECT count(DISTINCT s.player_id) FROM public.push_subscriptions s
                WHERE s.failed_at IS NULL AND NOT public.push_can_receive(s.player_id))
  );
END;
$$;

-- Admin: a test banner to the admin's own phones. Returns how many were queued (0: none turned on).
CREATE OR REPLACE FUNCTION public.admin_test_push()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid;
BEGIN
  IF NOT public.is_trip_admin() THEN
    RAISE EXCEPTION 'Admins only.' USING ERRCODE = '42501';
  END IF;
  v_me := public.push_actor();
  IF v_me IS NULL OR NOT EXISTS (SELECT 1 FROM public.players WHERE id = v_me AND user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Your login isn''t linked to a roster name, so there''s no phone to test.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.push_can_receive(v_me) THEN
    RAISE EXCEPTION 'Your roster name isn''t confirmed, and notifications only go to confirmed players. Approve it in Admin → RSVPs first.' USING ERRCODE = '42501';
  END IF;
  RETURN public.notify_players(ARRAY[v_me], 'test', 'Test from Bros before Boges',
    'Notifications are working on this phone.', '/', 'test-' || extract(epoch FROM clock_timestamp())::bigint, true);
END;
$$;

-- Admin: send an announcement to everyone with notifications on. Returns the row with recipients.
CREATE OR REPLACE FUNCTION public.admin_send_announcement(p_title text, p_body text, p_url text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_title text := left(regexp_replace(btrim(COALESCE(p_title, '')), '\s+', ' ', 'g'), 200);
  v_body text := NULLIF(left(regexp_replace(btrim(COALESCE(p_body, '')), '\s+', ' ', 'g'), 400), '');
  v_url text := NULLIF(btrim(COALESCE(p_url, '')), '');
  v_row public.announcements%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Log in first.' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_trip_admin() THEN
    RAISE EXCEPTION 'Admins only.' USING ERRCODE = '42501';
  END IF;
  IF v_title = '' THEN
    RAISE EXCEPTION 'Give it a title.' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_title) > 80 THEN
    RAISE EXCEPTION 'Keep the title to 80 characters.' USING ERRCODE = '22023';
  END IF;
  IF char_length(COALESCE(v_body, '')) > 200 THEN
    RAISE EXCEPTION 'Keep the message to 200 characters.' USING ERRCODE = '22023';
  END IF;
  IF v_url IS NULL THEN
    v_url := '/';
  ELSIF NOT public.push_safe_url(v_url) THEN
    RAISE EXCEPTION 'The link should be a page on the site, like /bookie or /#schedule.' USING ERRCODE = '22023';
  END IF;
  -- Two taps on Send within a minute: the first one stands
  SELECT * INTO v_row FROM public.announcements
  WHERE title = v_title AND body IS NOT DISTINCT FROM v_body AND created_at > now() - interval '1 minute'
  ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN to_jsonb(v_row) || jsonb_build_object('duplicate', true);
  END IF;
  INSERT INTO public.announcements (trip_year, title, body, url, created_by)
  VALUES (public.push_trip_year(), v_title, v_body, v_url, public.push_actor())
  RETURNING * INTO v_row;
  -- The trigger has queued the rows by now
  UPDATE public.announcements a
  SET recipients = (SELECT count(*) FROM public.notifications n WHERE n.tag = 'announcement-' || a.id)
  WHERE a.id = v_row.id
  RETURNING * INTO v_row;
  RETURN to_jsonb(v_row) || jsonb_build_object('duplicate', false);
END;
$$;

-- Admin: the last ones sent, newest first
CREATE OR REPLACE FUNCTION public.admin_announcements(p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_trip_admin() THEN
    RAISE EXCEPTION 'Admins only.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (
      SELECT a.id, a.title, a.body, a.url, a.recipients, a.created_at,
             (SELECT p.name FROM public.players p WHERE p.id = a.created_by) AS sent_by,
             (SELECT count(*) FROM public.notifications n WHERE n.tag = 'announcement-' || a.id AND n.sent_at IS NOT NULL) AS delivered
      FROM public.announcements a
      ORDER BY a.created_at DESC
      LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
    ) x), '[]'::jsonb);
END;
$$;

-- 6. Who may call what ---------------------------------------------------------------------------
-- The helpers and trigger functions: nobody from the site
REVOKE ALL ON FUNCTION public.push_safe_url(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_safe_endpoint(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_safe_key(text, integer) FROM PUBLIC, anon, authenticated;
-- The table checks above use these three, and api/push.js (the service role) updates those rows
GRANT EXECUTE ON FUNCTION public.push_safe_url(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.push_safe_endpoint(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.push_safe_key(text, integer) TO service_role;
REVOKE ALL ON FUNCTION public.push_actor() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_trip_year() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_trip_label() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_spots() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_first_name(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_everyone_but(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_can_receive(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_forget_phones() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_spot_holders(integer, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_in_count(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_players(uuid[], text, text, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_bet_players(public.wagers) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_money(numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_say_hello(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_spot_changes(uuid[], uuid[], uuid) FROM PUBLIC, anon, authenticated;

-- Signed-in players (each function refuses what it should inside)
REVOKE ALL ON FUNCTION public.save_push_subscription(text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_push_subscription(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_push_count() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.players_with_push() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_push_summary() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_test_push() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_send_announcement(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_announcements(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_push_subscription(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_push_subscription(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_push_count() TO authenticated;
GRANT EXECUTE ON FUNCTION public.players_with_push() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_push_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_test_push() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_send_announcement(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_announcements(integer) TO authenticated;

-- 7. Tell the API about the new functions right away --------------------------------------------
NOTIFY pgrst, 'reload schema';

-- 8. Check (read-only; the SQL editor shows this last result). Every row should say ok = true. ----
SELECT 'tables' AS check_name,
       COALESCE((SELECT bool_and(c.relrowsecurity) FROM pg_class c
                 WHERE c.oid IN (to_regclass('public.push_subscriptions'), to_regclass('public.notifications'), to_regclass('public.announcements'))), false)
       AND to_regclass('public.push_subscriptions') IS NOT NULL AND to_regclass('public.notifications') IS NOT NULL AND to_regclass('public.announcements') IS NOT NULL AS ok,
       'push_subscriptions, notifications, announcements exist with row security on' AS detail
UNION ALL
SELECT 'nobody reads them directly',
       NOT (has_table_privilege('anon', 'public.push_subscriptions', 'SELECT') OR has_table_privilege('authenticated', 'public.push_subscriptions', 'SELECT')
            OR has_table_privilege('anon', 'public.notifications', 'SELECT') OR has_table_privilege('authenticated', 'public.notifications', 'SELECT')
            OR has_table_privilege('authenticated', 'public.push_subscriptions', 'INSERT') OR has_table_privilege('authenticated', 'public.notifications', 'INSERT')
            OR has_table_privilege('authenticated', 'public.announcements', 'SELECT') OR has_table_privilege('authenticated', 'public.announcements', 'INSERT')),
       'only through the functions (and api/push.js with the service role)'
UNION ALL
SELECT 'api/push.js can read and stamp',
       has_table_privilege('service_role', 'public.notifications', 'UPDATE') AND has_table_privilege('service_role', 'public.push_subscriptions', 'DELETE'),
       'service role rights on notifications and push_subscriptions'
UNION ALL
SELECT 'nobody can queue a notification from the site',
       NOT has_function_privilege('authenticated', 'public.notify_players(uuid[], text, text, text, text, text, boolean)', 'EXECUTE'),
       'notify_players is internal'
UNION ALL
SELECT 'triggers',
       (SELECT count(*) FROM pg_trigger WHERE tgname IN ('zzz_push_on_wager', 'zzz_push_on_comment', 'zzz_push_on_paid', 'zzz_push_on_tee_time', 'zzz_push_on_rsvp', 'zzz_push_on_player_status', 'zzz_push_forget_phones', 'zzz_push_on_announcement') AND NOT tgisinternal) = 8,
       'wagers, wager_comments, bookie_payments, trip_tee_times, rsvps, players (status and login), announcements'
UNION ALL
SELECT 'player functions',
       bool_and(p.prosecdef AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND has_function_privilege('authenticated', p.oid, 'EXECUTE')),
       'save / delete subscription, my_push_count, players_with_push: signed in only'
FROM pg_proc p WHERE p.oid IN (to_regprocedure('public.save_push_subscription(text,text,text,text)'), to_regprocedure('public.delete_push_subscription(text)'),
                               to_regprocedure('public.my_push_count()'), to_regprocedure('public.players_with_push()'))
UNION ALL
SELECT 'admin functions',
       bool_and(p.prosecdef AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND has_function_privilege('authenticated', p.oid, 'EXECUTE')),
       'summary, test, send and list announcements: signed in only, and each refuses anyone who isn''t an admin'
FROM pg_proc p WHERE p.oid IN (to_regprocedure('public.admin_push_summary()'), to_regprocedure('public.admin_test_push()'),
                               to_regprocedure('public.admin_send_announcement(text,text,text)'), to_regprocedure('public.admin_announcements(integer)'))
UNION ALL
SELECT 'spots', public.push_spots() IS NOT DISTINCT FROM 20, 'push_spots() = ' || COALESCE(public.push_spots()::text, 'no cap') || ' (trip-config.js → rsvp.spots)'
UNION ALL
SELECT 'trip', public.push_trip_year() = 2027, public.push_trip_label() || ' (' || public.push_trip_year() || ')'
UNION ALL
SELECT 'phones on', true, (SELECT count(DISTINCT player_id) FROM public.push_subscriptions WHERE failed_at IS NULL) || ' players, '
       || (SELECT count(*) FROM public.push_subscriptions WHERE failed_at IS NULL) || ' phones (0 until someone turns them on)'
UNION ALL
SELECT 'webhook', true, 'not checked here: Supabase → Integrations → Database Webhooks → "push" on notifications INSERT → ' || 'https://bros-before-boges.vercel.app/api/push';
