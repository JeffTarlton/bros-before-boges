-- ============================================================
-- Bros before Boges — direct messages between players (2027)
-- Order: 1. push the site update first (messages.html, messages.js). Until this script has run,
--           the Messages page says "Messages are being set up".
--        2. run push_2027.sql first if it hasn't run (a new message notifies the other player
--           through it), then run this entire script once in the Supabase SQL Editor. Safe to run again.
-- ============================================================
-- What it does:
--   1. direct_messages: one row per message between two players. Nobody reads or writes it with
--      the site's key, signed in or not: only the functions below touch it, and every one of them
--      works out who's asking from the login itself (never from anything the page sends), so a
--      player can only ever read his own conversations and only ever send as himself.
--   2. Who can message: confirmed players linked to a login, to other confirmed players linked to
--      a login. New sign-ups waiting for the commissioner can't send or receive, so a stranger who
--      signs up can't message the crew. Admins get no way to read anyone's messages from the site.
--   3. Messages are plain text, up to 1,000 characters. Control characters are stripped. Sending is
--      capped (10 a minute, 300 a day per player) so nobody can flood the database, and the same
--      message twice within 10 seconds (a double tap) is saved once.
--   4. A new message tells the other player's phone (notify_players, push_2027.sql): "Kyle" and the
--      first 120 characters, opening the conversation. Several in a row from the same player
--      collapse into one banner.
--   5. The sender can delete (unsend) his own messages. Reading a conversation marks what the other
--      player sent as read, and the sender sees "Seen".
--   6. push_2027.sql's "<Name> is in" banner now opens a message to the new player ("Say hello").

-- 0. Checks first. If one fails the script stops here, before changing anything ---------------
DO $$
BEGIN
  IF to_regprocedure('public.payments_my_player()') IS NULL THEN
    RAISE EXCEPTION 'Run payments_2027.sql first, then run this again. Nothing was changed.';
  END IF;
  IF to_regprocedure('public.notify_players(uuid[], text, text, text, text, text, boolean)') IS NULL THEN
    RAISE EXCEPTION 'Run push_2027.sql first, then run this again. Nothing was changed.';
  END IF;
END $$;

-- 1. The table ---------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.direct_messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id    uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  body         text NOT NULL CONSTRAINT direct_messages_body_check CHECK (char_length(body) BETWEEN 1 AND 1000),
  created_at   timestamptz NOT NULL DEFAULT now(),
  read_at      timestamptz,
  CONSTRAINT direct_messages_two_players CHECK (sender_id <> recipient_id)
);
COMMENT ON TABLE public.direct_messages IS 'Messages between two players. Read and written only through the message functions (messages_2027.sql); never readable with the site''s key.';
CREATE INDEX IF NOT EXISTS direct_messages_pair_idx ON public.direct_messages
  (LEAST(sender_id, recipient_id), GREATEST(sender_id, recipient_id), created_at DESC);
CREATE INDEX IF NOT EXISTS direct_messages_sender_idx ON public.direct_messages (sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS direct_messages_unread_idx ON public.direct_messages (recipient_id) WHERE read_at IS NULL;

ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.direct_messages FROM PUBLIC, anon, authenticated;

-- 2. Internal helpers (not callable from the site) ----------------------------------------------
-- The signed-in player, when he may use messages: his own roster row, confirmed. Else NULL.
CREATE OR REPLACE FUNCTION public.dm_me()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p.id FROM public.players p
  WHERE p.id = public.payments_my_player() AND COALESCE(p.status, 'confirmed') = 'confirmed' AND p.user_id IS NOT NULL;
$$;

-- Someone who can be messaged: a confirmed roster name linked to a login
CREATE OR REPLACE FUNCTION public.dm_reachable(p_player uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.players p
                 WHERE p.id = p_player AND COALESCE(p.status, 'confirmed') = 'confirmed' AND p.user_id IS NOT NULL);
$$;

-- Raises the right message when the caller can't use messages
CREATE OR REPLACE FUNCTION public.dm_require_me()
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Log in to use messages.' USING ERRCODE = '28000';
  END IF;
  v_me := public.dm_me();
  IF v_me IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.players WHERE user_id = auth.uid()) THEN
      RAISE EXCEPTION 'Your login is not linked to a player yet.' USING ERRCODE = 'P0002';
    END IF;
    RAISE EXCEPTION 'Messages open once the commissioner approves you.' USING ERRCODE = '42501';
  END IF;
  RETURN v_me;
END;
$$;

-- Plain text, tidied: no control characters (tabs and line breaks stay), Windows line breaks made
-- plain, at most two blank lines in a row, no spaces at either end
CREATE OR REPLACE FUNCTION public.dm_clean(p_body text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT btrim(regexp_replace(
           regexp_replace(
             replace(COALESCE(p_body, ''), E'\r\n', E'\n'),
             '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F​-‏‪-‮⁦-⁩﻿]', '', 'g'),
           E'\n{3,}', E'\n\n', 'g'), E' \t\n');
$$;

CREATE OR REPLACE FUNCTION public.dm_json(m public.direct_messages, p_me uuid)
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  SELECT jsonb_build_object('id', m.id, 'from_me', m.sender_id = p_me, 'body', m.body,
                            'created_at', m.created_at, 'read_at', m.read_at);
$$;

-- 3. What the site calls -------------------------------------------------------------------------
-- Who you can message: [{ id, name }], everyone but you
CREATE OR REPLACE FUNCTION public.message_contacts()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := public.dm_require_me();
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) ORDER BY p.name)
    FROM public.players p
    WHERE p.id <> v_me AND COALESCE(p.status, 'confirmed') = 'confirmed' AND p.user_id IS NOT NULL
  ), '[]'::jsonb);
END;
$$;

-- Your conversations, newest first: [{ player_id, name, last_body, last_at, last_from_me, unread }]
CREATE OR REPLACE FUNCTION public.my_conversations()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := public.dm_require_me();
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'player_id', c.other, 'name', p.name, 'last_body', left(c.body, 120), 'last_at', c.created_at,
             'last_from_me', c.sender_id = v_me,
             'unread', (SELECT count(*) FROM public.direct_messages u
                        WHERE u.recipient_id = v_me AND u.sender_id = c.other AND u.read_at IS NULL))
           ORDER BY c.created_at DESC)
    FROM (
      SELECT DISTINCT ON (m.other) m.*
      FROM (SELECT d.*, CASE WHEN d.sender_id = v_me THEN d.recipient_id ELSE d.sender_id END AS other
            FROM public.direct_messages d
            WHERE d.sender_id = v_me OR d.recipient_id = v_me) m
      ORDER BY m.other, m.created_at DESC
    ) c
    JOIN public.players p ON p.id = c.other
  ), '[]'::jsonb);
END;
$$;

-- One conversation: { with: { id, name, reachable }, messages: [...oldest first], more }
-- p_before pages back through older messages (the created_at of the oldest one shown).
CREATE OR REPLACE FUNCTION public.my_messages(p_with uuid, p_before timestamptz DEFAULT NULL, p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := public.dm_require_me();
  v_lim integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_name text;
  v_rows jsonb;
  v_count integer;
BEGIN
  SELECT p.name INTO v_name FROM public.players p WHERE p.id = p_with AND p.id <> v_me;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'That player isn''t on the roster.' USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(jsonb_agg(public.dm_json(x, v_me) ORDER BY x.created_at), '[]'::jsonb), count(*)
    INTO v_rows, v_count
  FROM (
    SELECT d.* FROM public.direct_messages d
    WHERE ((d.sender_id = v_me AND d.recipient_id = p_with) OR (d.sender_id = p_with AND d.recipient_id = v_me))
      AND (p_before IS NULL OR d.created_at < p_before)
    ORDER BY d.created_at DESC
    LIMIT v_lim + 1
  ) x;
  -- One extra row tells us there's more; drop it (it's the oldest)
  IF v_count > v_lim THEN
    v_rows := v_rows - 0;
  END IF;
  RETURN jsonb_build_object('with', jsonb_build_object('id', p_with, 'name', v_name, 'reachable', public.dm_reachable(p_with)),
                            'messages', v_rows, 'more', v_count > v_lim);
END;
$$;

-- Send one. Returns the saved message (the earlier one, for a double tap).
CREATE OR REPLACE FUNCTION public.send_message(p_to uuid, p_body text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := public.dm_require_me();
  v_body text := public.dm_clean(p_body);
  v_row public.direct_messages%ROWTYPE;
BEGIN
  IF p_to IS NULL OR p_to = v_me THEN
    RAISE EXCEPTION 'Pick someone to message.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.dm_reachable(p_to) THEN
    RAISE EXCEPTION 'That player can''t get messages yet (no login, or waiting for the commissioner).' USING ERRCODE = '42501';
  END IF;
  IF v_body = '' THEN
    RAISE EXCEPTION 'Type a message first.' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_body) > 1000 THEN
    RAISE EXCEPTION 'Keep it to 1,000 characters.' USING ERRCODE = '22023';
  END IF;

  -- One send at a time per player, so the caps below can't be raced
  PERFORM pg_advisory_xact_lock(hashtextextended('bbb_dm_send:' || v_me, 0));

  SELECT * INTO v_row FROM public.direct_messages
  WHERE sender_id = v_me AND recipient_id = p_to AND body = v_body AND created_at > now() - interval '10 seconds'
  ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN public.dm_json(v_row, v_me) || jsonb_build_object('duplicate', true);
  END IF;
  IF (SELECT count(*) FROM public.direct_messages WHERE sender_id = v_me AND created_at > now() - interval '1 minute') >= 10 THEN
    RAISE EXCEPTION 'Slow down a little: that''s 10 messages in a minute. Try again shortly.' USING ERRCODE = '54000';
  END IF;
  IF (SELECT count(*) FROM public.direct_messages WHERE sender_id = v_me AND created_at > now() - interval '1 day') >= 300 THEN
    RAISE EXCEPTION 'That''s 300 messages today, the daily limit. Try again tomorrow.' USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.direct_messages (sender_id, recipient_id, body)
  VALUES (v_me, p_to, v_body)
  RETURNING * INTO v_row;
  RETURN public.dm_json(v_row, v_me) || jsonb_build_object('duplicate', false);
END;
$$;

-- What the other player sent you in this conversation is now read. Returns how many were marked.
CREATE OR REPLACE FUNCTION public.mark_messages_read(p_with uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := public.dm_require_me();
  v_n integer;
BEGIN
  UPDATE public.direct_messages SET read_at = now()
  WHERE recipient_id = v_me AND sender_id = p_with AND read_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- Unsend one of your own messages (gone for both of you). Its preview in the notification outbox goes
-- too; a banner already showing on the other player's phone can't be taken back.
CREATE OR REPLACE FUNCTION public.delete_message(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := public.dm_require_me();
  v_row public.direct_messages%ROWTYPE;
BEGIN
  DELETE FROM public.direct_messages WHERE id = p_id AND sender_id = v_me RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  DELETE FROM public.notifications
  WHERE player_id = v_row.recipient_id AND kind = 'message' AND tag = 'dm-' || v_row.sender_id
    AND btrim(body) = btrim(left(regexp_replace(v_row.body, '\s+', ' ', 'g'), 120));
  RETURN true;
END;
$$;

-- How many unread messages you have (0 for anyone who can't use messages, never an error: the
-- homepage and The Bookie ask on every visit)
CREATE OR REPLACE FUNCTION public.my_unread_messages()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT count(*)::integer FROM public.direct_messages
  WHERE recipient_id = public.dm_me() AND read_at IS NULL;
$$;

-- 4. Tell the other player's phone ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.push_on_message()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  BEGIN
    PERFORM public.notify_players(ARRAY[NEW.recipient_id], 'message', public.push_first_name(NEW.sender_id),
      left(regexp_replace(NEW.body, '\s+', ' ', 'g'), 120), '/messages?with=' || NEW.sender_id, 'dm-' || NEW.sender_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'push_on_message: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS zzz_push_on_message ON public.direct_messages;
CREATE TRIGGER zzz_push_on_message
  AFTER INSERT ON public.direct_messages
  FOR EACH ROW EXECUTE FUNCTION public.push_on_message();

-- "<Name> is in": the banner now opens a message to him (push_2027.sql's version opened the crew list)
CREATE OR REPLACE FUNCTION public.push_say_hello(p_player uuid, p_trip_year integer)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_in integer := public.push_in_count(p_trip_year);
BEGIN
  PERFORM public.notify_players(public.push_everyone_but(p_player), 'hello',
    public.push_first_name(p_player) || ' is in for ' || public.push_trip_label(),
    CASE WHEN v_in > 1 THEN 'That makes ' || v_in || ' in. Tap to say hello.' ELSE 'Tap to say hello.' END,
    CASE WHEN public.dm_reachable(p_player) THEN '/messages?with=' || p_player ELSE '/#attendees' END,
    'hello-' || p_player);
END;
$$;

-- 5. Who may call what ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.dm_me() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dm_reachable(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dm_require_me() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dm_clean(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dm_json(public.direct_messages, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_on_message() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_say_hello(uuid, integer) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.message_contacts() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_conversations() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_messages(uuid, timestamptz, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.send_message(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_messages_read(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_message(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_unread_messages() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.message_contacts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_conversations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_messages(uuid, timestamptz, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_message(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_messages_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_message(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_unread_messages() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- 6. Check (read-only; the SQL editor shows this last result). Every row should say ok = true. ----
SELECT 'table direct_messages' AS check_name,
       COALESCE((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass('public.direct_messages')), false) AS ok,
       'exists, row security on' AS detail
UNION ALL
SELECT 'nobody reads or writes it directly',
       NOT (has_table_privilege('anon', 'public.direct_messages', 'SELECT') OR has_table_privilege('authenticated', 'public.direct_messages', 'SELECT')
            OR has_table_privilege('anon', 'public.direct_messages', 'INSERT') OR has_table_privilege('authenticated', 'public.direct_messages', 'INSERT')
            OR has_table_privilege('authenticated', 'public.direct_messages', 'UPDATE') OR has_table_privilege('authenticated', 'public.direct_messages', 'DELETE')),
       'only through the message functions'
UNION ALL
SELECT 'player functions',
       bool_and(p.prosecdef AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND has_function_privilege('authenticated', p.oid, 'EXECUTE')),
       'contacts, conversations, messages, send, read, unsend, unread count: signed in only'
FROM pg_proc p WHERE p.oid IN (to_regprocedure('public.message_contacts()'), to_regprocedure('public.my_conversations()'),
                               to_regprocedure('public.my_messages(uuid,timestamptz,integer)'), to_regprocedure('public.send_message(uuid,text)'),
                               to_regprocedure('public.mark_messages_read(uuid)'), to_regprocedure('public.delete_message(uuid)'),
                               to_regprocedure('public.my_unread_messages()'))
UNION ALL
SELECT 'helpers are internal',
       NOT has_function_privilege('authenticated', 'public.dm_me()', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.dm_clean(text)', 'EXECUTE'),
       'dm_me, dm_reachable, dm_clean, dm_json'
UNION ALL
SELECT 'new messages notify', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'zzz_push_on_message' AND NOT tgisinternal), 'zzz_push_on_message on direct_messages'
UNION ALL
SELECT 'messages so far', true, (SELECT count(*) FROM public.direct_messages)::text;
