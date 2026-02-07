-- Insert Confirmed Players
INSERT INTO players (name, ghin, handicap, status, team_id) VALUES
('Colby Gibson', NULL, 5.0, 'confirmed', NULL),
('Westin Tucker', NULL, 5.6, 'confirmed', NULL),
('Zac Taylor', NULL, 3.5, 'confirmed', NULL),
('Derrick Merchant', NULL, 10.0, 'confirmed', NULL),
('Jeff Tarlton', '2360395', 9.0, 'confirmed', NULL),
('Kelly Dennard', NULL, 8.4, 'confirmed', NULL),
('Dillon Griffin', NULL, 14.4, 'confirmed', NULL),
('Andy Mazzolini', NULL, 15.0, 'confirmed', NULL),
('Jayme McCall', NULL, 7.1, 'confirmed', NULL),
('David Owens', NULL, 9.3, 'confirmed', NULL),
('Parker Davidson', NULL, 8.0, 'confirmed', NULL),
('Tripp Harris', NULL, NULL, 'confirmed', NULL),
('Ty Buis', NULL, 17.0, 'confirmed', NULL);

-- Insert Courses (if needed, just in case)
-- Insert Courses (Idempotent)
INSERT INTO courses (name, h1_par, h2_par, h3_par, h4_par, h5_par, h6_par, h7_par, h8_par, h9_par, h10_par, h11_par, h12_par, h13_par, h14_par, h15_par, h16_par, h17_par, h18_par)
SELECT 'Ram Rock', 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4
WHERE NOT EXISTS (SELECT 1 FROM courses WHERE name = 'Ram Rock');

INSERT INTO courses (name, h1_par, h2_par, h3_par, h4_par, h5_par, h6_par, h7_par, h8_par, h9_par, h10_par, h11_par, h12_par, h13_par, h14_par, h15_par, h16_par, h17_par, h18_par)
SELECT 'Slick Rock', 4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4
WHERE NOT EXISTS (SELECT 1 FROM courses WHERE name = 'Slick Rock');

INSERT INTO courses (name, h1_par, h2_par, h3_par, h4_par, h5_par, h6_par, h7_par, h8_par, h9_par, h10_par, h11_par, h12_par, h13_par, h14_par, h15_par, h16_par, h17_par, h18_par)
SELECT 'Summit Rock', 4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4
WHERE NOT EXISTS (SELECT 1 FROM courses WHERE name = 'Summit Rock');
