-- Run this in the Supabase SQL Editor to add the 2027 Scottsdale courses to the
-- Round Tracker's course picker. Safe to run more than once (skips existing names).
-- Hole-by-hole pars are from each club's official scorecard.

INSERT INTO courses (name,
    h1_par, h2_par, h3_par, h4_par, h5_par, h6_par, h7_par, h8_par, h9_par,
    h10_par, h11_par, h12_par, h13_par, h14_par, h15_par, h16_par, h17_par, h18_par,
    total_par)
SELECT v.* FROM (VALUES
    -- Talking Stick Golf Club — O'odham (North), par 70
    ('Talking Stick - O''odham', 4, 5, 4, 4, 4, 3, 4, 3, 4,   4, 3, 4, 4, 4, 4, 3, 5, 4,   70),
    -- Talking Stick Golf Club — Piipaash (South), par 71. Backup only; uncomment if plans change.
    -- ('Talking Stick - Piipaash', 4, 4, 3, 4, 4, 4, 5, 4, 3,   4, 4, 4, 3, 5, 4, 5, 3, 4,   71),
    -- We-Ko-Pa Golf Club — Cholla, par 72
    ('We-Ko-Pa - Cholla',        4, 5, 3, 4, 3, 4, 4, 5, 4,   5, 3, 4, 4, 3, 4, 4, 5, 4,   72),
    -- We-Ko-Pa Golf Club — Saguaro, par 71
    ('We-Ko-Pa - Saguaro',       4, 4, 4, 5, 3, 4, 4, 5, 3,   4, 3, 4, 4, 5, 3, 4, 4, 4,   71),
    -- Camelback Golf Club — Ambiente, par 72 (final round). The club doesn't post a scorecard online;
    -- these pars match GolfPass and 18Birdies, and the yardages add up to USGA's 7,225 from the Blacks.
    ('Camelback - Ambiente',     4, 3, 5, 4, 4, 4, 5, 3, 4,   4, 3, 4, 4, 5, 3, 5, 4, 4,   72)
) AS v(name,
    h1_par, h2_par, h3_par, h4_par, h5_par, h6_par, h7_par, h8_par, h9_par,
    h10_par, h11_par, h12_par, h13_par, h14_par, h15_par, h16_par, h17_par, h18_par,
    total_par)
WHERE NOT EXISTS (SELECT 1 FROM courses c WHERE c.name = v.name);
