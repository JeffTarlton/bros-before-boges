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
            { name: "Colby Gibson", size: "XL", handicap: 5.0 },
            { name: "Westin Tucker", size: "XL", handicap: 5.6 },
            { name: "Zac Taylor", size: "XL", handicap: 3.5 },
            { name: "Derrick Merchant", size: "L", handicap: 10.0 },
            { name: "Jeff Tarlton", size: "L", handicap: 9.0 },
            { name: "Kelly Dennard", size: "L", handicap: 8.4 },
            { name: "Dillon Griffin", size: "L", handicap: 14.4 },
            { name: "Andy Mazzolini", size: "L", handicap: 15.0 },
            { name: "Blake Watts", size: "L", handicap: null },
            { name: "Jayme McCall", size: "M", handicap: 7.1 },
            { name: "David Owens", size: "M", handicap: 9.3 },
            { name: "Parker Davidson", size: "M", handicap: 8.0 },
            { name: "Tripp Harris", size: "M", handicap: null },
            { name: "Ty Buis", size: null, handicap: 17.0 }
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
    mainNav: document.querySelector('.main-nav')
};

// Render Functions
function init() {
    renderTripDetails();
    renderSchedule();
    renderCourses();
    renderRoster();
    renderScoreboard();
    setupEventListeners();
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
            <div class="timeline-content">
                <div class="timeline-date">${day.day} - ${day.date}</div>
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
                <p>Size: ${player.size || '-'}</p>
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
    elements.menuToggle.addEventListener('click', () => {
        elements.mainNav.classList.toggle('active');
    });

    document.querySelectorAll('.main-nav a').forEach(link => {
        link.addEventListener('click', () => {
            elements.mainNav.classList.remove('active');
        });
    });
}

document.addEventListener('DOMContentLoaded', init);
