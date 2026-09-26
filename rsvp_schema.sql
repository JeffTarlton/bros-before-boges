-- ============================================================
-- Bros Before Boges — RSVP / head count
-- Run this entire script once in the Supabase SQL Editor.
-- ============================================================
-- Every RSVP is a new row. The site counts each person's most recent
-- answer, so changing your RSVP just means submitting again. Visitors can
-- read and add RSVPs but can't edit or delete anyone's — clean up bad rows
-- from the Supabase table editor.

CREATE TABLE IF NOT EXISTS public.rsvps (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    trip_year integer NOT NULL DEFAULT 2027,
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 3 AND 60),
    status text NOT NULL CHECK (status IN ('in', 'maybe', 'out')),
    sunday_round boolean NOT NULL DEFAULT false,
    note text CHECK (note IS NULL OR char_length(note) <= 280)
);

CREATE INDEX IF NOT EXISTS rsvps_year_created_idx ON public.rsvps (trip_year, created_at);

ALTER TABLE public.rsvps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rsvps_public_read" ON public.rsvps;
CREATE POLICY "rsvps_public_read"
  ON public.rsvps FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "rsvps_public_insert" ON public.rsvps;
CREATE POLICY "rsvps_public_insert"
  ON public.rsvps FOR INSERT
  WITH CHECK (true);

-- Keep the optional note private: visitors can read every column except `note`
-- (you still see notes in the Supabase table editor and in the email alerts).
REVOKE SELECT ON public.rsvps FROM anon, authenticated;
GRANT SELECT (id, created_at, trip_year, name, status, sunday_round) ON public.rsvps TO anon, authenticated;
GRANT INSERT ON public.rsvps TO anon, authenticated;

-- Handy query for the commissioner: everyone's latest answer for 2027
-- SELECT DISTINCT ON (lower(btrim(name))) name, status, sunday_round, note, created_at
-- FROM public.rsvps WHERE trip_year = 2027
-- ORDER BY lower(btrim(name)), created_at DESC;
