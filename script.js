// Supabase Configuration - USER NEEDS TO FILL THESE IN
const SUPABASE_URL = 'https://gxpwgrdyizruzfczzqwn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uo20KpEYmGXAIB9JGL1CnQ_wIxT8GX4';

// Initialize Supabase Client (Defensive Pattern)
let supabaseInstance = null;
try {
    if (typeof supabase !== 'undefined' && SUPABASE_URL !== 'YOUR_SUPABASE_URL') {
        supabaseInstance = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    }
} catch (e) {
    console.error('Supabase initialization failed:', e);
}

// Trip Configuration Data
const tripData = {
    tripName: "Annual Bros before Boges",
    year: 2026,
    location: "Horseshoe Bay, Texas",
    accommodation: "Horseshoe Bay Resort",
    accommodationLink: "https://www.hsbresort.com/",
    dates: "April 9th - 13th, 2026",
    costs: {
        entryFee: 150,
        room: 806.50,
        rounds: 620.00, // 235 + 80 + 235 + 145
        totalEstimate: 1506.50
    },
    roster: {
        confirmed: [],
        potential: []
    },
    schedule: [
        {
            day: "Thursday",
            date: "April 9",
            title: "Arrival & Practice",
            details: "Practice round/travel day. Late afternoon or twilight at Austin CC or Spanish Oaks (TBD).",
            courses: []
        },
        {
            day: "Friday",
            date: "April 10",
            title: "Round 1 - The Grind",
            details: "Format: Two man teams (Points). 5 pts eagle, 3 pts birdie, 2 pts par, 1 pt bogie. Most points wins match.",
            courses: [{
                name: "Ram Rock",
                teeTime: "9:25 AM - 9:55 AM",
                image: "assets/ram_rock.png",
                description: "Known as 'The Challenger'. Deep bunkers and water hazards."
            }]
        },
        {
            day: "Friday",
            date: "April 10 (PM)",
            title: "Round 2 - The Turn",
            details: "Front 9: Captain's Choice Scramble (Match Play). Back 9: Modified Alternate Shot.",
            courses: [{
                name: "Slick Rock",
                teeTime: "2:50 PM - 3:20 PM",
                image: "assets/slick_rock.png",
                description: "Home of the famous 'Million Dollar Hole'."
            }]
        },
        {
            day: "Friday/Saturday",
            date: "Pre and Post-Round fun",
            title: "Lake Life",
            details: "Malibu Boat Session. Pre or Post round fun on the water.",
            courses: [{
                name: "The Malibu",
                teeTime: "TBD",
                image: "assets/course2.png", // Placeholder or upload a boat image if available
                description: "Wakesurfing and vibes."
            }]
        },
        {
            day: "Saturday",
            date: "April 11",
            title: "Final Round - Sunday Singles on Saturday",
            details: "Individual Head-to-Head Match Play. 1 pt for win, 0.5 for tie.",
            courses: [{
                name: "Summit Rock",
                teeTime: "9:40 AM - 10:10 AM",
                image: "assets/course3.jpg",
                description: "Jack Nicklaus Signature Course. (Pending Pro Approval)"
            }]
        },
        {
            day: "Sunday",
            date: "April 12",
            title: "MASTERS SUNDAY",
            details: "Watch the pros. Recovery.",
            courses: []
        },
        {
            day: "Monday",
            date: "April 13",
            title: "Departure",
            details: "Travel home day.",
            courses: []
        }
    ]
};

// DOM Element Registry (to be populated in init)
let elements = {};

// Initialization
async function init() {
    console.log('Site initializing...');
    try {
        // Map DOM elements safely
        elements = {
            tripYear: document.getElementById('trip-year'),
            tripLocation: document.getElementById('trip-location'),
            tripDates: document.getElementById('trip-dates'),
            tripAccommodation: document.getElementById('trip-accommodation'),
            costBreakdown: document.getElementById('cost-breakdown'),
            totalCost: document.getElementById('total-cost'),
            scheduleTimeline: document.getElementById('schedule-timeline'),
            confirmedRoster: document.getElementById('confirmed-roster'),
            potentialRoster: document.getElementById('potential-roster'),
            coursesGrid: document.getElementById('courses-grid'),
            footerYear: document.getElementById('footer-year'),
            menuToggle: document.querySelector('.menu-toggle'),
            mainNav: document.querySelector('.main-nav'),
            signupBtn: document.getElementById('signup-btn'),
            registrationModal: document.getElementById('registration-modal'),
            modalClose: document.getElementById('modal-close'),
            cancelBtn: document.getElementById('cancel-btn'),
            registrationForm: document.getElementById('registration-form'),
            leaderboardBtn: document.getElementById('leaderboard-btn'),
            startRoundBtn: document.getElementById('start-round-btn'),
            leaderboardModal: document.getElementById('leaderboard-modal'),
            leaderboardClose: document.getElementById('leaderboard-close'),
            roundLoginModal: document.getElementById('round-login-modal'),
            roundLoginClose: document.getElementById('round-login-close'),
            roundLoginSubmit: document.getElementById('round-login-submit'),
            dynamicLeaderboard: document.getElementById('dynamic-leaderboard'),
            teamSelectionDisplay: document.getElementById('team-selection-display')
        };

        // Render static details immediately
        renderTripDetails();
        renderSchedule();
        renderCourses();

        // Start loading roster data (async)
        loadRosterData().then(() => {
            renderDynamicScoreboard();
            renderTeamSelection();
        }).catch(err => {
            console.error('Data flow failed:', err);
            renderDynamicScoreboard(); // Attempt anyway
            renderTeamSelection();
        });

        setupEventListeners();
        console.log('Site initialization complete.');
    } catch (err) {
        console.error('CRITICAL: Site failed to initialize.', err);
    }
}

async function loadRosterData() {
    if (!supabaseInstance) {
        console.warn('Supabase not configured. Using empty roster.');
        renderRoster();
        return;
    }

    try {
        const { data, error } = await supabaseInstance
            .from('players')
            .select('*')
            .order('name');

        if (error) {
            console.error('Error fetching roster:', error);
            renderRoster();
            return;
        }

        if (data && data.length > 0) {
            // Reset arrays
            tripData.roster.confirmed = [];
            tripData.roster.potential = [];

            data.forEach(p => {
                if (p.status === 'confirmed') {
                    tripData.roster.confirmed.push({
                        id: p.id,
                        name: p.name,
                        ghin: p.ghin,
                        handicap: p.handicap !== null ? parseFloat(p.handicap) : null,
                        team_id: p.team_id
                    });
                } else if (p.status === 'potential') {
                    // Current renderRoster expects strings for potential players
                    tripData.roster.potential.push(p.name);
                }
            });
            renderRoster();
        } else {
            renderRoster();
        }
    } catch (e) {
        console.error('Roster fetch failed:', e);
        renderRoster();
    }
}

function renderTripDetails() {
    if (!elements.tripYear) return;

    elements.tripYear.textContent = tripData.year;
    elements.tripLocation.textContent = tripData.location;
    elements.tripDates.textContent = tripData.dates;

    if (tripData.accommodationLink) {
        elements.tripAccommodation.innerHTML = `<a href="${tripData.accommodationLink}" target="_blank" style="color: var(--accent-emerald); text-decoration: none; border-bottom: 1px dashed var(--accent-emerald);">${tripData.accommodation}</a>`;
    } else {
        elements.tripAccommodation.textContent = tripData.accommodation;
    }

    elements.footerYear.textContent = tripData.year;

    document.title = `${tripData.tripName} ${tripData.year}`;

    if (tripData.costs && elements.costBreakdown) {
        elements.costBreakdown.innerHTML = `
            <div class="cost-item">
                <span class="cost-label">Entry Fee</span>
                <span class="cost-value">$${tripData.costs.entryFee}</span>
            </div>
            <div class="cost-item">
                <span class="cost-label">Room (4 Nights)</span>
                <span class="cost-value">$${tripData.costs.room.toFixed(2)}</span>
            </div>
            <div class="cost-item">
                <span class="cost-label">Golf Rounds</span>
                <span class="cost-value">$${tripData.costs.rounds.toFixed(2)}</span>
            </div>
        `;
        elements.totalCost.textContent = `$${tripData.costs.totalEstimate.toFixed(2)}`;
    }
}

function renderSchedule() {
    if (!elements.scheduleTimeline) return;
    elements.scheduleTimeline.innerHTML = tripData.schedule.map((day, index) => `
        <div class="timeline-item">
            <div class="timeline-date">
                ${day.day}<br>${day.date}
            </div>
            <div class="timeline-content">
                <h3 class="timeline-title">${day.title}</h3>
                <p class="timeline-details">${day.details}</p>
                ${day.courses.map(course => `
                    <div class="timeline-course">
                        <strong>⛳ ${course.name}</strong>
                        ${course.teeTime ? `<span>⏰ ${course.teeTime}</span>` : ''}
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');
}

function renderCourses() {
    if (!elements.coursesGrid) return;
    const uniqueCourses = [
        {
            name: "Ram Rock",
            image: "assets/ram_rock.png",
            description: "Known as 'The Challenger'. Deep bunkers and water hazards.",
            stats: { par: 71, yards: 6926, rating: 75.6 }
        },
        {
            name: "Slick Rock",
            image: "assets/slick_rock.png",
            description: "Home of the famous 'Million Dollar Hole' waterfall.",
            stats: { par: 72, yards: 6834, rating: 72.8 }
        },
        {
            name: "Slick Rock or Summit Rock",
            image: "assets/course3.jpg",
            description: "Jack Nicklaus Signature Course. (Pending Pro Approval)",
            stats: { par: 72, yards: 7200, rating: 74.5 }
        }
    ];

    elements.coursesGrid.innerHTML = uniqueCourses.map(course => `
        <div class="course-card glass-panel">
            <div class="course-image">
                <img src="${course.image}" alt="${course.name}">
            </div>
            <div class="course-content">
                <h3 class="course-name">${course.name}</h3>
                <p class="course-description">${course.description}</p>
                <div class="course-stats">
                    <div>
                        <span class="stat-label">Par</span>
                        <span class="stat-value">${course.stats.par}</span>
                    </div>
                    <div>
                        <span class="stat-label">Yards</span>
                        <span class="stat-value">${course.stats.yards}</span>
                    </div>
                    <div>
                        <span class="stat-label">Rating</span>
                        <span class="stat-value">${course.stats.rating}</span>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

async function renderDynamicScoreboard() {
    if (!elements.dynamicLeaderboard) return;

    if (!supabaseInstance) {
        renderFallbackLeaderboard();
        return;
    }

    try {
        // Fetch players and their scores for the most recent active round
        const { data: activeRounds, error: roundError } = await supabaseInstance
            .from('rounds')
            .select('*')
            .eq('status', 'active')
            .order('date', { ascending: false })
            .limit(1);

        if (roundError || !activeRounds || activeRounds.length === 0) {
            renderFallbackLeaderboard();
            return;
        }

        const roundData = activeRounds[0];
        const roundId = roundData.id;
        const roundNumber = roundData.round_number || 1;

        const { data: scores, error: scoreError } = await supabaseInstance
            .from('scores')
            .select('*, players(*)')
            .eq('round_id', roundId);

        if (scoreError || !scores) {
            renderFallbackLeaderboard();
            return;
        }

        // Fetch course data for this round to get pars
        const { data: courses, error: courseError } = await supabaseInstance
            .from('courses')
            .select('*')
            .eq('id', roundData.course_id);

        const course = courses && courses[0] ? courses[0] : null;

        // Calculate Points/Ranking based on round format
        const leaderboardData = scores.map(s => {
            let points = 0;
            if (roundNumber === 1 && course) {
                // Round 1: Stableford Points logic
                for (let i = 1; i <= 18; i++) {
                    const holeScore = s[`h${i}`];
                    const par = course[`h${i}_par`] || 4; // Fallback to 4
                    if (holeScore !== null) {
                        const diff = holeScore - par;
                        if (diff <= -2) points += 5; // Eagle or better
                        else if (diff === -1) points += 3; // Birdie
                        else if (diff === 0) points += 2; // Par
                        else if (diff === 1) points += 1; // Bogey
                    }
                }
            } else {
                points = s.total_to_par || 0;
            }
            return { ...s, calculationPoints: points };
        });

        // Sort: R1 by high points, others by low to par
        const sortedScores = leaderboardData.sort((a, b) => {
            if (roundNumber === 1) return b.calculationPoints - a.calculationPoints;
            return (a.total_to_par || 0) - (b.total_to_par || 0);
        });

        // Team Standings
        const team1Score = leaderboardData.filter(s => s.players.team_id === 1).reduce((acc, s) => acc + s.calculationPoints, 0);
        const team2Score = leaderboardData.filter(s => s.players.team_id === 2).reduce((acc, s) => acc + s.calculationPoints, 0);

        elements.dynamicLeaderboard.innerHTML = `
            <div class="m-board-header">
                <div class="m-board-title">Round ${roundNumber} - ${getRoundFormat(roundNumber)}</div>
                <div class="team-summary" style="display: flex; gap: 20px; font-weight: 800; font-size: 1.1rem;">
                    <span style="color: #1a4a1a;">TEAM 1: ${roundNumber === 1 ? team1Score : formatToPar(team1Score)}</span>
                    <span style="color: #a11;">TEAM 2: ${roundNumber === 1 ? team2Score : formatToPar(team2Score)}</span>
                </div>
            </div>
            <table class="m-table">
                <thead>
                    <tr>
                        <th>Pos</th>
                        <th class="m-row-player">Player</th>
                        <th>Team</th>
                        <th>Thru</th>
                        <th>${roundNumber === 1 ? 'Points' : 'To Par'}</th>
                        <th>Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${sortedScores.map((s, index) => `
                        <tr>
                            <td>${index + 1}</td>
                            <td class="m-row-player">${s.players.name}</td>
                            <td>${s.players.team_id || '-'}</td>
                            <td>${getThruHoles(s)}</td>
                            <td class="${roundNumber === 1 ? '' : getScoreClass(s.total_to_par)}">
                                ${roundNumber === 1 ? s.calculationPoints : formatToPar(s.total_to_par)}
                            </td>
                            <td>${s.total_score || '-'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch (err) {
        console.error('Leaderboard render failed:', err);
        renderFallbackLeaderboard();
    }
}

function renderFallbackLeaderboard() {
    // Show confirmed players ranked by handicap
    const sortedRoster = [...tripData.roster.confirmed].sort((a, b) => {
        if (a.handicap === null) return 1;
        if (b.handicap === null) return -1;
        return a.handicap - b.handicap;
    });

    elements.dynamicLeaderboard.innerHTML = `
        <div class="m-board-header">
            <div class="m-board-title">Confirmed Players - Pre-Tournament Rankings</div>
            <div style="color: var(--text-muted); font-size: 0.8rem;">Ranked by Handicap</div>
        </div>
        <table class="m-table">
            <thead>
                <tr>
                    <th>Rank</th>
                    <th class="m-row-player">Player</th>
                    <th>Handicap</th>
                    <th>GHIN</th>
                </tr>
            </thead>
            <tbody>
                ${sortedRoster.map((player, index) => `
                    <tr>
                        <td>${index + 1}</td>
                        <td class="m-row-player">${player.name}</td>
                        <td>${player.handicap !== null ? player.handicap : 'N/A'}</td>
                        <td>${player.ghin || 'Missing'}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function getThruHoles(score) {
    let thru = 0;
    for (let i = 1; i <= 18; i++) {
        if (score[`h${i}`] !== null) thru++;
    }
    return thru === 0 ? '-' : thru === 18 ? 'F' : thru;
}

function formatToPar(val) {
    if (val === 0) return 'E';
    if (val > 0) return `+${val}`;
    return val;
}

function getScoreClass(val) {
    if (val === 0) return 'm-score-even';
    if (val < 0) return 'm-score-under';
    return 'm-score-over';
}

function getRoundFormat(num) {
    switch (num) {
        case 1: return "The Grind (Stableford)";
        case 2: return "The Turn (Match Play)";
        case 3: return "Championship Saturday";
        default: return "Stroke Play";
    }
}

function renderRoster() {
    if (!elements.confirmedRoster) return;
    elements.confirmedRoster.innerHTML = tripData.roster.confirmed.map(player => `
        <div class="attendee-card glass-panel">
            <div class="attendee-avatar">
                <span>${getInitials(player.name)}</span>
            </div>
            <h4 class="attendee-name">${player.name}</h4>
            <div style="margin-top: 10px; font-size: 0.85rem; color: var(--text-muted);">
                <p>GHIN: ${player.ghin || 'Missing'}</p>
                <p style="color: var(--accent-emerald); font-weight: 700;">HCP: ${player.handicap !== null ? player.handicap : 'N/A'}</p>
            </div>
        </div>
    `).join('');

    if (elements.potentialRoster) {
        elements.potentialRoster.innerHTML = tripData.roster.potential.map(name => `
            <div class="potential-badge glass-panel" style="padding: 10px 20px; border-radius: 99px; font-size: 0.9rem; color: var(--text-muted);">${name}</div>
        `).join('');
    }
}

function renderTeamSelection() {
    if (!elements.teamSelectionDisplay) return;

    // Filter for players with handicaps and sort them
    const squad = tripData.roster.confirmed
        .filter(p => p.handicap !== null)
        .sort((a, b) => a.handicap - b.handicap);

    if (squad.length === 0) {
        elements.teamSelectionDisplay.innerHTML = `<div class="glass-panel" style="padding: 40px; text-align: center; color: var(--text-muted);">No confirmed players with handicaps found.</div>`;
        return;
    }

    const team1 = [];
    const team2 = [];

    // Apply Snake Draft Logic (1, 3, 6 pattern)
    // Rank 1 -> T1, Rank 2/3 -> T2, Rank 4/5 -> T1, Rank 6/7 -> T2...
    squad.forEach((player, index) => {
        const rank = index + 1;
        // Logic: 1 (T1), 2&3 (T2), 4&5 (T1), 6&7 (T2)...
        // This is essentially: if (rank % 4 === 1 || rank % 4 === 0) -> T1?
        // Let's re-verify: 1 (1%4=1), 2 (2%4=2), 3 (3%4=3), 4 (4%4=0), 5 (5%4=1), 6 (6%4=2), 7 (7%4=3), 8 (8%4=0)
        // Values: T1: 1, 4, 5, 8, 9, 12...
        // T2: 2, 3, 6, 7, 10, 11...
        // The pattern for T1 is: rank % 4 is 1 or 0.
        if (rank % 4 === 1 || rank % 4 === 0) {
            team1.push(player);
        } else {
            team2.push(player);
        }
    });

    const renderTeamList = (team, teamNum) => `
        <div class="glass-panel team-card" style="padding: 30px;">
            <h3 style="color: ${teamNum === 1 ? 'var(--accent-emerald)' : '#ef4444'}; margin-bottom: 25px; display: flex; justify-content: space-between; align-items: center;">
                TEAM ${teamNum}
                <span style="font-size: 0.8rem; background: rgba(255,255,255,0.05); padding: 5px 12px; border-radius: 99px; color: var(--text-muted);">
                    Avg HCP: ${(team.reduce((acc, p) => acc + p.handicap, 0) / team.length).toFixed(1)}
                </span>
            </h3>
            <div style="display: flex; flex-direction: column; gap: 12px;">
                ${team.map(p => `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 15px; background: rgba(255,255,255,0.02); border-radius: 12px; border: 1px solid rgba(255,255,255,0.05);">
                        <span style="font-weight: 600;">${p.name}</span>
                        <span style="color: var(--accent-emerald); font-weight: 800; font-family: monospace;">${p.handicap.toFixed(1)}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    elements.teamSelectionDisplay.innerHTML = `
        ${renderTeamList(team1, 1)}
        ${renderTeamList(team2, 2)}
    `;
}

function getInitials(name) {
    if (!name) return '??';
    return name.split(' ').map(n => n[0]).join('');
}

function setupEventListeners() {
    if (elements.menuToggle) {
        elements.menuToggle.addEventListener('click', () => {
            elements.mainNav.classList.toggle('active');
        });
    }

    document.querySelectorAll('.main-nav a').forEach(link => {
        link.addEventListener('click', () => {
            if (elements.mainNav) elements.mainNav.classList.remove('active');
        });
    });

    if (elements.signupBtn) elements.signupBtn.addEventListener('click', openModal);
    if (elements.modalClose) elements.modalClose.addEventListener('click', closeModal);
    if (elements.cancelBtn) elements.cancelBtn.addEventListener('click', closeModal);

    if (elements.leaderboardBtn) {
        elements.leaderboardBtn.addEventListener('click', () => {
            elements.leaderboardModal.classList.add('active');
            renderDynamicScoreboard();
        });
    }

    if (elements.leaderboardClose) {
        elements.leaderboardClose.addEventListener('click', () => {
            elements.leaderboardModal.classList.remove('active');
        });
    }

    if (elements.startRoundBtn) {
        elements.startRoundBtn.addEventListener('click', () => {
            elements.roundLoginModal.classList.add('active');
        });
    }

    if (elements.roundLoginClose) {
        elements.roundLoginClose.addEventListener('click', () => {
            elements.roundLoginModal.classList.remove('active');
        });
    }

    if (elements.roundLoginSubmit) {
        elements.roundLoginSubmit.addEventListener('click', handleRoundLogin);
    }

    if (elements.registrationModal) {
        elements.registrationModal.addEventListener('click', (e) => {
            if (e.target === elements.registrationModal) {
                closeModal();
            }
        });
    }

    if (elements.registrationForm) elements.registrationForm.addEventListener('submit', handleFormSubmit);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
            if (elements.leaderboardModal) elements.leaderboardModal.classList.remove('active');
            if (elements.roundLoginModal) elements.roundLoginModal.classList.remove('active');
        }
    });
}

function openModal() {
    if (elements.registrationModal) elements.registrationModal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    if (elements.registrationModal) elements.registrationModal.classList.remove('active');
    document.body.style.overflow = '';
    if (elements.registrationForm) elements.registrationForm.reset();
}

function handleFormSubmit(e) {
    e.preventDefault();
    const formData = new FormData(elements.registrationForm);
    const firstName = (formData.get('firstName') || '').trim();
    const lastName = (formData.get('lastName') || '').trim();
    const ghinNumber = (formData.get('ghinNumber') || '').trim();
    const handicap = formData.get('handicap');
    const password = formData.get('password');

    const correctPassword = 'golftrip'; // Reverting to original or keeping consistent
    if (password !== correctPassword) {
        alert('❌ Incorrect password. Please contact the trip organizer for the registration password.');
        return;
    }

    const newPlayer = {
        name: `${firstName} ${lastName}`,
        ghin: ghinNumber || null,
        handicap: handicap ? parseFloat(handicap) : null
    };

    sendEmailNotification(newPlayer);
    saveToSupabase(newPlayer);
    tripData.roster.confirmed.push(newPlayer);

    renderRoster();
    renderDynamicScoreboard();
    alert(`Welcome to the trip, ${newPlayer.name}! 🏌️‍♂️`);
    closeModal();
    const attendeeSection = document.getElementById('attendees');
    if (attendeeSection) attendeeSection.scrollIntoView({ behavior: 'smooth' });
}

async function handleRoundLogin() {
    const email = document.getElementById('round-email').value;
    const password = document.getElementById('round-password').value;
    const errorEl = document.getElementById('round-login-error');

    if (!supabaseInstance) {
        alert('Supabase not configured. Check script.js');
        return;
    }

    try {
        const { data, error } = await supabaseInstance.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) {
            errorEl.textContent = error.message;
            errorEl.style.display = 'block';
        } else {
            // Redirect to round tracker
            window.location.href = 'round_tracker.html';
        }
    } catch (err) {
        errorEl.textContent = 'An unexpected error occurred.';
        errorEl.style.display = 'block';
    }
}

async function saveToSupabase(player) {
    if (!supabaseInstance) return;
    try {
        await supabaseInstance.from('players').insert([{
            name: player.name,
            ghin: player.ghin,
            handicap: player.handicap,
            status: 'confirmed'
        }]);
    } catch (err) {
        console.error('Failed to save to Supabase:', err);
    }
}

function sendEmailNotification(player) {
    fetch('https://formsubmit.co/ajax/westin.tucker@gmail.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
            name: player.name,
            ghin: player.ghin || 'Not provided',
            handicap: player.handicap !== null ? player.handicap : 'Not provided',
            _subject: 'New Bros before Boges Registration'
        })
    }).catch(error => console.error('Error sending email:', error));
}

// Global initialization
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
