-- Run this in the Supabase SQL Editor to upgrade The Bookie to V2 --

-- 1. Add odds to wagers (American odds format like -110 or +150)
ALTER TABLE wagers ADD COLUMN IF NOT EXISTS odds integer DEFAULT 100;

-- 2. Update status constraint to include 'canceled' and 'push'
ALTER TABLE wagers DROP CONSTRAINT IF EXISTS wagers_status_check;
ALTER TABLE wagers ADD CONSTRAINT wagers_status_check CHECK (status IN ('proposed', 'open', 'active', 'settled', 'canceled', 'push'));

-- 3. Migrate from single winner_id to winner_ids array for Split Pots
ALTER TABLE wagers ADD COLUMN IF NOT EXISTS winner_ids jsonb DEFAULT '[]'::jsonb;
UPDATE wagers SET winner_ids = jsonb_build_array(winner_id) WHERE winner_id IS NOT NULL AND jsonb_array_length(winner_ids) = 0;

-- 4. Create wager_comments table for Trash Talk feature
CREATE TABLE IF NOT EXISTS wager_comments (
    id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    wager_id uuid REFERENCES wagers(id) ON DELETE CASCADE,
    player_id uuid REFERENCES players(id) ON DELETE CASCADE,
    message text NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Enable RLS on wager_comments
ALTER TABLE wager_comments ENABLE ROW LEVEL SECURITY;

-- Allow public read access (so anyone can view the trash talk on the board)
DROP POLICY IF EXISTS "Allow public read access to wager_comments" ON wager_comments;
CREATE POLICY "Allow public read access to wager_comments" 
  ON wager_comments FOR SELECT USING (true);

-- Allow authenticated users to insert their own comments
DROP POLICY IF EXISTS "Allow authenticated users to insert comments" ON wager_comments;
CREATE POLICY "Allow authenticated users to insert comments" 
  ON wager_comments FOR INSERT 
  WITH CHECK (
    auth.role() = 'authenticated' AND 
    player_id IN (SELECT id FROM players WHERE user_id = auth.uid())
  );
