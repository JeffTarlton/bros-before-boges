-- ============================================================
-- Bros before Boges — the notification bell (2027)
-- Order: 1. run this entire script once in the Supabase SQL Editor (after push_2027.sql and
--           messages_2027.sql, which have run). Safe to run again. The site that's live now keeps
--           working with it.
--        2. then push the site update with the bell (bell.js). Until this has run, the bell stays hidden.
-- ============================================================
-- What it does:
--   1. Every approved player gets every notification in the bell's list, phone or not (until now a
--      notification was only saved for players with a phone turned on). Phones get the banner as
--      before. notify_players and push_everyone_but change for that; push_2027.sql in the repo has
--      the same new versions, so re-running it doesn't undo this.
--   2. notifications.read_at: what's been seen in the bell.
--   3. What the bell calls, all for the signed-in player only (never anyone else's list):
--        my_notification_summary()      { crew, unread }: show the bell? and its count
--        my_notifications(limit, before, before_id) { items, more }: the last 30 days, newest first
--        mark_notifications_read(ids)    marks those (or, with none given, all) as seen
--        send_me_test_notification()     a test to yourself: { devices } (phones it went to);
--                                        at most 3 in 10 minutes
--   4. players_with_push (The Bookie: "Their phone got a notification") still counts phones only,
--      and admin_test_push now says how many phones the test went to.
--   5. Safer links (push_safe_url: no // or ./ ../ tricks), a deleted bet's notifications go with it,
--      a relinked name starts with an empty list, nobody gets more than 30 in 5 minutes, and a
--      notification for a player with no phone is stamped done at once (no call to Vercel).
--   The list keeps 30 days, as before.

-- 0. Checks first. If one fails the script stops here, before changing anything ---------------
DO $$
BEGIN
  IF to_regclass('public.notifications') IS NULL OR to_regprocedure('public.push_can_receive(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Run push_2027.sql first, then run this again. Nothing was changed.';
  END IF;
  IF to_regprocedure('public.payments_my_player()') IS NULL THEN
    RAISE EXCEPTION 'Run payments_2027.sql first, then run this again. Nothing was changed.';
  END IF;
END $$;

-- 1. Seen in the bell ----------------------------------------------------------------------------
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS read_at timestamptz;
CREATE INDEX IF NOT EXISTS notifications_player_unread_idx ON public.notifications (player_id) WHERE read_at IS NULL;

-- 2. Every approved player gets the notification (the bell); phones get the banner ----------------
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
  INSERT INTO public.notifications (player_id, kind, title, body, url, tag, sent_at, result)
  SELECT r.id, p_kind, left(btrim(p_title), 80), NULLIF(left(btrim(COALESCE(p_body, '')), 200), ''),
         CASE WHEN public.push_safe_url(p_url) THEN p_url ELSE '/' END, NULLIF(left(p_tag, 80), ''),
         -- No phone turned on: nothing to send, so it's stamped done now (api/push.js skips it)
         CASE WHEN r.phones THEN NULL ELSE now() END,
         CASE WHEN r.phones THEN NULL ELSE 'no devices' END
  FROM (SELECT DISTINCT x.id,
               EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.player_id = x.id AND s.failed_at IS NULL) AS phones
        FROM unnest(p_recipients) AS x(id)) r
  WHERE r.id IS NOT NULL
    AND r.id IS DISTINCT FROM v_actor
    -- The crew only (push_can_receive): a confirmed roster name linked to a login. Phone or not:
    -- the bell shows it either way, and api/push.js sends a banner to any phones that are on.
    AND public.push_can_receive(r.id)
    AND NOT (NULLIF(p_tag, '') IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.notifications n
          WHERE n.player_id = r.id AND n.tag = p_tag AND n.created_at > now() - interval '20 seconds'))
    -- Nobody's bell or phone gets more than 30 in 5 minutes, whatever anyone does
    AND (SELECT count(*) FROM public.notifications n
         WHERE n.player_id = r.id AND n.created_at > now() - interval '5 minutes') < 30;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Every approved player (the crew), except one (NULL: everyone): tee times, "<Name> is in", announcements
CREATE OR REPLACE FUNCTION public.push_everyone_but(p_except uuid)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(array_agg(p.id), '{}'::uuid[])
  FROM public.players p
  WHERE COALESCE(p.status, 'confirmed') = 'confirmed' AND p.user_id IS NOT NULL
    AND (p_except IS NULL OR p.id <> p_except);
$$;

-- Which players have a phone on (The Bookie: "Their phone got a notification"). Signed-in crew only.
CREATE OR REPLACE FUNCTION public.players_with_push()
RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.payments_crew() THEN
    RETURN '{}'::uuid[];
  END IF;
  RETURN COALESCE((SELECT array_agg(DISTINCT s.player_id) FROM public.push_subscriptions s
                   WHERE s.failed_at IS NULL AND public.push_can_receive(s.player_id)), '{}'::uuid[]);
END;
$$;

-- Admin's test: queued for his bell; returns how many of his phones it went to (0: none turned on)
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
  PERFORM public.notify_players(ARRAY[v_me], 'test', 'Test from Bros before Boges',
    'Notifications are working on this phone.', '/', 'test-' || extract(epoch FROM clock_timestamp())::bigint, true);
  RETURN (SELECT count(*)::integer FROM public.push_subscriptions WHERE player_id = v_me AND failed_at IS NULL);
END;
$$;

-- Links a notification may open: a page on this site, and nothing a browser could turn into
-- another site (bell.js shows them as links)
CREATE OR REPLACE FUNCTION public.push_safe_url(p_url text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT COALESCE(p_url, '') ~ '^/([^/\\[:space:][:cntrl:]][^\\[:space:][:cntrl:]]{0,198})?$'
     -- and nothing a browser could turn into "//other.site": no // anywhere, no ./ or ../ segments
     -- (also written %2e), which "/.//other.site" and "/a/..//other.site" would collapse into
     AND COALESCE(p_url, '') !~ '//'
     AND COALESCE(p_url, '') !~* '(^|/)(\.|%2e){1,2}(/|\?|#|$)';
$$;

-- A name's login changed: the old login's phones and bell list go
CREATE OR REPLACE FUNCTION public.push_forget_phones()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  BEGIN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      -- The old login's phones and its bell list go; the new login starts with neither
      DELETE FROM public.push_subscriptions WHERE player_id = NEW.id;
      DELETE FROM public.notifications WHERE player_id = NEW.id;
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

-- A bet that's deleted (a challenge pulled before anyone answered, an untouched pool) takes its
-- notifications with it: they'd only point at a bet that's gone
CREATE OR REPLACE FUNCTION public.push_on_wager_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  BEGIN
    DELETE FROM public.notifications WHERE tag = 'bet-' || OLD.id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'push_on_wager_delete: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS zzz_push_on_wager_delete ON public.wagers;
CREATE TRIGGER zzz_push_on_wager_delete
  AFTER DELETE ON public.wagers
  FOR EACH ROW EXECUTE FUNCTION public.push_on_wager_delete();

-- 3. What the bell calls -------------------------------------------------------------------------
-- { crew, unread }: crew false (signed out, waiting for approval, unlinked) means no bell
CREATE OR REPLACE FUNCTION public.my_notification_summary()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := public.payments_my_player();
BEGIN
  IF v_me IS NULL OR NOT public.push_can_receive(v_me) THEN
    RETURN jsonb_build_object('crew', false, 'unread', 0);
  END IF;
  RETURN jsonb_build_object('crew', true,
    'unread', (SELECT count(*) FROM public.notifications n
               WHERE n.player_id = v_me AND n.read_at IS NULL AND n.created_at > now() - interval '30 days'));
END;
$$;

-- The signed-in player's notifications from the last 30 days, newest first: { items: [{ id, kind, title,
-- body, url, created_at, read_at }], more }. p_before / p_before_id page back (the oldest one shown).
DROP FUNCTION IF EXISTS public.my_notifications(integer, timestamptz);
CREATE OR REPLACE FUNCTION public.my_notifications(p_limit integer DEFAULT 30, p_before timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := public.payments_my_player();
  v_lim integer := LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100);
  v_items jsonb;
  v_count integer;
BEGIN
  IF v_me IS NULL OR NOT public.push_can_receive(v_me) THEN
    RETURN jsonb_build_object('items', '[]'::jsonb, 'more', false);
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'title', x.title, 'body', x.body, 'url', x.url,
                                               'created_at', x.created_at, 'read_at', x.read_at) ORDER BY x.created_at DESC, x.id DESC), '[]'::jsonb),
         count(*)
    INTO v_items, v_count
  FROM (
    SELECT n.* FROM public.notifications n
    WHERE n.player_id = v_me
      AND n.created_at > now() - interval '30 days'
      -- the page before: older than the last one shown (ties on the same moment go by id)
      AND (p_before IS NULL OR n.created_at < p_before
           OR (p_before_id IS NOT NULL AND n.created_at = p_before AND n.id < p_before_id))
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT v_lim + 1
  ) x;
  -- One extra row says there's more; drop it (it's the oldest, last in the list)
  IF v_count > v_lim THEN
    v_items := v_items - (jsonb_array_length(v_items) - 1);
  END IF;
  RETURN jsonb_build_object('items', v_items, 'more', v_count > v_lim);
END;
$$;

-- Mark the signed-in player's notifications as seen: these ids, or every one when p_ids is NULL
CREATE OR REPLACE FUNCTION public.mark_notifications_read(p_ids uuid[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := public.payments_my_player();
  v_n integer;
BEGIN
  IF v_me IS NULL THEN
    RETURN 0;
  END IF;
  UPDATE public.notifications SET read_at = now()
  WHERE player_id = v_me AND read_at IS NULL AND (p_ids IS NULL OR id = ANY (p_ids));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- A test notification to yourself: in the bell, and as a banner on every phone you've turned on.
-- Returns { devices }. At most 3 in 10 minutes, so it can't be used to flood anything.
CREATE OR REPLACE FUNCTION public.send_me_test_notification()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Log in first.' USING ERRCODE = '28000';
  END IF;
  v_me := public.payments_my_player();
  IF v_me IS NULL OR NOT public.push_can_receive(v_me) THEN
    RAISE EXCEPTION 'Notifications open once the commissioner approves you.' USING ERRCODE = '42501';
  END IF;
  -- One test at a time per player, so the limit can't be raced
  PERFORM pg_advisory_xact_lock(hashtextextended('bbb_test_push:' || v_me, 0));
  IF (SELECT count(*) FROM public.notifications WHERE player_id = v_me AND kind = 'test' AND created_at > now() - interval '10 minutes') >= 3 THEN
    RAISE EXCEPTION 'That''s 3 tests in 10 minutes. Give it a few minutes, then try again.' USING ERRCODE = '54000';
  END IF;
  PERFORM public.notify_players(ARRAY[v_me], 'test', 'Test from Bros before Boges',
    'Notifications are working on this phone.', '/', 'test-' || extract(epoch FROM clock_timestamp())::bigint, true);
  RETURN jsonb_build_object('devices',
    (SELECT count(*) FROM public.push_subscriptions WHERE player_id = v_me AND failed_at IS NULL));
END;
$$;

-- 4. Who may call what ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.notify_players(uuid[], text, text, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_everyone_but(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.players_with_push() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_test_push() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_notification_summary() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_notifications(integer, timestamptz, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.push_forget_phones() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_on_wager_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_notifications_read(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.send_me_test_notification() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.players_with_push() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_test_push() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_notification_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_notifications(integer, timestamptz, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_me_test_notification() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- 5. Check (read-only; the SQL editor shows this last result). Every row should say ok = true. ----
SELECT 'seen column' AS check_name,
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'read_at') AS ok,
       'notifications.read_at' AS detail
UNION ALL
SELECT 'nobody reads notifications directly',
       NOT (has_table_privilege('anon', 'public.notifications', 'SELECT') OR has_table_privilege('authenticated', 'public.notifications', 'SELECT')
            OR has_table_privilege('authenticated', 'public.notifications', 'UPDATE')),
       'only through the bell''s functions, each for the signed-in player only'
UNION ALL
SELECT 'bell functions',
       bool_and(p.prosecdef AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND has_function_privilege('authenticated', p.oid, 'EXECUTE')),
       'summary, list, mark read, test: signed in only'
FROM pg_proc p WHERE p.oid IN (to_regprocedure('public.my_notification_summary()'), to_regprocedure('public.my_notifications(integer,timestamptz,uuid)'),
                               to_regprocedure('public.mark_notifications_read(uuid[])'), to_regprocedure('public.send_me_test_notification()'))
UNION ALL
SELECT 'nobody can queue a notification from the site',
       NOT has_function_privilege('authenticated', 'public.notify_players(uuid[], text, text, text, text, text, boolean)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public.push_everyone_but(uuid)', 'EXECUTE'),
       'notify_players and push_everyone_but are internal'
UNION ALL
SELECT 'clean-up triggers',
       (SELECT count(*) FROM pg_trigger WHERE tgname IN ('zzz_push_forget_phones', 'zzz_push_on_wager_delete') AND NOT tgisinternal) = 2,
       'a relinked name starts fresh; a deleted bet takes its notifications'
UNION ALL
SELECT 'links stay on the site',
       public.push_safe_url('/#schedule') AND NOT public.push_safe_url('/.//evil.example') AND NOT public.push_safe_url('/a/..//evil.example')
       AND NOT public.push_safe_url('/%2e//evil.example') AND NOT public.push_safe_url('//evil.example'),
       'push_safe_url refuses //, ./ and ../ tricks'
UNION ALL
SELECT 'the crew gets the bell',
       true,
       (SELECT count(*) FROM public.players WHERE COALESCE(status, 'confirmed') = 'confirmed' AND user_id IS NOT NULL)::text
       || ' approved players with a login; ' || (SELECT count(DISTINCT player_id) FROM public.push_subscriptions WHERE failed_at IS NULL)::text
       || ' with a phone on';
