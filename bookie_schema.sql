-- Run this in the Supabase SQL Editor to update the database for The Bookie --

-- 1. Add user_id to players table to link auth accounts to roster players
ALTER TABLE players ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 1b. Allow authenticated users to claim their roster spot by updating the user_id
CREATE POLICY "Allow users to claim their roster spot" 
  ON players 
  FOR UPDATE 
  TO authenticated 
  USING (user_id IS NULL) 
  WITH CHECK (user_id = auth.uid());

-- 2. Create the wagers table
CREATE TABLE wagers (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  creator_id uuid REFERENCES players(id) ON DELETE CASCADE NOT NULL,
  target_id uuid REFERENCES players(id) ON DELETE SET NULL, 
  type text NOT NULL CHECK (type IN ('pool', 'h2h', 'main_event')),
  amount integer NOT NULL DEFAULT 0,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('proposed', 'open', 'active', 'settled', 'canceled')),
  participants jsonb DEFAULT '[]'::jsonb, -- Array of player IDs who bought in
  winner_id uuid REFERENCES players(id) ON DELETE SET NULL
);

-- Turn on Row Level Security (RLS)
ALTER TABLE wagers ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read wagers (since the app needs to display the board)
CREATE POLICY "Allow public read access to wagers" 
  ON wagers FOR SELECT 
  USING (true);

-- Allow authenticated users to insert new wagers
CREATE POLICY "Allow authenticated users to insert wagers" 
  ON wagers FOR INSERT 
  WITH CHECK (auth.role() = 'authenticated');

-- Allow authenticated users to update wagers (e.g. joining a pool or accepting a bet)
CREATE POLICY "Allow authenticated users to update wagers" 
  ON wagers FOR UPDATE
  TO authenticated 
  USING (true) 
  WITH CHECK (true);

-- Allow creator to delete open/proposed wagers if no one else has joined
CREATE POLICY "Allow creator to delete open wagers"
  ON wagers FOR DELETE
  TO authenticated
  USING (
    auth.uid() = creator_id AND (
      (type = 'h2h' AND status = 'proposed') OR
      (type = 'pool' AND jsonb_array_length(participants) <= 1)
    )
  );
