// Supabase Configuration
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

// All trip content lives in trip-config.js (window.BBB). Update that file each year.
const CFG = window.BBB || {};
if (!window.BBB) console.error('trip-config.js is missing or has a syntax error — trip content will not render.');
const TRIP = CFG.trip || {};
const SEASON_LIVE = !!(CFG.season && CFG.season.live);
const CAPTAINS = (CFG.cup && CFG.cup.captains) || [];
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Live roster pulled from Supabase
const roster = { confirmed: [], potential: [] };

// RSVP / head count (Supabase `rsvps` table — see rsvp_schema.sql and rsvp_accounts.sql)
const RSVP = CFG.rsvp || {};
const RSVP_YEAR = RSVP.year || TRIP.year;
const RSVP_LABELS = { in: 'I’m in', maybe: 'Probably', out: 'Can’t make it' };
const rsvpState = { available: false, missingTable: false, latest: [], lastAt: null };

// RSVP and new-player alerts (trip-config.js → alerts)
const ALERTS = CFG.alerts || {};
// Each RSVP alert links straight to Admin's RSVPs tab, so approving a new player from a phone is one tap
const ADMIN_RSVPS_URL = 'https://bros-before-boges.vercel.app/admin#rsvps';

// The signed-in visitor and their roster row. RSVPs need both; accounts are set up on
// The Bookie page (bookie.html?next=…), which sends people back here when they're done.
const account = { checked: false, user: null, player: null, myRsvp: undefined };

// Nothing personal ("You're in", the You tag, Log out) renders until the first account and
// RSVP checks are done, so a signed-in player never sees a flash of the stranger's page.
let personalReady = false;

// DOM Element Registry (populated in init)
let elements = {};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function esc(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const ICON_PATHS = {
    calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    pin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
    bed: '<path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/>',
    plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    award: '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4 12 14.01l-3-3"/>',
    expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
    tv: '<rect width="20" height="15" x="2" y="7" rx="2" ry="2"/><path d="m17 2-5 5-5-5"/>',
    mountain: '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
    // Same marks as the RSVP sheet's in / probably / can't make it choices
    tick: '<path d="M20 6 9 17l-5-5"/>',
    question: '<path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    login: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>'
};

function icon(name) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
}

function allCourses() {
    const list = [];
    (CFG.courses || []).forEach(c => {
        if (c.options) c.options.forEach(o => list.push(o));
        else list.push(c);
    });
    return list;
}

function findCourse(id) {
    return allCourses().find(c => c.id === id) || null;
}

function parsForRound(roundNumber) {
    const id = CFG.roundCourses && CFG.roundCourses[roundNumber];
    const course = id ? findCourse(id) : null;
    if (course && Array.isArray(course.holePars) && course.holePars.length === 18) return course.holePars;
    return null;
}

function scoringForRound(roundNumber) {
    if (CFG.roundPlay && CFG.roundPlay[roundNumber] === 'points') return 'stableford';
    return (CFG.roundScoring && CFG.roundScoring[roundNumber]) || 'stroke';
}

// Some roster rows hold a placeholder GHIN like 0123456789 — treat those as missing.
function realGhin(ghin) {
    const g = String(ghin || '').trim();
    if (!g || /^0?123456789$/.test(g) || /^(\d)\1+$/.test(g)) return null;
    return g;
}

// The course group (card on the page) that contains a course id.
function findCourseGroup(id) {
    return (CFG.courses || []).find(g => g.id === id || (g.options || []).some(o => o.id === id)) || null;
}

function isCaptain(name) {
    return CAPTAINS.includes(name);
}

function getInitials(name) {
    if (!name) return '??';
    return name.split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 3).toUpperCase();
}

function formatMoney(n) {
    return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtPoints(v) {
    const n = Number(v);
    if (Number.isInteger(n)) return String(n);
    return (Math.floor(n) === 0 ? '' : Math.floor(n)) + '½';
}

// ---------------------------------------------------------------------------
// Trip phases: before, during and after the trip, by the calendar in Arizona
// ---------------------------------------------------------------------------
// 'pre'  until trip.dates.start: countdown and RSVPs
// 'trip' trip.dates.start through trip.dates.end (whole days): a Today card, Live scores, Keep score
// 'wrap' after trip.dates.end, until trip-config.js moves on to next year: That's a wrap
// Always the date in the trip's time zone, never the phone's own: the crew flies in from other
// zones. (season.live still decides whether teams and Cup points show.)
const TRIP_TZ = TRIP.timeZone || 'America/Phoenix';
const TRIP_TZ_NAME = TRIP.timeZoneName || 'Arizona';

let tripClockParts = null;
// The date and time in the trip's time zone at instant `ms`: { date: 'YYYY-MM-DD', hour, minute }
function tripClock(ms) {
    if (!tripClockParts) {
        try {
            // hour12:false rather than hourCycle, which older Safari ignores (it'd hand back 1–12)
            const fmt = new Intl.DateTimeFormat('en-US', { timeZone: TRIP_TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
            tripClockParts = t => {
                const p = {};
                fmt.formatToParts(t).forEach(x => { p[x.type] = x.value; });
                return p;
            };
        } catch (e) {
            // No time zone support (or a bad trip.timeZone): Arizona's fixed UTC-7
            const two = n => String(n).padStart(2, '0');
            tripClockParts = t => {
                const d = new Date(t - 7 * 3600000);
                return { year: d.getUTCFullYear(), month: two(d.getUTCMonth() + 1), day: two(d.getUTCDate()), hour: two(d.getUTCHours()), minute: two(d.getUTCMinutes()) };
            };
        }
    }
    const p = tripClockParts(ms);
    return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, minute: Number(p.minute) };
}

// The instant when the trip's clocks read y-mo-d h:mi
function tripWallTime(y, mo, d, h, mi) {
    const wanted = Date.UTC(y, mo - 1, d, h, mi);
    let ms = wanted;
    for (let i = 0; i < 2; i++) {
        const c = tripClock(ms);
        const [cy, cm, cd] = c.date.split('-').map(Number);
        ms += wanted - Date.UTC(cy, cm - 1, cd, c.hour, c.minute);
    }
    return ms;
}

function addDays(date, n) {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// 'Fri Apr 9' for a 'YYYY-MM-DD' date (noon, so no time zone can tip it into another day)
function shortDay(date) {
    return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
}

// 'Nov 30' for a 'YYYY-MM-DD' date
function monthDay(date) {
    return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// A short text typed into trip-config.js, trimmed; '' when it's missing (or isn't text or a number)
function configText(value) {
    return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

// A dollar amount typed into trip-config.js as a number: '$500', or '$203.13' when it has cents (a
// payment line must show the exact amount). '' when it isn't a real number.
function configMoney(n) {
    if (!Number.isFinite(n)) return '';
    const cents = Math.round(n * 100) % 100 !== 0;
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
}

// A date typed into trip-config.js as 'YYYY-MM-DD', or null when it's missing or isn't a real day
function configDate(value) {
    const s = configText(value);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? s : null;
}

// For a part rendered after applyPhase has run that only belongs to some phases ('pre', 'pre trip'):
// hidden at once if this isn't one of them, and applyPhase shows and hides it from then on, like the
// [data-phase] parts of index.html
function phaseAttrs(phases) {
    return ` data-phase="${phases}"${phases.split(' ').includes(phase.name) ? '' : ' hidden'}`;
}

// ?preview=2027-04-09T06:45 (trip time; a date alone means 8:00 AM) shows the page as it will be at
// that moment, so the commissioner can check trip-day mode early. The clock runs on from there. A
// ribbon marks it, and its Exit link drops the parameter. Normal visitors never have it.
const PREVIEW = (() => {
    let raw = '';
    try { raw = new URLSearchParams(window.location.search).get('preview') || ''; } catch (e) { return null; }
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?$/.exec(raw.trim());
    if (!m) return null;
    const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4] || 8, m[5] || 0].map(Number);
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
    return { at: tripWallTime(y, mo, d, h, mi), since: Date.now() };
})();

function nowMs() {
    return PREVIEW ? PREVIEW.at + (Date.now() - PREVIEW.since) : Date.now();
}

function tripPhase(ms) {
    const c = tripClock(ms);
    const dates = TRIP.dates || {};
    const start = dates.start || null;
    const end = dates.end || start;
    const name = !start || c.date < start ? 'pre' : c.date > end ? 'wrap' : 'trip';
    // From 6 PM the Today card also says what's on tomorrow
    return { name, date: c.date, hour: c.hour, minute: c.minute, evening: c.hour >= 18 };
}

let phase = tripPhase(nowMs());

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------
async function init() {
    // Tells index.html's safety net that the page is rendering, so it leaves the scroll reveals alone
    window.__homeInit = true;
    try {
        elements = {
            nav: document.getElementById('site-nav'),
            navToggle: document.getElementById('nav-toggle'),
            drawer: document.getElementById('drawer'),
            clubhouseBtn: document.getElementById('clubhouse-btn'),
            clubhouseMenu: document.getElementById('clubhouse-menu'),
            confirmedRoster: document.getElementById('confirmed-roster'),
            potentialRoster: document.getElementById('potential-roster'),
            bubbleBlock: document.getElementById('bubble-block'),
            outRoster: document.getElementById('out-roster'),
            outBlock: document.getElementById('out-block'),
            rsvpModal: document.getElementById('rsvp-modal'),
            rsvpForm: document.getElementById('rsvp-form'),
            crewCount: document.getElementById('crew-count'),
            coursesGrid: document.getElementById('courses-grid'),
            scheduleTimeline: document.getElementById('schedule-timeline'),
            cupSection: document.getElementById('team-selection-section'),
            registrationModal: document.getElementById('registration-modal'),
            registrationForm: document.getElementById('registration-form'),
            leaderboardModal: document.getElementById('leaderboard-modal'),
            dynamicLeaderboard: document.getElementById('dynamic-leaderboard'),
            lightboxModal: document.getElementById('lightbox-modal'),
            lightboxImage: document.getElementById('lightbox-image'),
            lightboxCaption: document.getElementById('lightbox-caption'),
            lightboxCount: document.getElementById('lightbox-count')
        };

        // Wire up buttons first so a bad config entry can't leave Sign Up / Standings dead.
        setupEventListeners();
        [applyPhase, renderHero, renderTripDetails, renderSchedule, renderCourses, renderCup, renderHallOfFame, renderCrewCta, initCountdown, initScrollEffects, watchPhase]
            .forEach(fn => {
                try { fn(); } catch (err) { console.error(`${fn.name} failed:`, err); }
            });

        showGoogleButtonsIfEnabled();
        await Promise.all([loadRosterData(), loadRsvps(), loadAccount()]);
        personalReady = true;
        renderPersonal();
        roster.loaded = true;
        openFromAddress();
        if (elements.leaderboardModal && elements.leaderboardModal.classList.contains('active')) renderDynamicScoreboard();
        fetchRyderCupScores();
        // The roster only changes the Cup section once teams are live; re-rendering
        // otherwise would restart the champions reel animation.
        if (SEASON_LIVE) renderCup();
        initReveals();
    } catch (err) {
        console.error('CRITICAL: Site failed to initialize.', err);
    }
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------
function renderHero() {
    const hero = CFG.hero || {};
    const kicker = document.getElementById('hero-kicker');
    if (kicker && TRIP.year && TRIP.location) kicker.textContent = `The ${TRIP.year} Edition · ${TRIP.location}`;

    // Facts list in the hero card
    const facts = document.getElementById('hero-facts');
    if (facts) {
        const rows = [
            { i: 'calendar', label: TRIP.dates && TRIP.dates.label, muted: TRIP.dates && TRIP.dates.days },
            { i: 'pin', label: TRIP.locationShort || TRIP.location, muted: TRIP.airport ? `Fly ${TRIP.airport.code}` : '' },
            { i: 'flag', label: hero.roundsLabel || '', muted: hero.roundsNote || '' },
            { i: 'wallet', label: TRIP.cost ? `${TRIP.cost.approx ? '~' : ''}${formatMoney(TRIP.cost.perPerson)} per person` : '', muted: TRIP.cost && TRIP.cost.excludes ? `+ ${TRIP.cost.excludes}` : '' }
        ].filter(r => r.label);
        facts.innerHTML = rows.map(r => `<li>${icon(r.i)}<span>${esc(r.label)}</span>${r.muted ? `<span class="muted">${esc(r.muted)}</span>` : ''}</li>`).join('');
    }

    const target = document.getElementById('cd-target-label');
    if (target && TRIP.dates) target.textContent = TRIP.dates.short || '';

    // Defending champions line under the hero copy
    const last = (CFG.history || []).find(e => e && e.score && e.champion);
    const sub = document.getElementById('hero-sub');
    if (sub && hero.subtitle) sub.textContent = hero.subtitle;
    const champs = document.getElementById('hero-champs');
    if (champs && last && !SEASON_LIVE) {
        const champ = last.champion === 'blue' ? 'Blue' : 'Red';
        const score = `${fmtPoints(last.score[last.champion])}–${fmtPoints(last.score[last.champion === 'blue' ? 'red' : 'blue'])}`;
        champs.className = `hero-champs ${last.champion}`;
        champs.innerHTML = `${icon('trophy')}<span>Defending champs: <b>Team ${champ}</b> · <span class="nowrap">${score} in ${esc(last.year)}</span></span>`;
        champs.hidden = false;
    }

    // Rotating hero backdrop
    const media = document.getElementById('hero-media');
    const images = hero.images || [];
    if (!media || images.length === 0) return;
    const first = media.querySelector('.hero-slide img');
    if (first && !first.getAttribute('src').includes(images[0])) first.src = images[0];

    // Reduced-motion users keep the first photo and never download the rest.
    if (REDUCED_MOTION || images.length < 2) return;
    const slides = [media.querySelector('.hero-slide')];
    const addSlide = (src) => {
        const slide = document.createElement('div');
        slide.className = 'hero-slide';
        slide.innerHTML = `<img src="${esc(src)}" alt="" decoding="async">`;
        media.appendChild(slide);
        return slide;
    };
    slides[1] = addSlide(images[1]); // preload the next slide only
    let current = 0;
    let loops = 0;
    const timer = setInterval(() => {
        if (document.hidden) return;
        const next = (current + 1) % images.length;
        if (!slides[next]) slides[next] = addSlide(images[next]);
        slides[current].classList.remove('is-active');
        slides[next].classList.add('is-active');
        current = next;
        const upcoming = (current + 1) % images.length;
        if (!slides[upcoming]) slides[upcoming] = addSlide(images[upcoming]);
        // Stop after two full cycles so the background isn't in motion forever.
        if (current === 0 && ++loops >= 2) clearInterval(timer);
    }, 7000);
}

// ---------------------------------------------------------------------------
// Trip details / destination
// ---------------------------------------------------------------------------
function renderTripDetails() {
    if (TRIP.year && TRIP.location) document.title = `${TRIP.name || 'Bros before Boges'} ${TRIP.year} | ${TRIP.location}`;

    const footerYear = document.getElementById('footer-year');
    if (footerYear) footerYear.textContent = new Date().getFullYear();

    const title = document.getElementById('trip-location-title');
    if (title && TRIP.location) {
        const [city, state] = TRIP.location.split(',').map(s => s.trim());
        title.innerHTML = state ? `${esc(city)}, <em>${esc(state)}</em>` : esc(city);
    }

    const intro = document.getElementById('trip-intro');
    if (intro && TRIP.intro) intro.innerHTML = TRIP.intro.map(p => `<p>${esc(p)}</p>`).join('');

    renderNews();

    const grid = document.getElementById('fact-grid');
    if (!grid) return;

    const hq = TRIP.hq || {};
    const hqValue = hq.link ? `<a href="${esc(hq.link)}" target="_blank" rel="noopener">${esc(hq.name)}</a>` : esc(hq.name || 'TBA');
    // In the order phones show them: lodging and travel first, then the cost. Dates and Golf repeat
    // the hero card, so phones skip them; wider screens put all of them back in their grid order
    // (home.css, "Trip facts").
    const facts = [
        { key: 'hq', i: 'bed', label: 'HQ', value: hqValue, note: hq.note },
        { key: 'fly', i: 'plane', label: 'Fly into', value: TRIP.airport ? esc(`${TRIP.airport.code} · ${TRIP.airport.name}`) : 'TBA', note: TRIP.airport && TRIP.airport.note, tip: flightTipHTML() },
        { key: 'cost' },
        { key: 'base', i: 'pin', label: 'Home base', value: esc(TRIP.region || TRIP.location), note: TRIP.regionNote },
        { key: 'forecast', i: 'sun', label: 'Forecast', value: esc(TRIP.weather && TRIP.weather.value), note: TRIP.weather && TRIP.weather.note },
        { key: 'dates', i: 'calendar', label: 'Dates', value: esc(TRIP.dates && TRIP.dates.label), note: TRIP.dates && TRIP.dates.note },
        { key: 'golf', i: 'flag', label: 'Golf', value: esc(CFG.hero && CFG.hero.roundsLabel), note: CFG.hero && CFG.hero.roundsNote }
    ];

    const cost = TRIP.cost || {};
    const breakdown = (cost.breakdown || []).filter(b => b && b.label);
    const costCard = cost.perPerson ? `
        <div class="cost-card reveal">
            <div class="cost-amount">${cost.approx ? '<span class="approx">approx.</span>' : ''}<sup>$</sup>${Number(cost.perPerson).toLocaleString('en-US')}</div>
            <div class="cost-meta">
                <b>The damage · per man</b>
                ${cost.note ? `<p>${esc(cost.note)}</p>` : ''}
                ${paymentTipHTML(cost)}
                <p class="cost-paid" id="cost-paid" hidden></p>
            </div>
            ${breakdown.length ? `<div class="cost-breakdown">${breakdown.map(b => `<div class="cost-line"><span>${esc(b.label)}</span><b${typeof b.amount === 'number' ? ' class="num"' : ''}>${esc(typeof b.amount === 'number' ? configMoney(b.amount) : b.amount)}</b></div>`).join('')}</div>` : ''}
        </div>` : '';

    let n = 0;
    grid.innerHTML = facts.map(f => {
        if (f.key === 'cost') return costCard;
        if (!f.value) return '';
        return `
        <div class="fact fact--${f.key} reveal ${n++ % 2 ? 'reveal-delay-1' : ''}">
            <div class="fact-icon">${icon(f.i)}</div>
            <div class="fact-label">${esc(f.label)}</div>
            <div class="fact-value">${f.value}</div>
            ${f.note ? `<div class="fact-note">${esc(f.note)}</div>` : ''}
            ${f.tip || ''}
        </div>`;
    }).join('');
}

// The Fly into card's timing line (trip.airport.arriveBy / departAfter): "Land by 10 AM Thu · fly out
// after 3 PM Sun", whichever is set. Before either is, and only before the trip, hold off on booking.
function flightTipHTML() {
    const air = TRIP.airport || {};
    const arrive = configText(air.arriveBy);
    const depart = configText(air.departAfter);
    if (!arrive && !depart) {
        return `<p class="fact-tip"${phaseAttrs('pre')}>${icon('clock')}<span>Hold off on flights until tee times post.</span></p>`;
    }
    const parts = [arrive ? `Land by ${arrive}` : '', depart ? `${arrive ? 'fly' : 'Fly'} out after ${depart}` : ''];
    return `<p class="fact-tip"${phaseAttrs('pre trip')}>${icon('clock')}<span>${tipPartsHTML(parts)}</span></p>`;
}

// "A · B · C", each short part kept on one line ("3 PM Sun", "Venmo @bbb-golf"), longer ones free to wrap
function tipPartsHTML(parts) {
    return parts.filter(Boolean).map(p => (p.length <= 24 ? `<span class="nowrap">${esc(p)}</span>` : esc(p))).join(' · ');
}

// The cost card's payment line (trip.cost.payment): "Deposit $500 due Dec 15 · Venmo @… · note", from
// whichever parts are set (or the whole line as plain text). Until any are, and only before the trip,
// don't send money yet.
function paymentTipHTML(cost) {
    const pay = cost.payment;
    let parts = [];
    if (typeof pay === 'string') {
        parts = [pay.trim()];
    } else if (pay && typeof pay === 'object') {
        const label = configText(pay.label);
        const amount = typeof pay.amount === 'number' ? configMoney(pay.amount) : configText(pay.amount);
        const due = configText(pay.due);
        const dueText = due ? `${label || amount ? 'due' : 'Due'} ${configDate(due) ? monthDay(due) : due}` : '';
        parts = [[label, amount, dueText].filter(Boolean).join(' '), configText(pay.how), configText(pay.note)];
    }
    if (!parts.some(Boolean)) {
        return `<p class="fact-tip"${phaseAttrs('pre')}>${icon('wallet')}<span>Don’t send money yet. Payment details come with the final breakdown.</span></p>`;
    }
    return `<p class="fact-tip is-set">${icon('wallet')}<span>${tipPartsHTML(parts)}</span></p>`;
}

// ---------------------------------------------------------------------------
// Trip updates and Still to come, at the top of The Trip section
// ---------------------------------------------------------------------------
const NEWS_SHOWN = 3; // the latest three; any older ones fold under "Show older"

// trip.updates, newest first; entries on the same day keep the config's order. An entry without a
// 'YYYY-MM-DD' date (left out, or typed another way) goes first, undated, so a typo can't fold the
// newest news away under "Show older".
function tripUpdates() {
    return (Array.isArray(TRIP.updates) ? TRIP.updates : [])
        .map((u, i) => {
            const entry = typeof u === 'string' ? { text: u } : u || {};
            return { date: configDate(entry.date), text: configText(entry.text), i };
        })
        .filter(u => u.text)
        .sort((a, b) => {
            const da = a.date || '9999', db = b.date || '9999';
            return da === db ? a.i - b.i : da < db ? 1 : -1;
        });
}

function stillToCome() {
    return (Array.isArray(TRIP.stillToCome) ? TRIP.stillToCome : []).map(configText).filter(Boolean);
}

function newsItemHTML(u) {
    const when = u.date ? `<time class="news-date" datetime="${u.date}">${esc(monthDay(u.date))}</time><span class="news-sep" aria-hidden="true">·</span>` : '';
    return `<li>${when}${esc(u.text)}</li>`;
}

function renderNews() {
    const el = document.getElementById('trip-news');
    if (!el) return;
    const updates = tripUpdates();
    // An older trip-config.js has one undated announcement { title, body } instead of updates
    const ann = !updates.length && TRIP.announcement && TRIP.announcement.body ? TRIP.announcement : null;
    const todo = stillToCome();
    const head = `<h2 class="news-head"><span class="news-icon" aria-hidden="true">${icon('megaphone')}</span>Trip updates</h2>`;

    let news = '';
    if (updates.length) {
        const older = updates.slice(NEWS_SHOWN);
        news = `${head}
            <ul class="news-list">${updates.slice(0, NEWS_SHOWN).map(newsItemHTML).join('')}</ul>
            ${older.length ? `
            <details class="news-older">
                <summary><span class="news-older-show">Show ${older.length} older update${older.length === 1 ? '' : 's'}</span><span class="news-older-hide">Hide older updates</span>${icon('chevron')}</summary>
                <ul class="news-list">${older.map(newsItemHTML).join('')}</ul>
            </details>` : ''}`;
    } else if (ann) {
        news = `${head}
            ${ann.title ? `<p class="news-title">${esc(ann.title)}</p>` : ''}
            <p class="news-body">${esc(ann.body)}</p>`;
    }
    // Still to come shows before the trip only (a heading of its own when there's no news above it)
    const tag = news ? 'h3' : 'h2';
    const todoHTML = todo.length ? `
        <div class="news-todo"${phaseAttrs('pre')}>
            <${tag} class="news-head news-head-todo">Still to come</${tag}>
            <ul class="news-todo-list">${todo.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
        </div>` : '';

    el.innerHTML = `${news ? `<div class="news-updates">${news}</div>` : ''}${todoHTML}`;
    // No news and no list: no box. Only the list: the box goes with it once the trip starts.
    if (news || !todo.length) {
        el.removeAttribute('data-phase');
        el.hidden = !news;
    } else {
        el.dataset.phase = 'pre';
        el.hidden = phase.name !== 'pre';
    }
}

// ---------------------------------------------------------------------------
// Countdown
// ---------------------------------------------------------------------------
let countdownTimer = null;
function initCountdown() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    // From the first trip day the Today card (then That's a wrap) takes this slot
    if (phase.name !== 'pre') return;
    const target = new Date(TRIP.countdownTarget || '2027-04-08T07:00:00-07:00').getTime();
    const els = ['cd-days', 'cd-hours', 'cd-mins', 'cd-secs'].map(id => document.getElementById(id));
    const label = document.getElementById('cd-label');
    if (els.some(el => !el)) return;
    if (label && TRIP.countdownLabel) label.textContent = TRIP.countdownLabel;

    function update() {
        let distance = target - nowMs();
        if (distance <= 0) {
            els.forEach(el => { el.textContent = '00'; });
            if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
            return;
        }
        const days = Math.floor(distance / 86400000);
        distance %= 86400000;
        const hours = Math.floor(distance / 3600000);
        distance %= 3600000;
        const minutes = Math.floor(distance / 60000);
        const seconds = Math.floor((distance % 60000) / 1000);
        els[0].textContent = String(days).padStart(2, '0');
        els[1].textContent = String(hours).padStart(2, '0');
        els[2].textContent = String(minutes).padStart(2, '0');
        els[3].textContent = String(seconds).padStart(2, '0');
    }
    update();
    if (target > nowMs()) countdownTimer = setInterval(update, 1000);
}

// ---------------------------------------------------------------------------
// Trip-day mode: what changes with the phase
// ---------------------------------------------------------------------------
// Shows the [data-phase] elements for this phase (header and drawer pairs, hero buttons, the
// countdown or the Today card), puts the Cup ahead of the courses, and fills the day's card.
// Safe to run again: checkPhase re-runs it when the day, the phase or the evening changes.
function applyPhase() {
    const root = document.documentElement;
    root.classList.remove('phase-pre', 'phase-trip', 'phase-wrap');
    document.querySelectorAll('[data-phase]').forEach(el => {
        el.hidden = !el.dataset.phase.split(' ').includes(phase.name);
    });
    // Until a phase is set every [data-phase] element is invisible (home.css), so a trip-day visitor
    // never sees the RSVP buttons flash up first. The small script in index.html sets it before the
    // supabase-js bundle loads; this keeps it right from then on.
    root.classList.add(`phase-${phase.name}`, 'phase-set');
    [orderSections, renderTodayCard, renderCupPillLabel, renderCrewPhase, renderNextEdition, renderPreviewRibbon].forEach(fn => {
        try { fn(); } catch (err) { console.error(`${fn.name} failed:`, err); }
    });
}

// A phone left open overnight moves on by itself: the next day's card, the Tomorrow line at
// 6 PM, trip-day mode at midnight. Checked twice a minute and whenever the page comes back.
function checkPhase() {
    const next = tripPhase(nowMs());
    const key = p => `${p.name}|${p.date}|${p.evening}`;
    const changed = key(next) !== key(phase);
    phase = next;
    if (!changed) return;
    [applyPhase, renderSchedule, initCountdown].forEach(fn => {
        try { fn(); } catch (err) { console.error(`${fn.name} failed:`, err); }
    });
    if (personalReady) renderPersonal();
    initReveals();
}

function watchPhase() {
    setInterval(checkPhase, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) checkPhase(); });
}

function itineraryDay(date) {
    return (CFG.itinerary || []).find(d => d && d.date === date) || null;
}

// '#course-…' for a slot that names a course, else null
function slotCourseHref(slot) {
    const group = slot && slot.courseId ? findCourseGroup(slot.courseId) : null;
    return group ? `#course-${group.anchor || group.id}` : null;
}

function slotWhatHTML(slot) {
    const href = slotCourseHref(slot);
    return href ? `<a href="${esc(href)}">${esc(slot.what)}</a>` : esc(slot.what);
}

// During the trip: today's itinerary entry (Live scores / Keep score follow, in index.html). From
// 6 PM, a quiet line with tomorrow's first slot.
function todayCardHTML() {
    const day = itineraryDay(phase.date);
    const rows = (day && day.slots || []).map(s => {
        const href = slotCourseHref(s);
        const cells = `<span class="slot-when">${esc(s.when)}</span><span class="slot-what">${esc(s.what)}</span><span class="slot-meta">${esc(s.meta || '')}</span>`;
        // The whole row is the link (a 44px+ target), to the course card
        return `<li>${href
            ? `<a class="slot today-slot" href="${esc(href)}">${cells}<span class="today-slot-go" aria-hidden="true">${icon('chevronRight')}</span></a>`
            : `<div class="slot today-slot">${cells}</div>`}</li>`;
    }).join('');
    const title = day ? day.title : `${TRIP.name || 'Bros before Boges'} ${TRIP.year || ''}`.trim();

    const next = phase.evening ? itineraryDay(addDays(phase.date, 1)) : null;
    const first = next && (next.slots || [])[0];
    const tomorrow = first
        ? `${slotWhatHTML(first)}${first.meta ? ` · ${esc(first.meta)}` : ''}`
        : next ? esc(next.title) : '';

    return `
        <p class="today-eyebrow"><b>Today</b><span class="today-sep">·</span>${esc(shortDay(phase.date))}</p>
        ${title ? `<h2 class="today-title">${esc(title)}</h2>` : ''}
        ${rows ? `<ul class="today-slots">${rows}</ul>` : ''}
        ${tomorrow ? `<p class="today-next"><span>Tomorrow:</span> ${tomorrow}</p>` : ''}`;
}

// After the trip (Final scores / Settle up follow, in index.html)
function wrapCardHTML() {
    const where = (TRIP.location || '').split(',')[0];
    return `
        <p class="today-eyebrow"><b>That’s a wrap</b>${where ? `<span class="today-where"><span class="today-sep">·</span>${esc(where)} ${esc(TRIP.year || '')}</span>` : ''}</p>
        <h2 class="today-title">Thanks for a great trip.</h2>`;
}

function renderTodayCard() {
    const el = document.getElementById('hero-today');
    const body = document.getElementById('hero-today-body');
    if (!el || !body) return;
    body.innerHTML = phase.name === 'trip' ? todayCardHTML() : phase.name === 'wrap' ? wrapCardHTML() : '';
    el.classList.toggle('is-wrap', phase.name === 'wrap');
    // "Add your photos" only when this trip's album in trip-config has a shareUrl
    const photos = document.getElementById('wrap-photos');
    const album = (CFG.photoAlbums || []).find(a => a && String(a.year) === String(TRIP.year) && /^https:\/\//i.test(a.shareUrl || ''));
    if (photos) {
        photos.hidden = !album;
        if (album) photos.href = album.shareUrl;
    }
}

function renderCupPillLabel() {
    const pill = document.getElementById('team-scoreboard-widget');
    const label = document.getElementById('cup-pill-label');
    if (!pill || !label) return;
    label.textContent = phase.name === 'wrap' ? 'Final' : 'The Cup';
    pill.classList.toggle('is-final', phase.name === 'wrap');
}

// Once the trip starts the crew section stops asking for RSVPs (renderCrewCta, renderYouRow and the
// hero head count drop theirs). The head count's own RSVP button stays, outlined, so the sheet is
// still there for anyone who needs it.
function renderCrewPhase() {
    const asking = phase.name === 'pre';
    const lede = document.getElementById('crew-lede');
    if (lede) {
        if (lede.dataset.preText === undefined) lede.dataset.preText = lede.textContent;
        const where = (TRIP.location || '').split(',')[0] || 'the trip';
        lede.textContent = asking ? lede.dataset.preText
            : phase.name === 'trip' ? `The crew in ${where} this week.` : `The crew that made it to ${where}.`;
    }
    const btn = document.getElementById('hc-rsvp');
    if (btn) {
        btn.classList.toggle('btn-copper', asking);
        btn.classList.toggle('btn-line', !asking);
    }
}

// During and after the trip the Cup comes before the course guide, on the page and in the menus
function orderSections() {
    const cup = document.getElementById('cup');
    const courses = document.getElementById('courses');
    if (!cup || !courses) return;
    const cupFirst = phase.name !== 'pre';
    const navItem = sel => { const a = document.querySelector(sel); return a ? a.closest('li') : null; };
    [
        [cup, courses],
        [navItem('.nav-links a[href="#cup"]'), navItem('.nav-links a[href="#courses"]')],
        [document.querySelector('#drawer > a[href="#cup"]'), document.querySelector('#drawer > a[href="#courses"]')]
    ].forEach(([c, k]) => {
        if (!c || !k || c.parentNode !== k.parentNode) return;
        const cupIsFirst = !!(k.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_PRECEDING);
        if (cupFirst && !cupIsFirst) k.before(c);
        if (!cupFirst && cupIsFirst) c.before(k);
    });
    // Keep the section backgrounds alternating
    cup.classList.toggle('section-alt', !cupFirst);
    courses.classList.toggle('section-alt', cupFirst);
}

// "Preview · Fri Apr 9, 6:45 AM (Arizona) · Exit", so a preview can't pass for the real thing
function renderPreviewRibbon() {
    if (!PREVIEW || document.getElementById('preview-ribbon')) return;
    const c = tripClock(PREVIEW.at);
    const when = `${shortDay(c.date)}, ${c.hour % 12 || 12}:${String(c.minute).padStart(2, '0')} ${c.hour < 12 ? 'AM' : 'PM'}`;
    const params = new URLSearchParams(window.location.search);
    params.delete('preview');
    const qs = params.toString();
    const ribbon = document.createElement('div');
    ribbon.className = 'preview-ribbon';
    ribbon.id = 'preview-ribbon';
    ribbon.setAttribute('role', 'note');
    ribbon.innerHTML = `<span class="preview-ribbon-dot" aria-hidden="true"></span><span><b>Preview</b> · ${esc(when)} (${esc(TRIP_TZ_NAME)})</span><span aria-hidden="true">·</span><a href="${esc(window.location.pathname + (qs ? `?${qs}` : ''))}" aria-label="Exit preview">Exit</a>`;
    document.body.appendChild(ribbon);
}

// ---------------------------------------------------------------------------
// Itinerary
// ---------------------------------------------------------------------------
function renderSchedule() {
    if (!elements.scheduleTimeline) return;
    const lede = document.getElementById('itinerary-lede');
    if (lede && CFG.itineraryLede) lede.textContent = CFG.itineraryLede;

    const dawnSvg = `<svg viewBox="0 0 400 80" preserveAspectRatio="none" aria-hidden="true"><path fill="currentColor" d="M0 80V52l40-14 30 10 44-28 38 22 30-12 50 26 36-18 42 20 34-16 56 24v14z"/><path fill="currentColor" d="M300 80V30h8v12c0 4 2 6 6 6h4V36h8v24h-4c-4 0-6 2-6 6v14z" opacity=".9"/></svg>`;

    elements.scheduleTimeline.innerHTML = (CFG.itinerary || []).map((day, idx) => {
        // During the trip: today's card gets a TODAY tag, earlier days fold down and dim
        const isToday = phase.name === 'trip' && day.date === phase.date;
        const isPast = phase.name === 'trip' && day.date < phase.date;
        const d = new Date(`${day.date}T12:00:00`);
        const dayNum = String(d.getDate()).padStart(2, '0');
        const month = d.toLocaleString('en-US', { month: 'short' });
        const dow = d.toLocaleString('en-US', { weekday: 'long' });
        const m = day.media || {};
        let media = '';
        if (m.type === 'split') {
            media = `<div class="day-media split">${(m.srcs || []).map(s => `<img src="${esc(s)}" alt="" loading="lazy" decoding="async">`).join('')}`;
        } else if (m.type === 'mystery') {
            media = `<div class="day-media mystery"><span class="q" aria-hidden="true">?</span>`;
        } else if (m.type === 'dawn') {
            media = `<div class="day-media dawn">${dawnSvg}`;
        } else {
            media = `<div class="day-media"><img src="${esc(m.src)}" alt="${esc(m.alt || '')}" loading="lazy" decoding="async">`;
        }
        media += `${isToday ? '<span class="day-today">Today</span>' : ''}${day.tag ? `<span class="day-tag ${day.tagSoft ? 'soft' : ''}">${esc(day.tag)}</span>` : ''}
            <div class="day-date"><b>${dayNum}</b><span>${esc(month)}<small>${esc(dow)}</small></span></div></div>`;

        // A slot with a course is one big link to its course card: the course name's link
        // stretches over the whole row (home.css), with a chevron and "Course guide" to say so.
        // The dot rides with "Course guide", so a wrapped meta line never ends on a lone "·".
        const slots = (day.slots || []).map(s => {
            const href = slotCourseHref(s);
            if (!href) return `<li class="slot"><span class="slot-when">${esc(s.when)}</span><span class="slot-what">${esc(s.what)}</span><span class="slot-meta">${esc(s.meta || '')}</span></li>`;
            return `<li class="slot has-link"><span class="slot-when">${esc(s.when)}</span><span class="slot-what"><a class="slot-link" href="${esc(href)}">${esc(s.what)}</a></span><span class="slot-meta">${s.meta ? `${esc(s.meta)} ` : ''}<span class="slot-guide nowrap">${s.meta ? '· ' : ''}Course guide</span></span><span class="slot-go" aria-hidden="true">${icon('chevronRight')}</span></li>`;
        }).join('');

        return `
        <article class="day reveal reveal-delay-${idx % 4}${isToday ? ' is-today' : ''}${isPast ? ' is-past' : ''}"${isToday ? ' aria-current="date"' : ''}>
            ${media}
            <div class="day-body">
                <h3 class="day-title">${esc(day.title)}</h3>
                ${day.text ? `<p class="day-text">${esc(day.text)}</p>` : ''}
                <ul class="slots">${slots}</ul>
            </div>
        </article>`;
    }).join('');
}

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------
function scorecardHTML(course) {
    const pars = course.holePars;
    if (!Array.isArray(pars) || pars.length !== 18) return '';
    const yards = Array.isArray(course.holeYards) && course.holeYards.length === 18 ? course.holeYards : null;
    const sum = arr => arr.reduce((a, b) => a + b, 0);
    const cls = p => (p === 3 ? 'par3' : p === 5 ? 'par5' : '');

    // Printed like a real card: front nine and back nine as two short tables,
    // so the whole thing fits without sideways scrolling.
    const nine = (start, label) => {
        const idx = Array.from({ length: 9 }, (_, i) => start + i);
        const p9 = idx.map(i => pars[i]);
        const y9 = yards ? idx.map(i => yards[i]) : null;
        return `
        <div class="scorecard-scroll"><table>
            <colgroup><col class="sc-label"><col span="9"><col class="sc-sum"></colgroup>
            <caption class="sr-only">${esc(course.name)} ${label === 'Out' ? 'front nine' : 'back nine'}</caption>
            <thead><tr><th scope="col">Hole</th>${idx.map(i => `<th scope="col">${i + 1}</th>`).join('')}<th scope="col" class="tot">${label}</th></tr></thead>
            <tbody>
                ${y9 ? `<tr><th scope="row"><abbr title="Yards">Yds</abbr></th>${y9.map(v => `<td>${v}</td>`).join('')}<td class="tot">${sum(y9)}</td></tr>` : ''}
                <tr><th scope="row">Par</th>${idx.map(i => `<td class="${cls(pars[i])}">${pars[i]}</td>`).join('')}<td class="tot">${sum(p9)}</td></tr>
            </tbody>
        </table></div>`;
    };

    return `
    <div class="scorecard" role="region" aria-label="${esc(course.name)} scorecard">
        <div class="scorecard-head"><b>${esc(course.name)}</b><span>${yards ? esc(course.yardsTeeName || 'Back tees') : 'Par by hole'}</span></div>
        ${nine(0, 'Out')}
        ${nine(9, 'In')}
        <div class="scorecard-foot"><span class="sc-total">Total: ${yards ? `${sum(yards).toLocaleString('en-US')} yds · ` : ''}par ${sum(pars)}</span><span><i class="k3">■</i> Par 3</span><span><i class="k5">■</i> Par 5</span>${course.scorecardNote ? `<span>${esc(course.scorecardNote)}</span>` : ''}</div>
    </div>`;
}

function courseBodyHTML(course, group) {
    const stats = (course.stats || []).map(s => `
        <div class="course-stat"><span>${esc(s.label)}</span><b>${esc(s.value)}</b>${s.sub ? `<small>${esc(s.sub)}</small>` : ''}</div>`).join('');
    const holes = (course.signatureHoles || []).map(h => `
        <li class="sig-hole">
            <div class="sig-num"><b>${esc(h.hole)}</b><small>Par ${esc(h.par)}</small></div>
            <p>${h.yards ? `<b>${esc(h.yards)} yds.</b> ` : ''}${esc(h.blurb)}</p>
        </li>`).join('');
    const accolades = (course.accolades || []).map(a => `<span class="accolade">${icon('award')}${esc(a)}</span>`).join('');
    const when = group.when || course.when;
    const scorecard = scorecardHTML(course);
    // The reference detail (designer and tees, signature holes, accolades, scorecard, photo credit)
    // folds into a "Course guide" below the stats, so a phone shows each course in about a screen
    // and a half. It opens downward, so the page above it never moves.
    const guide = [
        course.designer ? `<p class="course-designer">Designed by <b>${esc(course.designer)}</b>${course.opened ? ` · Opened ${esc(course.opened)}` : ''}${course.aka ? ` · ${esc(course.aka)}` : ''}</p>` : '',
        course.midTees ? `<p class="course-designer">Likely our tees: <b>${esc(course.midTees)}</b></p>` : '',
        holes ? `<ul class="sig-holes" aria-label="Signature holes">${holes}</ul>` : '',
        accolades ? `<div class="accolades">${accolades}</div>` : '',
        scorecard,
        course.credit ? `<p class="course-credit">Photos: <a href="${esc(course.credit.url)}" target="_blank" rel="noopener">${esc(course.credit.name)}</a></p>` : ''
    ].filter(Boolean).join('');
    // "Signature holes, tees & scorecard": only what this course's guide actually holds
    const inside = [holes ? 'signature holes' : '', course.midTees ? 'tees' : '', scorecard ? 'scorecard' : ''].filter(Boolean);
    const insideText = inside.length > 1 ? `${inside.slice(0, -1).join(', ')} & ${inside[inside.length - 1]}` : inside[0] || 'designer, accolades & more';
    return `
        <p class="course-club">${esc(group.club || course.club)}</p>
        <h3 class="course-title">${esc(course.name)}</h3>
        ${course.tagline ? `<p class="course-tagline">${esc(course.tagline)}</p>` : ''}
        <p class="course-desc">${esc(course.description)}</p>
        ${when ? `<span class="course-when">${icon('calendar')}${esc(when)}</span>` : ''}
        ${stats ? `<div class="course-stats">${stats}</div>` : ''}
        ${guide ? `
        <details class="course-guide">
            <summary>
                <span class="course-guide-label"><b>Course guide<span class="sr-only">:</span></b><span>${esc(insideText.charAt(0).toUpperCase() + insideText.slice(1))}</span></span>
                ${icon('chevron')}
            </summary>
            <div class="course-guide-body">${guide}</div>
        </details>` : ''}`;
}

function courseGalleryHTML(course, round) {
    const imgs = course.images || [];
    if (!imgs.length) return '';
    const hero = imgs[0];
    return `
        <button type="button" class="course-hero" data-lightbox-course="${esc(course.id)}" data-index="0" aria-label="View ${esc(course.name)} photos full screen"${course.heroAspect ? ` style="aspect-ratio: ${esc(course.heroAspect)};"` : ''}>
            <img src="${esc(hero.src)}" alt="${esc(hero.alt)}" loading="lazy" decoding="async" width="${hero.w || 1600}" height="${hero.h || 1067}">
            ${round ? `<span class="round-badge">${round}</span>` : ''}
            <span class="zoom-hint">${icon('expand')}</span>
        </button>
        ${imgs.length > 1 ? `<div class="thumbs" role="group" aria-label="${esc(course.name)} photos">${imgs.map((im, i) => `
            <button type="button" class="thumb" data-course="${esc(course.id)}" data-index="${i}" aria-pressed="${i === 0}" aria-label="Show photo ${i + 1}: ${esc(im.alt)}">
                <img src="${esc(im.thumb || im.src)}" alt="" loading="lazy" decoding="async">
            </button>`).join('')}</div>` : ''}`;
}

function renderCourses() {
    if (!elements.coursesGrid) return;
    const blocks = (CFG.courses || []).map(group => {
        if (group.tbd) {
            return `
            <article class="course-tbd reveal" id="course-${esc(group.id)}">
                <p class="eyebrow">${esc(group.eyebrow || 'Final Round')}</p>
                <h3 class="course-title">${esc(group.name)}</h3>
                <p>${esc(group.description)}</p>
                ${group.when ? `<span class="course-when" style="margin-top: 22px;">${icon('calendar')}${esc(group.when)}</span>` : ''}
            </article>`;
        }

        const all = group.options || [group];
        const picked = group.selected ? all.filter(o => o.id === group.selected) : [];
        const options = picked.length ? picked : all;
        const first = options[0];
        const tabs = options.length > 1 ? `
            <div class="course-tabs" role="tablist" aria-label="${esc(group.club)} courses">
                ${options.map((o, i) => `<button type="button" role="tab" class="course-tab" id="tab-${esc(o.id)}" aria-controls="panel-${esc(group.id)}" aria-selected="${i === 0}" data-group="${esc(group.id)}" data-course="${esc(o.id)}">${esc(o.shortName || o.name)}</button>`).join('')}
            </div>
            ${group.optionsNote ? `<p class="course-options-note">${icon('info')}${esc(group.optionsNote)}</p>` : ''}` : '';

        return `
        <article class="course reveal${(first.images || []).length ? '' : ' no-media'}" id="course-${esc(group.anchor || group.id)}" data-group-id="${esc(group.id)}">
            <div class="course-gallery" data-gallery-for="${esc(group.id)}">${courseGalleryHTML(first, group.round || first.round)}</div>
            <div class="course-body">
                ${tabs}
                <div id="panel-${esc(group.id)}" ${options.length > 1 ? `role="tabpanel" aria-labelledby="tab-${esc(first.id)}"` : ''} data-body-for="${esc(group.id)}">${courseBodyHTML(first, group)}</div>
            </div>
        </article>`;
    });
    elements.coursesGrid.innerHTML = blocks.join('');

    const credits = document.getElementById('footer-credits');
    if (credits && CFG.photoCredits) credits.innerHTML = CFG.photoCredits;
}

function switchCourseOption(groupId, courseId) {
    const group = (CFG.courses || []).find(g => g.id === groupId);
    const course = findCourse(courseId);
    if (!group || !course) return;
    const gallery = document.querySelector(`[data-gallery-for="${groupId}"]`);
    const body = document.querySelector(`[data-body-for="${groupId}"]`);
    if (gallery) gallery.innerHTML = courseGalleryHTML(course, group.round || course.round);
    if (body) {
        // An open course guide stays open on the other course
        const wasOpen = !!body.querySelector('.course-guide[open]');
        body.innerHTML = courseBodyHTML(course, group);
        const guide = body.querySelector('.course-guide');
        if (guide && wasOpen) guide.open = true;
        body.setAttribute('aria-labelledby', `tab-${courseId}`);
    }
    document.querySelectorAll(`.course-tab[data-group="${groupId}"]`).forEach(t => {
        t.setAttribute('aria-selected', String(t.dataset.course === courseId));
    });
}

function showCoursePhoto(courseId, index) {
    const course = findCourse(courseId);
    if (!course || !course.images || !course.images[index]) return;
    const img = course.images[index];
    const heroBtn = document.querySelector(`.course-hero[data-lightbox-course="${courseId}"]`);
    if (heroBtn) {
        const el = heroBtn.querySelector('img');
        el.style.opacity = '0';
        setTimeout(() => {
            el.src = img.src;
            el.alt = img.alt;
            el.onload = () => { el.style.opacity = '1'; };
            if (el.complete) el.style.opacity = '1';
        }, 180);
        heroBtn.dataset.index = index;
    }
    document.querySelectorAll(`.thumb[data-course="${courseId}"]`).forEach(t => {
        t.setAttribute('aria-pressed', String(Number(t.dataset.index) === index));
    });
}

// ---------------------------------------------------------------------------
// The Cup — champions reel, hardware, and (once live) the teams
// ---------------------------------------------------------------------------
function champsReelHTML(edition, allEditions) {
    if (!edition || !edition.score) return '';
    const blue = Number(edition.score.blue) || 0;
    const red = Number(edition.score.red) || 0;
    const total = edition.totalPoints || (blue + red) || 1;
    const toWin = edition.toWin || (total / 2 + 0.5);
    const winner = edition.champion || (blue > red ? 'blue' : red > blue ? 'red' : null);
    const loser = winner === 'blue' ? 'red' : 'blue';
    const caps = edition.captains || {};
    const rosterMode = edition.rosterDisplay || 'collapsed';
    const squad = winner && edition.rosters ? (edition.rosters[winner] || []) : [];
    const sessions = (edition.sessions || []).filter(s => s && s.label);

    const years = allEditions.length > 1 ? `
        <div class="reel-years" role="group" aria-label="Past results by year">
            ${allEditions.map(e => `<button type="button" class="reel-year" data-year="${esc(e.year)}" aria-pressed="${e.year === edition.year}">${esc(e.year)}</button>`).join('')}
        </div>` : '';

    const side = (team) => `
        <div class="reel-side ${team} ${team === winner ? 'is-winner' : ''}">
            <span class="reel-team">Team ${team === 'blue' ? 'Blue' : 'Red'}</span>
            <b class="reel-score" data-to="${team === 'blue' ? blue : red}" aria-hidden="true">0</b>
            ${caps[team] ? `<span class="reel-cap">Capt. ${esc(caps[team])}</span>` : ''}
            ${team === winner ? `<span class="reel-stamp" aria-hidden="true">${icon('trophy')}Champions</span>` : ''}
        </div>`;

    const sessionRows = sessions.length ? `
        <div class="reel-sessions">
            ${sessions.map(s => {
                const sb = Number(s.blue) || 0, sr = Number(s.red) || 0, st = (sb + sr) || 1;
                return `<div class="reel-session">
                    <span class="rs-label">${esc(s.label)}</span>
                    <span class="rs-num blue">${fmtPoints(sb)}</span>
                    <span class="rs-bar"><i class="blue" style="--w:${(sb / st) * 100}%"></i><i class="red" style="--w:${(sr / st) * 100}%"></i></span>
                    <span class="rs-num red">${fmtPoints(sr)}</span>
                </div>`;
            }).join('')}
        </div>` : '';

    const squadBlock = rosterMode !== 'hidden' && squad.length ? `
        <div class="reel-squad-wrap">
            ${rosterMode === 'collapsed' ? `<button type="button" class="btn btn-line btn-sm reel-squad-btn" aria-expanded="false" aria-controls="reel-squad-${esc(edition.year)}">${icon('users')}See the winning squad</button>` : ''}
            <div class="reel-squad chips" id="reel-squad-${esc(edition.year)}" ${rosterMode === 'collapsed' ? 'hidden' : ''}>
                ${squad.map((n, i) => `<span class="chip ${caps[winner] === n ? 'cap' : ''}" style="--i:${i}">${esc(n)}${caps[winner] === n ? ' · Capt.' : ''}</span>`).join('')}
            </div>
        </div>` : '';

    const sparks = Array.from({ length: 16 }, (_, i) => `<i style="--a:${i * 22.5}deg;--d:${60 + (i % 4) * 22}px;--t:${(i % 5) * 40}ms"></i>`).join('');

    return `
    <div class="reel" data-reel data-year="${esc(edition.year)}" data-winner="${winner || ''}">
        <div class="reel-head">
            <div>
                <h3 class="reel-kicker">${icon('trophy')}${esc(edition.year)} Ryder Cup · Final</h3>
                <p class="reel-where">${esc(edition.location)}${edition.courses ? ` · ${esc(edition.courses.join(' · '))}` : ''}</p>
            </div>
            ${years}
        </div>
        <div class="reel-board" role="group" aria-label="${esc(edition.year)} final: Blue ${blue}, Red ${red}">
            ${side('blue')}
            <div class="reel-vs" aria-hidden="true"><span>vs</span></div>
            ${side('red')}
            <div class="reel-sparks" aria-hidden="true">${sparks}</div>
        </div>
        <div class="reel-track" aria-hidden="true">
            <div class="reel-fill blue" style="--w:${(blue / total) * 100}%"></div>
            <div class="reel-fill red" style="--w:${(red / total) * 100}%"></div>
            <div class="reel-mark" style="--pos:${(toWin / total) * 100}%"><span>${fmtPoints(toWin)} to win</span></div>
        </div>
        ${sessionRows}
        <div class="reel-foot">
            <p class="reel-note">${esc(edition.note || (winner ? `Team ${winner === 'blue' ? 'Blue' : 'Red'} takes the Cup, ${fmtPoints(edition.score[winner])} to ${fmtPoints(edition.score[loser])}.` : 'All square.'))}</p>
            ${squadBlock}
        </div>
    </div>`;
}

function renderCup() {
    const wrap = elements.cupSection;
    if (!wrap) return;
    const cup = CFG.cup || {};
    const editions = (CFG.history || []).filter(e => e.score);
    const latest = editions[0];

    const headline = document.getElementById('cup-headline');
    const subheadline = document.getElementById('cup-subheadline');
    const lede = document.getElementById('cup-lede');
    if (cup.headline && headline) headline.textContent = cup.headline;
    if (cup.subheadline && subheadline) subheadline.textContent = cup.subheadline;
    if (cup.lede && lede) lede.textContent = cup.lede;

    const team1 = roster.confirmed.filter(p => p.team_id === 1);
    const team2 = roster.confirmed.filter(p => p.team_id === 2);
    const liveTeams = SEASON_LIVE && (team1.length || team2.length);

    let html = '';

    if (SEASON_LIVE) {
        html += `
        <div class="cup-live" id="cup-live">
            <div class="side blue"><span>Blue</span><b id="home-ryder-blue-pts">0</b></div>
            <div class="vs">vs</div>
            <div class="side red"><span>Red</span><b id="home-ryder-red-pts">0</b></div>
            <p class="needed">${esc(cup.liveNote || 'The official Cup total, updated by the commissioner after every session.')}</p>
            <a class="cup-live-link" href="round_tracker.html#board">Live scores, hole by hole <span aria-hidden="true">›</span></a>
        </div>`;
    }

    if (liveTeams) {
        const teamCard = (team, n) => {
            const color = n === 1 ? 'var(--blue-team)' : 'var(--red-team)';
            const withHcp = team.filter(p => typeof p.handicap === 'number');
            const avg = withHcp.length ? fmtHcp(withHcp.reduce((a, p) => a + p.handicap, 0) / withHcp.length) : '–';
            return `
            <div class="team-card" style="--team-color: ${color};">
                <h3>${n === 1 ? 'Team Blue' : 'Team Red'} <small>Avg HCP ${avg}</small></h3>
                ${team.map(p => `<div class="team-row"><span>${esc(p.name)}${isCaptain(p.name) ? '<span class="cap-tag">Capt.</span>' : ''}</span><span class="hcp">${fmtHcp(p.handicap)}</span></div>`).join('')}
            </div>`;
        };
        html += `<div class="teams">${teamCard(team1, 1)}${teamCard(team2, 2)}</div>`;
    } else if (latest) {
        html += `<div class="cup-reel-slot" style="grid-column: 1 / -1;">${champsReelHTML(latest, editions)}</div>`;
    }

    // The hardware + this year's draft. Once drafted teams are live the draft card has said its
    // piece, so the hardware runs full width and keeps the rules link.
    const trophy = cup.trophy;
    html += `
        <div class="cup-card cup-hardware reveal${liveTeams ? ' is-wide' : ''}">
            ${trophy && trophy.src ? `<button type="button" class="hardware-photo" data-lightbox-single="${esc(trophy.full || trophy.src)}" data-caption="${esc(trophy.caption || '')}" aria-label="View the trophy full screen"><img src="${esc(trophy.src)}" alt="${esc(trophy.alt || 'The Bros before Boges trophy')}" loading="lazy" decoding="async"></button>` : ''}
            <div>
                <p class="eyebrow">The Hardware</p>
                <h3>${esc(cup.trophyTitle || 'The Cup')}</h3>
                <p>${esc(cup.trophyText || '')}</p>
                ${liveTeams ? '<a class="btn btn-line btn-sm" href="rules.html" style="margin-top: 22px;">Read the rules</a>' : ''}
            </div>
        </div>`;
    if (!liveTeams) html += `
        <div class="cup-card reveal reveal-delay-1">
            <p class="eyebrow">${esc(TRIP.year)} Draft</p>
            <h3>${esc(cup.draftTitle || 'Draft pending')}</h3>
            <p>${esc(cup.draftText || '')}</p>
            <ul class="cup-rules">
                ${(cup.points || []).map(pt => `<li>${icon('check')}<span>${esc(pt)}</span></li>`).join('')}
            </ul>
            ${CAPTAINS.length
                ? `<div class="chips" style="margin-top: 18px;">${CAPTAINS.map(c => `<span class="chip cap">${esc(c)} · Capt.</span>`).join('')}</div>`
                : (cup.captainsNote ? `<div class="chips" style="margin-top: 18px;"><span class="chip pending">${esc(cup.captainsNote)}</span></div>` : '')}
            <a class="btn btn-line btn-sm" href="rules.html" style="margin-top: 22px;">Read the rules</a>
        </div>`;

    wrap.innerHTML = html;
    initReels();
    initReveals();
}

// Animate a champions reel when it scrolls into view
function playReel(reel) {
    if (!reel || reel.dataset.played === '1') return;
    reel.dataset.played = '1';
    const scores = reel.querySelectorAll('.reel-score');
    if (REDUCED_MOTION) {
        scores.forEach(el => { el.textContent = fmtPoints(el.dataset.to); });
        reel.classList.add('is-played', 'is-done');
        return;
    }
    reel.classList.add('is-played');
    const duration = 1900;
    const start = performance.now();
    const ease = t => 1 - Math.pow(1 - t, 3);
    function frame(now) {
        const t = Math.min(1, Math.max(0, (now - start) / duration));
        scores.forEach(el => {
            const to = Number(el.dataset.to) || 0;
            const val = Math.round(to * ease(t) * 2) / 2; // count in half points
            el.textContent = fmtPoints(val);
        });
        if (t < 1) requestAnimationFrame(frame);
        else setTimeout(() => reel.classList.add('is-done'), 120);
    }
    requestAnimationFrame(frame);
}

let reelObserver = null;
function initReels() {
    const reels = document.querySelectorAll('[data-reel]');
    if (!reels.length) return;
    if (!('IntersectionObserver' in window)) { reels.forEach(playReel); return; }
    if (!reelObserver) {
        reelObserver = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    playReel(entry.target);
                    reelObserver.unobserve(entry.target);
                }
            });
        }, { threshold: 0.45 });
    }
    reels.forEach(r => { if (r.dataset.played !== '1') reelObserver.observe(r); });
}

function switchReelYear(year) {
    const editions = (CFG.history || []).filter(e => e.score);
    const edition = editions.find(e => String(e.year) === String(year));
    const slot = document.querySelector('.cup-reel-slot');
    if (!edition || !slot) return;
    slot.innerHTML = champsReelHTML(edition, editions);
    const reel = slot.querySelector('[data-reel]');
    void reel.offsetWidth; // flush styles so the bars animate from zero
    requestAnimationFrame(() => playReel(reel));
    const btn = slot.querySelector(`.reel-year[data-year="${year}"]`);
    if (btn) btn.focus();
}

// ---------------------------------------------------------------------------
// Hall of Fame
// ---------------------------------------------------------------------------
// This year's row: "Up next" with the dates, "This week" with Live scores during the trip, and
// Final scores after it (until the commissioner adds the result to history in trip-config.js)
function nextEditionResultHTML() {
    if (phase.name === 'trip') return `<b>This week</b><a class="edition-link" href="round_tracker.html#board">Live scores${icon('chevronRight')}</a>`;
    if (phase.name === 'wrap') return `<b>In the books</b><a class="edition-link" href="round_tracker.html#board">Final scores${icon('chevronRight')}</a>`;
    return `<b>Up next</b><span style="color: var(--copper);">${esc(TRIP.dates && TRIP.dates.short)}</span>`;
}

function renderNextEdition() {
    const el = document.getElementById('edition-next-result');
    if (el) el.innerHTML = nextEditionResultHTML();
}

function renderHallOfFame() {
    const list = document.getElementById('editions');
    if (list) {
        const next = `
            <div class="edition next reveal">
                <h3 class="edition-year">${esc(TRIP.year)}</h3>
                <div><div class="edition-where">${esc(TRIP.location)}</div><div class="edition-note">${esc(CFG.hallOfFameNextNote || '')}</div></div>
                <div class="edition-result" id="edition-next-result">${nextEditionResultHTML()}</div>
            </div>`;
        const past = (CFG.history || []).map(e => {
            const w = e.champion;
            const result = e.score && w ? `<b>${fmtPoints(e.score[w])}–${fmtPoints(e.score[w === 'blue' ? 'red' : 'blue'])}</b><span style="color: var(--${w}-team);">Team ${w === 'blue' ? 'Blue' : 'Red'} wins</span>` : (e.resultText ? `<b>${esc(e.resultText)}</b>` : '');
            const album = (CFG.photoAlbums || []).find(a => String(a.year) === String(e.year) && (a.photos || []).length);
            return `
            <div class="edition reveal">
                <h3 class="edition-year">${esc(e.year)}</h3>
                <div>
                    <div class="edition-where">${esc(e.location)}</div>
                    <div class="edition-note">${esc((e.courses || []).join(' · '))}</div>
                    ${album ? `<button type="button" class="edition-photos" data-album-open="${esc(album.id)}">${icon('camera')}View ${album.photos.length} photos</button>` : ''}
                </div>
                <div class="edition-result">${result}</div>
            </div>`;
        }).join('');
        list.innerHTML = next + past;
    }

    renderPhotoWall();
}

// ---------------------------------------------------------------------------
// Photo wall: albums per trip, shown as a five-tile mosaic
// ---------------------------------------------------------------------------
const MOSAIC_TILES = 5;
let activeAlbumId = null;

function photoAlbums() {
    return (CFG.photoAlbums || []).filter(a => a && (a.photos || []).length);
}

function mosaicHTML(album) {
    const photos = album.photos;
    const shown = photos.slice(0, MOSAIC_TILES);
    const extra = photos.length - shown.length;
    return shown.map((p, i) => {
        const isLast = i === shown.length - 1 && extra > 0;
        const label = isLast
            ? `Open photo ${i + 1} of ${photos.length} (${extra} more in this album)`
            : `Open photo ${i + 1} of ${photos.length}: ${p.alt}`;
        return `
        <button type="button" class="mosaic-tile" data-album="${esc(album.id)}" data-index="${i}" aria-label="${esc(label)}">
            <img src="${esc(p.src)}" alt="${esc(p.alt)}" loading="lazy" decoding="async"${p.pos ? ` style="object-position: ${esc(p.pos)};"` : ''}>
            ${i === 0 ? `<span class="mosaic-caption" aria-hidden="true">${esc(album.label)}</span>` : ''}
            ${isLast ? `<span class="mosaic-more" aria-hidden="true">+${extra}<small>more</small></span>` : ''}
        </button>`;
    }).join('');
}

function renderPhotoWall(albumId) {
    const wall = document.getElementById('gallery');
    const albums = photoAlbums();
    if (!wall) return;
    if (!albums.length) { wall.innerHTML = ''; return; }
    const album = albums.find(a => a.id === albumId) || albums.find(a => a.id === activeAlbumId) || albums[0];
    activeAlbumId = album.id;

    wall.innerHTML = `
        <div class="photo-wall-head">
            <h3 class="photo-wall-title">The photo wall</h3>
            ${albums.length > 1 ? `
            <div class="album-picker" role="group" aria-label="Photo albums">
                ${albums.map(a => `<button type="button" class="album-chip" data-album-pick="${esc(a.id)}" aria-pressed="${a.id === album.id}">${esc(a.label)}<span>${a.photos.length}</span></button>`).join('')}
            </div>` : ''}
        </div>
        <div class="mosaic count-${Math.min(album.photos.length, MOSAIC_TILES)}" id="mosaic">${mosaicHTML(album)}</div>
        <div class="photo-wall-foot">
            <button type="button" class="btn btn-line btn-sm" data-album-open="${esc(album.id)}">${icon('camera')}View all ${album.photos.length} photos</button>
        </div>`;
}

function switchAlbum(albumId) {
    const mosaic = document.getElementById('mosaic');
    if (!mosaic || REDUCED_MOTION) { renderPhotoWall(albumId); focusAlbumChip(albumId); return; }
    mosaic.classList.add('is-swapping');
    setTimeout(() => {
        renderPhotoWall(albumId);
        focusAlbumChip(albumId);
    }, 180);
}

function focusAlbumChip(albumId) {
    const chip = document.querySelector(`.album-chip[data-album-pick="${albumId}"]`);
    if (chip) chip.focus();
}

function openAlbum(albumId, index) {
    const album = photoAlbums().find(a => a.id === albumId);
    if (!album) return;
    openLightbox(album.photos.map(p => ({ src: p.full || p.src, alt: p.alt, caption: album.label })), index || 0);
}

// ---------------------------------------------------------------------------
// Roster (Supabase)
// ---------------------------------------------------------------------------
// init() renders once both the roster and the RSVPs are in, so nothing here renders.
async function loadRosterData() {
    if (!supabaseInstance) {
        console.warn('Supabase not configured. Using empty roster.');
        roster.error = true;
        return;
    }

    try {
        // Only rows the page shows: confirmed players and names the commissioner added.
        // (Self sign-ups waiting for approval stay private, and can't crowd the list.)
        // No GHIN numbers: the public lists show handicaps only. A player's own GHIN loads with his
        // account (loadAccount) for his golf profile, and Admin has everyone's.
        const { data, error } = await supabaseInstance
            .from('players')
            .select('id, name, handicap, team_id, status, user_id')
            .or('status.eq.confirmed,user_id.is.null')
            .order('name');

        if (error) {
            console.error('Error fetching roster:', error);
            roster.error = true;
            return;
        }

        roster.error = false;
        roster.loaded = true;
        roster.confirmed = [];
        roster.potential = [];
        (data || []).forEach(p => {
            if (!p || !p.name) return;
            if (p.status === 'confirmed') {
                roster.confirmed.push({
                    id: p.id,
                    name: p.name,
                    handicap: p.handicap !== null && p.handicap !== undefined ? parseFloat(p.handicap) : null,
                    team_id: p.team_id
                });
            } else if (p.status === 'potential' && !p.user_id) {
                // Only names the commissioner added. Self sign-ups stay private until approved.
                roster.potential.push(p.name);
            }
        });
    } catch (e) {
        console.error('Roster fetch failed:', e);
        roster.error = true;
    }
}

// Plus handicaps are stored as negative numbers; golfers write them as "+2.1".
function fmtHcp(h) {
    if (h === null || h === undefined || h === '' || isNaN(Number(h))) return '–';
    const n = Number(h);
    return n < 0 ? `+${Math.abs(n).toFixed(1)}` : n.toFixed(1);
}

// The signed-in viewer's own roster row
function isMe(playerId) {
    const v = viewer();
    return !!(v && v.player && playerId && v.player.id === playerId);
}

const YOU_TAG = '<span class="you-tag">You</span>';

// A handicap as the crew list shows it: "10.0" / "+1.2" over a small HCP, or just "No HCP".
// (No GHIN numbers on public lists: those are for the captains and Admin.)
function hcpBadgeHTML(handicap) {
    const hcp = fmtHcp(handicap);
    return hcp === '–'
        ? '<div class="player-hcp is-none"><span>No HCP</span></div>'
        : `<div class="player-hcp"><b>${esc(hcp)}</b><span>HCP</span></div>`;
}

// `waiting`: the viewer's own card while the commissioner hasn't approved them yet (only they see it)
function playerCardHTML(p, i, meta, waiting) {
    const nameKey = p.name.replace(/\s+/g, '');
    const hasCard = (CFG.playerCards || []).includes(nameKey);
    const cap = isCaptain(p.name);
    const me = waiting || isMe(p.id);
    return `
            <div class="player ${cap ? 'is-captain' : ''} ${me ? 'is-you' : ''} ${waiting ? 'is-waiting' : ''} reveal" style="transition-delay: ${Math.min(i, 12) * 30}ms;">
                <div class="player-avatar">
                    <span>${esc(getInitials(p.name))}</span>
                    ${hasCard ? `<img src="assets/PlayerCards/${esc(nameKey)}.jpg" alt="" loading="lazy" onerror="this.remove()">` : ''}
                </div>
                <div class="player-info">
                    <div class="player-name">${esc(p.name)}${cap ? '<span class="cap-tag">Capt.</span>' : ''}${me && !waiting ? YOU_TAG : ''}</div>
                    ${meta ? `<div class="player-meta">${esc(meta)}</div>` : ''}
                </div>
                ${hcpBadgeHTML(p.handicap)}
            </div>`;
}

// A name chip in the Probably / Can't make it lists. The viewer's own chip gets a You tag;
// while they wait on approval it's a dashed placeholder only they can see.
function rsvpChipHTML(name, cls, playerId) {
    if (isMe(playerId)) return `<span class="chip ${cls} is-you"><span class="chip-name">${esc(name)}</span>${YOU_TAG}</span>`;
    return `<span class="chip ${cls}">${esc(name)}</span>`;
}

function waitingChipHTML(name) {
    return `<span class="chip is-waiting">${esc(name)} · you, waiting on approval</span>`;
}

function renderRoster() {
    const grid = elements.confirmedRoster;
    if (!grid) return;
    // The head count needs the roster too (only confirmed players count); without it, show
    // "couldn't load" rather than zero.
    if (rsvpState.available && !roster.error) {
        renderHeadcount();
        return;
    }
    const inTitle = document.getElementById('confirmed-roster-title');
    const maybeTitle = document.getElementById('potential-roster-title');
    // Until the season is live the DB roster is last year's crew, not 2027 commitments.
    if (inTitle) inTitle.textContent = SEASON_LIVE ? 'Locked in' : `The ${TRIP.year ? TRIP.year - 1 : ''} crew`.replace('  ', ' ');
    if (maybeTitle) maybeTitle.textContent = 'On the bubble';
    if (elements.outBlock) elements.outBlock.hidden = true;

    if (roster.error) {
        grid.innerHTML = `<div class="crew-empty" style="grid-column: 1 / -1;">Couldn’t load the crew right now. Refresh to try again.</div>`;
    } else if (!roster.confirmed.length) {
        grid.innerHTML = `<div class="crew-empty" style="grid-column: 1 / -1;">No one’s locked in yet. Be the first to RSVP.</div>`;
    } else {
        const sorted = [...roster.confirmed].sort((a, b) => {
            const ca = isCaptain(a.name) ? 0 : 1, cb = isCaptain(b.name) ? 0 : 1;
            if (ca !== cb) return ca - cb;
            return (a.name || '').localeCompare(b.name || '');
        });
        grid.innerHTML = sorted.map((p, i) => playerCardHTML(p, i, '')).join('');
    }

    if (elements.crewCount) {
        elements.crewCount.textContent = roster.confirmed.length ? `${roster.confirmed.length} golfer${roster.confirmed.length === 1 ? '' : 's'}` : '';
    }

    if (elements.potentialRoster && elements.bubbleBlock) {
        elements.bubbleBlock.hidden = roster.potential.length === 0;
        elements.potentialRoster.innerHTML = roster.potential.map(name => `<span class="chip muted">${esc(name)}</span>`).join('');
    }

    initReveals();
}

// ---------------------------------------------------------------------------
// RSVP / head count
// ---------------------------------------------------------------------------
function normName(name) {
    return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function cleanName(name) {
    return String(name || '').trim().replace(/\s+/g, ' ');
}

function isMissingTable(error) {
    const text = `${error && error.code || ''} ${error && error.message || ''}`;
    return /42P01|PGRST205|PGRST106|does not exist|could not find the table/i.test(text);
}

function timeAgo(iso) {
    const then = new Date(iso).getTime();
    if (!then) return '';
    const mins = Math.round((Date.now() - then) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`;
    const days = Math.round(hrs / 24);
    if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

async function loadRsvps() {
    if (!supabaseInstance) return;
    try {
        // One latest row per player, from rsvp_accounts.sql, so a long history can't crowd out
        // anyone's current answer. Until that script has run, read the table instead.
        let { data, error } = await supabaseInstance.rpc('rsvp_latest', { p_trip_year: RSVP_YEAR });
        if (error && /PGRST202|could not find the function/i.test(`${error.code || ''} ${error.message || ''}`)) {
            ({ data, error } = await supabaseInstance
                .from('rsvps')
                .select('name, status, sunday_round, created_at, player_id')
                .eq('trip_year', RSVP_YEAR)
                .order('created_at', { ascending: false })
                .limit(1000));
        }
        if (data) data = data.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));

        if (error) {
            rsvpState.available = false;
            rsvpState.missingTable = isMissingTable(error);
            if (!rsvpState.missingTable) console.error('Error loading RSVPs:', error);
            return;
        }

        // Sorted newest first, so the first row seen for each player is their latest answer
        const latest = new Map();
        (data || []).forEach(r => {
            if (!r || !RSVP_LABELS[r.status]) return;
            const key = r.player_id || `name:${normName(r.name)}`;
            if (!latest.has(key)) latest.set(key, r);
        });
        rsvpState.latest = [...latest.values()];
        rsvpState.lastAt = data && data.length ? data[0].created_at : null;
        rsvpState.available = true;
        rsvpState.missingTable = false;
    } catch (e) {
        console.error('RSVP load failed:', e);
    }
}

function rosterPlayerById(id) {
    return id ? roster.confirmed.find(p => p.id === id) || null : null;
}

// Only confirmed roster players count publicly; new sign-ups show up once the
// commissioner approves them in Admin.
function rsvpCounts() {
    const list = rsvpState.latest.filter(r => rosterPlayerById(r.player_id));
    const pick = status => list
        .filter(r => r.status === status)
        .sort((a, b) => rsvpName(a).localeCompare(rsvpName(b)));
    return {
        in: pick('in'),
        maybe: pick('maybe'),
        out: pick('out'),
        sunday: list.filter(r => r.sunday_round && r.status !== 'out').length
    };
}

// Prefer the roster's spelling of a name.
function rsvpName(r) {
    const player = rosterPlayerById(r.player_id);
    return player ? player.name : cleanName(r.name);
}

function myLatestRsvp() {
    const id = account.player && account.player.id;
    return id ? rsvpState.latest.find(r => r.player_id === id) || null : null;
}

// The RSVP-by date (rsvp.lockBy, a day in Arizona): "Lock it in by Nov 30 so we can book rooms." through
// that day, then just "RSVPs were due Nov 30." null when it isn't set, and once the trip has started.
function rsvpDeadline() {
    const by = configDate(RSVP.lockBy);
    if (!by || phase.name !== 'pre') return null;
    const day = monthDay(by);
    const passed = tripClock(nowMs()).date > by;
    return { passed, text: passed ? `RSVPs were due ${day}.` : `Lock it in by ${day} so we can book rooms.` };
}

function renderHeadcount() {
    const counts = rsvpCounts();
    const grid = elements.confirmedRoster;

    const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    setText('hc-in', counts.in.length);
    setText('hc-maybe', counts.maybe.length);
    setText('hc-out', counts.out.length);
    setText('hc-sunday', counts.sunday);
    setText('hc-updated', rsvpState.lastAt ? `Last RSVP ${timeAgo(rsvpState.lastAt)}` : 'No RSVPs yet');
    const due = rsvpDeadline();
    const dueEl = document.getElementById('hc-due');
    if (dueEl) {
        dueEl.hidden = !due;
        dueEl.classList.toggle('is-past', !!(due && due.passed));
        dueEl.innerHTML = due ? `${icon('calendar')}${esc(due.text)}` : '';
    }
    setText('confirmed-roster-title', 'I’m in');
    setText('potential-roster-title', 'Probably');

    const target = Number(RSVP.target) || 0;
    const progress = document.getElementById('hc-progress');
    if (progress) {
        progress.hidden = !target;
        if (target) {
            const fill = document.getElementById('hc-bar-fill');
            if (fill) fill.style.width = `${Math.min(100, (counts.in.length / target) * 100)}%`;
            setText('hc-progress-label', `${counts.in.length} of ${target} spots filled`);
        }
    }
    const panel = document.getElementById('headcount');
    if (panel) panel.hidden = false;

    // A new sign-up isn't on the public lists until approved. Show him his own spot anyway
    // (dashed, to him only) so the head count doesn't look like his RSVP got lost.
    const v = viewer();
    const waiting = v && v.pending && v.status ? v : null;

    if (grid) {
        const cards = counts.in.map((r, i) => {
            const player = rosterPlayerById(r.player_id);
            const meta = r.sunday_round ? 'Sunday round' : `RSVP’d ${timeAgo(r.created_at)}`;
            return playerCardHTML(player, i, meta);
        });
        if (waiting && waiting.status === 'in') cards.push(playerCardHTML(waiting.player, cards.length, 'You, waiting on approval', true));
        grid.innerHTML = cards.length
            ? cards.join('')
            : `<div class="crew-empty" style="grid-column: 1 / -1;">No one’s in yet. Be the first to RSVP.</div>`;
    }

    if (elements.crewCount) {
        elements.crewCount.textContent = counts.in.length ? `${counts.in.length} golfer${counts.in.length === 1 ? '' : 's'}` : '';
    }
    const chipList = (list, cls, status) => list.map(r => rsvpChipHTML(rsvpName(r), cls, r.player_id))
        .concat(waiting && waiting.status === status ? [waitingChipHTML(waiting.player.name)] : []);
    if (elements.potentialRoster && elements.bubbleBlock) {
        const chips = chipList(counts.maybe, 'muted', 'maybe');
        elements.bubbleBlock.hidden = chips.length === 0;
        elements.potentialRoster.innerHTML = chips.join('');
    }
    if (elements.outRoster && elements.outBlock) {
        const chips = chipList(counts.out, 'out', 'out');
        elements.outBlock.hidden = chips.length === 0;
        elements.outRoster.innerHTML = chips.join('');
    }

    updateHeroHeadcount(counts);
    initReveals();
}

function updateHeroHeadcount(counts) {
    const facts = document.getElementById('hero-facts');
    if (!facts) return;
    let li = document.getElementById('hero-headcount');
    if (!li) {
        li = document.createElement('li');
        li.id = 'hero-headcount';
        facts.appendChild(li);
    }
    // A player who's answered can't be "the first", and the You row below carries his RSVP button.
    // Once the trip has started it's just the crew size: no RSVP button.
    const v = viewer();
    const youRow = !!(v && v.player && v.known);
    const asking = phase.name === 'pre';
    const counted = !asking || counts.in.length || counts.maybe.length || (v && v.status);
    const label = !asking
        ? `${counts.in.length} in the crew`
        : counted
            ? `${counts.in.length} in · ${counts.maybe.length} probably`
            : 'Be the first to RSVP';
    // The count is a link down to the names (the crew list sits far down a phone page)
    const text = counted
        ? `<a class="hero-count-link" href="#attendees">${esc(label)}<span class="sr-only">: see who’s in</span>${icon('chevronRight')}</a>`
        : `<span>${esc(label)}</span>`;
    li.innerHTML = `${icon('users')}${text}${youRow || !asking ? '' : '<button type="button" class="hero-rsvp" id="hero-headcount-rsvp" data-action="rsvp">RSVP</button>'}`;
}

// ---------------------------------------------------------------------------
// The viewer: who's signed in and what they answered
// ---------------------------------------------------------------------------
// The viewer's current answer: the head count's row for them, or what they've sent or loaded
// on this page (account.myRsvp), whichever is newer.
function myAnswer() {
    const listed = myLatestRsvp();
    const mine = account.myRsvp;
    if (mine && (!listed || !mine.created_at || !listed.created_at || mine.created_at >= listed.created_at)) return mine;
    return listed;
}

// null until the first account check is done, or when it failed: show nothing rather than guess.
// `known` is false when the RSVPs couldn't load, so we can't say whether they've answered.
function viewer() {
    if (!personalReady || account.error) return null;
    if (!account.user) return { signedIn: false };
    const player = account.player;
    if (!player) return { signedIn: true, email: account.user.email || '' };
    const known = rsvpState.available || account.myRsvp !== undefined;
    const answer = known ? myAnswer() : null;
    return {
        signedIn: true,
        player,
        pending: player.status === 'potential',
        known,
        status: answer && RSVP_LABELS[answer.status] ? answer.status : null
    };
}

// Re-render everything that depends on who's looking. Runs after the first account check, and
// again after an RSVP, a profile save, a log out, or any later account re-check.
function renderPersonal() {
    [renderRoster, renderYouRow, renderHeroCtas, renderCrewCta, renderAccountMenus, refreshTripPaid].forEach(fn => {
        try { fn(); } catch (err) { console.error(`${fn.name} failed:`, err); }
    });
}

const YOU_COPY = {
    in: { text: 'You’re in', mark: 'tick' },
    maybe: { text: 'You’re a probably', mark: 'question' },
    out: { text: 'You can’t make it', mark: 'x' }
};

// Hero card row under the head count: "You're in · Change", or "You haven't RSVP'd yet · RSVP"
function renderYouRow() {
    const facts = document.getElementById('hero-facts');
    if (!facts) return;
    let li = document.getElementById('hero-you');
    const v = viewer();
    // RSVPs are moot once the trip has started
    if (!(v && v.player && v.known) || phase.name !== 'pre') {
        if (li) li.remove();
        return;
    }
    if (!li) {
        li = document.createElement('li');
        li.id = 'hero-you';
    }
    // Keep it right under the head count row (which renderHeadcount may add later)
    const headcount = document.getElementById('hero-headcount');
    if (headcount) headcount.after(li);
    else facts.appendChild(li);

    const copy = YOU_COPY[v.status];
    li.className = `hero-you ${v.status || 'none'}`;
    li.innerHTML = copy
        ? `<span class="you-mark" aria-hidden="true">${icon(copy.mark)}</span>
           <span class="hero-you-text"><b>${copy.text}</b>${v.pending ? '<span class="hero-you-note"> · shows on the list once the commissioner approves you</span>' : ''}</span>
           <button type="button" class="hero-rsvp" id="hero-you-rsvp" data-action="rsvp" aria-label="Change your RSVP">Change</button>`
        : `<span class="you-mark" aria-hidden="true"></span>
           <span class="hero-you-text"><b>You haven’t RSVP’d yet</b></span>
           <button type="button" class="hero-rsvp is-primary" id="hero-you-rsvp" data-action="rsvp">RSVP</button>`;
}

// Until the viewer has answered, RSVP is the filled hero button; after that the itinerary is.
// Only the fills and the label change, never the order: this runs once the account check is
// done, and a tap aimed at RSVP a moment earlier should still land on RSVP.
function renderHeroCtas() {
    const rsvpBtn = document.getElementById('hero-rsvp-cta');
    const tripBtn = document.getElementById('hero-trip-cta');
    if (!rsvpBtn || !tripBtn) return;
    const v = viewer();
    const answered = !!(v && v.status);
    if (rsvpBtn.classList.contains('btn-copper') === !answered) return;
    rsvpBtn.textContent = answered ? 'Change my RSVP' : 'RSVP now';
    // Swap the fills without the hover colour transition, so it doesn't fade in on page load
    [rsvpBtn, tripBtn].forEach(b => { b.style.transition = 'none'; });
    rsvpBtn.classList.toggle('btn-copper', !answered);
    rsvpBtn.classList.toggle('btn-line', answered);
    tripBtn.classList.toggle('btn-copper', answered);
    tripBtn.classList.toggle('btn-line', !answered);
    rsvpBtn.parentNode.classList.toggle('is-answered', answered); // keeps the pair on one row on phones
    void rsvpBtn.offsetWidth;
    [rsvpBtn, tripBtn].forEach(b => { b.style.transition = ''; });
}

// Crew section's "Are you in?" block: hidden once the viewer has answered, and once the trip starts.
function renderCrewCta() {
    const cta = document.getElementById('crew-cta');
    const title = document.getElementById('crew-cta-title');
    const text = document.getElementById('crew-cta-text');
    if (!cta) return;
    if (title && RSVP_YEAR) title.textContent = `Are you in for ${RSVP_YEAR}?`;
    const v = viewer();
    cta.hidden = phase.name !== 'pre' || !!(v && v.status);
    if (!text) return;
    text.textContent = v && v.player
        ? 'Put your name down so we get an accurate head count. It takes ten seconds.'
        : v && v.signedIn
            ? 'Finish setting up your player account, then RSVP in a tap.'
            : 'First time? Set up your player account once (about two minutes), then RSVP in a tap.';
}

// "Signed in as …" with Golf profile and Log out (or Log in) in the drawer, and in the
// Clubhouse menu for wide screens, which have no drawer.
function renderAccountMenus() {
    const drawerRow = document.getElementById('drawer-account');
    const clubRow = document.getElementById('clubhouse-account');
    const v = viewer();
    [drawerRow, clubRow].forEach(el => { if (el) el.hidden = !v; });
    renderAdminLinks();
    if (!v) return;
    checkAdmin();

    const who = v.player ? v.player.name : v.email || 'your account';
    const loginUrl = accountUrl('home', 'login');
    if (drawerRow) {
        drawerRow.innerHTML = !v.signedIn
            ? `<a href="${loginUrl}">Log in</a>`
            : `<p class="drawer-account-who">Signed in as <b>${esc(who)}</b></p>
               ${v.player
                   ? '<button type="button" class="drawer-link" data-action="profile">Golf profile</button>'
                   : `<a href="${accountUrl('home')}">Finish setting up</a>`}
               <button type="button" class="drawer-link" data-action="logout">Log out</button>`;
    }
    if (clubRow) {
        clubRow.innerHTML = !v.signedIn
            ? `<a href="${loginUrl}">${icon('login')}Log in</a>`
            : `<p class="nav-menu-who">Signed in as <b>${esc(who)}</b></p>
               ${v.player
                   ? `<button type="button" data-action="profile">${icon('flag')}Golf profile</button>`
                   : `<a href="${accountUrl('home')}">${icon('user')}Finish setting up</a>`}
               <button type="button" data-action="logout">${icon('logout')}Log out</button>`;
    }
}

// The Admin links (Clubhouse menu, drawer, footer) show only to admins. The database decides, by its
// own rule (is_trip_admin: an is_admin roster row with this login's email), asked once per login.
// Signed out, not an admin, or the check failed: hidden. Anyone can still open /admin directly.
const adminCheck = { userId: null, isAdmin: false };

function renderAdminLinks() {
    const v = viewer();
    const show = !!(v && v.signedIn && account.user && adminCheck.userId === account.user.id && adminCheck.isAdmin);
    document.querySelectorAll('[data-admin-link]').forEach(el => { el.hidden = !show; });
}

async function checkAdmin() {
    const userId = account.user ? account.user.id : null;
    if (!userId || !supabaseInstance || !personalReady) return;
    if (adminCheck.userId === userId) return; // already asked (or asking) for this login
    adminCheck.userId = userId;
    adminCheck.isAdmin = false;
    let isAdmin = false;
    try {
        const { data, error } = await supabaseInstance.rpc('is_trip_admin');
        isAdmin = !error && data === true;
    } catch (e) { /* offline: hidden until the next page load */ }
    if (adminCheck.userId !== userId) return; // a different login since: its own check decides
    adminCheck.isAdmin = isAdmin;
    renderAdminLinks();
}

// Many of these golfers won't remember their password, so ask before logging out.
// Returns true once logged out (and the page shows the signed-out view).
async function logOutHere() {
    const who = account.player ? account.player.name : (account.user && account.user.email) || 'your account';
    const device = window.matchMedia('(pointer: coarse)').matches ? 'this phone' : 'this device';
    if (!window.confirm(`Log out of ${who} on ${device}? You’ll need your password to log back in.`)) return false;
    await signOutHere();
    renderPersonal();
    return true;
}

// Log out from the drawer or the Clubhouse menu. The menu stays open while we ask.
async function logOutFromMenu() {
    const returnTo = focusReturnTarget(); // the menu's button: the Log out button is re-rendered away
    if (!(await logOutHere())) return;
    setDrawer(false);
    setClubhouse(false);
    if (returnTo && returnTo.isConnected) returnTo.focus();
    announce('You’re logged out.');
}

function announce(message) {
    const el = document.getElementById('account-status');
    if (!el) return;
    el.textContent = '';
    setTimeout(() => { el.textContent = message; }, 60);
}

// ---------------------------------------------------------------------------
// Accounts (shared with The Bookie and the round tracker)
// ---------------------------------------------------------------------------
async function loadAccount() {
    account.user = null;
    account.player = null;
    account.myRsvp = undefined;
    account.error = false;
    if (!supabaseInstance) { account.checked = true; return; }
    try {
        const { data: { session }, error: sessionError } = await supabaseInstance.auth.getSession();
        // An expired login that couldn't be refreshed (offline, weak signal) comes back as no
        // session plus a retryable error, but stays stored and works again once back online:
        // that's "couldn't check", not "logged out". (Other refresh errors do end the login.)
        if (sessionError && sessionError.name === 'AuthRetryableFetchError') throw sessionError;
        account.user = session ? session.user : null;
        if (account.user) {
            const { data, error } = await supabaseInstance
                .from('players')
                .select('id, name, status, ghin, handicap')
                .eq('user_id', account.user.id)
                .limit(1);
            if (error) throw error;
            account.player = data && data.length ? data[0] : null;
        }
        account.checked = true;
    } catch (e) {
        // Leave it unchecked so the next RSVP / profile tap tries again, and don't claim
        // "not linked" when we simply couldn't look
        console.error('Account check failed:', e);
        account.error = true;
        account.checked = false;
    }
    // A later re-check (an RSVP / profile tap found the login changed, or retried a failed
    // check, or the page came back from the back/forward cache)
    if (personalReady) renderPersonal();
}

// Before showing or saving an RSVP / profile: re-read the account if the login changed
// (signed out or switched players in another tab) or the last check failed.
async function ensureFreshAccount() {
    let session = null;
    try {
        ({ data: { session } } = supabaseInstance ? await supabaseInstance.auth.getSession() : { data: {} });
    } catch (e) { /* treated as signed out */ }
    const sessionUserId = session && session.user ? session.user.id : null;
    const knownUserId = account.user ? account.user.id : null;
    if (!account.checked || sessionUserId !== knownUserId) await loadAccount();
}

// Where The Bookie should send someone after they sign in or finish setting up.
function accountUrl(next, mode) {
    return `bookie.html?next=${next}${mode ? `&mode=${mode}` : ''}`;
}

// Google buttons only show when trip-config.js turns them on AND the Google provider
// is switched on in Supabase.
async function showGoogleButtonsIfEnabled() {
    if (!(CFG.auth && CFG.auth.google)) return;
    try {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_KEY } });
        const settings = res.ok ? await res.json() : null;
        const on = !!(settings && settings.external && settings.external.google);
        document.querySelectorAll('[data-google-block]').forEach(el => { el.hidden = !on; });
    } catch (e) { /* offline or blocked: email login still works */ }
}

async function signInWithGoogle(next) {
    if (!supabaseInstance) return;
    const redirectTo = new URL(accountUrl(next), window.location.href).href;
    const { error } = await supabaseInstance.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
    if (error) alert(`Google sign-in didn’t start: ${error.message}`);
}

// Pages that finish signing someone in send them back to #rsvp or #profile.
function openFromAddress() {
    const hash = window.location.hash;
    if (hash !== '#rsvp' && hash !== '#profile') return;
    history.replaceState(null, '', window.location.pathname + window.location.search);
    runAction(hash === '#rsvp' ? 'rsvp' : 'profile');
}

// FormSubmit relays these to the alerts inbox (fire and forget).
function sendAlert(subject, fields) {
    if (!ALERTS.to) return Promise.resolve(false);
    const body = Object.assign({}, fields, { _subject: subject, _template: 'table' });
    if (ALERTS.cc) body._cc = ALERTS.cc;
    return fetch(`https://formsubmit.co/ajax/${ALERTS.to}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(body)
    }).then(res => res.ok).catch(err => { console.error('Alert email failed:', err); return false; });
}

// ---------------------------------------------------------------------------
// RSVP modal
// ---------------------------------------------------------------------------
// The signed-in player's own latest RSVP, note included. Notes aren't public, so the head
// count can't supply it. Loaded once per page and updated after each RSVP.
async function loadMyRsvp() {
    if (!account.player) return null;
    if (account.myRsvp !== undefined) return account.myRsvp;
    const fromHeadcount = () => rsvpState.latest.find(r => r.player_id === account.player.id) || null;
    if (!supabaseInstance) return fromHeadcount();
    try {
        const { data, error } = await supabaseInstance.rpc('my_rsvp', { p_trip_year: RSVP_YEAR });
        if (error) throw error;
        account.myRsvp = data || null;
        return account.myRsvp;
    } catch (e) {
        console.error('Could not load your RSVP:', e);
        return fromHeadcount(); // no note, and not cached so the next open tries again
    }
}

function setFieldError(id, message, input) {
    const el = document.getElementById(id);
    if (el) {
        el.textContent = message || '';
        el.hidden = !message;
    }
    if (input) {
        if (message) input.setAttribute('aria-invalid', 'true');
        else input.removeAttribute('aria-invalid');
    }
}

// Show an error message and make sure it's on screen (it can sit below the fold on phones)
function showFormError(el, message) {
    el.textContent = message;
    el.hidden = false;
    el.scrollIntoView({ block: 'nearest', behavior: REDUCED_MOTION ? 'auto' : 'smooth' });
}

const RSVP_STEP_TITLES = { account: 'rsvp-account-title', form: 'rsvp-title', done: 'rsvp-done-title' };

function showRsvpStep(step) {
    Object.keys(RSVP_STEP_TITLES).forEach(s => {
        const el = document.getElementById(`rsvp-step-${s}`);
        if (el) el.hidden = s !== step;
    });
    // Screen readers announce the heading of the step that's showing
    if (elements.rsvpModal) elements.rsvpModal.setAttribute('aria-labelledby', RSVP_STEP_TITLES[step]);
}

function syncSundayOption() {
    const form = elements.rsvpForm;
    if (!form) return;
    const status = (form.querySelector('input[name="status"]:checked') || {}).value;
    const wrap = document.getElementById('rsvp-sunday-wrap');
    if (wrap) wrap.hidden = status === 'out' || !RSVP.sundayQuestion;
}

// The first control matching `selector` that's actually on screen (not inside a hidden block)
function firstVisible(root, selector) {
    return [...root.querySelectorAll(selector)].find(el => el.getClientRects().length > 0) || null;
}

// pickFocus runs once the dialog is showing and returns the element to focus
function openRsvpModal(pickFocus) {
    const modal = elements.rsvpModal;
    if (!modal.classList.contains('active')) {
        openDialog(modal, () => pickFocus() || document.getElementById('rsvp-close'));
    } else {
        setTimeout(() => { const el = pickFocus(); if (el) el.focus(); }, 30);
    }
}

// Signed out, or signed in but not linked to a roster name yet: send them to set up.
// `purpose` is where they come back to afterwards ('rsvp' or 'profile').
function showAccountStep(purpose, note) {
    const next = purpose || 'rsvp';
    const failed = !!account.error; // couldn't look the account up: don't guess
    const linked = !failed && !!account.user;
    const lede = document.getElementById('rsvp-account-lede');
    const title = document.getElementById('rsvp-account-title');
    if (title) title.innerHTML = next === 'profile' ? 'Your golf <em>profile</em>' : 'Are you <em>in?</em>';
    if (lede) {
        const text = failed
            ? 'We couldn’t check your account just now. Check your connection, then close this and try again.'
            : linked
                ? `You’re logged in as ${account.user.email || 'this account'}, but it isn’t linked to a name on the trip roster yet. Finish setting up and you’ll come right back here.`
                : next === 'profile'
                    ? 'Log in to update your GHIN and handicap. It’s the same login as The Bookie.'
                    : 'RSVPs need a player account. It’s the same login you use for The Bookie and to keep score, so you only set it up once.';
        // Most people who haven't answered yet start here: the RSVP-by date too, while it's ahead
        const due = next === 'rsvp' && !failed ? rsvpDeadline() : null;
        lede.innerHTML = [
            note && !failed ? esc(note) : '',
            due && !due.passed ? `<span class="rsvp-due">${esc(due.text)}</span>` : '',
            esc(text)
        ].filter(Boolean).join(' ');
    }
    const set = (id, show, href) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.hidden = !show;
        if (href) el.href = href;
    };
    set('rsvp-create-link', !failed && !linked, accountUrl(next, 'register'));
    set('rsvp-login-link', !failed && !linked, accountUrl(next, 'login'));
    set('rsvp-finish-link', linked, accountUrl(next));
    set('rsvp-switch-account', linked);
    const google = elements.rsvpModal.querySelector('#rsvp-step-account [data-google-signin]');
    if (google) {
        google.dataset.next = next;
        google.closest('[data-google-block]').style.display = linked || failed ? 'none' : '';
    }
    setRsvpEyebrows();
    showRsvpStep('account');
    openRsvpModal(() => firstVisible(elements.rsvpModal, '#rsvp-step-account .google-btn, #rsvp-step-account .btn, #rsvp-step-account .link-btn'));
}

function setRsvpEyebrows() {
    document.querySelectorAll('.rsvp-eyebrow').forEach(el => {
        el.textContent = `${TRIP.year} · ${(TRIP.location || '').split(',')[0]} · ${TRIP.dates ? TRIP.dates.short : ''}`;
    });
}

// ---------------------------------------------------------------------------
// Loading states: on a weak signal the login check (and the player's own RSVP) can take a few
// seconds. The RSVP sheet and the golf profile open on the tap anyway, locked, and fill in and
// unlock when it's done, so a tap never looks dead. The copy that needs no network (title, lede,
// RSVP-by date) shows from the start, so nothing moves when it finishes.
// ---------------------------------------------------------------------------
// A load quicker than this shows no loading state at all (no dimming, no "Loading…" flash)
const LOADING_SHOW_MS = 300;
const loadingTimers = new Map();

// Locks or unlocks a form; `regions` are the parts that lock (not `keep`, a way out such as Cancel).
// Locking is immediate but invisible at first: aria-busy, and the regions inert (no taps, no focus,
// same look; a disabled checkbox would turn grey). Only if it's still loading after LOADING_SHOW_MS
// does the form dim (.is-loading) with "Loading…" over it (the status line), its controls disabled.
function setFormLoading(form, busyEl, regions, loadingId, text, on, keep) {
    if (!form || !busyEl) return;
    const parts = regions.filter(Boolean);
    const controls = [...form.elements].filter(el => el !== keep);
    const line = document.getElementById(loadingId);
    if (!on) {
        clearTimeout(loadingTimers.get(busyEl));
        loadingTimers.delete(busyEl);
        busyEl.removeAttribute('aria-busy');
        busyEl.classList.remove('is-loading');
        parts.forEach(el => { el.inert = false; });
        controls.forEach(el => { el.disabled = false; });
        if (line) line.innerHTML = '';
        return;
    }
    busyEl.setAttribute('aria-busy', 'true');
    if (busyEl.classList.contains('is-loading') || loadingTimers.has(busyEl)) return; // already locked
    parts.forEach(el => { el.inert = true; });
    loadingTimers.set(busyEl, setTimeout(() => {
        loadingTimers.delete(busyEl);
        if (!busyEl.hasAttribute('aria-busy')) return;
        // Still loading: dimmed, controls disabled (what screen readers expect), and the status line
        // filled, which is what they announce (it's always in the page, empty when idle)
        parts.forEach(el => { el.inert = false; });
        controls.forEach(el => { el.disabled = true; });
        busyEl.classList.add('is-loading');
        if (line) line.innerHTML = `<span class="form-spinner" aria-hidden="true"></span>${esc(text)}`;
    }, LOADING_SHOW_MS));
}

function setRsvpLoading(on) {
    const step = document.getElementById('rsvp-step-form');
    setFormLoading(elements.rsvpForm, step, [elements.rsvpForm], 'rsvp-loading', 'Loading your RSVP…', on);
    // "Golf profile" and "Switch player" wait too: they act on the login being checked
    if (step) step.querySelectorAll('.rsvp-who-links button').forEach(b => { b.disabled = on; });
}

function fillRsvpForm(answer) {
    const form = elements.rsvpForm;
    if (!form || !answer) return;
    const radio = RSVP_LABELS[answer.status] ? form.querySelector(`input[name="status"][value="${answer.status}"]`) : null;
    if (radio) radio.checked = true;
    const sunday = form.elements.namedItem('sunday');
    if (sunday) sunday.checked = !!answer.sunday_round;
    if (answer.note !== undefined) form.elements.namedItem('note').value = answer.note || '';
}

// The sheet as soon as RSVP is tapped: the form, locked, showing who's RSVPing (when we know) and
// the answer we already have (this page's, or the head count's), until openRsvp has the real one.
function showRsvpLoading(keepValues) {
    const form = elements.rsvpForm;
    if (!keepValues) {
        form.reset();
        if (account.player) fillRsvpForm(myAnswer());
    }
    // Who's RSVPing: the name when we know it; otherwise the row keeps its place, blank, until we do
    const who = document.getElementById('rsvp-who');
    document.getElementById('rsvp-who-name').textContent = account.player ? account.player.name : '';
    if (who) {
        who.hidden = false;
        who.classList.toggle('is-unknown', !account.player);
    }
    setFieldError('rsvp-status-error', '');
    const err = document.getElementById('rsvp-error');
    if (err) err.hidden = true;
    const sundayLabel = document.getElementById('rsvp-sunday-label');
    if (sundayLabel && RSVP.sundayQuestion) sundayLabel.textContent = RSVP.sundayQuestion;
    setRsvpFormLede();
    setRsvpEyebrows();
    syncSundayOption();
    setRsvpLoading(true);
    showRsvpStep('form');
    // Focus the title while it loads (the controls are disabled); openRsvp moves it on afterwards
    openRsvpModal(() => document.getElementById('rsvp-title'));
}

// With an RSVP-by date the lede leads with it, and "Change your answer any time" (index.html, still
// used once the trip starts) gives way to a line that doesn't argue with it. Config only (no network),
// so the sheet shows it from the first frame, loading or not.
function setRsvpFormLede() {
    const lede = document.getElementById('rsvp-form-lede');
    if (!lede) return;
    if (lede.dataset.text === undefined) lede.dataset.text = lede.textContent;
    const due = rsvpDeadline();
    lede.innerHTML = due
        ? `<span class="rsvp-due${due.passed ? ' is-past' : ''}">${esc(due.text)}</span> ${due.passed
            ? 'You can still answer or change it here, and we count your latest one.'
            : 'We count your latest answer.'}`
        : esc(lede.dataset.text);
}

let rsvpOpenSeq = 0; // the latest openRsvp; an older one that finishes later leaves the sheet alone

async function openRsvp(keepValues) {
    const form = elements.rsvpForm;
    if (!form) return;
    const sheet = elements.rsvpModal;
    const seq = ++rsvpOpenSeq;
    const shownPlayer = account.player ? { id: account.player.id, name: account.player.name } : null;
    // Known to be signed out: the account step needs no network, so it opens straight away.
    // Otherwise open now, locked, while the login is re-checked and the answer loads.
    const loading = !(account.checked && !account.error && !account.user);
    if (loading) showRsvpLoading(keepValues);
    // Closed while it loaded (or opened again): don't pop it back up
    const stale = () => seq !== rsvpOpenSeq || (loading && !sheet.classList.contains('active'));
    try {
        await ensureFreshAccount();
        if (stale()) return;
        if (!account.player) {
            showAccountStep('rsvp');
            return;
        }
        // "Change my answer" after a different player logged in (another tab): start from the
        // new player's own RSVP, not the previous player's answers and note
        const switched = !!(keepValues && shownPlayer && shownPlayer.id !== account.player.id);

        if (!keepValues || switched) {
            const mine = await loadMyRsvp();
            if (stale()) return;
            form.reset();
            fillRsvpForm(mine);
        }
        finishOpenRsvp(switched, shownPlayer, loading);
    } finally {
        if (seq === rsvpOpenSeq) setRsvpLoading(false);
    }
}

function finishOpenRsvp(switched, shownPlayer, loading) {
    const form = elements.rsvpForm;
    const who = document.getElementById('rsvp-who');
    if (who) {
        who.hidden = false;
        who.classList.remove('is-unknown');
    }
    document.getElementById('rsvp-who-name').textContent = account.player.name;
    setFieldError('rsvp-status-error', '');
    const err = document.getElementById('rsvp-error');
    if (err) err.hidden = true;
    const sundayLabel = document.getElementById('rsvp-sunday-label');
    if (sundayLabel && RSVP.sundayQuestion) sundayLabel.textContent = RSVP.sundayQuestion;
    setRsvpFormLede();
    setRsvpEyebrows();
    syncSundayOption();
    showRsvpStep('form');
    const answerControl = () => form.querySelector('input[name="status"]:checked') || form.querySelector('input[name="status"]');
    // After loading, focus moves from the title to the answer, unless the player went to the close
    // button meanwhile (the only other control that isn't locked while it loads)
    if (!(loading && document.activeElement && document.activeElement.id === 'rsvp-close')) openRsvpModal(answerControl);
    if (switched) showNoteAfterFocus(err, switchedNote(shownPlayer.name));
}

async function signOutHere() {
    try {
        if (supabaseInstance) await supabaseInstance.auth.signOut({ scope: 'local' });
    } catch (e) {
        console.error('Sign-out failed:', e);
    }
    account.user = null;
    account.player = null;
    account.myRsvp = undefined;
    account.checked = true;
    account.error = false;
}

// A request without a login (it ended in another tab, or expired) is refused by the
// database before the function's own "Log in" message can run.
function looksSignedOut(error) {
    const text = `${error && error.code || ''} ${error && error.message || ''}`;
    return /42501|PGRST30\d|JWT|permission denied for function|log in/i.test(text);
}

// Reload who's signed in. If they're no longer a linked player, show the account step
// instead and return false.
async function recheckAccount(purpose) {
    await loadAccount();
    if (account.player) return true;
    closeDialog(elements.registrationModal);
    showAccountStep(purpose, account.user ? '' : 'You’ve been logged out.');
    return false;
}

// Before an RSVP or profile save: is the same player still logged in? The login can end,
// or switch to someone else, in another tab. Never save for a player the form doesn't show.
async function stillSignedIn(purpose) {
    let session = null;
    try {
        ({ data: { session } } = await supabaseInstance.auth.getSession());
    } catch (e) { /* treated as signed out */ }
    const shownPlayer = account.player ? { id: account.player.id, name: account.player.name } : null;
    if (session && account.user && session.user.id === account.user.id && account.player) return true;
    if (!(await recheckAccount(purpose))) return false;
    // Same player after all (e.g. the session read hiccuped): go ahead and save
    if (shownPlayer && account.player.id === shownPlayer.id) return true;
    // A different linked player is logged in now: reopen the form for them instead of saving
    const note = switchedNote(shownPlayer && shownPlayer.name);
    if (purpose === 'profile') {
        await openProfile();
        showNoteAfterFocus(document.getElementById('profile-error'), note);
    } else {
        await openRsvp();
        showNoteAfterFocus(document.getElementById('rsvp-error'), note);
    }
    return false;
}

function switchedNote(previousName) {
    return `You’re now logged in as ${account.player.name}${previousName ? ` (not ${previousName})` : ''}. Check the details and save again.`;
}

// Reopening a form moves focus (and scroll) a moment later; show the note after that so it
// stays on screen.
function showNoteAfterFocus(el, message) {
    setTimeout(() => showFormError(el, message), 80);
}

function validateRsvp(form) {
    const status = (form.querySelector('input[name="status"]:checked') || {}).value;
    if (!RSVP_LABELS[status]) {
        setFieldError('rsvp-status-error', 'Pick one: in, probably, or can’t make it.');
        form.querySelector('input[name="status"]').focus();
        return null;
    }
    setFieldError('rsvp-status-error', '');
    const sundayBox = form.elements.namedItem('sunday');
    return {
        status,
        sunday: status !== 'out' && !!(sundayBox && sundayBox.checked),
        note: cleanName(form.elements.namedItem('note').value).slice(0, 280)
    };
}

function rsvpErrorMessage(error) {
    const text = `${error && error.code || ''} ${error && error.message || ''}`;
    if (/PGRST202|could not find the function/i.test(text)) return 'RSVPs are being set up. Try again in a few minutes, or text the commissioner.';
    if (/54000|lot of RSVP changes/i.test(text) || isWaitingApproval(error)) return error.message;
    return 'We couldn’t save your RSVP. Check your connection and try again.';
}

async function handleRsvpSubmit(e) {
    e.preventDefault();
    // Still loading the login / the player's answer: nothing to send yet (the form is locked anyway)
    if (document.getElementById('rsvp-step-form').hasAttribute('aria-busy')) return;
    const form = elements.rsvpForm;
    const rsvp = validateRsvp(form);
    if (!rsvp) return;

    const button = document.getElementById('rsvp-submit');
    const errorEl = document.getElementById('rsvp-error');
    errorEl.hidden = true;
    button.disabled = true;
    button.textContent = 'Sending…';

    try {
        if (!supabaseInstance) throw new Error('Supabase is not configured');
        if (!(await stillSignedIn('rsvp'))) return;
        const { data, error } = await supabaseInstance.rpc('submit_rsvp', {
            p_trip_year: RSVP_YEAR,
            p_status: rsvp.status,
            p_sunday: rsvp.sunday,
            p_note: rsvp.note || null
        });
        if (error) {
            // (A picked name still waiting for approval is refused with 42501 too: that's no logout)
            if (!isWaitingApproval(error) && (looksSignedOut(error) || /not linked/i.test(error.message || ''))) {
                if (!(await recheckAccount('rsvp'))) return;
            }
            throw error;
        }
        const saved = Object.assign({}, rsvp, { name: (data && data.name) || account.player.name, pending: !!(data && data.player_status && data.player_status !== 'confirmed') });
        account.myRsvp = { status: saved.status, sunday_round: saved.sunday, note: saved.note || null, created_at: data && data.created_at };

        if (RSVP.emailNotify !== false) {
            sendAlert(`BBB ${RSVP_YEAR} RSVP: ${saved.name} — ${RSVP_LABELS[saved.status]}${saved.pending ? ' (new player)' : ''}`, {
                name: saved.name,
                rsvp: RSVP_LABELS[saved.status],
                sunday_round: saved.sunday ? 'Yes' : 'No',
                note: saved.note || '—',
                roster: saved.pending ? 'New player: approve in Admin → RSVPs (link below)' : 'On the roster',
                admin_link: ADMIN_RSVPS_URL
            });
        }

        await loadRsvps();
        renderPersonal();
        showRsvpDone(saved);
    } catch (err) {
        console.error('RSVP failed:', err);
        showFormError(errorEl, rsvpErrorMessage(err));
    } finally {
        button.disabled = false;
        button.textContent = 'Send my RSVP';
    }
}

function showRsvpDone(rsvp) {
    const first = rsvp.name.split(' ')[0];
    const due = rsvpDeadline();
    const copy = {
        in: [`You’re in, ${first}.`, 'See you in Scottsdale. Tee times and rooms get posted here as they’re booked.'],
        maybe: [`Noted, ${first}.`, `We’ve got you down as a probably. ${!due ? 'Come back and lock it in when you can.'
            : due.passed ? `${due.text} Lock it in as soon as you know.` : due.text}`],
        out: [`We’ll miss you, ${first}.`, 'Sorry you can’t make it. If plans change, just RSVP again.']
    }[rsvp.status];
    const mark = document.getElementById('rsvp-done-mark');
    if (mark) {
        mark.className = `rsvp-done-mark ${rsvp.status}`;
        mark.innerHTML = icon(rsvp.status === 'in' ? 'check' : rsvp.status === 'maybe' ? 'clock' : 'x');
    }
    document.getElementById('rsvp-done-title').textContent = copy[0];
    document.getElementById('rsvp-done-text').textContent = rsvp.pending
        ? `${copy[1]} You’re new, so your name shows on the head count once the commissioner confirms you.`
        : copy[1];

    const countEl = document.getElementById('rsvp-done-count');
    if (countEl) {
        if (rsvpState.available && !roster.error) {
            const c = rsvpCounts();
            countEl.textContent = `Head count so far: ${c.in.length} in · ${c.maybe.length} probably · ${c.out.length} out`;
            countEl.hidden = false;
        } else {
            countEl.hidden = true;
        }
    }

    // Nudge for a GHIN / handicap when they're coming and either is missing
    const rosterLink = document.getElementById('rsvp-roster-link');
    const p = account.player || {};
    if (rosterLink) rosterLink.hidden = !(rsvp.status !== 'out' && (!realGhin(p.ghin) || p.handicap === null || p.handicap === undefined));

    showRsvpStep('done');
    const title = document.getElementById('rsvp-done-title');
    if (title) title.focus();
}

// ---------------------------------------------------------------------------
// Golf profile (GHIN / handicap) for the signed-in player
// ---------------------------------------------------------------------------
// Set when the profile was opened from the RSVP form: closing it goes back to the form with
// the picked answer and note as they were, since that RSVP hasn't been sent yet.
let profileBackToRsvp = false;

// The player's own GHIN and handicap (his account row: the public roster has no GHIN numbers).
// `p` null: blank, with no name, while the login is still being checked.
function fillProfileForm(p) {
    const hcp = !p || p.handicap === null || p.handicap === undefined || p.handicap === '' ? null : Number(p.handicap);
    document.getElementById('profile-name').textContent = p ? p.name : '';
    // Not known yet (the login is still being checked): the row keeps its place, blank
    const who = document.getElementById('profile-who');
    if (who) who.classList.toggle('is-unknown', !p);
    document.getElementById('ghin-number').value = p ? realGhin(p.ghin) || '' : '';
    // Plus handicaps are stored as negatives: show the number plus a ticked "plus" box
    document.getElementById('handicap').value = hcp === null || isNaN(hcp) ? '' : Math.abs(hcp).toFixed(1);
    document.getElementById('handicap-plus').checked = hcp !== null && hcp < 0;
    setFieldError('profile-error', '');
    ['ghin-number', 'handicap'].forEach(id => document.getElementById(id).removeAttribute('aria-invalid'));
    // Venmo: his username when we already have it, else blank (and off) until loadMyVenmo has it
    fillVenmoField(p);
    renderVenmoField();
}

function setProfileLoading(on) {
    const form = elements.registrationForm;
    if (!form) return;
    // Cancel stays a way out while it loads
    setFormLoading(form, form, [form.querySelector('.form-row'), document.getElementById('profile-submit')],
        'profile-loading', 'Loading your golf profile…', on, document.getElementById('cancel-btn'));
    // Unlocking turns every box back on: the Venmo box stays off unless it's ready
    renderVenmoField();
}

let profileOpenSeq = 0; // the latest openProfile; an older one that finishes later does nothing

async function openProfile() {
    const modal = elements.registrationModal;
    const sheet = elements.rsvpModal;
    const seq = ++profileOpenSeq;
    const formStep = document.getElementById('rsvp-step-form');
    const fromRsvpForm = !!(sheet && sheet.classList.contains('active') && formStep && !formStep.hidden);
    // As with the RSVP sheet: unless they're known to be signed out, open now, locked, with what we
    // already have, while the login is re-checked
    const loading = !(account.checked && !account.error && !account.user);
    if (loading) {
        profileBackToRsvp = fromRsvpForm;
        fillProfileForm(account.player);
        setProfileLoading(true);
        // Open the profile before closing the sheet, so focus doesn't drop onto the page in between
        openDialog(modal, '#registration-title');
        closeDialog(sheet);
    }
    const stale = () => seq !== profileOpenSeq || (loading && !modal.classList.contains('active'));
    try {
        await ensureFreshAccount();
        if (stale()) return;
        if (!account.player) {
            // Log in first: the account step is in the RSVP sheet
            profileBackToRsvp = false;
            showAccountStep('profile');
            if (loading) {
                closeDialog(modal);
                if (elements.registrationForm) elements.registrationForm.reset();
            }
            return;
        }
        fillProfileForm(account.player);
        // His Venmo username loads on its own, so GHIN and handicap never wait for it
        loadMyVenmo();
        if (!loading) {
            profileBackToRsvp = fromRsvpForm;
            openDialog(modal, '#ghin-number');
            closeDialog(sheet);
        } else {
            // Focus moves from the title to the GHIN box, unless they went to Close or Cancel meanwhile
            const a = document.activeElement;
            if (!(a && (a.id === 'modal-close' || a.id === 'cancel-btn'))) {
                setTimeout(() => { const g = document.getElementById('ghin-number'); if (g && modal.classList.contains('active')) g.focus(); }, 30);
            }
        }
    } finally {
        if (seq === profileOpenSeq) setProfileLoading(false);
    }
}

// Cancel, close, Escape, or a moment after Save
async function closeProfile() {
    const modal = elements.registrationModal;
    if (!modal || !modal.classList.contains('active')) return;
    const back = profileBackToRsvp;
    profileBackToRsvp = false;
    // Back to the RSVP form: openRsvp shows the sheet at once (before any network wait), so the profile
    // closes straight away and focus goes to the sheet, not the page. A profile still loading then sees
    // it was closed and stands down.
    const reopening = back ? openRsvp(true) : null;
    closeDialog(modal);
    if (elements.registrationForm) elements.registrationForm.reset();
    await reopening;
}

// "9.4" -> 9.4, "+2.1" or "2.1" with the plus box ticked -> -2.1. A comma decimal ("9,4",
// the only decimal key on some phones' keypads) works too. Returns NaN when unreadable.
function parseHandicap(text, plusTicked) {
    const m = String(text || '').replace(/\s+/g, '').replace(',', '.').match(/^([+-])?(\d{1,2}(?:\.\d+)?)$/);
    if (!m) return NaN;
    const n = Math.round(parseFloat(m[2]) * 10) / 10;
    return m[1] || plusTicked ? -n : n;
}

async function handleProfileSubmit(e) {
    e.preventDefault();
    if (elements.registrationForm && elements.registrationForm.hasAttribute('aria-busy')) return; // still loading
    const ghinInput = document.getElementById('ghin-number');
    const hcpInput = document.getElementById('handicap');
    const ghin = ghinInput.value.replace(/\D/g, '');
    const hcpText = hcpInput.value.trim();
    const handicap = hcpText === '' ? null : parseHandicap(hcpText, document.getElementById('handicap-plus').checked);
    const errEl = document.getElementById('profile-error');
    const btn = document.getElementById('profile-submit');
    // The message, and the box it's about: marked (red, aria-invalid) and focused
    const fail = (msg, input) => {
        showFormError(errEl, msg);
        if (input) {
            input.setAttribute('aria-invalid', 'true');
            input.focus();
        }
    };
    errEl.hidden = true;

    if (ghin && (ghin.length < 5 || ghin.length > 12)) return fail('A GHIN number is 5 to 12 digits.', ghinInput);
    if (handicap !== null && isNaN(handicap)) return fail('Enter your handicap as a number, like 9.4.', hcpInput);
    if (handicap !== null && (handicap < -10 || handicap > 54)) return fail('Enter a handicap between +10 and 54.', hcpInput);
    // The Venmo box, when it's on: checked here, and saved (set_my_venmo) after the GHIN and handicap,
    // only when it changed. Off (loading, being set up, waiting for approval): left alone.
    const venmoInput = document.getElementById('venmo-handle');
    const venmoPlayer = venmoInput && !venmoInput.disabled && venmoStateFor(account.player) === 'ready' ? account.player.id : null;
    const venmoNew = venmoPlayer ? cleanVenmo(venmoInput.value) : '';
    if (venmoNew === null) return fail(VENMO_BAD, venmoInput);
    const venmoChanged = !!venmoPlayer && (venmoNew || null) !== (myVenmo.handle || null);

    btn.disabled = true;
    btn.textContent = 'Saving…';
    // What's in the boxes was read above, so they can't be typed in until this is done (anything typed
    // meanwhile would be lost). Read-only, not disabled: focus and the Venmo box's on/off stay as they are.
    const boxes = [ghinInput, hcpInput, venmoInput].filter(Boolean);
    boxes.forEach(el => { el.readOnly = true; });
    try {
        if (!(await stillSignedIn('profile'))) return;
        const { data, error } = await supabaseInstance.rpc('update_my_profile', { p_ghin: ghin || null, p_handicap: handicap });
        if (error) {
            if (!isWaitingApproval(error) && (looksSignedOut(error) || /not linked/i.test(error.message || ''))) {
                if (!(await recheckAccount('profile'))) return;
            }
            throw error;
        }
        Object.assign(account.player, { ghin: data ? data.ghin : ghin || null, handicap: data ? data.handicap : handicap });
        // The crew list's copy has the handicap only (no GHIN on public lists)
        const onRoster = roster.confirmed.find(p => p.id === account.player.id);
        if (onRoster) onRoster.handicap = account.player.handicap === null ? null : parseFloat(account.player.handicap);
        renderPersonal();
        // Then the Venmo username, still for the player whose box it is (stillSignedIn checked the login)
        if (venmoChanged && account.player && account.player.id === venmoPlayer) {
            const venmoSave = await saveMyVenmo(venmoNew || null, venmoPlayer);
            if (venmoSave.stop) return;
            if (venmoSave.message) {
                const box = document.getElementById('venmo-handle');
                fail(venmoSave.message, venmoSave.field && box && !box.disabled ? box : null);
                return;
            }
        }
        btn.textContent = 'Saved';
        setTimeout(closeProfile, 700);
    } catch (err) {
        console.error('Profile save failed:', err);
        const text = `${err.code || ''} ${err.message || ''}`;
        fail(/PGRST202|could not find the function/i.test(text)
            ? 'Profiles are being set up. Try again in a few minutes.'
            : (/22023/.test(text) || isWaitingApproval(err)) && err.message
                ? err.message
                : 'That didn’t save. Check your connection and try again.');
    } finally {
        boxes.forEach(el => { el.readOnly = false; });
        btn.disabled = false;
        setTimeout(() => { btn.textContent = 'Save'; }, 800);
    }
}

// ---------------------------------------------------------------------------
// Payments (payments_2027.sql): the player's own Venmo username, in the golf profile, and his own
// trip-cost payments, on the cost card. Until that SQL has run the Venmo box says "Venmo is being set
// up." (and stays off), and the cost card shows nothing extra; everything else works as before.
// ---------------------------------------------------------------------------
// The tables or functions aren't there yet: a missing table (PGRST205, or 42P01 from an older
// PostgREST) or function (PGRST202)
function paymentsMissing(error) {
    const text = `${error && error.code || ''} ${error && error.message || ''}`;
    return /PGRST20[25]|42P01|could not find the (table|function)/i.test(text);
}

// A roster name this login picked from the list is held until the commissioner approves it, and the
// RSVP, profile and Venmo functions say so (42501, a message that can be shown as is)
function isWaitingApproval(error) {
    return !!error && String(error.code || '') === '42501' && /waiting for the commissioner/i.test(error.message || '');
}

const VENMO_HINT = 'So the crew can pay you after the trip. Only signed-in crew can see it.';
const VENMO_BAD = 'A Venmo username is 5 to 30 letters, numbers, hyphens or underscores, like @Jeff-Tarlton.';
// The hint's place when the box is off, by state
const VENMO_NOTES = {
    missing: 'Venmo is being set up.',
    held: 'Your roster name is waiting for the commissioner’s approval. You can add your Venmo once you’re approved.',
    failed: 'Couldn’t load your Venmo just now. Close this and try again.'
};
const VENMO_LINK = /^(https?:\/\/)?(www\.|account\.)?venmo\.com\/(u\/)?/i;

// What was typed in the Venmo box: "@name", "name", or a pasted venmo.com link (venmo.com/u/name or
// venmo.com/name, with or without https://www., and anything after a ? or #), as the username without
// the @. '' means "clear it"; null means it isn't a Venmo username (5 to 30 letters, numbers, hyphens
// or underscores, the same rule as set_my_venmo).
function cleanVenmo(text) {
    let v = String(text === null || text === undefined ? '' : text).trim();
    if (VENMO_LINK.test(v)) {
        v = v.replace(VENMO_LINK, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
        if (!v) return null; // just "venmo.com/": not a username, and not "clear it" either
    }
    v = v.replace(/^@/, '');
    if (!v) return '';
    return /^[a-z0-9_-]{5,30}$/.test(v.toLowerCase()) ? v : null;
}

// Venmo's public page for a username (photo and name), to check it's the right one. Built as a URL,
// never pasted into HTML.
function venmoProfileUrl(handle) {
    const url = new URL('https://venmo.com/');
    url.pathname = `/u/${encodeURIComponent(String(handle).toLowerCase())}`;
    return url.href;
}

// The signed-in player's own username (player_venmo). state: 'idle' (not asked yet), 'loading',
// 'ready' (handle: his username, or null for none), 'held' (a picked name still waiting for approval:
// set_my_venmo would refuse), 'missing' (payments_2027.sql hasn't run), 'failed' (couldn't load). Only
// 'ready' turns the box on, so a blank box can never clear a username we couldn't read.
const myVenmo = { playerId: null, state: 'idle', handle: null, slow: false, seq: 0, slowTimer: null };

function venmoStateFor(player) {
    return player && myVenmo.playerId === player.id ? myVenmo.state : 'idle';
}

// The box's value: his username ("@name") when it's known, else blank
function fillVenmoField(player) {
    const input = document.getElementById('venmo-handle');
    if (!input) return;
    input.value = venmoStateFor(player) === 'ready' && myVenmo.handle ? `@${myVenmo.handle}` : '';
    input.removeAttribute('aria-invalid');
}

// On or off, and the hint (or what's up instead); "Check it" follows. Never touches what's typed.
function renderVenmoField() {
    const input = document.getElementById('venmo-handle');
    const hint = document.getElementById('venmo-hint');
    if (!input || !hint) return;
    const state = venmoStateFor(account.player);
    const form = elements.registrationForm;
    // (While the whole profile is still loading, setFormLoading keeps every box off)
    input.disabled = state !== 'ready' || !!(form && form.classList.contains('is-loading'));
    // (No "@your-username" in a box that can't be used: the hint says why)
    input.placeholder = VENMO_NOTES[state] ? '' : '@your-username';
    const note = VENMO_NOTES[state] || (state === 'loading' && myVenmo.slow ? 'Loading your Venmo…' : '');
    hint.textContent = note || VENMO_HINT;
    hint.classList.toggle('is-note', !!note);
    const group = document.getElementById('venmo-group');
    if (group && state === 'loading') group.setAttribute('aria-busy', 'true');
    else if (group) group.removeAttribute('aria-busy');
    syncVenmoCheck();
}

// "Check it" (venmo.com/u/name, new tab) once what's typed is a username. While the box is on the
// link keeps its place even when it's not showing, so the hint beside it doesn't jump as he types.
function syncVenmoCheck() {
    const input = document.getElementById('venmo-handle');
    const link = document.getElementById('venmo-check');
    const sr = document.getElementById('venmo-check-sr');
    if (!input || !link) return;
    const on = venmoStateFor(account.player) === 'ready';
    const handle = on ? cleanVenmo(input.value) : null;
    link.hidden = !on;
    link.classList.toggle('is-off', !handle);
    if (handle) {
        link.href = venmoProfileUrl(handle);
        if (sr) sr.textContent = `: @${handle} on Venmo (opens in a new tab)`;
    }
}

// His own row, plus payments_me to tell a picked name that's still held (it can't set one) from a
// new sign-up waiting for approval (it can). Loaded once per player per page; a save keeps it current.
async function loadMyVenmo() {
    const player = account.player;
    if (!player || !supabaseInstance) return;
    const now = venmoStateFor(player);
    if (now === 'ready' || now === 'loading') return;
    const seq = ++myVenmo.seq;
    clearTimeout(myVenmo.slowTimer);
    Object.assign(myVenmo, { playerId: player.id, state: 'loading', handle: null, slow: false });
    // A quick load shows nothing; a slow one says so in the hint
    myVenmo.slowTimer = setTimeout(() => {
        if (seq !== myVenmo.seq) return;
        myVenmo.slow = true;
        renderVenmoField();
    }, LOADING_SHOW_MS);
    fillVenmoField(player);
    renderVenmoField();

    let state = 'failed';
    let handle = null;
    try {
        const settle = q => Promise.resolve(q).catch(error => ({ data: null, error }));
        const [me, row] = await Promise.all([
            settle(supabaseInstance.rpc('payments_me')),
            settle(supabaseInstance.from('player_venmo').select('handle').eq('player_id', player.id).maybeSingle())
        ]);
        if (paymentsMissing(me.error) || paymentsMissing(row.error)) state = 'missing';
        else if (me.error || row.error || !me.data || me.data.player_id !== player.id) console.warn('Could not load your Venmo:', me.error || row.error || me.data);
        else if (!me.data.own_ok) state = 'held';
        else {
            state = 'ready';
            handle = row.data && row.data.handle ? String(row.data.handle) : null;
        }
    } catch (e) {
        console.warn('Could not load your Venmo:', e);
    }
    if (seq !== myVenmo.seq) return; // a newer load (another player) took over
    clearTimeout(myVenmo.slowTimer);
    Object.assign(myVenmo, { state, handle, slow: false });
    const input = document.getElementById('venmo-handle');
    // The box was off while this loaded, so nothing typed is lost
    if (input && input.disabled) fillVenmoField(account.player);
    renderVenmoField();
}

// Saves his own username (null clears it). Returns {} when saved, {message, field} to show (field:
// it's about what's in the box), or {stop: true} when the login is gone (the account step shows).
async function saveMyVenmo(handle, playerId) {
    let res;
    try {
        res = await supabaseInstance.rpc('set_my_venmo', { p_handle: handle });
    } catch (e) {
        res = { data: null, error: e };
    }
    const { data, error } = res || {};
    if (!error) {
        if (myVenmo.playerId === playerId) Object.assign(myVenmo, { state: 'ready', handle: data && data.handle ? String(data.handle) : null });
        fillVenmoField(account.player);
        renderVenmoField();
        return {};
    }
    console.error('Venmo save failed:', error);
    // (The GHIN and handicap are saved by now, and each message says so)
    const notVenmo = 'Your GHIN and handicap saved, but your Venmo didn’t.';
    if (paymentsMissing(error)) {
        if (myVenmo.playerId === playerId) myVenmo.state = 'missing';
        fillVenmoField(account.player);
        renderVenmoField();
        return { message: 'Your GHIN and handicap saved. Venmo is being set up, so your username didn’t save yet.' };
    }
    if (isWaitingApproval(error)) {
        if (myVenmo.playerId === playerId) myVenmo.state = 'held';
        fillVenmoField(account.player);
        renderVenmoField();
        return { message: `${notVenmo} ${error.message}` };
    }
    if (String(error.code || '') === '22023' && error.message) return { message: `${notVenmo} ${error.message}`, field: true };
    if (looksSignedOut(error) || /not linked/i.test(error.message || '')) {
        if (!(await recheckAccount('profile'))) return { stop: true };
    }
    return { message: `${notVenmo} Check your connection and try again.` };
}

// The signed-in player's own trip-cost payments for this trip (my_trip_payments: only ever his own
// rows), for the cost card's "Trip cost: $800 paid (Oct 15)". state: 'idle', 'loading', 'ready'
// (rows), 'missing' (payments_2027.sql hasn't run) or 'failed' (tried again on the next re-render).
const myTripPay = { playerId: null, state: 'idle', rows: [], seq: 0 };

// From renderPersonal: load for whoever is signed in now (a different player, or after a failure)
function refreshTripPaid() {
    const player = account.player;
    if (!player || !supabaseInstance || !TRIP.year) {
        myTripPay.seq++; // drop any load still on its way
        Object.assign(myTripPay, { playerId: null, state: 'idle', rows: [] });
    } else if (myTripPay.playerId !== player.id || myTripPay.state === 'failed') {
        loadMyTripPayments(player.id);
    }
    renderTripPaid();
}

async function loadMyTripPayments(playerId) {
    const seq = ++myTripPay.seq;
    Object.assign(myTripPay, { playerId, state: 'loading', rows: [] });
    let state = 'failed';
    let rows = [];
    try {
        const { data, error } = await supabaseInstance.rpc('my_trip_payments', { p_trip_year: TRIP.year });
        if (!error) {
            state = 'ready';
            rows = Array.isArray(data) ? data : [];
        } else if (paymentsMissing(error)) {
            state = 'missing';
        } else {
            console.warn('Could not load your trip payments:', error);
        }
    } catch (e) {
        console.warn('Could not load your trip payments:', e);
    }
    if (seq !== myTripPay.seq) return; // signed out or switched player meanwhile
    Object.assign(myTripPay, { state, rows });
    renderTripPaid();
}

// "Trip cost: $1,600 paid (Oct 15)", or "$800 paid so far" while it's less than the per-man cost; with
// several payments, the total and the latest date. Nothing when he has none (or they couldn't load),
// and never anyone else's.
function renderTripPaid() {
    const el = document.getElementById('cost-paid');
    if (!el) return;
    const player = account.player;
    const rows = player && myTripPay.playerId === player.id && myTripPay.state === 'ready' ? myTripPay.rows : [];
    let cents = 0;
    let latest = null;
    rows.forEach(r => {
        const c = Math.round(Number(r && r.amount) * 100);
        if (Number.isFinite(c) && c > 0) cents += c;
        const d = configDate(r && r.paid_on);
        if (d && (!latest || d > latest)) latest = d;
    });
    if (!cents) {
        el.hidden = true;
        el.innerHTML = '';
        return;
    }
    const day = latest ? `<span class="nowrap">${esc(monthDay(latest))}</span>` : '';
    const when = rows.length > 1 ? ` (${rows.length} payments${day ? `, latest ${day}` : ''})` : day ? ` (${day})` : '';
    // The green check only once he's paid the per-man cost; less than that is "paid so far"
    const perPerson = Math.round(Number(TRIP.cost && TRIP.cost.perPerson) * 100);
    const inFull = perPerson > 0 && cents >= perPerson;
    el.classList.toggle('is-part', !inFull);
    el.innerHTML = `${icon(inFull ? 'check' : 'wallet')}<span>Trip cost: <strong>${esc(configMoney(cents / 100))} paid</strong>${inFull ? '' : ' so far'}${when}</span>`;
    el.hidden = false;
}

// ---------------------------------------------------------------------------
// Ryder Cup live score (Supabase)
// ---------------------------------------------------------------------------
async function fetchRyderCupScores() {
    if (!supabaseInstance || !SEASON_LIVE) return;

    try {
        const { data, error } = await supabaseInstance
            .from('ryder_cup_scores')
            .select('*')
            .eq('id', 1)
            .single();

        if (error && error.code !== 'PGRST116') throw error;

        const bluePoints = data ? data.blue_score : 0;
        const redPoints = data ? data.red_score : 0;

        const widget = document.getElementById('team-scoreboard-widget');
        const s1 = document.getElementById('score-team-1');
        const s2 = document.getElementById('score-team-2');
        if (widget && s1 && s2) {
            widget.classList.remove('team-scoreboard-hidden');
            s1.textContent = fmtPoints(bluePoints);
            s2.textContent = fmtPoints(redPoints);
        }

        const homeBlue = document.getElementById('home-ryder-blue-pts');
        const homeRed = document.getElementById('home-ryder-red-pts');
        if (homeBlue && homeRed) {
            homeBlue.textContent = fmtPoints(bluePoints);
            homeRed.textContent = fmtPoints(redPoints);
        }
    } catch (e) {
        console.error('Error fetching global Ryder Cup scores:', e);
    }
}

// ---------------------------------------------------------------------------
// Standings pop-up: the official Cup total, round totals once posted, then the roster and
// handicaps. (Live scores, hole by hole, live on the round tracker's board.)
// ---------------------------------------------------------------------------
async function renderDynamicScoreboard() {
    if (!elements.dynamicLeaderboard) return;

    // Until the new season is switched on, the database still holds last year's rounds.
    if (!SEASON_LIVE) {
        renderFallbackLeaderboard();
        return;
    }

    // The official Cup total (hand-entered in Admin) leads, even before any round totals are posted
    let cup = null;
    let roundScores = [];
    try {
        if (supabaseInstance) {
            const settle = q => Promise.resolve(q).catch(error => ({ data: null, error }));
            const [cupRes, roundsRes] = await Promise.all([
                settle(supabaseInstance.from('ryder_cup_scores').select('*').eq('id', 1).single()),
                settle(supabaseInstance.from('player_round_scores').select('*, players(id, name, team_id, handicap)').order('round_number'))
            ]);
            if (cupRes.error && cupRes.error.code !== 'PGRST116') console.error('Cup total load failed:', cupRes.error);
            else cup = { blue: cupRes.data ? cupRes.data.blue_score : 0, red: cupRes.data ? cupRes.data.red_score : 0 };
            if (roundsRes.error) console.error('Round totals load failed:', roundsRes.error);
            else roundScores = roundsRes.data || [];
        }
    } catch (err) {
        console.error('Standings load failed:', err);
    }

    const live = `
        <a class="standings-live" href="round_tracker.html#board">
            <span><b>Live scores, hole by hole <span aria-hidden="true">›</span></b><small>Every match, straight from the groups’ scorecards</small></span>
        </a>`;
    elements.dynamicLeaderboard.innerHTML = standingsCupHTML(cup, roundScores) + live + roundTablesHTML(roundScores) + `
        <details class="standings-roster">
            <summary><span>Roster &amp; handicaps<small>${roster.confirmed.length ? `${roster.confirmed.length} players, ` : ''}ranked by handicap</small></span>${icon('chevron')}</summary>
            ${rosterListHTML()}
        </details>`;
}

function fmtPar(v) {
    if (v === null || v === undefined) return '-';
    if (v === 0) return 'E';
    if (v > 0) return '+' + v;
    return '' + v;
}

// The Cup total card; once rounds are posted, each team's players by total to par under it.
// `cup` is null when the total couldn't be loaded.
function standingsCupHTML(cup, roundScores) {
    // Per-player overall totals (true strokes & true to-par against each round's course)
    const playerTotals = {};
    roundScores.forEach(s => {
        if (!s.players) return;
        const pid = s.player_id;
        if (!playerTotals[pid]) {
            playerTotals[pid] = { name: s.players.name, team_id: s.players.team_id, total_score: 0, total_to_par: 0, rounds_played: 0 };
        }
        const pars = parsForRound(s.round_number);
        let hasPlayed = false, roundStrokes = 0, roundToPar = 0;
        for (let i = 1; i <= 18; i++) {
            const val = s[`h${i}`];
            if (val !== null && val !== undefined) {
                hasPlayed = true;
                roundStrokes += val;
                if (pars) roundToPar += (val - pars[i - 1]);
            }
        }
        if (hasPlayed) {
            playerTotals[pid].total_score += roundStrokes;
            playerTotals[pid].total_to_par += roundToPar;
            playerTotals[pid].rounds_played++;
        }
    });
    const played = Object.values(playerTotals).filter(p => p.rounds_played);
    const bluePlayers = played.filter(p => p.team_id === 1).sort((a, b) => a.total_to_par - b.total_to_par);
    const redPlayers = played.filter(p => p.team_id === 2).sort((a, b) => a.total_to_par - b.total_to_par);

    const teamList = (players, color, bg, border, label) => `
        <div style="background: ${bg}; border: 1px solid ${border}; border-radius: 14px; padding: 16px;">
            <div style="font-weight: 800; color: ${color}; margin-bottom: 12px; text-transform: uppercase; font-size: 0.78rem; letter-spacing: 0.12em;">${label}</div>
            ${players.map(p => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 7px 0; border-bottom: 1px solid var(--line);">
                    <span style="font-size: 0.9rem; font-weight: 600;">${esc(p.name)}</span>
                    <div style="display: flex; gap: 12px; align-items: center; font-variant-numeric: tabular-nums;">
                        <span style="font-weight: 800; color: ${p.total_to_par <= 0 ? 'var(--fairway)' : 'var(--red-team)'}; font-size: 0.95rem;">${fmtPar(p.total_to_par)}</span>
                        <span style="color: var(--ink-dim); font-size: 0.85rem;">${p.total_score || '-'}</span>
                    </div>
                </div>`).join('')}
        </div>`;

    const score = v => (cup ? fmtPoints(v) : '–');
    return `
        <section class="standings-cup" aria-labelledby="standings-cup-title">
            <h3 id="standings-cup-title">The ${esc(TRIP.year)} Cup${phase.name === 'wrap' ? ' · Final' : ''}</h3>
            <div class="standings-score">
                <div class="side blue"><span>Blue</span><b>${score(cup && cup.blue)}</b></div>
                <div class="vs" aria-hidden="true">vs</div>
                <div class="side red"><span>Red</span><b>${score(cup && cup.red)}</b></div>
            </div>
            <p class="standings-note">${cup ? 'Official total, posted by the commissioner after each session.' : 'Couldn’t load the Cup total just now. Close this and try again.'}</p>
            ${played.length ? `
            <div class="standings-teams">
                ${teamList(bluePlayers, 'var(--blue-team)', 'rgba(110, 168, 255, 0.07)', 'rgba(110, 168, 255, 0.22)', 'Blue Team')}
                ${teamList(redPlayers, 'var(--red-team)', 'rgba(255, 123, 114, 0.07)', 'rgba(255, 123, 114, 0.22)', 'Red Team')}
            </div>` : ''}
        </section>`;
}

// Hole-by-hole round totals the commissioner posted (player_round_scores), one table per round
function roundTablesHTML(roundScores) {
    const roundMap = {};
    roundScores.forEach(s => {
        if (!roundMap[s.round_number]) roundMap[s.round_number] = [];
        roundMap[s.round_number].push(s);
    });

    let html = '';
    const roundNumbers = Object.keys(roundMap).map(Number).sort((a, b) => a - b);
    roundNumbers.forEach(rn => {
        const points = scoringForRound(rn) === 'stableford';
        const roundPlayers = roundMap[rn].filter(s => s.players).sort((a, b) => {
            if (points) return (b.total_score || 0) - (a.total_score || 0); // highest points wins
            if (a.to_par !== null && b.to_par !== null) return a.to_par - b.to_par;
            if (a.total_score !== null && b.total_score !== null) return a.total_score - b.total_score;
            return 0;
        });
        const pars = parsForRound(rn);
        const th = 'padding: 10px 5px; color: var(--ink-dim); font-size: 0.78rem; border-bottom: 2px solid var(--line-strong);';

        html += `
            <div style="background: rgba(244, 235, 223, 0.02); border: 1px solid var(--line); border-radius: 16px; padding: 20px; margin-bottom: 20px;">
                <div style="border-bottom: 1px solid var(--line); padding-bottom: 12px; margin-bottom: 14px;">
                    <div style="font: 500 1.4rem var(--serif);">Round ${rn}</div>
                    <div style="color: var(--gold); font-size: 0.8rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; margin-top: 3px;">${esc(getRoundFormat(rn))}</div>
                </div>
                <div style="overflow-x: auto; width: 100%; border-radius: 8px;">
                    <table style="width: 100%; min-width: 800px; border-collapse: collapse; text-align: center; font-size: 0.95rem; font-variant-numeric: tabular-nums;">
                        <thead>
                            <tr>
                                <th style="padding: 12px 15px; position: sticky; left: 0; background: var(--surface); z-index: 2; text-align: left; border-bottom: 2px solid var(--line-strong);">Player</th>
                                ${Array.from({ length: 18 }, (_, i) => `<th style="${th}">${i + 1}${pars ? `<div style="font-weight: 500; opacity: 0.7;">${pars[i]}</div>` : ''}</th>`).join('')}
                                <th style="padding: 10px; border-bottom: 2px solid var(--line-strong); font-weight: 900;">${points ? 'PTS' : 'TOT'}</th>
                                <th style="padding: 10px; border-bottom: 2px solid var(--line-strong); font-weight: 900;">+/-</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${roundPlayers.map((s, idx) => {
                                let tdsHoles = '';
                                for (let i = 1; i <= 18; i++) {
                                    const score = s[`h${i}`];
                                    tdsHoles += `<td style="padding: 10px 5px; border-bottom: 1px solid var(--line);">${score !== null && score !== undefined ? esc(score) : '-'}</td>`;
                                }
                                return `
                                <tr style="background: ${idx % 2 === 0 ? 'rgba(244, 235, 223, 0.015)' : 'transparent'};">
                                    <td style="padding: 12px 15px; position: sticky; left: 0; background: var(--surface); z-index: 1; text-align: left; border-bottom: 1px solid var(--line); font-weight: 600; white-space: nowrap;">
                                        <span style="display: inline-block; width: 18px; text-align: center; color: var(--ink-dim); font-size: 0.8rem; margin-right: 8px;">${idx + 1}</span>${esc(s.players.name)}
                                    </td>
                                    ${tdsHoles}
                                    <td style="padding: 10px; border-bottom: 1px solid var(--line); border-left: 1px solid var(--line-strong); font-weight: 800;">${s.total_score !== null && s.total_score !== undefined ? esc(s.total_score) : '-'}</td>
                                    <td style="padding: 10px; border-bottom: 1px solid var(--line); font-weight: 900; color: ${s.to_par !== null && s.to_par !== undefined ? (s.to_par <= 0 ? 'var(--fairway)' : 'var(--red-team)') : 'inherit'};">${fmtPar(s.to_par)}</td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>`;
    });
    return html;
}

// The confirmed roster ranked by handicap (handicaps only: GHIN numbers are for the captains and Admin)
function rosterListHTML() {
    const sortedRoster = [...roster.confirmed].sort((a, b) => {
        if (a.handicap === null) return 1;
        if (b.handicap === null) return -1;
        return a.handicap - b.handicap;
    });
    return `
        <div class="leaderboard-list">
            <div class="leaderboard-row header-row">
                <div class="col-rank">Rank</div>
                <div class="col-player">Player</div>
                <div class="col-hcp">Handicap</div>
            </div>
            ${!sortedRoster.length ? `<div class="leaderboard-row"><div class="col-player">${roster.error ? 'Couldn’t load the crew right now.' : roster.loaded ? 'No one on the roster yet.' : 'Loading the crew…'}</div></div>` : ''}
            ${sortedRoster.map((player, index) => `
                <div class="leaderboard-row">
                    <div class="col-rank">${index + 1}</div>
                    <div class="col-player" style="color: var(--ink); font-weight: 700;">${esc(player.name)}</div>
                    ${player.handicap !== null && !isNaN(player.handicap)
                        ? `<div class="col-hcp" style="color: var(--fairway); font-weight: 800; font-variant-numeric: tabular-nums; font-size: 1.1rem;">${esc(fmtHcp(player.handicap))}</div>`
                        : '<div class="col-hcp hcp-none">No HCP</div>'}
                </div>`).join('')}
        </div>`;
}

// Before the season is live: the field by handicap (the database still holds last year's rounds)
function renderFallbackLeaderboard() {
    const opens = TRIP.dates && TRIP.dates.start ? new Date(`${TRIP.dates.start}T12:00:00`).toLocaleString('en-US', { month: 'short', day: 'numeric' }) : '';
    elements.dynamicLeaderboard.innerHTML = `
        <div style="border-bottom: 1px solid var(--line); padding-bottom: 15px; margin-bottom: 22px; display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap;">
            <div>
                <div style="font: 500 1.6rem var(--serif);">${phase.name === 'pre' ? 'Pre-Tournament Rankings' : 'The Roster'}</div>
                ${phase.name === 'pre' && opens ? `<div style="color: var(--gold); font-size: 0.85rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; margin-top: 5px;">Live scores open ${esc(opens)}</div>` : ''}
            </div>
            <div style="color: var(--ink-dim); font-size: 0.8rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em;">Ranked by handicap</div>
        </div>
        ${rosterListHTML()}`;
}

function getRoundFormat(num) {
    const course = findCourse(CFG.roundCourses && CFG.roundCourses[num]);
    const format = CFG.roundFormats && CFG.roundFormats[num];
    return [course ? course.name : null, format].filter(Boolean).join(' · ') || 'Stroke Play';
}

// ---------------------------------------------------------------------------
// Scroll effects: header state, scroll-spy, reveals
// ---------------------------------------------------------------------------
let revealObserver = null;
function initReveals() {
    const targets = document.querySelectorAll('.reveal:not(.is-in)');
    if (REDUCED_MOTION || !('IntersectionObserver' in window)) {
        targets.forEach(el => el.classList.add('is-in'));
        return;
    }
    if (!revealObserver) {
        revealObserver = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-in');
                    revealObserver.unobserve(entry.target);
                }
            });
        }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    }
    targets.forEach(el => revealObserver.observe(el));
}

function initScrollEffects() {
    const nav = elements.nav;
    const onScroll = () => {
        if (nav) nav.classList.toggle('is-scrolled', window.scrollY > 40);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    const links = document.querySelectorAll('.nav-links a[data-spy]');
    if (!links.length || !('IntersectionObserver' in window)) return;
    const map = new Map();
    links.forEach(a => {
        const section = document.querySelector(a.getAttribute('href'));
        if (section) map.set(section, a);
    });
    const spy = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            const link = map.get(entry.target);
            if (!link) return;
            if (entry.isIntersecting) {
                links.forEach(l => l.classList.remove('is-active'));
                link.classList.add('is-active');
            } else {
                link.classList.remove('is-active');
            }
        });
    }, { rootMargin: '-45% 0px -50% 0px' });
    map.forEach((_, section) => spy.observe(section));
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------
let lastFocused = null;

// Where focus should return after a dialog closes. Menus hide themselves when an
// action runs, so fall back to the button that opened them.
function focusReturnTarget() {
    const a = document.activeElement;
    if (!a || a === document.body) return null;
    if (a.closest('#clubhouse-menu')) return elements.clubhouseBtn;
    if (a.closest('#drawer')) return elements.navToggle;
    return a;
}

// While a dialog is open, everything behind it is inert so Tab stays inside.
function setBackgroundInert(on) {
    document.querySelectorAll('body > :not(.modal):not(.lightbox):not(script)').forEach(n => { n.inert = on; });
}

// focusTarget: a selector, an element, or a function (run once the dialog shows) returning one
function openDialog(el, focusTarget) {
    if (!el) return;
    if (!document.querySelector('.modal.active, .lightbox.active')) {
        const t = focusReturnTarget();
        if (t) lastFocused = t;
    }
    el.classList.add('active');
    document.body.style.overflow = 'hidden';
    setBackgroundInert(true);
    const target = typeof focusTarget === 'function' ? focusTarget()
        : focusTarget && typeof focusTarget !== 'string' ? focusTarget
        : el.querySelector(focusTarget || 'input, button, [href]');
    if (target) setTimeout(() => target.focus(), 30);
}

function closeDialog(el) {
    if (!el || !el.classList.contains('active')) return;
    el.classList.remove('active');
    if (!document.querySelector('.modal.active, .lightbox.active')) {
        document.body.style.overflow = '';
        setBackgroundInert(false);
        lastFocused = focusAfterDialog(lastFocused);
        if (lastFocused) lastFocused.focus();
    }
}

// The button that opened a dialog may be gone or hidden by the time it closes: the hero's RSVP
// buttons are re-rendered after an RSVP or a log out, and the crew block hides once you've
// answered. Use its new copy, or the nearest RSVP button still showing, so focus doesn't drop
// to the top of the page.
function focusAfterDialog(el) {
    if (!el || typeof el.focus !== 'function') return null;
    const shown = n => !!n && n.isConnected && n.getClientRects().length > 0;
    if (shown(el)) return el;
    const sameId = el.id && document.getElementById(el.id);
    if (shown(sameId)) return sameId;
    if (!(el.matches && el.matches('[data-action="rsvp"]'))) return el.isConnected ? el : null;
    const section = el.isConnected ? el.closest('section') : null;
    const nearby = section ? [...section.querySelectorAll('[data-action="rsvp"]')] : [];
    const hero = ['hero-you-rsvp', 'hero-headcount-rsvp', 'hero-rsvp-cta'].map(id => document.getElementById(id));
    return nearby.concat(hero).find(shown) || null;
}

function setDrawer(open) {
    if (!elements.drawer || !elements.navToggle) return;
    elements.drawer.classList.toggle('is-open', open);
    elements.navToggle.setAttribute('aria-expanded', String(open));
    elements.navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    document.body.classList.toggle('drawer-open', open);
    if (elements.nav) elements.nav.classList.toggle('is-solid', open);
    // The drawer covers the page, so keep Tab inside it while it's open.
    const dialogOpen = !!document.querySelector('.modal.active, .lightbox.active');
    ['main', 'footer', '.skip-link', '.preview-ribbon'].forEach(sel => { const n = document.querySelector(sel); if (n) n.inert = open || dialogOpen; });
}

function setClubhouse(open) {
    if (!elements.clubhouseBtn || !elements.clubhouseMenu) return;
    elements.clubhouseBtn.setAttribute('aria-expanded', String(open));
    elements.clubhouseMenu.classList.toggle('is-open', open);
}

function runAction(action) {
    if (action === 'logout') { logOutFromMenu(); return; } // asks first, with the menu still open
    if (!document.querySelector('.modal.active, .lightbox.active')) {
        const t = focusReturnTarget();
        if (t) lastFocused = t;
    }
    setDrawer(false);
    setClubhouse(false);
    if (action === 'rsvp') openRsvp();
    if (action === 'profile' || action === 'signup') openProfile();
    if (action === 'scoreboard') {
        openDialog(elements.leaderboardModal, '#leaderboard-close');
        renderDynamicScoreboard();
    }
}

function setupEventListeners() {
    // Standings pop-up hero image comes from config
    const sbHero = document.getElementById('scoreboard-hero');
    if (sbHero && CFG.scoreboardImage) sbHero.style.backgroundImage = `url('${CFG.scoreboardImage}')`;

    document.addEventListener('click', (e) => {
        // Clicks outside the clubhouse menu close it
        if (!e.target.closest('.nav-menu')) setClubhouse(false);

        const actionEl = e.target.closest('[data-action]');
        if (actionEl) {
            e.preventDefault();
            runAction(actionEl.dataset.action);
            return;
        }

        // Course option tabs (e.g. the two Talking Stick courses)
        const tab = e.target.closest('.course-tab');
        if (tab) { switchCourseOption(tab.dataset.group, tab.dataset.course); return; }

        // Course thumbnails swap the main photo
        const thumb = e.target.closest('.thumb');
        if (thumb) { showCoursePhoto(thumb.dataset.course, Number(thumb.dataset.index)); return; }

        // Main course photo opens the lightbox
        const courseHero = e.target.closest('.course-hero');
        if (courseHero) {
            const course = findCourse(courseHero.dataset.lightboxCourse);
            if (course) openLightbox(course.images.map(im => ({ src: im.full || im.src, alt: im.alt, caption: course.name })), Number(courseHero.dataset.index) || 0);
            return;
        }

        const tile = e.target.closest('.mosaic-tile');
        if (tile) { openAlbum(tile.dataset.album, Number(tile.dataset.index) || 0); return; }

        const albumOpen = e.target.closest('[data-album-open]');
        if (albumOpen) { openAlbum(albumOpen.dataset.albumOpen, 0); return; }

        const albumPick = e.target.closest('[data-album-pick]');
        if (albumPick) {
            if (albumPick.getAttribute('aria-pressed') !== 'true') switchAlbum(albumPick.dataset.albumPick);
            return;
        }

        const single = e.target.closest('[data-lightbox-single]');
        if (single) {
            openLightbox([{ src: single.dataset.lightboxSingle, alt: single.querySelector('img')?.alt || '', caption: single.dataset.caption || '' }], 0);
            return;
        }

        const yearBtn = e.target.closest('.reel-year');
        if (yearBtn) { switchReelYear(yearBtn.dataset.year); return; }

        const squadBtn = e.target.closest('.reel-squad-btn');
        if (squadBtn) {
            const panel = document.getElementById(squadBtn.getAttribute('aria-controls'));
            const open = squadBtn.getAttribute('aria-expanded') !== 'true';
            squadBtn.setAttribute('aria-expanded', String(open));
            squadBtn.lastChild.textContent = open ? 'Hide the winning squad' : 'See the winning squad';
            if (panel) {
                panel.hidden = !open;
                if (open) panel.classList.add('is-open');
            }
            return;
        }
    });

    if (elements.navToggle) {
        elements.navToggle.addEventListener('click', () => setDrawer(!elements.drawer.classList.contains('is-open')));
    }
    if (elements.drawer) {
        // Delegated, so the account row's links (rendered later) close the drawer too
        elements.drawer.addEventListener('click', (e) => { if (e.target.closest('a')) setDrawer(false); });
    }
    if (elements.clubhouseBtn) {
        elements.clubhouseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            setClubhouse(elements.clubhouseBtn.getAttribute('aria-expanded') !== 'true');
        });
        document.querySelector('.nav-menu')?.addEventListener('focusout', (e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setClubhouse(false);
        });
    }
    // Back from The Bookie after logging in or out there: the cached page may show the old login
    // (and the trip day may have moved on while it sat in the cache)
    window.addEventListener('pageshow', (e) => {
        if (!e.persisted) return;
        checkPhase();
        if (personalReady) ensureFreshAccount();
    });

    // Wherever home.css shows the full nav: the exact opposite of its hamburger rule, (max-width: 1099.98px)
    const desktopNav = window.matchMedia('not all and (max-width: 1099.98px)');
    const closeDrawerOnDesktop = (e) => { if (e.matches) setDrawer(false); };
    if (desktopNav.addEventListener) desktopNav.addEventListener('change', closeDrawerOnDesktop);
    else if (desktopNav.addListener) desktopNav.addListener(closeDrawerOnDesktop);

    // Close buttons
    document.getElementById('modal-close')?.addEventListener('click', closeProfile);
    document.getElementById('cancel-btn')?.addEventListener('click', closeProfile);
    document.getElementById('leaderboard-close')?.addEventListener('click', () => closeDialog(elements.leaderboardModal));

    // Click on the backdrop closes a modal
    [elements.registrationModal, elements.leaderboardModal, elements.rsvpModal].forEach(modal => {
        if (!modal) return;
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                if (modal === elements.registrationModal) closeProfile();
                else closeDialog(modal);
            }
        });
    });

    if (elements.registrationForm) {
        elements.registrationForm.addEventListener('submit', handleProfileSubmit);
        // A box being fixed loses its error mark; "Check it" follows what's typed in the Venmo box
        elements.registrationForm.addEventListener('input', (e) => {
            if (e.target.classList && e.target.classList.contains('field-input')) e.target.removeAttribute('aria-invalid');
            if (e.target.id === 'venmo-handle') syncVenmoCheck();
        });
    }

    // RSVP modal
    if (elements.rsvpForm) {
        elements.rsvpForm.addEventListener('submit', handleRsvpSubmit);
        elements.rsvpForm.addEventListener('change', (e) => {
            if (e.target.name === 'status') {
                setFieldError('rsvp-status-error', '');
                syncSundayOption();
            }
        });
    }
    document.querySelectorAll('[data-google-signin]').forEach(btn => {
        btn.addEventListener('click', () => signInWithGoogle(btn.dataset.next || 'rsvp'));
    });
    // "Switch player" / "Use a different account": log out on this device (after asking), then
    // show the account step
    ['rsvp-signout', 'rsvp-switch-account'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', async () => {
            if (!(await logOutHere())) return;
            showAccountStep('rsvp');
        });
    });
    document.getElementById('rsvp-close')?.addEventListener('click', () => closeDialog(elements.rsvpModal));
    document.getElementById('rsvp-again')?.addEventListener('click', () => openRsvp(true));
    document.getElementById('rsvp-see-count')?.addEventListener('click', () => {
        closeDialog(elements.rsvpModal);
        document.getElementById('attendees')?.scrollIntoView({ behavior: REDUCED_MOTION ? 'auto' : 'smooth' });
    });

    // Lightbox
    document.getElementById('lightbox-close')?.addEventListener('click', closeLightbox);
    document.getElementById('lightbox-prev')?.addEventListener('click', () => stepLightbox(-1));
    document.getElementById('lightbox-next')?.addEventListener('click', () => stepLightbox(1));
    if (elements.lightboxModal) {
        elements.lightboxModal.addEventListener('click', (e) => {
            if (e.target === elements.lightboxModal || e.target.tagName === 'FIGURE') closeLightbox();
        });
        let touchX = null;
        elements.lightboxModal.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
        elements.lightboxModal.addEventListener('touchend', (e) => {
            if (touchX === null) return;
            const dx = e.changedTouches[0].clientX - touchX;
            if (Math.abs(dx) > 50) stepLightbox(dx < 0 ? 1 : -1);
            touchX = null;
        });
    }

    document.addEventListener('keydown', (e) => {
        const lightboxOpen = elements.lightboxModal && elements.lightboxModal.classList.contains('active');
        if (lightboxOpen && e.key === 'ArrowRight') stepLightbox(1);
        if (lightboxOpen && e.key === 'ArrowLeft') stepLightbox(-1);
        if (e.key === 'Escape') {
            if (lightboxOpen) { closeLightbox(); return; }
            const ae = document.activeElement;
            if (ae && ae.closest && ae.closest('#clubhouse-menu')) elements.clubhouseBtn.focus();
            else if (ae && ae.closest && ae.closest('#drawer')) elements.navToggle.focus();
            // Escape from a profile opened in the RSVP form goes back to the form: closeProfile
            // reopens it a moment later, after the sheet's close below has nothing to close
            closeProfile();
            closeDialog(elements.rsvpModal);
            closeDialog(elements.leaderboardModal);
            setDrawer(false);
            setClubhouse(false);
        }
    });
}

// ---------------------------------------------------------------------------
// Lightbox
// ---------------------------------------------------------------------------
const lightbox = { items: [], index: 0 };

function openLightbox(items, index) {
    if (!elements.lightboxModal || !items.length) return;
    lightbox.items = items;
    lightbox.index = index;
    const multi = items.length > 1;
    document.getElementById('lightbox-prev').hidden = !multi;
    document.getElementById('lightbox-next').hidden = !multi;
    renderLightbox();
    openDialog(elements.lightboxModal, '#lightbox-close');
}

function renderLightbox() {
    const item = lightbox.items[lightbox.index];
    if (!item) return;
    elements.lightboxImage.src = item.src;
    elements.lightboxImage.alt = item.alt || '';
    elements.lightboxCaption.textContent = item.caption || '';
    elements.lightboxCount.textContent = lightbox.items.length > 1 ? `${lightbox.index + 1} / ${lightbox.items.length}` : '';
}

function stepLightbox(delta) {
    if (lightbox.items.length < 2) return;
    lightbox.index = (lightbox.index + delta + lightbox.items.length) % lightbox.items.length;
    renderLightbox();
}

function closeLightbox() {
    closeDialog(elements.lightboxModal);
    setTimeout(() => {
        if (elements.lightboxImage && !elements.lightboxModal.classList.contains('active')) elements.lightboxImage.src = '';
    }, 300);
}

// Global initialization
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
