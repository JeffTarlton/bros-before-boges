-- ============================================================
-- Bros Before Boges — keep player emails private (optional hardening)
-- Run once in the Supabase SQL Editor.
-- ============================================================
-- Right now anyone with the site's public key can read every column of
-- `players`, including email and is_admin. The public pages only need the
-- columns below. Logged-in users (Admin, The Bookie, Round Tracker) keep
-- full access because this only changes the anonymous role.
--
-- user_id stays readable because The Bookie checks it before sign-up.

REVOKE SELECT ON public.players FROM anon;
GRANT SELECT (id, name, ghin, handicap, team_id, status, user_id) ON public.players TO anon;

-- To undo:
-- GRANT SELECT ON public.players TO anon;
