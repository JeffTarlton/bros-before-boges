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
            details: "On Thursday's arrival practice we have lined up two tee times. 2:00pm and 2:10pm at Summit Rock (Private Course).",
            courses: [{
                name: "Summit Rock",
                teeTime: "2:00 PM & 2:10 PM",
                image: "assets/course3.jpg",
                description: "Private Course"
            }]
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
            day: "Friday/Saturday/Sunday",
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
            teamSelectionDisplay: document.getElementById('team-selection-display'),
            lightboxModal: document.getElementById('lightbox-modal'),
            lightboxImage: document.getElementById('lightbox-image'),
            lightboxClose: document.getElementById('lightbox-close')
        };

        // Render static details immediately
        renderTripDetails();
        renderSchedule();
        renderCourses();
        initCountdown();
        initScrollAnimations();

        // Start loading roster data (async)
        loadRosterData().then(() => {
            fetchRyderCupScores();
            renderTeamSelection();
        }).catch(err => {
            console.error('Data flow failed:', err);
            fetchRyderCupScores(); // Attempt anyway
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
                    tripData.roster.potential.push(p.name);
                }
            });
            renderRoster();
            
            // Render the Live Team Scoreboard Widget once players are loaded
            fetchRyderCupScores();

        } else {
            renderRoster();
        }
    } catch (e) {
        console.error('Roster fetch failed:', e);
        renderRoster();
    }
}

async function fetchRyderCupScores() {
    if (!supabaseInstance) return;

    try {
        const { data, error } = await supabaseInstance
            .from('ryder_cup_scores')
            .select('*')
            .eq('id', 1)
            .single();

        if (error && error.code !== 'PGRST116') throw error;

        let bluePoints = 0;
        let redPoints = 0;

        if (data) {
            bluePoints = data.blue_score;
            redPoints = data.red_score;
        }

        // --- 1. Update the Legacy Top Nav Widget (If present) ---
        const scoreboardWidget = document.getElementById('team-scoreboard-widget');
        const scoreTeam1El = document.getElementById('score-team-1');
        const scoreTeam2El = document.getElementById('score-team-2');

        if (scoreboardWidget && scoreTeam1El && scoreTeam2El) {
            scoreboardWidget.classList.remove('team-scoreboard-hidden');
            scoreTeam1El.textContent = bluePoints;
            scoreTeam2El.textContent = redPoints;
        }

        // --- 2. Update the New Main Event Core Scoreboard ---
        const homeBluePts = document.getElementById('home-ryder-blue-pts');
        const homeRedPts = document.getElementById('home-ryder-red-pts');

        if (homeBluePts && homeRedPts) {
            homeBluePts.textContent = bluePoints;
            homeRedPts.textContent = redPoints;
        }

    } catch (e) {
        console.error('Error fetching global Ryder Cup scores:', e);
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

function initCountdown() {
    const targetDate = new Date("April 9, 2026 14:00:00 CST").getTime();
    
    const daysEl = document.getElementById('cd-days');
    const hoursEl = document.getElementById('cd-hours');
    const minsEl = document.getElementById('cd-mins');
    const secsEl = document.getElementById('cd-secs');

    if (!daysEl || !hoursEl || !minsEl || !secsEl) return;

    function updateTimer() {
        const now = new Date().getTime();
        const distance = targetDate - now;

        if (distance < 0) {
            daysEl.textContent = "00";
            hoursEl.textContent = "00";
            minsEl.textContent = "00";
            secsEl.textContent = "00";
            return;
        }

        const days = Math.floor(distance / (1000 * 60 * 60 * 24));
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);

        daysEl.textContent = days.toString().padStart(2, '0');
        hoursEl.textContent = hours.toString().padStart(2, '0');
        minsEl.textContent = minutes.toString().padStart(2, '0');
        secsEl.textContent = seconds.toString().padStart(2, '0');
    }

    updateTimer(); // run immediately
    setInterval(updateTimer, 1000);
}

function renderSchedule() {
    if (!elements.scheduleTimeline) return;
    
    // Check if we are on mobile to auto-collapse
    const isMobile = window.innerWidth <= 768;

    elements.scheduleTimeline.innerHTML = tripData.schedule.map((day, index) => {
        // First item open on desktop, all collapsed on mobile
        const isOpen = isMobile ? false : index === 0; 
        return `
        <div class="timeline-item ${isOpen ? 'open' : ''}">
            <div class="timeline-date">
                ${day.day}<br>${day.date}
            </div>
            <div class="timeline-card glass-panel" style="flex: 1; padding: 0; overflow: hidden; border-radius: 16px;">
                <div class="timeline-header" style="padding: 20px 30px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02); border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <h3 class="timeline-title" style="margin: 0;">${day.title}</h3>
                    <span class="accordion-icon" style="transition: transform 0.3s ease; font-size: 1.2rem; color: var(--accent-emerald);">▼</span>
                </div>
                <div class="timeline-content-wrapper" style="display: ${isOpen ? 'block' : 'none'}; padding: 30px; border-top: 1px solid rgba(255,255,255,0.05);">
                    <p class="timeline-details">${day.details}</p>
                    <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 20px;">
                        ${day.courses.map(course => `
                            <div class="timeline-course">
                                <strong>⛳ ${course.name}</strong>
                                ${course.teeTime ? `<span style="margin-left: auto;">⏰ ${course.teeTime}</span>` : ''}
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        </div>
    `}).join('');

    // Attach click listeners for the accordion effect
    setTimeout(() => {
        const headers = elements.scheduleTimeline.querySelectorAll('.timeline-header');
        headers.forEach(header => {
            header.addEventListener('click', function() {
                const item = this.closest('.timeline-item');
                const content = item.querySelector('.timeline-content-wrapper');
                const icon = item.querySelector('.accordion-icon');
                
                const isOpen = item.classList.contains('open');
                
                if (isOpen) {
                    content.style.display = 'none';
                    icon.style.transform = 'rotate(0deg)';
                    item.classList.remove('open');
                } else {
                    content.style.display = 'block';
                    icon.style.transform = 'rotate(180deg)';
                    item.classList.add('open');
                }
            });
        });
        
        // Ensure starting rotation is correct for pre-opened items
        elements.scheduleTimeline.querySelectorAll('.timeline-item.open .accordion-icon').forEach(icon => {
            icon.style.transform = 'rotate(180deg)';
        });
    }, 0);
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
        // 1. Fetch player_round_scores (admin-entered data)
        const { data: roundScores, error: rsErr } = await supabaseInstance
            .from('player_round_scores')
            .select('*, players(id, name, team_id, handicap)')
            .order('round_number');

        // 2. Fetch the Ryder Cup match score
        const { data: ryderData, error: ryderErr } = await supabaseInstance
            .from('ryder_cup_scores')
            .select('*')
            .eq('id', 1)
            .single();

        if (rsErr) throw rsErr;

        // If no manual scores at all yet, fall back to roster-based leaderboard
        if (!roundScores || roundScores.length === 0) {
            renderFallbackLeaderboard();
            return;
        }

        const blueScore = ryderData ? ryderData.blue_score : 0;
        const redScore = ryderData ? ryderData.red_score : 0;

        // Group scores by round
        const roundMap = {};
        roundScores.forEach(s => {
            if (!roundMap[s.round_number]) roundMap[s.round_number] = [];
            roundMap[s.round_number].push(s);
        });

        // Course Pars Configuration
        const RamRockPars = [4,5,4,3,4,3,4,5,4, 4,4,3,5,4,5,3,4,4]; // Par 71
        const AppleRockPars = [4,4,5,4,3,4,4,5,3, 4,4,3,4,5,4,4,5,3]; // Par 72

        // Calculate per-player overall totals (True Strokes & True To-Par)
        const playerTotals = {};
        roundScores.forEach(s => {
            const pid = s.player_id;
            if (!playerTotals[pid]) {
                playerTotals[pid] = {
                    name: s.players.name,
                    team_id: s.players.team_id,
                    total_score: 0,
                    total_to_par: 0,
                    rounds_played: 0
                };
            }
            
            let hasPlayed = false;
            let roundStrokes = 0;
            let roundToPar = 0;

            for (let i = 1; i <= 18; i++) {
                const val = s[`h${i}`];
                if (val !== null && val !== undefined) {
                    hasPlayed = true;
                    roundStrokes += val;
                    if (s.round_number === 1) {
                        roundToPar += (val - RamRockPars[i-1]);
                    } else if (s.round_number === 2) {
                        roundToPar += (val - AppleRockPars[i-1]);
                    } else {
                        roundToPar += (val - 4); // Default estimation
                    }
                }
            }

            if (hasPlayed) {
                playerTotals[pid].total_score += roundStrokes;
                playerTotals[pid].total_to_par += roundToPar;
                playerTotals[pid].rounds_played++;
            }
        });

        // Split into teams
        const bluePlayers = Object.values(playerTotals).filter(p => p.team_id === 1).sort((a, b) => a.total_to_par - b.total_to_par);
        const redPlayers = Object.values(playerTotals).filter(p => p.team_id === 2).sort((a, b) => a.total_to_par - b.total_to_par);

        // Helper to format to-par
        const fmtPar = (v) => {
            if (v === null || v === undefined) return '-';
            if (v === 0) return 'E';
            if (v > 0) return '+' + v;
            return '' + v;
        };

        // ────────────────────────────────────────────────────
        // RENDER: Blue vs Red Top Banner with Player Totals
        // ────────────────────────────────────────────────────
        let html = `
            <!-- Blue vs Red Scoreboard -->
            <div style="border: 2px solid var(--accent-gold, #fbbf24); background: linear-gradient(145deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.95)); border-radius: 20px; padding: 25px; margin-bottom: 30px; position: relative; overflow: hidden;">
                <div style="position: absolute; top: -15px; right: -15px; font-size: 6rem; opacity: 0.04; transform: rotate(15deg);">🏆</div>
                <h3 style="text-align: center; font-size: 1.4rem; margin-bottom: 20px; font-family: var(--font-heading);">The 2026 Ryder Cup</h3>
                
                <!-- Team Score Banner -->
                <div style="display: flex; justify-content: space-around; align-items: center; margin-bottom: 25px;">
                    <div style="text-align: center;">
                        <div style="font-size: 2rem; font-weight: 900; color: #60a5fa; font-family: var(--font-heading); text-shadow: 0 0 20px rgba(96, 165, 250, 0.3);">BLUE</div>
                        <div style="font-size: 2.8rem; font-weight: 900; color: white; font-family: var(--font-heading); margin-top: 5px;">${blueScore}</div>
                    </div>
                    <div style="font-size: 1.3rem; color: var(--text-muted); font-weight: 900; font-family: var(--font-heading);">VS</div>
                    <div style="text-align: center;">
                        <div style="font-size: 2rem; font-weight: 900; color: #fca5a5; font-family: var(--font-heading); text-shadow: 0 0 20px rgba(252, 165, 165, 0.3);">RED</div>
                        <div style="font-size: 2.8rem; font-weight: 900; color: white; font-family: var(--font-heading); margin-top: 5px;">${redScore}</div>
                    </div>
                </div>

                <!-- Blue Team Players -->
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                    <div style="background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.2); border-radius: 12px; padding: 15px;">
                        <div style="font-weight: 800; color: #60a5fa; margin-bottom: 12px; text-transform: uppercase; font-size: 0.8rem; letter-spacing: 0.08em;">Blue Team</div>
                        ${bluePlayers.map(p => `
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.04);">
                                <span style="font-size: 0.9rem; font-weight: 600;">${p.name}</span>
                                <div style="display: flex; gap: 12px; align-items: center;">
                                    <span style="font-family: monospace; font-weight: 800; color: ${p.total_to_par <= 0 ? 'var(--accent-emerald)' : '#ef4444'}; font-size: 0.95rem;">${fmtPar(p.total_to_par)}</span>
                                    <span style="font-family: monospace; color: var(--text-muted); font-size: 0.85rem;">${p.total_score || '-'}</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>

                    <!-- Red Team Players -->
                    <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 12px; padding: 15px;">
                        <div style="font-weight: 800; color: #fca5a5; margin-bottom: 12px; text-transform: uppercase; font-size: 0.8rem; letter-spacing: 0.08em;">Red Team</div>
                        ${redPlayers.map(p => `
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.04);">
                                <span style="font-size: 0.9rem; font-weight: 600;">${p.name}</span>
                                <div style="display: flex; gap: 12px; align-items: center;">
                                    <span style="font-family: monospace; font-weight: 800; color: ${p.total_to_par <= 0 ? 'var(--accent-emerald)' : '#ef4444'}; font-size: 0.95rem;">${fmtPar(p.total_to_par)}</span>
                                    <span style="font-family: monospace; color: var(--text-muted); font-size: 0.85rem;">${p.total_score || '-'}</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;

        // ────────────────────────────────────────────────────
        // RENDER: Individual Round Cards (Round 1 on top, Round 2 below, etc.)
        // ────────────────────────────────────────────────────
        const roundNumbers = Object.keys(roundMap).map(Number).sort((a, b) => a - b);

        roundNumbers.forEach(rn => {
            const roundPlayers = roundMap[rn].sort((a, b) => {
                if (rn === 1) {
                    // Round 1 is Stableford - Highest Points Wins
                    return (b.total_score || 0) - (a.total_score || 0);
                } else {
                    // Round 2/3 is Stroke Play - Lowest To Par Wins
                    if (a.to_par !== null && b.to_par !== null) return a.to_par - b.to_par;
                    if (a.total_score !== null && b.total_score !== null) return a.total_score - b.total_score;
                    return 0;
                }
            });

            html += `
                <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 20px; margin-bottom: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid rgba(255,255,255,0.08); padding-bottom: 12px; margin-bottom: 15px;">
                        <div>
                            <div style="color: white; font-family: var(--font-heading); font-size: 1.4rem; font-weight: 800;">Round ${rn}</div>
                            <div style="color: var(--accent-emerald); font-size: 0.85rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 3px;">${getRoundFormat(rn)}</div>
                        </div>
                    </div>
                    <div style="overflow-x: auto; width: 100%; border-radius: 8px;">
                        <table style="width: 100%; min-width: 800px; border-collapse: collapse; text-align: center; font-size: 0.95rem;">
                            <thead>
                                <tr style="background: rgba(255,255,255,0.03);">
                                    <th style="padding: 12px 15px; position: sticky; left: 0; background: rgba(25, 33, 48, 0.98); z-index: 2; text-align: left; border-bottom: 2px solid rgba(255,255,255,0.1);">Player</th>
                                    <th style="padding: 10px 5px; color: var(--text-muted); font-size: 0.8rem; border-bottom: 2px solid rgba(255,255,255,0.1);">1</th>
                                    <th style="padding: 10px 5px; color: var(--text-muted); font-size: 0.8rem; border-bottom: 2px solid rgba(255,255,255,0.1);">2</th>
                                    <th style="padding: 10px 5px; color: var(--text-muted); font-size: 0.8rem; border-bottom: 2px solid rgba(255,255,255,0.1);">3</th>
                                    <th style="padding: 10px 5px; color: var(--text-muted); font-size: 0.8rem; border-bottom: 2px solid rgba(255,255,255,0.1);">4</th>
                                    <th style="padding: 10px 5px; color: var(--text-muted); font-size: 0.8rem; border-bottom: 2px solid rgba(255,255,255,0.1);">5</th>
                                    <th style="padding: 10px 5px; color: var(--text-muted); font-size: 0.8rem; border-bottom: 2px solid rgba(255,255,255,0.1);">6</th>
                                    <th style="padding: 10px 5px; color: var(--text-muted); font-size: 0.8rem; border-bottom: 2px solid rgba(255,255,255,0.1);">7</th>
                                    <th style="padding: 10px 5px; color: var(--text-muted); font-size: 0.8rem; border-bottom: 2px solid rgba(255,255,255,0.1);">8</th>
                                    <th style="padding: 10px 5px; color: var(--text-muted); font-size: 0.8rem; border-bottom: 2px solid rgba(255,255,255,0.1);">9</th>
                                    <th style="padding: 10px 5px; color: var(--text-muted); font-size: 0.8rem; border-bottom: 2px solid rgba(255,255,255,0.1);">10</th>
                                    <th style="padding: 10px 5px; color: var(--text-muted); font-size: 0.8rem; border-bottom: 2px solid rgba(255,255,255,0.1);">11</th>
                                    <th style="padding: 10px 5px; color: var(--text-muted); font-size: 0.8rem; border-bottom: 2px solid rgba(255,255,255,0.1);">12</th>
                                    <th style="padding: 10px 5px; color: var(--text-muted); font-size: 0.8rem; border-bottom: 2px solid rgba(255,255,255,0.1);">13</th>
                                    <th style="padding: 10px 5px; color: var(--text-muted); font-size: 0.8rem; border-bottom: 2px solid rgba(255,255,255,0.1);">14</th>
                                    <th style="padding: 10px 5px; color: var(--text-muted); font-size: 0.8rem; border-bottom: 2px solid rgba(255,255,255,0.1);">15</th>
                                    <th style="padding: 10px 5px; color: var(--text-muted); font-size: 0.8rem; border-bottom: 2px solid rgba(255,255,255,0.1);">16</th>
                                    <th style="padding: 10px 5px; color: var(--text-muted); font-size: 0.8rem; border-bottom: 2px solid rgba(255,255,255,0.1);">17</th>
                                    <th style="padding: 10px 5px; color: var(--text-muted); font-size: 0.8rem; border-bottom: 2px solid rgba(255,255,255,0.1);">18</th>
                                    <th style="padding: 10px; border-bottom: 2px solid rgba(255,255,255,0.1); font-weight: 900;">TOT</th>
                                    <th style="padding: 10px; border-bottom: 2px solid rgba(255,255,255,0.1); font-weight: 900;">+/-</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${roundPlayers.map((s, idx) => {
                                    const trBg = idx % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent';
                                    
                                    let tdsHoles = '';
                                    for (let i = 1; i <= 18; i++) {
                                        const score = s[`h${i}`];
                                        tdsHoles += `<td style="padding: 10px 5px; border-bottom: 1px solid rgba(255,255,255,0.05); font-family: monospace;">${score !== null && score !== undefined ? score : '-'}</td>`;
                                    }

                                    return `
                                    <tr style="background: ${trBg};">
                                        <td style="padding: 12px 15px; position: sticky; left: 0; background: rgba(25, 33, 48, 0.98); z-index: 1; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.05); font-weight: 600; white-space: nowrap;">
                                            <span style="display: inline-block; width: 18px; text-align: center; color: var(--text-muted); font-size: 0.8rem; margin-right: 8px;">${idx + 1}</span>
                                            ${s.players.name}
                                        </td>
                                        ${tdsHoles}
                                        <td style="padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.05); border-left: 2px solid rgba(255,255,255,0.1); font-weight: 800; font-family: monospace;">${s.total_score !== null ? s.total_score : '-'}</td>
                                        <td style="padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.05); font-weight: 900; font-family: monospace; color: ${s.to_par !== null ? (s.to_par <= 0 ? 'var(--accent-emerald)' : '#ef4444') : 'inherit'};">${fmtPar(s.to_par)}</td>
                                    </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        });

        elements.dynamicLeaderboard.innerHTML = html;
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
        <div class="m-board-header" style="border-bottom: 2px solid rgba(255,255,255,0.1); padding-bottom: 15px; margin-bottom: 25px; display: flex; justify-content: space-between; align-items: flex-end;">
            <div>
                <div class="m-board-title" style="color: white; font-family: var(--font-heading); font-size: 1.6rem; font-weight: 800; letter-spacing: -0.02em;">Pre-Tournament Rankings</div>
                <div style="color: var(--accent-emerald); font-size: 0.95rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 5px;">Confirmed Squad</div>
            </div>
            <div style="color: var(--text-muted); font-size: 0.85rem; font-weight: 600; text-transform: uppercase;">Ranked by Handicap</div>
        </div>
        <div class="leaderboard-list">
            <div class="leaderboard-row header-row">
                <div class="col-rank">Rank</div>
                <div class="col-player">Player</div>
                <div class="col-hcp">Handicap</div>
                <div class="col-ghin">GHIN</div>
            </div>
            ${sortedRoster.map((player, index) => `
                <div class="leaderboard-row">
                    <div class="col-rank">${index + 1}</div>
                    <div class="col-player" style="color: white; font-weight: 700;">${player.name}</div>
                    <div class="col-hcp" style="color: var(--accent-emerald); font-weight: 800; font-family: monospace; font-size: 1.1rem;">${player.handicap !== null ? player.handicap : '-'}</div>
                    <div class="col-ghin" style="font-family: monospace; color: var(--text-muted);">${player.ghin || '-'}</div>
                </div>
            `).join('')}
        </div>
    `;
}

function getCssScoreClass(val) {
    if (val === 0) return 'score-even';
    if (val < 0) return 'score-under';
    return 'score-over';
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
    elements.confirmedRoster.innerHTML = tripData.roster.confirmed.map(player => {
        // Only attempt to load images for players who actually have them to prevent console 404 errors
        const nameKey = player.name.replace(/\s+/g, '');
        const PLAYERS_WITH_CARDS = ['JaymeMcCall']; // Add names here when you upload their photos
        const hasCard = PLAYERS_WITH_CARDS.includes(nameKey);
        
        const imagePath = `assets/PlayerCards/${nameKey}.jpg`;
        const isCaptain = player.name === 'Jeff Tarlton' || player.name === 'David Owens';
        return `
        <div class="attendee-card glass-panel" style="position: relative;">
            ${isCaptain ? `<div style="position: absolute; top: -10px; right: -10px; background: linear-gradient(135deg, #1B5E20, #0A5640); color: #F2C811; font-size: 0.75rem; font-weight: 900; padding: 6px 14px; border-radius: 99px; box-shadow: 0 4px 15px rgba(10, 86, 64, 0.4); z-index: 10; font-family: var(--font-heading); text-transform: uppercase; letter-spacing: 0.05em; transform: rotate(5deg);">⛳ Captain</div>` : ''}
            <div class="attendee-avatar" style="position: relative; overflow: hidden;">
                ${hasCard ? `<img src="${imagePath}" alt="${player.name}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; z-index: 2;" onerror="this.style.display='none';">` : ''}
                <span style="position: relative; z-index: 1;">${getInitials(player.name)}</span>
            </div>
            <h4 class="attendee-name">${player.name}</h4>
            <div style="margin-top: 10px; font-size: 0.85rem; color: var(--text-muted);">
                <p>GHIN: ${player.ghin || 'Missing'}</p>
                <p style="color: var(--accent-emerald); font-weight: 700;">HCP: ${player.handicap !== null ? player.handicap : 'N/A'}</p>
            </div>
        </div>
    `}).join('');

    if (elements.potentialRoster) {
        elements.potentialRoster.innerHTML = tripData.roster.potential.map(name => `
            <div class="potential-badge glass-panel" style="padding: 10px 20px; border-radius: 99px; font-size: 0.9rem; color: var(--text-muted);">${name}</div>
        `).join('');
    }

    // Auto-hide roster sections if all confirmed players have been drafted to a team
    const allDrafted = tripData.roster.confirmed.length > 0 &&
        tripData.roster.confirmed.every(p => p.team_id === 1 || p.team_id === 2);

    const rosterSection1 = document.getElementById('confirmed-roster-title');
    const rosterSection2 = document.getElementById('potential-roster-title');
    const hideStyle = 'display: none;';

    if (allDrafted) {
        // Hide the grid divs
        if (elements.confirmedRoster) elements.confirmedRoster.style.display = 'none';
        if (elements.potentialRoster) elements.potentialRoster.style.display = 'none';
        // Hide the heading labels
        if (rosterSection1) rosterSection1.style.display = 'none';
        if (rosterSection2) rosterSection2.style.display = 'none';
    } else {
        // Make sure they're visible if draft is reset
        if (elements.confirmedRoster) elements.confirmedRoster.style.display = '';
        if (elements.potentialRoster) elements.potentialRoster.style.display = '';
        if (rosterSection1) rosterSection1.style.display = '';
        if (rosterSection2) rosterSection2.style.display = '';
    }
}

function renderTeamSelection() {
    if (!elements.teamSelectionDisplay) return;

    const team1 = [];
    const team2 = [];

    // Filter and group by team_id
    tripData.roster.confirmed.forEach(player => {
        if (player.team_id === 1) team1.push(player);
        else if (player.team_id === 2) team2.push(player);
    });

    if (team1.length === 0 && team2.length === 0) {
        elements.teamSelectionDisplay.innerHTML = `<div class="glass-panel" style="padding: 50px 40px; text-align: center; color: var(--text-muted); grid-column: 1 / -1; border: 1px dashed rgba(255,255,255,0.1);">
            <div style="font-size: 3rem; margin-bottom: 20px; opacity: 0.5;">📋</div>
            <h3 style="color: white; margin-bottom: 15px; font-size: 1.5rem; font-family: var(--font-heading);">Draft Pending</h3>
            <p style="font-size: 1.1rem; line-height: 1.6;">Teams will be drafted by <strong style="color: var(--accent-gold);">3/23</strong>.<br>Captains Jeff Tarlton and David Owens are reviewing the scouting reports.</p>
        </div>`;
        return;
    }

    const renderTeamList = (team, teamNum) => {
        const teamName = teamNum === 1 ? '🔵 Blue Team' : '🔴 Red Team';
        const teamColor = teamNum === 1 ? '#3b82f6' : '#ef4444';
        return `
        <div class="glass-panel team-card" style="padding: 30px; border-top: 3px solid ${teamColor};">
            <h3 style="color: ${teamColor}; margin-bottom: 25px; display: flex; justify-content: space-between; align-items: center;">
                ${teamName}
                <span style="font-size: 0.8rem; background: rgba(255,255,255,0.05); padding: 5px 12px; border-radius: 99px; color: var(--text-muted);">
                    Avg HCP: ${(team.reduce((acc, p) => acc + p.handicap, 0) / team.length).toFixed(1)}
                </span>
            </h3>
            <div style="display: flex; flex-direction: column; gap: 12px;">
                ${team.map(p => {
                    const isCaptain = p.name === 'Jeff Tarlton' || p.name === 'David Owens';
                    return `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 15px; background: rgba(255,255,255,0.02); border-radius: 12px; border: 1px solid ${isCaptain ? teamColor + '40' : 'rgba(255,255,255,0.05)'};">
                        <span style="font-weight: 600; display: flex; align-items: center; gap: 8px;">
                            ${p.name}
                            ${isCaptain ? `<span style="background: linear-gradient(135deg, ${teamColor}33, ${teamColor}22); color: ${teamColor}; font-size: 0.65rem; font-weight: 900; padding: 3px 10px; border-radius: 99px; text-transform: uppercase; letter-spacing: 0.05em; border: 1px solid ${teamColor}55;">⛳ Captain</span>` : ''}
                        </span>
                        <span style="color: var(--accent-emerald); font-weight: 800; font-family: monospace;">${p.handicap.toFixed(1)}</span>
                    </div>
                `}).join('')}
            </div>
        </div>
    `};

    elements.teamSelectionDisplay.innerHTML = `
        ${renderTeamList(team1, 1)}
        ${renderTeamList(team2, 2)}
    `;
}

function getInitials(name) {
    if (!name) return '??';
    return name.split(' ').map(n => n[0]).join('');
}

function initScrollAnimations() {
    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target); // Only animate once
            }
        });
    }, {
        threshold: 0.1, // Trigger when 10% of the element is visible
        rootMargin: "0px 0px -50px 0px"
    });

    // We must wait briefly since courses are injected dynamically
    setTimeout(() => {
        document.querySelectorAll('.course-card, .trip-info-card, .masonry-item').forEach(card => {
            observer.observe(card);
        });
    }, 100);
}

function setupEventListeners() {
    if (elements.menuToggle) {
        elements.menuToggle.addEventListener('click', () => {
            elements.mainNav.classList.toggle('active');
            elements.menuToggle.classList.toggle('is-open');
        });
    }

    document.querySelectorAll('.main-nav a').forEach(link => {
        link.addEventListener('click', () => {
            if (elements.mainNav) elements.mainNav.classList.remove('active');
            if (elements.menuToggle) elements.menuToggle.classList.remove('is-open');
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

    // Lightbox Modal Listeners
    document.querySelectorAll('.masonry-item').forEach(item => {
        item.addEventListener('click', () => {
            const img = item.querySelector('img');
            if (img && elements.lightboxModal && elements.lightboxImage) {
                elements.lightboxImage.src = img.src;
                elements.lightboxModal.classList.add('active');
                document.body.style.overflow = 'hidden';
            }
        });
    });

    if (elements.lightboxClose) {
        elements.lightboxClose.addEventListener('click', closeLightbox);
    }

    if (elements.lightboxModal) {
        elements.lightboxModal.addEventListener('click', (e) => {
            if (e.target === elements.lightboxModal) {
                closeLightbox();
            }
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
            closeLightbox();
            if (elements.leaderboardModal) elements.leaderboardModal.classList.remove('active');
            if (elements.roundLoginModal) elements.roundLoginModal.classList.remove('active');
        }
    });
}

function closeLightbox() {
    if (elements.lightboxModal) elements.lightboxModal.classList.remove('active');
    setTimeout(() => {
        // Clear src after a tiny delay so it doesn't blink out before fading
        if (elements.lightboxImage) elements.lightboxImage.src = ""; 
    }, 300);
    document.body.style.overflow = '';
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
    const email = (formData.get('email') || '').trim();
    const ghinNumber = (formData.get('ghinNumber') || '').trim();
    const handicap = formData.get('handicap');

    // NOTE: Registration access is enforced server-side via Supabase Row Level Security.
    // Client-side password checks are insecure (visible in source) and have been removed.
    // To restrict who can register, configure RLS policies on the `players` table in Supabase.
    if (!firstName || !lastName) {
        alert('Please enter your first and last name.');
        return;
    }

    const newPlayer = {
        name: `${firstName} ${lastName}`,
        email: email || null,
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
            email: player.email,
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
            email: player.email || 'Not provided',
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
