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

// RSVP / head count (Supabase `rsvps` table — see rsvp_schema.sql)
const RSVP = CFG.rsvp || {};
const RSVP_YEAR = RSVP.year || TRIP.year;
const RSVP_STORAGE_KEY = `bbb_rsvp_${RSVP_YEAR}`;
const RSVP_LABELS = { in: 'I’m in', maybe: 'Probably', out: 'Can’t make it' };
const rsvpState = { available: false, missingTable: false, latest: [], lastAt: null };

// Registration + RSVP alerts go to the commissioner's inbox
const NOTIFY_EMAIL = 'westin.tucker@gmail.com';

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
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    award: '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4 12 14.01l-3-3"/>',
    expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
    tv: '<rect width="20" height="15" x="2" y="7" rx="2" ry="2"/><path d="m17 2-5 5-5-5"/>',
    mountain: '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>'
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
// Initialization
// ---------------------------------------------------------------------------
async function init() {
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
            roundLoginModal: document.getElementById('round-login-modal'),
            dynamicLeaderboard: document.getElementById('dynamic-leaderboard'),
            lightboxModal: document.getElementById('lightbox-modal'),
            lightboxImage: document.getElementById('lightbox-image'),
            lightboxCaption: document.getElementById('lightbox-caption'),
            lightboxCount: document.getElementById('lightbox-count')
        };

        // Wire up buttons first so a bad config entry can't leave Sign Up / Scoreboard dead.
        setupEventListeners();
        [renderHero, renderTripDetails, renderSchedule, renderCourses, renderCup, renderHallOfFame, initCountdown, initScrollEffects]
            .forEach(fn => {
                try { fn(); } catch (err) { console.error(`${fn.name} failed:`, err); }
            });

        await Promise.all([loadRosterData(), loadRsvps()]);
        renderRoster();
        roster.loaded = true;
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

    const ann = TRIP.announcement;
    const annEl = document.getElementById('announcement');
    if (annEl && ann && ann.body) {
        document.getElementById('announcement-title').textContent = ann.title || 'Event Updates';
        document.getElementById('announcement-body').textContent = ann.body;
        annEl.hidden = false;
    }

    const grid = document.getElementById('fact-grid');
    if (!grid) return;

    const hq = TRIP.hq || {};
    const hqValue = hq.link ? `<a href="${esc(hq.link)}" target="_blank" rel="noopener">${esc(hq.name)}</a>` : esc(hq.name || 'TBA');
    const facts = [
        { i: 'calendar', label: 'Dates', value: esc(TRIP.dates && TRIP.dates.label), note: TRIP.dates && TRIP.dates.note },
        { i: 'pin', label: 'Home base', value: esc(TRIP.region || TRIP.location), note: TRIP.regionNote },
        { i: 'bed', label: 'HQ', value: hqValue, note: hq.note },
        { i: 'plane', label: 'Fly into', value: TRIP.airport ? esc(`${TRIP.airport.code} · ${TRIP.airport.name}`) : 'TBA', note: TRIP.airport && TRIP.airport.note },
        { i: 'sun', label: 'Forecast', value: esc(TRIP.weather && TRIP.weather.value), note: TRIP.weather && TRIP.weather.note },
        { i: 'flag', label: 'Golf', value: esc(CFG.hero && CFG.hero.roundsLabel), note: CFG.hero && CFG.hero.roundsNote }
    ].filter(f => f.value);

    const cost = TRIP.cost || {};
    const breakdown = (cost.breakdown || []).filter(b => b && b.label);
    const costCard = cost.perPerson ? `
        <div class="cost-card reveal">
            <div class="cost-amount">${cost.approx ? '<span class="approx">approx.</span>' : ''}<sup>$</sup>${Number(cost.perPerson).toLocaleString('en-US')}</div>
            <div class="cost-meta">
                <b>The damage · per man</b>
                <p>${esc(cost.note || '')}</p>
            </div>
            ${breakdown.length ? `<div class="cost-breakdown">${breakdown.map(b => `<div class="cost-line"><span>${esc(b.label)}</span><b>${esc(typeof b.amount === 'number' ? formatMoney(b.amount) : b.amount)}</b></div>`).join('')}</div>` : ''}
        </div>` : '';

    grid.innerHTML = facts.map((f, idx) => `
        <div class="fact reveal ${idx % 2 ? 'reveal-delay-1' : ''}">
            <div class="fact-icon">${icon(f.i)}</div>
            <div class="fact-label">${esc(f.label)}</div>
            <div class="fact-value">${f.value}</div>
            ${f.note ? `<div class="fact-note">${esc(f.note)}</div>` : ''}
        </div>`).join('') + costCard;
}

// ---------------------------------------------------------------------------
// Countdown
// ---------------------------------------------------------------------------
function initCountdown() {
    const target = new Date(TRIP.countdownTarget || '2027-04-08T07:00:00-07:00').getTime();
    const end = TRIP.dates && TRIP.dates.end ? new Date(`${TRIP.dates.end}T23:59:59-07:00`).getTime() : target;
    const els = ['cd-days', 'cd-hours', 'cd-mins', 'cd-secs'].map(id => document.getElementById(id));
    const label = document.getElementById('cd-label');
    if (els.some(el => !el)) return;
    if (label && TRIP.countdownLabel) label.textContent = TRIP.countdownLabel;

    let timer = null;
    function update() {
        const now = Date.now();
        let distance = target - now;
        if (distance <= 0) {
            els.forEach(el => { el.textContent = '00'; });
            if (label) label.textContent = now <= end ? "We're live in the desert" : 'See you next year';
            if (timer) clearInterval(timer);
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
    timer = setInterval(update, 1000);
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
        media += `${day.tag ? `<span class="day-tag ${day.tagSoft ? 'soft' : ''}">${esc(day.tag)}</span>` : ''}
            <div class="day-date"><b>${dayNum}</b><span>${esc(month)}<small>${esc(dow)}</small></span></div></div>`;

        const slots = (day.slots || []).map(s => {
            const group = s.courseId ? findCourseGroup(s.courseId) : null;
            const what = group ? `<a href="#course-${esc(group.anchor || group.id)}">${esc(s.what)}</a>` : esc(s.what);
            return `<li class="slot"><span class="slot-when">${esc(s.when)}</span><span class="slot-what">${what}</span><span class="slot-meta">${esc(s.meta || '')}</span></li>`;
        }).join('');

        return `
        <article class="day reveal reveal-delay-${idx % 4}">
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
    return `
        <p class="course-club">${esc(group.club || course.club)}</p>
        <h3 class="course-title">${esc(course.name)}</h3>
        ${course.tagline ? `<p class="course-tagline">${esc(course.tagline)}</p>` : ''}
        <p class="course-desc">${esc(course.description)}</p>
        ${when ? `<span class="course-when">${icon('calendar')}${esc(when)}</span>` : ''}
        ${stats ? `<div class="course-stats">${stats}</div>` : ''}
        ${course.designer ? `<p class="course-designer">Designed by <b>${esc(course.designer)}</b>${course.opened ? ` · Opened ${esc(course.opened)}` : ''}${course.aka ? ` · ${esc(course.aka)}` : ''}</p>` : ''}
        ${course.midTees ? `<p class="course-designer">Likely our tees: <b>${esc(course.midTees)}</b></p>` : ''}
        ${holes ? `<ul class="sig-holes" aria-label="Signature holes">${holes}</ul>` : ''}
        ${accolades ? `<div class="accolades">${accolades}</div>` : ''}
        ${scorecardHTML(course)}
        ${course.credit ? `<p class="course-credit">Photos: <a href="${esc(course.credit.url)}" target="_blank" rel="noopener">${esc(course.credit.name)}</a></p>` : ''}`;
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
        body.innerHTML = courseBodyHTML(course, group);
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
            <p class="needed">${esc(cup.liveNote || 'Live Cup standings — updated by the scorekeepers after every session.')}</p>
        </div>`;
    }

    if (liveTeams) {
        const teamCard = (team, n) => {
            const color = n === 1 ? 'var(--blue-team)' : 'var(--red-team)';
            const withHcp = team.filter(p => typeof p.handicap === 'number');
            const avg = withHcp.length ? (withHcp.reduce((a, p) => a + p.handicap, 0) / withHcp.length).toFixed(1) : '–';
            return `
            <div class="team-card" style="--team-color: ${color};">
                <h3>${n === 1 ? 'Team Blue' : 'Team Red'} <small>Avg HCP ${avg}</small></h3>
                ${team.map(p => `<div class="team-row"><span>${esc(p.name)}${isCaptain(p.name) ? '<span class="cap-tag">Capt.</span>' : ''}</span><span class="hcp">${typeof p.handicap === 'number' ? p.handicap.toFixed(1) : '–'}</span></div>`).join('')}
            </div>`;
        };
        html += `<div class="teams">${teamCard(team1, 1)}${teamCard(team2, 2)}</div>`;
    } else if (latest) {
        html += `<div class="cup-reel-slot" style="grid-column: 1 / -1;">${champsReelHTML(latest, editions)}</div>`;
    }

    // The hardware + this year's draft
    const trophy = cup.trophy;
    html += `
        <div class="cup-card cup-hardware reveal">
            ${trophy && trophy.src ? `<button type="button" class="hardware-photo" data-lightbox-single="${esc(trophy.full || trophy.src)}" data-caption="${esc(trophy.caption || '')}" aria-label="View the trophy full screen"><img src="${esc(trophy.src)}" alt="${esc(trophy.alt || 'The Bros before Boges trophy')}" loading="lazy" decoding="async"></button>` : ''}
            <div>
                <p class="eyebrow">The Hardware</p>
                <h3>${esc(cup.trophyTitle || 'The Cup')}</h3>
                <p>${esc(cup.trophyText || '')}</p>
            </div>
        </div>
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
function renderHallOfFame() {
    const list = document.getElementById('editions');
    if (list) {
        const next = `
            <div class="edition next reveal">
                <h3 class="edition-year">${esc(TRIP.year)}</h3>
                <div><div class="edition-where">${esc(TRIP.location)}</div><div class="edition-note">${esc(CFG.hallOfFameNextNote || '')}</div></div>
                <div class="edition-result"><b>Up next</b><span style="color: var(--copper);">${esc(TRIP.dates && TRIP.dates.short)}</span></div>
            </div>`;
        const past = (CFG.history || []).map(e => {
            const w = e.champion;
            const result = e.score && w ? `<b>${fmtPoints(e.score[w])}–${fmtPoints(e.score[w === 'blue' ? 'red' : 'blue'])}</b><span style="color: var(--${w}-team);">Team ${w === 'blue' ? 'Blue' : 'Red'} wins</span>` : `<b>${esc(e.resultText || '')}</b>`;
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
async function loadRosterData() {
    if (!supabaseInstance) {
        console.warn('Supabase not configured. Using empty roster.');
        roster.error = true;
        renderRoster();
        return;
    }

    try {
        const { data, error } = await supabaseInstance
            .from('players')
            .select('id, name, ghin, handicap, team_id, status')
            .order('name');

        if (error) {
            console.error('Error fetching roster:', error);
            roster.error = true;
            renderRoster();
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
                    ghin: p.ghin,
                    handicap: p.handicap !== null && p.handicap !== undefined ? parseFloat(p.handicap) : null,
                    team_id: p.team_id
                });
            } else if (p.status === 'potential') {
                roster.potential.push(p.name);
            }
        });
        renderRoster();
    } catch (e) {
        console.error('Roster fetch failed:', e);
        roster.error = true;
        renderRoster();
    }
}

function playerCardHTML(p, i, meta) {
    const nameKey = p.name.replace(/\s+/g, '');
    const hasCard = (CFG.playerCards || []).includes(nameKey);
    const cap = isCaptain(p.name);
    const hcp = typeof p.handicap === 'number' && !isNaN(p.handicap) ? p.handicap.toFixed(1) : '–';
    return `
            <div class="player ${cap ? 'is-captain' : ''} reveal" style="transition-delay: ${Math.min(i, 12) * 30}ms;">
                <div class="player-avatar">
                    <span>${esc(getInitials(p.name))}</span>
                    ${hasCard ? `<img src="assets/PlayerCards/${esc(nameKey)}.jpg" alt="" loading="lazy" onerror="this.remove()">` : ''}
                </div>
                <div class="player-info">
                    <div class="player-name">${esc(p.name)}${cap ? '<span class="cap-tag">Capt.</span>' : ''}</div>
                    <div class="player-meta">${esc(meta)}</div>
                </div>
                <div class="player-hcp"><b>${esc(hcp)}</b><span>HCP</span></div>
            </div>`;
}

function renderRoster() {
    const grid = elements.confirmedRoster;
    if (!grid) return;
    if (rsvpState.available) {
        renderHeadcount();
        return;
    }
    const PLAYERS_WITH_CARDS = (CFG.playerCards || []);
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
        grid.innerHTML = sorted.map((p, i) => {
            const nameKey = p.name.replace(/\s+/g, '');
            const hasCard = PLAYERS_WITH_CARDS.includes(nameKey);
            const cap = isCaptain(p.name);
            return `
            <div class="player ${cap ? 'is-captain' : ''} reveal" style="transition-delay: ${Math.min(i, 12) * 30}ms;">
                <div class="player-avatar">
                    <span>${esc(getInitials(p.name))}</span>
                    ${hasCard ? `<img src="assets/PlayerCards/${esc(nameKey)}.jpg" alt="" loading="lazy" onerror="this.remove()">` : ''}
                </div>
                <div class="player-info">
                    <div class="player-name">${esc(p.name)}${cap ? '<span class="cap-tag">Capt.</span>' : ''}</div>
                    <div class="player-meta">GHIN ${realGhin(p.ghin) ? esc(realGhin(p.ghin)) : '—'}</div>
                </div>
                <div class="player-hcp"><b>${p.handicap !== null ? esc(p.handicap.toFixed(1)) : '–'}</b><span>HCP</span></div>
            </div>`;
        }).join('');
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
        const { data, error } = await supabaseInstance
            .from('rsvps')
            .select('name, status, sunday_round, created_at')
            .eq('trip_year', RSVP_YEAR)
            .order('created_at', { ascending: true })
            .limit(2000);

        if (error) {
            rsvpState.available = false;
            rsvpState.missingTable = isMissingTable(error);
            if (!rsvpState.missingTable) console.error('Error loading RSVPs:', error);
            return;
        }

        // Rows are oldest-first, so each person's latest answer wins. Keep the
        // best-capitalized spelling anyone used for the name ("kelly dennard" -> "Kelly Dennard").
        const latest = new Map();
        const spelling = new Map();
        (data || []).forEach(r => {
            if (!r || !r.name || !RSVP_LABELS[r.status]) return;
            const key = normName(r.name);
            const tidy = cleanName(r.name);
            if (/[A-Z]/.test(tidy) || !spelling.has(key)) spelling.set(key, tidy);
            latest.set(key, r);
        });
        rsvpState.latest = [...latest.entries()].map(([key, r]) => {
            let name = spelling.get(key);
            if (!/[A-Z]/.test(name)) name = name.replace(/(^|[\s'-])([a-z])/g, (m, pre, ch) => pre + ch.toUpperCase());
            return { ...r, name };
        });
        rsvpState.lastAt = data && data.length ? data[data.length - 1].created_at : null;
        rsvpState.available = true;
        rsvpState.missingTable = false;
    } catch (e) {
        console.error('RSVP load failed:', e);
    }
}

function rsvpCounts() {
    const list = rsvpState.latest;
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

function findRosterPlayer(name) {
    const key = normName(name);
    return roster.confirmed.find(p => normName(p.name) === key) || null;
}

// Prefer the roster's spelling of a name when the person is on it.
function rsvpName(r) {
    const player = findRosterPlayer(r.name);
    return player ? player.name : cleanName(r.name);
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

    if (grid) {
        grid.innerHTML = counts.in.length
            ? counts.in.map((r, i) => {
                const player = findRosterPlayer(r.name);
                const shown = player ? { ...player } : { name: rsvpName(r), handicap: null };
                const meta = [player && realGhin(player.ghin) ? `GHIN ${realGhin(player.ghin)}` : null, r.sunday_round ? 'Sunday round' : null]
                    .filter(Boolean).join(' · ') || `RSVP’d ${timeAgo(r.created_at)}`;
                return playerCardHTML(shown, i, meta);
            }).join('')
            : `<div class="crew-empty" style="grid-column: 1 / -1;">No one’s in yet. Be the first to RSVP.</div>`;
    }

    if (elements.crewCount) {
        elements.crewCount.textContent = counts.in.length ? `${counts.in.length} golfer${counts.in.length === 1 ? '' : 's'}` : '';
    }
    if (elements.potentialRoster && elements.bubbleBlock) {
        elements.bubbleBlock.hidden = counts.maybe.length === 0;
        elements.potentialRoster.innerHTML = counts.maybe.map(r => `<span class="chip muted">${esc(rsvpName(r))}</span>`).join('');
    }
    if (elements.outRoster && elements.outBlock) {
        elements.outBlock.hidden = counts.out.length === 0;
        elements.outRoster.innerHTML = counts.out.map(r => `<span class="chip out">${esc(rsvpName(r))}</span>`).join('');
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
    const label = counts.in.length || counts.maybe.length
        ? `${counts.in.length} in · ${counts.maybe.length} probably`
        : 'Be the first to RSVP';
    li.innerHTML = `${icon('users')}<span>${esc(label)}</span><button type="button" class="hero-rsvp" data-action="rsvp">RSVP</button>`;
}

function refreshNameSuggestions() {
    const list = document.getElementById('rsvp-names');
    if (!list) return;
    const names = new Map();
    roster.confirmed.forEach(p => names.set(normName(p.name), cleanName(p.name)));
    roster.potential.forEach(n => names.set(normName(n), cleanName(n)));
    rsvpState.latest.forEach(r => { if (!names.has(normName(r.name))) names.set(normName(r.name), rsvpName(r)); });
    list.innerHTML = [...names.values()].sort().map(n => `<option value="${esc(n)}"></option>`).join('');
}

function readSavedRsvp() {
    try {
        return JSON.parse(localStorage.getItem(RSVP_STORAGE_KEY) || 'null');
    } catch (e) {
        return null;
    }
}

function saveRsvpLocally(rsvp) {
    try {
        localStorage.setItem(RSVP_STORAGE_KEY, JSON.stringify({ name: rsvp.name, status: rsvp.status, at: new Date().toISOString() }));
    } catch (e) { /* storage unavailable — not important */ }
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

function showRsvpStep(step) {
    const form = document.getElementById('rsvp-step-form');
    const done = document.getElementById('rsvp-step-done');
    if (form) form.hidden = step !== 'form';
    if (done) done.hidden = step !== 'done';
}

function syncSundayOption() {
    const form = elements.rsvpForm;
    if (!form) return;
    const status = (form.querySelector('input[name="status"]:checked') || {}).value;
    const wrap = document.getElementById('rsvp-sunday-wrap');
    if (wrap) wrap.hidden = status === 'out' || !RSVP.sundayQuestion;
}

function openRsvp(keepValues) {
    const form = elements.rsvpForm;
    if (!form) return;
    if (!keepValues) {
        form.reset();
        const saved = readSavedRsvp();
        if (saved && saved.name) {
            form.elements.namedItem('name').value = saved.name;
            const radio = form.querySelector(`input[name="status"][value="${saved.status}"]`);
            if (radio) radio.checked = true;
        }
    }
    setFieldError('rsvp-name-error', '', form.elements.namedItem('name'));
    setFieldError('rsvp-status-error', '');
    const err = document.getElementById('rsvp-error');
    if (err) err.hidden = true;
    const sundayLabel = document.getElementById('rsvp-sunday-label');
    if (sundayLabel && RSVP.sundayQuestion) sundayLabel.textContent = RSVP.sundayQuestion;
    const eyebrow = document.getElementById('rsvp-eyebrow');
    if (eyebrow) eyebrow.textContent = `${TRIP.year} · ${(TRIP.location || '').split(',')[0]} · ${TRIP.dates ? TRIP.dates.short : ''}`;
    syncSundayOption();
    refreshNameSuggestions();
    showRsvpStep('form');
    if (!elements.rsvpModal.classList.contains('active')) openDialog(elements.rsvpModal, '#rsvp-name');
    else setTimeout(() => form.elements.namedItem('name').focus(), 30);
}

function validateRsvp(form) {
    const nameInput = form.elements.namedItem('name');
    const name = cleanName(nameInput.value);
    const status = (form.querySelector('input[name="status"]:checked') || {}).value;
    let firstInvalid = null;

    if (!name) {
        setFieldError('rsvp-name-error', 'Your name is required to RSVP.', nameInput);
        firstInvalid = nameInput;
    } else if (!/^\S+(\s+\S+)+$/.test(name) || !/[a-z]/i.test(name) || name.length < 3) {
        setFieldError('rsvp-name-error', 'Please enter your first and last name.', nameInput);
        firstInvalid = nameInput;
    } else {
        setFieldError('rsvp-name-error', '', nameInput);
    }

    if (!RSVP_LABELS[status]) {
        setFieldError('rsvp-status-error', 'Pick one: in, probably, or can’t make it.');
        firstInvalid = firstInvalid || form.querySelector('input[name="status"]');
    } else {
        setFieldError('rsvp-status-error', '');
    }

    if (firstInvalid) {
        firstInvalid.focus();
        return null;
    }
    const sundayBox = form.elements.namedItem('sunday');
    let tidy = name.slice(0, 60);
    if (!/[A-Z]/.test(tidy)) tidy = tidy.replace(/(^|[\s'-])([a-z])/g, (m, pre, ch) => pre + ch.toUpperCase());
    return {
        name: tidy,
        status,
        sunday: status !== 'out' && !!(sundayBox && sundayBox.checked),
        note: cleanName(form.elements.namedItem('note').value).slice(0, 280)
    };
}

async function sendRsvpEmail(rsvp) {
    const res = await fetch(`https://formsubmit.co/ajax/${NOTIFY_EMAIL}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
            name: rsvp.name,
            rsvp: RSVP_LABELS[rsvp.status],
            sunday_round: rsvp.sunday ? 'Yes' : 'No',
            note: rsvp.note || '—',
            _subject: `BBB ${RSVP_YEAR} RSVP: ${rsvp.name} — ${RSVP_LABELS[rsvp.status]}`
        })
    });
    if (!res.ok) throw new Error(`Email notification failed (${res.status})`);
}

async function handleRsvpSubmit(e) {
    e.preventDefault();
    const form = elements.rsvpForm;
    const rsvp = validateRsvp(form);
    if (!rsvp) return;

    const button = document.getElementById('rsvp-submit');
    const errorEl = document.getElementById('rsvp-error');
    errorEl.hidden = true;

    // Bots fill the hidden field; real people never see it.
    if (form.elements.namedItem('company').value) {
        showRsvpDone(rsvp, false);
        return;
    }

    button.disabled = true;
    button.textContent = 'Sending…';
    let saved = false;
    let emailed = false;

    try {
        if (supabaseInstance && !rsvpState.missingTable) {
            const { error } = await supabaseInstance.from('rsvps').insert([{
                trip_year: RSVP_YEAR,
                name: rsvp.name,
                status: rsvp.status,
                sunday_round: rsvp.sunday,
                note: rsvp.note || null
            }]);
            if (!error) saved = true;
            else if (isMissingTable(error)) rsvpState.missingTable = true;
            else throw error;
        }

        // Email the commissioner; if the RSVP table isn't set up yet, email is the only record.
        if (RSVP.emailNotify !== false || !saved) {
            try {
                await sendRsvpEmail(rsvp);
                emailed = true;
            } catch (mailErr) {
                console.error(mailErr);
            }
        }

        if (!saved && !emailed) throw new Error('RSVP could not be saved or emailed');

        saveRsvpLocally(rsvp);
        if (saved) {
            await loadRsvps();
            renderRoster();
        }
        showRsvpDone(rsvp, saved);
    } catch (err) {
        console.error('RSVP failed:', err);
        errorEl.textContent = 'We couldn’t save your RSVP. Check your connection and try again.';
        errorEl.hidden = false;
    } finally {
        button.disabled = false;
        button.textContent = 'Send my RSVP';
    }
}

function showRsvpDone(rsvp, savedToHeadcount) {
    const first = rsvp.name.split(' ')[0];
    const copy = {
        in: [`You’re in, ${first}.`, 'See you in Scottsdale. Tee times and rooms get posted here as they’re booked.'],
        maybe: [`Noted, ${first}.`, 'We’ve got you down as a probably. Come back and lock it in when you can.'],
        out: [`We’ll miss you, ${first}.`, 'Sorry you can’t make it. If plans change, just RSVP again.']
    }[rsvp.status];
    const mark = document.getElementById('rsvp-done-mark');
    if (mark) {
        mark.className = `rsvp-done-mark ${rsvp.status}`;
        mark.innerHTML = icon(rsvp.status === 'in' ? 'check' : rsvp.status === 'maybe' ? 'clock' : 'x');
    }
    document.getElementById('rsvp-done-title').textContent = copy[0];
    document.getElementById('rsvp-done-text').textContent = savedToHeadcount || !rsvpState.missingTable
        ? copy[1]
        : `${copy[1]} (Your RSVP went straight to the commissioner’s inbox.)`;

    const countEl = document.getElementById('rsvp-done-count');
    if (countEl) {
        if (rsvpState.available) {
            const c = rsvpCounts();
            countEl.textContent = `Head count so far: ${c.in.length} in · ${c.maybe.length} probably · ${c.out.length} out`;
            countEl.hidden = false;
        } else {
            countEl.hidden = true;
        }
    }

    const rosterLink = document.getElementById('rsvp-roster-link');
    if (rosterLink) rosterLink.hidden = !(rsvp.status === 'in' && !findRosterPlayer(rsvp.name));

    showRsvpStep('done');
    const title = document.getElementById('rsvp-done-title');
    if (title) title.focus();
}

function prefillRegistrationFromRsvp() {
    const saved = readSavedRsvp();
    if (!saved || !saved.name) return;
    const parts = cleanName(saved.name).split(' ');
    const first = document.getElementById('first-name');
    const last = document.getElementById('last-name');
    if (first && !first.value) first.value = parts[0] || '';
    if (last && !last.value) last.value = parts.slice(1).join(' ');
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
// Scoreboard modal
// ---------------------------------------------------------------------------
async function renderDynamicScoreboard() {
    if (!elements.dynamicLeaderboard) return;

    // Until the new season is switched on, the database still holds last year's rounds.
    if (!supabaseInstance || !SEASON_LIVE) {
        renderFallbackLeaderboard();
        return;
    }

    try {
        const { data: roundScores, error: rsErr } = await supabaseInstance
            .from('player_round_scores')
            .select('*, players(id, name, team_id, handicap)')
            .order('round_number');

        const { data: ryderData } = await supabaseInstance
            .from('ryder_cup_scores')
            .select('*')
            .eq('id', 1)
            .single();

        if (rsErr) throw rsErr;

        if (!roundScores || roundScores.length === 0) {
            renderFallbackLeaderboard();
            return;
        }

        const blueScore = ryderData ? ryderData.blue_score : 0;
        const redScore = ryderData ? ryderData.red_score : 0;

        const roundMap = {};
        roundScores.forEach(s => {
            if (!roundMap[s.round_number]) roundMap[s.round_number] = [];
            roundMap[s.round_number].push(s);
        });

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

        const bluePlayers = Object.values(playerTotals).filter(p => p.team_id === 1).sort((a, b) => a.total_to_par - b.total_to_par);
        const redPlayers = Object.values(playerTotals).filter(p => p.team_id === 2).sort((a, b) => a.total_to_par - b.total_to_par);

        const fmtPar = (v) => {
            if (v === null || v === undefined) return '-';
            if (v === 0) return 'E';
            if (v > 0) return '+' + v;
            return '' + v;
        };

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

        let html = `
            <div style="border: 1px solid rgba(232, 184, 107, 0.45); background: radial-gradient(120% 120% at 50% 0%, rgba(232, 184, 107, 0.12), transparent 60%), var(--surface-2); border-radius: 22px; padding: 24px; margin-bottom: 28px;">
                <h3 style="text-align: center; font-size: 1.4rem; margin-bottom: 18px;">The ${esc(TRIP.year)} Ryder Cup</h3>
                <div style="display: flex; justify-content: space-around; align-items: center; margin-bottom: 22px;">
                    <div style="text-align: center;">
                        <div style="font: 800 0.85rem var(--sans); letter-spacing: 0.2em; color: var(--blue-team);">BLUE</div>
                        <div style="font: 500 3rem/1 var(--serif); margin-top: 6px;">${fmtPoints(blueScore)}</div>
                    </div>
                    <div style="font: italic 500 1.3rem var(--serif); color: var(--ink-dim);">vs</div>
                    <div style="text-align: center;">
                        <div style="font: 800 0.85rem var(--sans); letter-spacing: 0.2em; color: var(--red-team);">RED</div>
                        <div style="font: 500 3rem/1 var(--serif); margin-top: 6px;">${fmtPoints(redScore)}</div>
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px;">
                    ${teamList(bluePlayers, 'var(--blue-team)', 'rgba(110, 168, 255, 0.07)', 'rgba(110, 168, 255, 0.22)', 'Blue Team')}
                    ${teamList(redPlayers, 'var(--red-team)', 'rgba(255, 123, 114, 0.07)', 'rgba(255, 123, 114, 0.22)', 'Red Team')}
                </div>
            </div>`;

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
                                        tdsHoles += `<td style="padding: 10px 5px; border-bottom: 1px solid var(--line);">${score !== null && score !== undefined ? score : '-'}</td>`;
                                    }
                                    return `
                                    <tr style="background: ${idx % 2 === 0 ? 'rgba(244, 235, 223, 0.015)' : 'transparent'};">
                                        <td style="padding: 12px 15px; position: sticky; left: 0; background: var(--surface); z-index: 1; text-align: left; border-bottom: 1px solid var(--line); font-weight: 600; white-space: nowrap;">
                                            <span style="display: inline-block; width: 18px; text-align: center; color: var(--ink-dim); font-size: 0.8rem; margin-right: 8px;">${idx + 1}</span>${esc(s.players.name)}
                                        </td>
                                        ${tdsHoles}
                                        <td style="padding: 10px; border-bottom: 1px solid var(--line); border-left: 1px solid var(--line-strong); font-weight: 800;">${s.total_score !== null ? s.total_score : '-'}</td>
                                        <td style="padding: 10px; border-bottom: 1px solid var(--line); font-weight: 900; color: ${s.to_par !== null ? (s.to_par <= 0 ? 'var(--fairway)' : 'var(--red-team)') : 'inherit'};">${fmtPar(s.to_par)}</td>
                                    </tr>`;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>`;
        });

        elements.dynamicLeaderboard.innerHTML = html;
    } catch (err) {
        console.error('Leaderboard render failed:', err);
        renderFallbackLeaderboard();
    }
}

function renderFallbackLeaderboard() {
    const sortedRoster = [...roster.confirmed].sort((a, b) => {
        if (a.handicap === null) return 1;
        if (b.handicap === null) return -1;
        return a.handicap - b.handicap;
    });

    elements.dynamicLeaderboard.innerHTML = `
        <div style="border-bottom: 1px solid var(--line); padding-bottom: 15px; margin-bottom: 22px; display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap;">
            <div>
                <div style="font: 500 1.6rem var(--serif);">Pre-Tournament Rankings</div>
                <div style="color: var(--gold); font-size: 0.85rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; margin-top: 5px;">${SEASON_LIVE ? 'Confirmed Squad' : `Live scoring opens ${esc(TRIP.dates && TRIP.dates.start ? new Date(`${TRIP.dates.start}T12:00:00`).toLocaleString('en-US', { month: 'short', day: 'numeric' }) : '')}`}</div>
            </div>
            <div style="color: var(--ink-dim); font-size: 0.8rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em;">Ranked by handicap</div>
        </div>
        <div class="leaderboard-list">
            <div class="leaderboard-row header-row">
                <div class="col-rank">Rank</div>
                <div class="col-player">Player</div>
                <div class="col-hcp">Handicap</div>
                <div class="col-ghin">GHIN</div>
            </div>
            ${!sortedRoster.length ? `<div class="leaderboard-row"><div class="col-player">${roster.error ? 'Couldn’t load the crew right now.' : roster.loaded ? 'No one on the roster yet.' : 'Loading the crew…'}</div></div>` : ''}
            ${sortedRoster.map((player, index) => `
                <div class="leaderboard-row">
                    <div class="col-rank">${index + 1}</div>
                    <div class="col-player" style="color: var(--ink); font-weight: 700;">${esc(player.name)}</div>
                    <div class="col-hcp" style="color: var(--fairway); font-weight: 800; font-variant-numeric: tabular-nums; font-size: 1.1rem;">${player.handicap !== null && !isNaN(player.handicap) ? esc(Number(player.handicap).toFixed(1)) : '-'}</div>
                    <div class="col-ghin" style="font-variant-numeric: tabular-nums; color: var(--ink-dim);">${esc(realGhin(player.ghin) || '-')}</div>
                </div>`).join('')}
        </div>`;
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

function openDialog(el, focusSelector) {
    if (!el) return;
    if (!document.querySelector('.modal.active, .lightbox.active')) {
        const t = focusReturnTarget();
        if (t) lastFocused = t;
    }
    el.classList.add('active');
    document.body.style.overflow = 'hidden';
    setBackgroundInert(true);
    const target = el.querySelector(focusSelector || 'input, button, [href]');
    if (target) setTimeout(() => target.focus(), 30);
}

function closeDialog(el) {
    if (!el || !el.classList.contains('active')) return;
    el.classList.remove('active');
    if (!document.querySelector('.modal.active, .lightbox.active')) {
        document.body.style.overflow = '';
        setBackgroundInert(false);
        if (lastFocused && typeof lastFocused.focus === 'function' && lastFocused.isConnected) lastFocused.focus();
    }
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
    ['main', 'footer', '.skip-link'].forEach(sel => { const n = document.querySelector(sel); if (n) n.inert = open || dialogOpen; });
}

function setClubhouse(open) {
    if (!elements.clubhouseBtn || !elements.clubhouseMenu) return;
    elements.clubhouseBtn.setAttribute('aria-expanded', String(open));
    elements.clubhouseMenu.classList.toggle('is-open', open);
}

function runAction(action) {
    if (!document.querySelector('.modal.active, .lightbox.active')) {
        const t = focusReturnTarget();
        if (t) lastFocused = t;
    }
    setDrawer(false);
    setClubhouse(false);
    if (action === 'rsvp') openRsvp();
    if (action === 'signup') {
        closeDialog(elements.rsvpModal);
        prefillRegistrationFromRsvp();
        const firstName = document.getElementById('first-name');
        openDialog(elements.registrationModal, firstName && firstName.value ? '#ghin-number' : '#first-name');
    }
    if (action === 'scoreboard') {
        openDialog(elements.leaderboardModal, '#leaderboard-close');
        renderDynamicScoreboard();
    }
    if (action === 'start-round') openDialog(elements.roundLoginModal, '#round-email');
}

function setupEventListeners() {
    // Scoreboard hero image comes from config
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
        elements.drawer.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setDrawer(false)));
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
    const desktopNav = window.matchMedia('(min-width: 1301px)');
    const closeDrawerOnDesktop = (e) => { if (e.matches) setDrawer(false); };
    if (desktopNav.addEventListener) desktopNav.addEventListener('change', closeDrawerOnDesktop);
    else if (desktopNav.addListener) desktopNav.addListener(closeDrawerOnDesktop);

    // Close buttons
    const closeReg = () => { closeDialog(elements.registrationModal); if (elements.registrationForm) elements.registrationForm.reset(); };
    document.getElementById('modal-close')?.addEventListener('click', closeReg);
    document.getElementById('cancel-btn')?.addEventListener('click', closeReg);
    document.getElementById('leaderboard-close')?.addEventListener('click', () => closeDialog(elements.leaderboardModal));
    document.getElementById('round-login-close')?.addEventListener('click', () => closeDialog(elements.roundLoginModal));

    // Click on the backdrop closes a modal
    [elements.registrationModal, elements.leaderboardModal, elements.roundLoginModal, elements.rsvpModal].forEach(modal => {
        if (!modal) return;
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                if (modal === elements.registrationModal) closeReg();
                else closeDialog(modal);
            }
        });
    });

    if (elements.registrationForm) elements.registrationForm.addEventListener('submit', handleFormSubmit);

    // RSVP modal
    if (elements.rsvpForm) {
        elements.rsvpForm.addEventListener('submit', handleRsvpSubmit);
        elements.rsvpForm.addEventListener('change', (e) => {
            if (e.target.name === 'status') {
                setFieldError('rsvp-status-error', '');
                syncSundayOption();
            }
        });
        elements.rsvpForm.elements.namedItem('name').addEventListener('input', (e) => {
            if (e.target.getAttribute('aria-invalid')) setFieldError('rsvp-name-error', '', e.target);
        });
    }
    document.getElementById('rsvp-close')?.addEventListener('click', () => closeDialog(elements.rsvpModal));
    document.getElementById('rsvp-again')?.addEventListener('click', () => openRsvp(true));
    document.getElementById('rsvp-see-count')?.addEventListener('click', () => {
        closeDialog(elements.rsvpModal);
        document.getElementById('attendees')?.scrollIntoView({ behavior: REDUCED_MOTION ? 'auto' : 'smooth' });
    });
    document.getElementById('round-login-form')?.addEventListener('submit', (e) => { e.preventDefault(); handleRoundLogin(); });

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
            closeReg();
            closeDialog(elements.rsvpModal);
            closeDialog(elements.leaderboardModal);
            closeDialog(elements.roundLoginModal);
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

// ---------------------------------------------------------------------------
// Registration + round login (Supabase)
// ---------------------------------------------------------------------------
async function handleFormSubmit(e) {
    e.preventDefault();
    const formData = new FormData(elements.registrationForm);
    const firstName = (formData.get('firstName') || '').trim();
    const lastName = (formData.get('lastName') || '').trim();
    const email = (formData.get('email') || '').trim();
    const ghinNumber = (formData.get('ghinNumber') || '').trim();
    const handicap = formData.get('handicap');

    // NOTE: Registration access is enforced server-side via Supabase Row Level Security.
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

    const submitBtn = elements.registrationForm.querySelector('[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving…'; }
    const saved = await saveToSupabase(newPlayer);
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Add me to the roster'; }
    if (!saved) {
        alert('Sorry, that didn’t save. Check your connection and try again.');
        return;
    }

    sendEmailNotification(newPlayer);
    roster.confirmed.push(newPlayer);
    renderRoster();
    alert(`Thanks, ${newPlayer.name}! You’re on the roster.`);
    closeDialog(elements.registrationModal);
    elements.registrationForm.reset();
    const attendeeSection = document.getElementById('attendees');
    if (attendeeSection) attendeeSection.scrollIntoView({ behavior: REDUCED_MOTION ? 'auto' : 'smooth' });
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
        const { error } = await supabaseInstance.auth.signInWithPassword({ email, password });
        if (error) {
            errorEl.textContent = error.message;
            errorEl.style.display = 'block';
        } else {
            window.location.href = 'round_tracker.html';
        }
    } catch (err) {
        errorEl.textContent = 'An unexpected error occurred.';
        errorEl.style.display = 'block';
    }
}

async function saveToSupabase(player) {
    if (!supabaseInstance) return false;
    try {
        const { error } = await supabaseInstance.from('players').insert([{
            name: player.name,
            email: player.email,
            ghin: player.ghin,
            handicap: player.handicap,
            status: 'confirmed'
        }]);
        if (error) {
            console.error('Failed to save to Supabase:', error);
            return false;
        }
        return true;
    } catch (err) {
        console.error('Failed to save to Supabase:', err);
        return false;
    }
}

function sendEmailNotification(player) {
    fetch(`https://formsubmit.co/ajax/${NOTIFY_EMAIL}`, {
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
