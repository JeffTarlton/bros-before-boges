// Supabase Configuration - USER NEEDS TO FILL THESE IN
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_KEY = 'YOUR_SUPABASE_ANON_KEY';

// Initialize Supabase Client
let supabase = null;
if (SUPABASE_URL !== 'YOUR_SUPABASE_URL') {
    supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
}

// Trip Configuration Data
const tripData = {
    tripName: "Annual Bros before Boges",
    year: 2026,
    location: "Horseshoe Bay, Texas",
    accommodation: "Horseshoe Bay Resort",
    accommodationLink: "https://www.hsbresort.com/",
    dates: "April 9th - 13th, 2025",
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

// DOM Elements
const elements = {
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
    registrationForm: document.getElementById('registration-form')
};

// Render Functions
async function init() {
    renderTripDetails();
    renderSchedule();
    renderCourses();
    await loadRosterData(); // Fetch from Supabase if possible
    renderScoreboard();
    setupEventListeners();
}

async function loadRosterData() {
    if (!supabase) {
        console.warn('Supabase not configured. Using hardcoded roster.');
        renderRoster();
        return;
    }

    const { data, error } = await supabase
        .from('players')
        .select('*')
        .order('name');

    if (error) {
        console.error('Error fetching roster:', error);
        renderRoster(); // Fallback
    } else if (data && data.length > 0) {
        tripData.roster.confirmed = data.map(p => ({
            name: p.name,
            ghin: p.ghin,
            handicap: p.handicap !== null ? parseFloat(p.handicap) : null
        }));
        renderRoster();
    } else {
        renderRoster(); // No data yet, show hardcoded
    }
}

function renderTripDetails() {
    elements.tripYear.textContent = tripData.year;
    elements.tripLocation.textContent = tripData.location;
    elements.tripDates.textContent = tripData.dates;
    elements.tripAccommodation.textContent = tripData.accommodation;
    elements.footerYear.textContent = tripData.year;

    // Update title
    document.title = `${tripData.tripName} ${tripData.year}`;

    // Render Costs
    if (tripData.costs) {
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
    // Unique courses including Summit Rock
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
        <div class="course-card">
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

function renderScoreboard() {
    // For now, mimic a "Field" list since we don't have matches yet.
    // Just sorting by Handicap to give a "Ranked" look.
    const sortedRoster = [...tripData.roster.confirmed].sort((a, b) => {
        // Handle null handicaps by pushing them to end
        if (a.handicap === null) return 1;
        if (b.handicap === null) return -1;
        return a.handicap - b.handicap;
    });

    const scoreboardElement = document.getElementById('main-scoreboard');

    // Keep header row
    const headerRow = scoreboardElement.querySelector('.header-row');
    scoreboardElement.innerHTML = '';
    scoreboardElement.appendChild(headerRow);

    sortedRoster.forEach((player, index) => {
        const row = document.createElement('div');
        row.className = 'board-row';
        row.innerHTML = `
            <div class="col-pos">${index + 1}</div>
            <div class="col-player">${player.name}</div>
            <div class="col-thru">-</div>
            <div class="col-score">E</div>
        `;
        scoreboardElement.appendChild(row);
    });
}

function renderRoster() {
    // Confirmed
    elements.confirmedRoster.innerHTML = tripData.roster.confirmed.map(player => `
        <div class="attendee-card">
            <div class="attendee-avatar">
                <span>${getInitials(player.name)}</span>
            </div>
            <h4 class="attendee-name">${player.name}</h4>
            <div style="margin-top: 10px; font-size: 0.85rem; color: #555;">
                <p>GHIN: ${player.ghin || 'Missing'}</p>
                <p style="color: var(--primary-color); font-weight: 700;">HCP: ${player.handicap !== null ? player.handicap : 'N/A'}</p>
            </div>
        </div>
    `).join('');

    // Potential
    elements.potentialRoster.innerHTML = tripData.roster.potential.map(name => `
        <div class="potential-badge">${name}</div>
    `).join('');
}

function getInitials(name) {
    return name.split(' ').map(n => n[0]).join('');
}

function setupEventListeners() {
    // Mobile menu toggle
    elements.menuToggle.addEventListener('click', () => {
        elements.mainNav.classList.toggle('active');
    });

    document.querySelectorAll('.main-nav a').forEach(link => {
        link.addEventListener('click', () => {
            elements.mainNav.classList.remove('active');
        });
    });

    // Modal open/close
    elements.signupBtn.addEventListener('click', openModal);
    elements.modalClose.addEventListener('click', closeModal);
    elements.cancelBtn.addEventListener('click', closeModal);

    // Close modal when clicking outside
    elements.registrationModal.addEventListener('click', (e) => {
        if (e.target === elements.registrationModal) {
            closeModal();
        }
    });

    // Close modal with Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && elements.registrationModal.classList.contains('active')) {
            closeModal();
        }
    });

    // Form submission
    elements.registrationForm.addEventListener('submit', handleFormSubmit);
}

function openModal() {
    elements.registrationModal.classList.add('active');
    document.body.style.overflow = 'hidden'; // Prevent scrolling
}

function closeModal() {
    elements.registrationModal.classList.remove('active');
    document.body.style.overflow = ''; // Restore scrolling
    elements.registrationForm.reset();
}

function handleFormSubmit(e) {
    e.preventDefault();

    // Get form data
    const formData = new FormData(elements.registrationForm);
    const firstName = formData.get('firstName').trim();
    const lastName = formData.get('lastName').trim();
    const shirtsize = formData.get('shirt size').trim();
    const ghinNumber = formData.get('ghinNumber').trim();
    const handicap = formData.get('handicap');
    const password = formData.get('password');

    // Validate password
    const correctPassword = 'iLoveGolf2026!';
    if (password !== correctPassword) {
        alert('❌ Incorrect password. Please contact the trip organizer for the registration password.');
        return;
    }

    // Create player object
    const newPlayer = {
        name: `${firstName} ${lastName}`,
        ghin: ghinNumber || null,
        handicap: handicap ? parseFloat(handicap) : null
    };

    // Send email notification
    sendEmailNotification(newPlayer);

    // Add to Supabase
    saveToSupabase(newPlayer);

    // Add locally for instant UI update
    tripData.roster.confirmed.push(newPlayer);

    // Re-render the roster and scoreboard
    renderRoster();
    renderScoreboard();

    // Show success message
    alert(`Welcome to the trip, ${newPlayer.name}! 🏌️‍♂️\n\nA confirmation email has been sent to the trip organizer.`);

    // Close modal
    closeModal();

    // Scroll to roster section
    document.getElementById('attendees').scrollIntoView({ behavior: 'smooth' });
}

async function saveToSupabase(player) {
    if (!supabase) return;

    try {
        const { error } = await supabase
            .from('players')
            .insert([
                {
                    name: player.name,
                    ghin: player.ghin,
                    handicap: player.handicap,
                    status: 'confirmed'
                }
            ]);

        if (error) throw error;
        console.log('Player saved to Supabase successfully');
    } catch (err) {
        console.error('Failed to save to Supabase:', err);
    }
}


function sendEmailNotification(player) {
    // Create email body
    const subject = encodeURIComponent('New Bros before Boges Registration');
    const body = encodeURIComponent(
        `New Player Registration\n\n` +
        `Name: ${player.name}\n` +
        `GHIN Number: ${player.ghin || 'Not provided'}\n` +
        `Handicap: ${player.handicap !== null ? player.handicap : 'Not provided'}\n\n` +
        `Registration Time: ${new Date().toLocaleString()}\n\n` +
        `---\n` +
        `This is an automated notification from the Bros before Boges registration system.`
    );

    // Method 1: Using mailto (will open user's email client)
    // Uncomment this if you want to use the simpler mailto approach
    // window.location.href = `mailto:westin.tucker@gmail.com?subject=${subject}&body=${body}`;

    // Method 2: Using FormSubmit.co (recommended - sends silently in background)
    fetch('https://formsubmit.co/ajax/westin.tucker@gmail.com', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({
            name: player.name,
            ghin: player.ghin || 'Not provided',
            handicap: player.handicap !== null ? player.handicap : 'Not provided',
            _subject: 'New Bros before Boges Registration',
            _template: 'box'
        })
    })
        .then(response => response.json())
        .then(data => console.log('Email sent successfully:', data))
        .catch(error => {
            console.error('Error sending email:', error);
            // Fallback to mailto if fetch fails
            window.open(`mailto:westin.tucker@gmail.com?subject=${subject}&body=${body}`, '_blank');
        });
}


document.addEventListener('DOMContentLoaded', init);
