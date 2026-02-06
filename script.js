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
        confirmed: [
            { name: "Colby Gibson", ghin: null, handicap: 5.0 },
            { name: "Westin Tucker", ghin: null, handicap: 5.6 },
            { name: "Zac Taylor", ghin: null, handicap: 3.5 },
            { name: "Derrick Merchant", ghin: null, handicap: 10.0 },
            { name: "Jeff Tarlton", ghin: 2360395, handicap: 9.0 },
            { name: "Kelly Dennard", ghin: null, handicap: 8.4 },
            { name: "Dillon Griffin", ghin: null, handicap: 14.4 },
            { name: "Andy Mazzolini", ghin: null, handicap: 15.0 },
            { name: "Jayme McCall", ghin: null, handicap: 7.1 },
            { name: "David Owens", ghin: null, handicap: 9.3 },
            { name: "Parker Davidson", ghin: null, handicap: 8.0 },
            { name: "Tripp Harris", ghin: null, handicap: null },
            { name: "Ty Buis", ghin: null, handicap: 17.0 }
        ],
        potential: [
            "Tanner Terrell", "Brian Lewis", "Daniel Castro", "Tommy Wood",
            "Jake Mahan", "Tyler Lyons", "Brad Elder", "Kyle Motheral",
            "Hunter Scott", "Hunter Miller", "Jeremy Martin", "David Maupins",
            "Trey Merchant", "Tyler Houk"
        ]
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
            dynamicLeaderboard: document.getElementById('dynamic-leaderboard')
        };

        // Render static details immediately
        renderTripDetails();
        renderSchedule();
        renderCourses();

        // Start loading roster data (async)
        loadRosterData().then(() => {
            renderDynamicScoreboard();
        }).catch(err => {
            console.error('Data flow failed:', err);
            renderDynamicScoreboard(); // Attempt anyway
        });

        setupEventListeners();
        console.log('Site initialization complete.');
    } catch (err) {
        console.error('CRITICAL: Site failed to initialize.', err);
    }
}

async function loadRosterData() {
    if (!supabaseInstance) {
        console.warn('Supabase not configured. Using hardcoded roster.');
        renderRoster();
        return;
    }

    try {
        const { data, error } = await supabaseInstance
            .from('players')
            .select('*')
            .eq('status', 'confirmed') // Only confirmed players
            .order('name');

        if (error) {
            console.error('Error fetching roster:', error);
            renderRoster();
        } else if (data && data.length > 0) {
            tripData.roster.confirmed = data.map(p => ({
                name: p.name,
                ghin: p.ghin,
                handicap: p.handicap !== null ? parseFloat(p.handicap) : null
            }));
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
    elements.tripAccommodation.textContent = tripData.accommodation;
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

        const roundId = activeRounds[0].id;
        const { data: scores, error: scoreError } = await supabaseInstance
            .from('scores')
            .select('*, players(*)')
            .eq('round_id', roundId);

        if (scoreError || !scores) {
            renderFallbackLeaderboard();
            return;
        }

        // Rank by total_to_par
        const sortedScores = scores.sort((a, b) => (a.total_to_par || 0) - (b.total_to_par || 0));

        elements.dynamicLeaderboard.innerHTML = `
            <div class="m-board-header">
                <div class="m-board-title">Bros before Boges 2026 - Live Scoreboard</div>
                <div style="color: #1a4a1a; font-weight: 800;">ROUND ACTIVE</div>
            </div>
            <table class="m-table">
                <thead>
                    <tr>
                        <th>Pos</th>
                        <th class="m-row-player">Player</th>
                        <th>HCP</th>
                        <th>Thru</th>
                        <th>To Par</th>
                        <th>Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${sortedScores.map((s, index) => `
                        <tr>
                            <td>${index + 1}</td>
                            <td class="m-row-player">${s.players.name}</td>
                            <td>${s.players.handicap || '-'}</td>
                            <td>${getThruHoles(s)}</td>
                            <td class="${getScoreClass(s.total_to_par)}">${formatToPar(s.total_to_par)}</td>
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
