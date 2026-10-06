-- Run this in the Supabase SQL Editor to update the database for The Bookie --

-- 1. Add user_id to players table to link auth accounts to roster players
ALTER TABLE players ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 1b. Allow authenticated users to claim their roster spot by updating the user_id
DROP POLICY IF EXISTS "Allow users to claim their roster spot" ON players;
CREATE POLICY "Allow users to claim their roster spot" 
  ON players 
  FOR UPDATE 
  TO authenticated 
  USING (user_id IS NULL) 
  WITH CHECK (user_id = auth.uid());

-- 2. Create the wagers table
CREATE TABLE IF NOT EXISTS wagers (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  creator_id uuid REFERENCES players(id) ON DELETE CASCADE NOT NULL,
  target_id uuid REFERENCES players(id) ON DELETE SET NULL, 
  type text NOT NULL CHECK (type IN ('pool', 'h2h', 'prop', 'main_event')),
  amount integer NOT NULL DEFAULT 0,
  odds integer DEFAULT 100,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('proposed', 'open', 'active', 'settled', 'canceled', 'push')),
  participants jsonb DEFAULT '[]'::jsonb, -- Array of player IDs who bought in
  winner_id uuid REFERENCES players(id) ON DELETE SET NULL,
  winner_ids jsonb DEFAULT '[]'::jsonb
);

-- Turn on Row Level Security (RLS)
ALTER TABLE wagers ENABLE ROW LEVEL SECURITY;

-- NOTE (2027): reads are crew-only now. bookie_crew_read_2027.sql replaces this "public read" rule; if this
-- script is ever re-run, its crew-only rules still apply on top, but run bookie_crew_read_2027.sql again after it.
-- (Historical) Let anyone read wagers, back when the board was public
DROP POLICY IF EXISTS "Allow public read access to wagers" ON wagers;
CREATE POLICY "Allow public read access to wagers" 
  ON wagers FOR SELECT 
  USING (true);

-- Allow authenticated users to insert new wagers
DROP POLICY IF EXISTS "Allow authenticated users to insert wagers" ON wagers;
CREATE POLICY "Allow authenticated users to insert wagers" 
  ON wagers FOR INSERT 
  WITH CHECK (auth.role() = 'authenticated');

-- Allow authenticated users to update wagers (e.g. joining a pool or accepting a bet)
DROP POLICY IF EXISTS "Allow authenticated users to update wagers" ON wagers;
CREATE POLICY "Allow authenticated users to update wagers" 
  ON wagers FOR UPDATE
  TO authenticated 
  USING (true) 
  WITH CHECK (true);

-- Allow creator to delete open/proposed wagers if no one else has joined
DROP POLICY IF EXISTS "Allow creator to delete open wagers" ON wagers;
CREATE POLICY "Allow creator to delete open wagers"
  ON wagers FOR DELETE
  TO authenticated
  USING (
    creator_id IN (SELECT id FROM players WHERE user_id = auth.uid()) AND (
      (type = 'h2h' AND status = 'proposed') OR
      (type IN ('pool', 'prop') AND jsonb_array_length(participants) <= 1)
    )
  );

-- 3. Create wager_comments table
CREATE TABLE IF NOT EXISTS wager_comments (
    id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    wager_id uuid REFERENCES wagers(id) ON DELETE CASCADE,
    player_id uuid REFERENCES players(id) ON DELETE CASCADE,
    message text NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE wager_comments ENABLE ROW LEVEL SECURITY;

-- NOTE (2027): reads are crew-only now. bookie_crew_read_2027.sql replaces this "public read" rule; if this
-- script is ever re-run, its crew-only rules still apply on top, but run bookie_crew_read_2027.sql again after it.
DROP POLICY IF EXISTS "Allow public read access to wager_comments" ON wager_comments;
CREATE POLICY "Allow public read access to wager_comments" 
  ON wager_comments FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow authenticated users to insert comments" ON wager_comments;
CREATE POLICY "Allow authenticated users to insert comments" 
  ON wager_comments FOR INSERT 
  WITH CHECK (auth.role() = 'authenticated' AND player_id IN (SELECT id FROM players WHERE user_id = auth.uid()));
