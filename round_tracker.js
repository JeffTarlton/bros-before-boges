// Round Tracker: keep score on the course and follow every match live.
//
// How it works
// - One shared `rounds` row per Cup round per day. The first group to start Round 2 on Friday
//   creates it; every other phone joins it, so the leaderboard sees every card.
// - Each player has a `scores` row (h1..h18) in that round. A phone scores the players it picked.
// - Taps save on the phone first (localStorage) and go to the database through an outbox that
//   retries until it gets through, so a dead zone or a Safari reload never loses a score.
//   localStorage is the source of truth for the outbox: every change re-reads it first, so two
//   tabs on one phone can't erase each other's unsent scores.
// - Coming back (reload, another app, Back from the Bookie) reopens the same group on the same hole.
//   Links from other pages open Live scores (#board); the Score tab there goes back to the hole.
// - Formats come from trip-config.js `roundPlay`; the math lives in scoring.js.
const SUPABASE_URL = 'https://gxpwgrdyizruzfczzqwn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uo20KpEYmGXAIB9JGL1CnQ_wIxT8GX4';
// Pinned, the same file as the page's own script tag (a new 2.x release can't change things under us)
const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js';

const CFG = window.BBB || {};
const SC = window.BBBScoring;
const HOLES = SC.HOLES;
// Right after a deploy, a phone on a weak signal can pair this file with an older scoring.js from
// its offline copy (tracker-sw.js). Reload once to get matching files; until then the parts that
// need the newer math (the Cup scoreboard, the whole-trip table, a match's margin row) stay out.
const SC_FULL = ['cupTotals', 'holeMargins', 'playerRecords'].every(k => typeof SC[k] === 'function');
const RELOAD_KEY = 'bbb_tracker_reloaded';
// Now, and again whenever the signal or the app comes back (onVisible). It reloads only once the
// page's own scoring.js is in the offline copy (so the reload is sure to pair the files), at most
// once a minute, and never with the keypad or Go to hole sheet open. Until then it asks
// tracker-sw.js to fetch that file in the background, and the page carries on without the newer parts.
function reloadForNewFiles() {
    if (SC_FULL || navigator.onLine === false || !window.caches) return;
    const sheetOpen = () => { try { return !!S.keypad; } catch (e) { return false; } }; // the first call runs before S exists
    if (sheetOpen()) return;
    try { if (Date.now() - (Number(sessionStorage.getItem(RELOAD_KEY)) || 0) < 60000) return; } catch (e) { return; }
    const src = (document.querySelector('script[src*="scoring.js"]') || {}).src;
    if (!src) return;
    caches.match(src).then(hit => {
        if (!hit) {
            if (navigator.serviceWorker) {
                navigator.serviceWorker.ready.then(reg => { if (reg.active) reg.active.postMessage({ type: 'keep', urls: [src] }); }).catch(() => { /* next time */ });
            }
            return;
        }
        if (sheetOpen() || navigator.onLine === false) return;
        try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch (e) { return; }
        location.reload();
    }).catch(() => { /* no offline copy: carry on */ });
}
if (SC_FULL) { try { sessionStorage.removeItem(RELOAD_KEY); } catch (e) { /* ignore */ } } else reloadForNewFiles();
const SESSION_KEY = 'bbb_tracker_session';
const OUTBOX_KEY = 'bbb_tracker_outbox';
// This tab's setup choices (sessionStorage): Back from the rules page can reload the tracker.
// Kept for a while only, so a tab left open still opens on the round that's on now.
const SETUP_KEY = 'bbb_tracker_setup';
const SETUP_KEEP_MS = 30 * 60000;
const REFRESH_MS = 45000;
const BOARD_STALE_MS = 30000;
const NEXT_ARM_MS = 700; // how long a freshly shown next-hole button ignores taps
const NEXT_ARM_COVER_MS = 1500; // ...when it's pinned over a player's buttons (a short phone)
// Rounds before this date belong to earlier trips
const WINDOW_START = (CFG.bookie && CFG.bookie.seasonStart) || (CFG.trip && CFG.trip.dates && CFG.trip.dates.start) || '2000-01-01';
// Until the commissioner switches the season on, ryder_cup_scores still holds last year's total
const SEASON_LIVE = !!(CFG.season && CFG.season.live);
// The last official Cup total this phone loaded (this trip's only), so the row is there from the first paint
const CUP_KEY = 'bbb_tracker_cup';
const CUP_YEAR = (CFG.trip && CFG.trip.year) || null;
// The last live scores and roster names this phone loaded (this trip's only), so Live scores
// opens on them with no signal. tracker-sw.js keeps the page itself.
const BOARD_KEY = 'bbb_tracker_board';
const ROSTER_KEY = 'bbb_tracker_roster';
// Each round's first tee time from Admin (trip_tee_times, teetimes_2027.sql), shared with the
// homepage, which keeps the same copy under the same name: { r1: { time: '08:10', note }, ... }
const TEE_KEY = `bbb-tee-times-${CUP_YEAR}`;
const TEE_REFRESH_MS = 5 * 60000;
// The public link to Live scores (vercel.json sends /live to round_tracker#board)
const LIVE_URL = 'https://www.bros-before-boges.com/live';
// How the match scorecard was opened, so its back button goes back there (kept for this tab)
const MATCH_FROM_KEY = 'bbb_tracker_match_from';
// Where supabase-js keeps the login on this phone (its default storage key)
const AUTH_KEY = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`;

let sb = null;
const S = {
    authUser: null,      // the signed-in login, or null
    me: null,            // their roster row
    players: [],         // everyone on the roster (names for the board)
    courses: [],         // courses table
    loadError: null,     // roster or courses didn't load
    view: null,
    sess: null,          // the scoring session on this phone (saved in localStorage)
    outbox: {},          // unsent hole scores (saved in localStorage)
    outboxOrder: 0,
    acks: 0,             // scores the database has confirmed (a refresh read before one lands is thrown away)
    sync: 'ok',          // ok | saving | offline | auth | error
    syncMessage: '',
    setup: null,         // setup screen choices
    board: { round: null, data: {}, loading: {}, error: {}, at: {}, tried: {}, mAt: {}, mErr: {} }, // mAt/mErr: the matchups' own load
    cup: cachedCup(),    // the official Cup total { blue, red } (season live only): the last one saved, then the database's
    teeTimes: {},        // each round's first tee time (Admin > Tee times), keyed like the itinerary: r1, r2...
    teeAt: 0,            // when they last loaded
    album: null,         // { key, url }: the crew's photo album link, for this login. Memory only (it's crew-only).
    matchFrom: null,     // 'score' or 'card' when a match scorecard was opened from scoring
    keypad: null,
    nextShown: { key: null, at: 0 }, // which hole's next button is showing, and since when
    legendOn: false,     // the gold-dot legend is showing (a send failed or is slow, and scores are still waiting)
    ready: false,        // login and roster checked
    droppedStale: null,  // a group left open from an earlier day
    warnedOtherPhone: false
};

// ==========================================
// Small helpers
// ==========================================
function escHtml(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Match an email literally in an ilike filter: % and _ are wildcards, so escape them.
function escapeLike(value) {
    return String(value || '').replace(/[\\%_*]/g, '\\$&');
}

const localDay = (d = new Date()) => d.toLocaleDateString('en-CA'); // YYYY-MM-DD on this phone
const $ = id => document.getElementById(id);
const firstName = name => String(name || '').split(' ')[0];
// "David O." for tight spaces
const shortName = name => {
    const parts = String(name || '').trim().split(/\s+/);
    return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0] || '';
};
const fmtDay = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '');

function readStore(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
        return fallback;
    }
}
function writeStore(key, value) {
    try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* private mode: still works for this visit */ }
}

// What was picked on the setup screen, kept in this tab until it becomes a group, so a look at the
// rules and Back doesn't reset the round and players even when the page reloads
function saveSetupDraft() {
    const st = S.setup;
    if (!st) return;
    try {
        sessionStorage.setItem(SETUP_KEY, JSON.stringify({ at: Date.now(), day: localDay(), round: st.round, courseId: st.courseId, playerIds: st.playerIds, touched: st.touched }));
    } catch (e) { /* private mode: they last for this visit */ }
}
function clearSetupDraft() {
    try { sessionStorage.removeItem(SETUP_KEY); } catch (e) { /* ignore */ }
}
function readSetupDraft() {
    try {
        const d = JSON.parse(sessionStorage.getItem(SETUP_KEY) || 'null');
        const fresh = d && d.day === localDay() && Date.now() - d.at < SETUP_KEEP_MS;
        return fresh && Number.isFinite(d.round) && Array.isArray(d.playerIds) ? d : null;
    } catch (e) {
        return null;
    }
}

function showToast(message, type = 'success') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        container.setAttribute('role', 'status');
        container.setAttribute('aria-live', 'polite');
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = '<span></span>';
    toast.querySelector('span').textContent = message;
    container.appendChild(toast);
    const dismiss = () => {
        if (!toast.isConnected || toast.classList.contains('fade-out')) return;
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    };
    toast.addEventListener('click', dismiss);
    setTimeout(dismiss, type === 'error' ? 6000 : 3500);
}

function isNetworkError(err) {
    return (typeof navigator !== 'undefined' && navigator.onLine === false) ||
        /Failed to fetch|Load failed|NetworkError|network connection|fetch failed|timed out/i.test((err && err.message) || String(err || ''));
}
function isAuthError(err) {
    const text = `${(err && err.code) || ''} ${(err && err.message) || ''}`;
    return /PGRST301|JWT|not authenticated|Auth session missing|401/i.test(text);
}
function isRefused(err) {
    return !!err && (err.code === '42501' || /row-level security|permission denied/i.test(err.message || ''));
}

function playerById(id) {
    return S.players.find(p => p.id === id) || (S.sess && S.sess.names && S.sess.names[id]) || null;
}
function nameOf(id) {
    const p = playerById(id);
    return p ? p.name : 'Player';
}
function teamOf(id) {
    const p = playerById(id);
    return p ? p.team_id : null;
}
const TEAM_NAMES = { 1: 'Blue', 2: 'Red' };

// The lowest id among same-day rounds: every phone settles on the same one
const pickRound = list => list.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];

// Matches with anyone in `ids` first
function mineFirst(matches, ids) {
    const has = m => (m.sides.some(s => s.ids.some(id => ids.has(id))) ? 0 : 1);
    return matches.slice().sort((a, b) => has(a) - has(b));
}

// Replace a container's contents, keeping keyboard focus on the same control. A match card or a
// player's link carries data-key (it follows the match or player even when a refresh re-sorts the
// table); other links are found again by their href.
function swapKeepingFocus(box, html) {
    const a = document.activeElement;
    const inBox = a && box.contains(a);
    const esc = s => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));
    let sel = null;
    if (inBox && a.dataset && a.dataset.key) sel = `[data-key="${esc(a.dataset.key)}"]`;
    else if (inBox && a.dataset && a.dataset.action) sel = `[data-action="${a.dataset.action}"]${a.dataset.round ? `[data-round="${a.dataset.round}"]` : ''}${a.dataset.scope ? `[data-scope="${a.dataset.scope}"]` : ''}`;
    else if (inBox && a.classList.contains('fmt-link')) sel = '.fmt-link';
    else if (inBox && a.tagName === 'A' && a.getAttribute('href')) sel = `a[href="${esc(a.getAttribute('href'))}"]`;
    box.innerHTML = html;
    const t = sel && box.querySelector(sel);
    if (t) t.focus({ preventScroll: true });
}

// Center the pressed button of a sideways-scrolling strip without moving the page
function centerInStrip(strip, selector) {
    const cur = strip && strip.querySelector(selector);
    if (!cur) return;
    strip.scrollLeft += cur.getBoundingClientRect().left - strip.getBoundingClientRect().left - (strip.clientWidth - cur.offsetWidth) / 2;
}

// Rounds from trip-config: [{ number, date, day }]
function tripRounds() {
    const list = [];
    (CFG.itinerary || []).forEach(day => (day.slots || []).forEach(slot => {
        const m = /^R(\d+)$/.exec(slot.when || '');
        if (m) list.push({ number: Number(m[1]), date: day.date, what: slot.what, meta: slot.meta, tee: slot.tee || null });
    }));
    const numbers = new Set(list.map(r => r.number));
    Object.keys(CFG.roundCourses || {}).concat(Object.keys(CFG.roundPlay || {})).forEach(n => {
        if (!numbers.has(Number(n))) { numbers.add(Number(n)); list.push({ number: Number(n), date: null }); }
    });
    if (!list.length) [1, 2, 3].forEach(n => list.push({ number: n, date: null }));
    const dayName = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' }) : '');
    return list.sort((a, b) => a.number - b.number).map(r => {
        const sameDay = list.filter(x => x.date && x.date === r.date).sort((a, b) => a.number - b.number);
        const part = sameDay.length > 1 ? (sameDay[0].number === r.number ? ' AM' : ' PM') : '';
        return Object.assign(r, { day: dayName(r.date) + part });
    });
}
const scheduleOf = n => tripRounds().find(r => r.number === n) || null;

// Today's round by the trip schedule (Friday has two: morning before 12:30, then afternoon)
function scheduledRoundToday() {
    const today = localDay();
    const todays = tripRounds().filter(r => r.date === today);
    if (!todays.length) return null;
    if (todays.length === 1) return todays[0].number;
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes() < 12 * 60 + 30 ? todays[0].number : todays[todays.length - 1].number;
}

// Today's practice round (trip-config: a slot with practice: true on a day with no Cup round, e.g.
// Thursday at Talking Stick). The tracker doesn't keep it; setup and the board say so.
// { slot, next }: next is the first Cup round after today (null if none is left).
function practiceToday() {
    const today = localDay();
    const rounds = tripRounds();
    if (rounds.some(r => r.date === today)) return null;
    const day = (CFG.itinerary || []).find(d => d && d.date === today);
    const slot = day && (day.slots || []).find(s => s && s.practice);
    return slot ? { slot, next: rounds.find(r => r.date && r.date > today) || null } : null;
}

// The trip-config course for a round (holePars, name)
function configCourse(roundNumber) {
    const id = CFG.roundCourses && CFG.roundCourses[roundNumber];
    if (!id) return null;
    let found = null;
    (CFG.courses || []).forEach(c => (c.options || [c]).forEach(o => { if (o.id === id) found = o; }));
    return found;
}

// The database course that matches the trip-config course for a round (by name)
function dbCourseForRound(roundNumber) {
    const cc = configCourse(roundNumber);
    if (!cc) return null;
    const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
    const key = norm(String(cc.name || '').replace(/course/i, ''));
    return key ? S.courses.find(c => norm(c.name).includes(key)) || null : null;
}

// Pars for a round: the database course, else trip-config, else all 4s
function parsFor(course, roundNumber) {
    if (course) {
        const pars = Array.from({ length: HOLES }, (_, i) => Number(course[`h${i + 1}_par`]) || null);
        if (pars.every(Boolean)) return pars;
    }
    const cc = configCourse(roundNumber);
    if (cc && Array.isArray(cc.holePars) && cc.holePars.length === HOLES) return cc.holePars.slice();
    return Array(HOLES).fill(4);
}

// The tees we play, hole by hole (trip-config teeYards / holeHandicaps), for a round played at its
// trip-config course: { teeName, yards: [18] | null, hcps: [18] | null }, or null (another course,
// or no data). Worked out while the courses are loaded and kept with the group and the board, so
// it's there with no signal too.
function holeInfoFor(roundNumber, courseId) {
    const cc = configCourse(roundNumber);
    if (!cc) return null;
    const db = dbCourseForRound(roundNumber);
    if (courseId && db && db.id !== courseId) return null; // being played somewhere else
    const ok = a => Array.isArray(a) && a.length === HOLES && a.every(n => Number.isFinite(n) && n > 0);
    const yards = ok(cc.teeYards) ? cc.teeYards.slice() : null;
    const hcps = ok(cc.holeHandicaps) ? cc.holeHandicaps.slice() : null;
    return yards || hcps ? { teeName: cc.teeName || '', yards, hcps } : null;
}

function formatOf(roundNumber) {
    return SC.formatFor(roundNumber, CFG);
}

// A matchup's group and tee time (groups_2027.sql). An older scoring.js on the phone doesn't carry
// them: then there's simply no group.
const groupOf = m => (m && Number.isInteger(m.group) && m.group > 0 ? m.group : null);
const teeTimeOf = m => (m && typeof m.teeTime === 'string' && /^\d\d:\d\d$/.test(m.teeTime) ? m.teeTime : null);

// '08:10' -> '8:10 AM'. Tee times are Arizona clock times as typed in Admin, so they're never turned
// into a Date (a phone set to another time zone would shift them). The homepage has the same helper.
function teeClock(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
    if (!m) return '';
    const h = Number(m[1]);
    return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

// The tees and total length we play for a round: "Composite tees, 6,436 yds" (or '' for a round
// being played somewhere else, or with no tee data)
function teesText(info) {
    if (!info || !info.teeName) return '';
    const yards = Array.isArray(info.yards) ? info.yards.reduce((s, y) => s + (Number(y) || 0), 0) : 0;
    return yards ? `${info.teeName}, ${yards.toLocaleString('en-US')} yds` : info.teeName;
}

// A match's scorecard, from Live scores or the Score view: #match=2-<matchup id>
const matchHref = (round, id) => `#match=${round}-${encodeURIComponent(id)}`;
function parseMatchHash(hash) {
    const m = /^#?match=(\d+)-(.+)$/.exec(hash || '');
    if (!m) return null;
    let id = m[2];
    try { id = decodeURIComponent(id); } catch (e) { /* keep it as it is */ }
    return { round: Number(m[1]), id };
}
const teamLetter = team => (TEAM_NAMES[team] || '?').charAt(0);

// The rules page's name and section for each format (rules.html#grind opens that section), so the
// tracker and the rules call a round the same thing. A format the rules don't describe keeps the
// tracker's label and points at the house rules. Every match is gross: no handicap strokes.
// Admin's Score Entry line uses the same names (renderScoreEntryContext in admin.js): keep them in step.
const FORMAT_RULES = {
    points: { name: 'The Grind', section: 'grind' },
    split: { name: 'The Split Decision', section: 'split' },
    singles: { name: 'Championship Singles', section: 'singles' }
};

// { name: 'The Grind', about: ['team points'], href, link } for a round's format line
function formatInfo(format) {
    const rules = FORMAT_RULES[format.key];
    if (!rules) return { name: format.label, about: [], href: 'rules.html#house-rules', link: 'House rules' };
    const lower = s => s.charAt(0).toLowerCase() + s.slice(1);
    return { name: rules.name, about: format.label.split(' · ').map(lower), href: `rules.html#${rules.section}`, link: 'How it’s scored' };
}

// "team points · no handicap strokes · How it's scored ›" (HTML). The dot stays with the part before
// it, "front 9" and "no handicap" stay together (a line starting "handicap strokes" reads backwards),
// and the rules link (same tab) comes last, whole.
function formatLineHTML(parts, info, capFirst) {
    const all = parts.concat('no\u00a0handicap strokes');
    if (capFirst) all[0] = all[0].charAt(0).toUpperCase() + all[0].slice(1);
    return all.map(p => escHtml(p).replace(/ (\d+)\b/g, '&nbsp;$1'))
        .concat(`<a class="fmt-link" href="${escHtml(info.href)}">${escHtml(info.link)}<span aria-hidden="true">&nbsp;›</span></a>`)
        .join('&nbsp;· ');
}

// ==========================================
// Session (this phone's group) and outbox (unsent scores)
// ==========================================
function saveSession() {
    writeStore(SESSION_KEY, S.sess);
}

// localStorage is the source of truth for the outbox: read it before every change
function reloadOutbox() {
    const box = readStore(OUTBOX_KEY, null);
    S.outbox = box && box.items ? box.items : {};
    S.outboxOrder = Math.max(S.outboxOrder, (box && box.order) || 0);
}
function saveOutbox() {
    writeStore(OUTBOX_KEY, { order: S.outboxOrder, items: S.outbox });
}

// A group left open from an earlier day: its scores are saved, so today starts fresh
function dropStaleSession() {
    if (!S.sess || !S.sess.date || S.sess.date >= localDay()) return false;
    S.droppedStale = { round: S.sess.roundNumber, date: S.sess.date };
    S.sess = null;
    S.setup = null;
    clearSetupDraft();
    S.board.round = null;
    saveSession();
    return true;
}

function loadStored() {
    S.sess = readStore(SESSION_KEY, null);
    if (S.sess && (!S.sess.roundId || !Array.isArray(S.sess.playerIds))) S.sess = null;
    reloadOutbox();
    // The old tracker kept only a round id and player ids
    if (!S.sess) {
        let oldRound = null;
        try { oldRound = localStorage.getItem('bbb_active_round_id'); } catch (e) { /* ignore */ }
        const oldPlayers = readStore('bbb_tracked_players', null);
        if (oldRound && Array.isArray(oldPlayers) && oldPlayers.length) {
            S.sess = { v: 2, roundId: String(oldRound).replace(/"/g, ''), playerIds: oldPlayers, hole: 1, holes: {}, names: {}, needsLoad: true, legacy: true };
        }
    }
    try {
        localStorage.removeItem('bbb_active_round_id');
        localStorage.removeItem('bbb_tracked_players');
    } catch (e) { /* ignore */ }
    dropStaleSession();
    // Shown until the database answers (and kept on screen, marked as old, if it can't)
    const board = readStore(BOARD_KEY, null);
    if (board && board.since === WINDOW_START && board.data && board.at) {
        S.board.data = board.data;
        S.board.at = board.at;
    }
    const roster = readStore(ROSTER_KEY, null);
    if (roster && roster.since === WINDOW_START && Array.isArray(roster.players)) S.players = roster.players;
    S.teeTimes = cleanTeeTimes(readStore(TEE_KEY, null));
}

// Only well-formed entries: { r1: { time: '08:10', note } }
function cleanTeeTimes(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    Object.keys(raw).forEach(k => {
        const v = raw[k];
        if (v && typeof v === 'object' && teeClock(v.time)) out[k] = { time: String(v.time).slice(0, 5), note: typeof v.note === 'string' ? v.note : null };
    });
    return out;
}

// The login saved on this phone. With no signal an expired login can't be refreshed, so
// supabase-js reports no session, but it's still there and refreshes once the signal is back.
function savedLoginUser() {
    const saved = readStore(AUTH_KEY, null);
    return saved && saved.refresh_token && saved.user && saved.user.id ? saved.user : null;
}

// Another tab on this phone may have changed things while this one was in the background
function reloadFromStore() {
    reloadOutbox();
    const stored = readStore(SESSION_KEY, null);
    if (!stored) {
        if (S.sess) { S.sess = null; return true; }
        return false;
    }
    if (!S.sess || stored.roundId !== S.sess.roundId || JSON.stringify(stored) !== JSON.stringify(S.sess)) {
        S.sess = stored;
        return true;
    }
    return false;
}

const outboxKey = (roundId, pid, hole) => `${roundId}|${pid}|${hole}`;

function pendingFor(roundId, pid, hole) {
    return !!S.outbox[outboxKey(roundId, pid, hole)];
}
function pendingCount() {
    return Object.keys(S.outbox).length;
}
// Unsent scores in the round this phone is scoring (what the gold dots mark)
function roundPending() {
    return !!S.sess && Object.values(S.outbox).some(o => o.roundId === S.sess.roundId);
}
// The gold-dot legend shows once a score couldn't go straight up (no signal, logged out, refused,
// or a send that's still hanging after a few seconds on one bar) and stays until this round's
// scores are all sent, so a normal quick save never flashes it
const LEGEND_AFTER_MS = 4000;
let legendTimer = null;
function legendShown() {
    clearTimeout(legendTimer);
    if (!roundPending()) { S.legendOn = false; return false; }
    if (S.legendOn) return true;
    // Before start-up has checked the login and the database, "no client yet" means nothing
    if (['offline', 'auth', 'error'].includes(S.sync) || (S.ready && (!sb || !S.authUser))) {
        S.legendOn = true;
        return true;
    }
    const oldest = Math.min(...Object.values(S.outbox).filter(o => o.roundId === S.sess.roundId).map(o => o.at || 0));
    const wait = LEGEND_AFTER_MS - (Date.now() - oldest);
    if (wait <= 0) { S.legendOn = true; return true; }
    // A hung request triggers no redraw: look again when the oldest score has waited long enough
    legendTimer = setTimeout(applyLegend, wait + 50);
    return false;
}
// The gold dot in the sync chip comes and goes with the legend state
function applyLegend() {
    const was = S.legendOn;
    const on = legendShown();
    if (on !== was) document.querySelectorAll('[data-sync]').forEach(el => { el.innerHTML = syncChipHTML(); });
}

// The groups this phone enters: a two-man side sharing a ball is one row; everyone else is one row each
function unitsOf(sess) {
    const format = formatOf(sess.roundNumber);
    const chosen = new Set(sess.playerIds);
    const used = new Set();
    const units = [];
    SC.matchesFrom(sess.matchups).forEach(m => m.sides.forEach(side => {
        const ids = side.ids.filter(id => chosen.has(id));
        if (!ids.length) return;
        if (format.sharedBall && ids.length === side.ids.length && ids.length > 1) {
            units.push({ ids, team: side.team, match: m.number });
        } else {
            ids.forEach(id => units.push({ ids: [id], team: side.team, match: m.number }));
        }
        ids.forEach(id => used.add(id));
    }));
    sess.playerIds.filter(id => !used.has(id)).forEach(id => units.push({ ids: [id], team: teamOf(id), match: null }));
    return units;
}

function unitName(unit, short) {
    if (unit.ids.length > 1) return unit.ids.map(id => firstName(nameOf(id))).join(' & ');
    return short ? shortName(nameOf(unit.ids[0])) : nameOf(unit.ids[0]);
}

function holesFor(pid) {
    const sess = S.sess;
    sess.holes = sess.holes || {};
    if (!sess.holes[pid]) sess.holes[pid] = Array(HOLES).fill(null);
    return sess.holes[pid];
}

function unitValue(unit, hole) {
    const vals = unit.ids.map(id => holesFor(id)[hole - 1]);
    const v = vals.find(x => x !== null);
    return v === undefined ? null : v;
}

function unitHoles(unit) {
    return Array.from({ length: HOLES }, (_, i) => unitValue(unit, i + 1));
}

function unitPending(unit, hole) {
    return unit.ids.some(id => pendingFor(S.sess.roundId, id, hole));
}

function unitPoints(holes, pars) {
    return holes.reduce((s, v, i) => s + SC.quotaPoints(v, pars[i]), 0);
}
const ptsText = n => `${n} pt${n === 1 ? '' : 's'}`;
// The score's name for screen readers (on screen it's the circle or square around the digit)
const KIND_WORDS = { ace: 'hole in one', albatross: 'albatross', eagle: 'eagle', birdie: 'birdie', par: 'par', bogey: 'bogey', double: 'double bogey', worse: 'triple bogey or worse' };
const kindText = kind => (KIND_WORDS[kind] ? ` (${KIND_WORDS[kind]})` : '');
// The digit the circle or square is drawn around (a 10+ gets a smaller digit to clear the inner ring)
const digitHTML = v => `<span class="digit${v >= 10 ? ' two' : ''}">${v}</span>`;

// Matches that involve anyone this phone scores
function trackedMatches(sess) {
    const chosen = new Set(sess.playerIds);
    return SC.matchesFrom(sess.matchups).filter(m => m.sides.some(s => s.ids.some(id => chosen.has(id))));
}

function holesByIdFromSession() {
    const out = {};
    S.sess.playerIds.forEach(id => { out[id] = holesFor(id).slice(); });
    return out;
}

// First hole where someone in the group has no score yet (18 when the card is full)
function firstOpenHole(sess) {
    const units = unitsOf(sess);
    for (let h = 1; h <= HOLES; h++) {
        if (units.some(u => unitValue(u, h) === null)) return h;
    }
    return HOLES;
}

// ==========================================
// Writing scores
// ==========================================
function setScore(unit, hole, value) {
    const sess = S.sess;
    const v = value === null ? null : Math.max(1, Math.min(20, Math.round(value)));
    reloadOutbox();
    unit.ids.forEach(pid => {
        holesFor(pid)[hole - 1] = v;
        const key = outboxKey(sess.roundId, pid, hole);
        const prev = S.outbox[key];
        S.outbox[key] = { roundId: sess.roundId, pid, hole, value: v, seq: (prev ? prev.seq : 0) + 1, order: prev ? prev.order : ++S.outboxOrder, at: Date.now() };
    });
    saveSession();
    saveOutbox();
    scheduleFlush(350);
}

let flushTimer = null;
let flushing = false;
let retryDelay = 0;

function scheduleFlush(ms) {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, ms);
}

async function ensureScoreRow(roundId, pid) {
    const { data, error } = await sb.from('scores').select('id').eq('round_id', roundId).eq('player_id', pid).limit(1);
    if (error) throw error;
    if (data && data.length) return;
    const { error: insertError } = await sb.from('scores').insert([{ round_id: roundId, player_id: pid, total_score: 0, total_to_par: 0 }]);
    if (insertError && insertError.code !== '23505') throw insertError;
}

// Take an entry off the outbox, unless it changed again while it was being sent
function settleEntry(key, sentSeq) {
    reloadOutbox();
    const now = S.outbox[key];
    if (now && now.seq === sentSeq) delete S.outbox[key];
    saveOutbox();
}

// Send unsent scores one at a time, oldest first. Only the hole goes up: totals are worked out
// from the holes (by the database once tracker_2027.sql is in, and by every page that shows them).
async function flush() {
    clearTimeout(flushTimer);
    if (flushing || !sb) return;
    reloadOutbox();
    if (!pendingCount()) { setSync('ok'); renderSyncOnly(); return; }
    if (!S.authUser) { setSync('auth'); renderSyncOnly(); return; }
    // The phone knows it has no network: don't sit on "Saving" (the 'online' event sends them)
    if (navigator.onLine === false) { setSync('offline'); renderSyncOnly(); return; }
    flushing = true;
    const hadError = S.sync === 'error';
    setSync('saving');
    renderSyncOnly();
    try {
        for (;;) {
            reloadOutbox();
            const entries = Object.entries(S.outbox).sort((a, b) => a[1].order - b[1].order);
            if (!entries.length) break;
            const [key, entry] = entries[0];
            const { data, error } = await sb.from('scores').update({ [`h${entry.hole}`]: entry.value })
                .eq('round_id', entry.roundId).eq('player_id', entry.pid).select('id');
            if (error) {
                // The round was deleted (23503) or the value refused (23514): this one can never save,
                // so it mustn't hold up the rest
                if (error.code === '23503' || error.code === '23514') {
                    settleEntry(key, entry.seq);
                    showToast(`Hole ${entry.hole} for ${firstName(nameOf(entry.pid))} couldn’t be saved and was skipped.`, 'error');
                    continue;
                }
                throw error;
            }
            if (!data || !data.length) {
                // No row for this player yet (or the database refused quietly): make one, then retry
                if (!entry.madeRow) {
                    try {
                        await ensureScoreRow(entry.roundId, entry.pid);
                    } catch (e) {
                        if (e.code !== '23503') throw e;
                        // The round (or the player) is gone: that player's scores there can never save
                        reloadOutbox();
                        Object.keys(S.outbox).forEach(k => {
                            const o = S.outbox[k];
                            if (o.roundId === entry.roundId && o.pid === entry.pid) delete S.outbox[k];
                        });
                        saveOutbox();
                        showToast(`Scores for ${firstName(nameOf(entry.pid))} in a round that was deleted couldn’t be saved and were skipped.`, 'error');
                        continue;
                    }
                    reloadOutbox();
                    if (S.outbox[key]) S.outbox[key].madeRow = true;
                    saveOutbox();
                    continue;
                }
                throw Object.assign(new Error('Your login isn’t allowed to keep score yet. Ask the commissioner to link your account.'), { code: 'NOT_SAVED' });
            }
            settleEntry(key, entry.seq);
            S.acks++;
            retryDelay = 0;
            renderSyncOnly();
        }
        setSync('ok');
    } catch (err) {
        console.warn('Score sync failed:', err);
        const wasError = hadError;
        if (isNetworkError(err)) setSync('offline');
        else if (isAuthError(err)) setSync('auth');
        else {
            const message = err.code === 'NOT_SAVED' || isRefused(err)
                ? 'Your login isn’t allowed to keep score yet. Ask the commissioner to link your account.'
                : ((err && err.message) || String(err));
            setSync('error', message);
            if (!wasError) showToast(`Scores aren’t saving: ${message}`, 'error');
        }
        retryDelay = Math.min(retryDelay ? retryDelay * 2 : 3000, 30000);
        scheduleFlush(retryDelay);
    } finally {
        flushing = false;
        renderSyncOnly();
    }
}

function setSync(state, message) {
    S.sync = state;
    S.syncMessage = message || '';
}

function syncText() {
    const n = pendingCount();
    if (!n) return 'All saved';
    const scores = `${n} score${n === 1 ? '' : 's'}`;
    if (!sb) return `${scores} waiting for signal`;
    if (S.sync === 'auth' || !S.authUser) return `Log in to send ${scores}`;
    if (S.sync === 'offline') return `${scores} waiting for signal`;
    if (S.sync === 'error') return `${scores} not saved: ${S.syncMessage}`;
    return `Saving ${scores}…`;
}

function syncChipHTML() {
    const n = pendingCount();
    if (!n) return '<span class="sync">✓ All saved</span>';
    // Once this round's scores are slow to send, the chip (always on screen, top right) carries the
    // same gold dot as the scores still waiting: the key to what the dots mean
    const key = S.legendOn && roundPending();
    const dot = key ? '<span class="legend-dot" aria-hidden="true"></span>' : '';
    const tip = key ? ' title="Gold dot = not sent yet. It keeps trying."' : '';
    const text = `${dot}${escHtml(syncText())}`;
    if (!sb) return `<span class="sync pending"${tip}>${text}</span>`;
    if (S.sync === 'auth' || !S.authUser) {
        return `<a class="sync problem" href="bookie.html?next=round&amp;mode=login"${tip}>${text}</a>`;
    }
    if (S.sync === 'error') return `<span class="sync problem wrap"${tip}>${text}</span>`;
    return `<span class="sync pending"${tip}>${text}</span>`;
}

let lastAnnounced = '';
function renderSyncOnly() {
    document.querySelectorAll('[data-sync]').forEach(el => { el.innerHTML = syncChipHTML(); });
    // One live region, updated only when the words change, so screen readers hear it once
    const live = $('sync-live');
    const text = syncText();
    if (live && text !== lastAnnounced) { live.textContent = text; lastAnnounced = text; }
    if (!pendingCount()) document.querySelectorAll('[data-waiting]').forEach(n => n.remove());
    // The gold-dot legend shows only while there are gold dots to explain
    applyLegend();
    if (!S.sess) return;
    // Unsent marks on the score buttons and card cells
    document.querySelectorAll('[data-pend-ids]').forEach(el => {
        const hole = Number(el.dataset.pendHole);
        const pend = el.dataset.pendIds.split(',').some(id => pendingFor(S.sess.roundId, id, hole));
        el.classList.toggle('pend', pend);
        if (el.hasAttribute('title')) el.title = pend ? 'Not sent yet' : '';
    });
}

// ==========================================
// Loading data
// ==========================================
async function loadBase() {
    S.loadError = null;
    const [players, courses] = await Promise.all([
        sb.from('players').select('id, name, team_id, status, user_id').order('team_id', { ascending: true }).order('name'),
        sb.from('courses').select('*')
    ]);
    if (players.error) S.loadError = players.error;
    else {
        S.players = players.data || [];
        // Names and teams only: what the board needs to label a card
        writeStore(ROSTER_KEY, { since: WINDOW_START, players: S.players.map(p => ({ id: p.id, name: p.name, team_id: p.team_id, status: p.status })) });
    }
    if (courses.error) S.loadError = S.loadError || courses.error;
    else S.courses = courses.data || [];
}

// The function isn't there yet (PGRST202): the SQL that adds it hasn't run. Not a missing table.
const isMissingFunction = err => /PGRST202|could not find the function/i.test(`${err && err.code} ${err && err.message}`);

// The roster row for this login. A login whose email is on an unclaimed roster name gets linked
// to it here (the database does the matching: claim_roster_by_email, privacy_2027.sql).
async function findMe(user) {
    if (!user) return null;
    const { data: byLogin, error: loginError } = await sb.from('players')
        .select('id, name, team_id, status, user_id').eq('user_id', user.id).limit(1);
    if (loginError) throw loginError;
    if (byLogin && byLogin.length) return byLogin[0];
    if (!user.email) return null;
    const { data, error } = await sb.rpc('claim_roster_by_email');
    if (error) {
        if (isMissingFunction(error)) return legacyFindByEmail(user);
        throw error; // as before: "Couldn't load ... Try again"
    }
    return data ? { id: data.id, name: data.name, team_id: data.team_id, status: data.status, user_id: data.user_id } : null;
}
// Until privacy_2027.sql has run: the email lookup and link the database now does
async function legacyFindByEmail(user) {
    const { data: byEmail, error: emailError } = await sb.from('players').select('*').ilike('email', escapeLike(user.email)).limit(1);
    if (emailError) throw emailError;
    const row = byEmail && byEmail.length ? byEmail[0] : null;
    if (row && !row.user_id) {
        const { data: claimed, error: claimError } = await sb.from('players').update({ user_id: user.id }).eq('id', row.id).is('user_id', null).select('id');
        if (claimError) throw claimError;
        if (claimed && claimed.length) row.user_id = user.id;
    }
    return row;
}

async function loadMatchups(roundNumber) {
    const { data, error } = await sb.from('matchups').select('*').eq('round_number', roundNumber);
    if (error) throw error;
    return data || [];
}

// Pull the group's latest scores (another phone may have entered some). The server wins,
// except for scores this phone hasn't sent yet. A read that raced a save is thrown away.
let refreshing = false;
let refreshAgain = false;
async function refreshSession() {
    const sess = S.sess;
    if (!sess || !sb || !S.authUser) return;
    if (refreshing) { refreshAgain = true; return; }
    refreshing = true;
    try {
        const { data: round, error: roundError } = await sb.from('rounds').select('*').eq('id', sess.roundId).maybeSingle();
        if (roundError) throw roundError;
        if (sess !== S.sess) return;
        if (!round) {
            // The round is gone: its unsent scores can never save
            reloadOutbox();
            Object.keys(S.outbox).forEach(k => { if (S.outbox[k].roundId === sess.roundId) delete S.outbox[k]; });
            saveOutbox();
            showToast('That round was removed from the database. Start scoring again from Keep score.', 'error');
            endSession(true);
            return;
        }
        sess.roundNumber = round.round_number;
        sess.date = round.date;
        sess.courseId = round.course_id;
        const course = S.courses.find(c => c.id === round.course_id);
        if (course) sess.courseName = course.name;
        if (course || !sess.pars) sess.pars = parsFor(course, sess.roundNumber);
        // The tees' yards and handicaps arrive with the courses: redraw once they do (below)
        const infoBefore = JSON.stringify(sess.info || null);
        if (S.courses.length) sess.info = holeInfoFor(sess.roundNumber, sess.courseId);
        sess.matchups = await loadMatchups(sess.roundNumber);
        sess.names = sess.names || {};
        sess.holes = sess.holes || {};
        sess.playerIds.forEach(id => {
            const p = playerById(id);
            if (p && S.players.length) sess.names[id] = { id, name: p.name, team_id: p.team_id };
        });

        // Two groups that started at the same moment can leave twin rounds for one day: read both
        const { data: twins } = await sb.from('rounds').select('id').eq('round_number', round.round_number).eq('date', round.date);
        const roundIds = [...new Set([sess.roundId].concat((twins || []).map(r => r.id)))];
        const acksBefore = S.acks;
        const { data: rows, error } = await sb.from('scores').select('*').in('round_id', roundIds).in('player_id', sess.playerIds);
        if (error) throw error;
        if (sess !== S.sess) return;
        if (S.acks !== acksBefore) { refreshAgain = true; return; } // a save landed meanwhile: read again

        reloadOutbox();
        const before = JSON.stringify(sess.holes);
        let otherPhone = null;
        sess.playerIds.forEach(pid => {
            const mine = (rows || []).filter(r => r.player_id === pid);
            const own = SC.mergeHoles(mine.filter(r => r.round_id === sess.roundId));
            const twin = SC.mergeHoles(mine.filter(r => r.round_id !== sess.roundId));
            const server = own.map((v, i) => (v !== null ? v : twin[i]));
            const local = holesFor(pid);
            for (let h = 1; h <= HOLES; h++) {
                if (pendingFor(sess.roundId, pid, h)) continue;
                if (!sess.needsLoad && local[h - 1] !== null && server[h - 1] !== null && local[h - 1] !== server[h - 1]) otherPhone = h;
                local[h - 1] = server[h - 1];
            }
        });
        if (otherPhone && !S.warnedOtherPhone) {
            S.warnedOtherPhone = true;
            showToast(`Another phone is scoring this group too (hole ${otherPhone} changed). Keep one phone per group, or tap Done on one of them.`, 'error');
        }
        const firstLoad = !!sess.needsLoad;
        if (firstLoad) {
            delete sess.needsLoad;
            delete sess.legacy;
            sess.hole = firstOpenHole(sess);
        }
        sess.syncedAt = Date.now();
        S.refreshFailed = false;
        saveSession();
        // Re-draw only when something changed, so a background refresh never moves a button under a finger
        if (firstLoad || JSON.stringify(sess.holes) !== before || JSON.stringify(sess.info || null) !== infoBefore) {
            if (S.view === 'score') renderScore();
            else if (S.view === 'card') renderCard();
        }
    } catch (err) {
        console.warn('Refresh failed:', err);
        S.refreshFailed = true;
        if (sess.legacy && sess === S.sess) {
            // An old-style session we couldn't load: fall back to setup
            S.sess = null;
            saveSession();
            if (S.view === 'score' || S.view === 'card') go('setup');
        }
    } finally {
        refreshing = false;
        if (refreshAgain) {
            refreshAgain = false;
            setTimeout(refreshSession, 400);
        }
    }
}

// ==========================================
// Starting a round
// ==========================================
// Everyone playing Round N today shares one rounds row. If two groups create it at the same
// moment, both phones settle on the same one (the lowest id).
async function findOrCreateRound(roundNumber, courseId) {
    const today = localDay();
    const find = async () => {
        const { data, error } = await sb.from('rounds').select('*').eq('round_number', roundNumber).eq('date', today);
        if (error) throw error;
        return data || [];
    };
    const existing = await find();
    if (existing.length) return pickRound(existing);
    const { data: created, error } = await sb.from('rounds')
        .insert([{ course_id: courseId, status: 'active', round_number: roundNumber, date: today }])
        .select('*');
    // 23505: another group created it a moment ago (tracker_2027.sql allows one per day)
    if (error && error.code !== '23505') throw error;
    const again = await find();
    if (!again.length && !(created && created.length)) throw new Error('The round couldn’t be created.');
    return pickRound(again.length ? again : created);
}

async function startScoring() {
    const st = S.setup;
    const btn = $('start-btn');
    if (!st || !btn || btn.disabled) return;
    if (!sb) return showToast('Still connecting to the score database. Try again in a moment.', 'error');
    if (!st.playerIds.length) return showToast('Pick at least one player to score.', 'error');
    if (!st.courseId) return showToast('Pick the course.', 'error');
    // Singles day with one match picked: ask about the rest of the group first (once per tap on Start)
    const skipCheck = st.singlesOk;
    st.singlesOk = false;
    const check = skipCheck ? null : singlesCheck(st);
    if (check) return showSinglesCheck(check);
    hideSinglesCheck();
    // A tap on the wrong round would start a stray round that hides the real one (on a practice day,
    // say why: the group is about to score the practice round as a Cup round)
    const sched = scheduleOf(st.round);
    if (sched && sched.date && sched.date !== localDay() &&
        !confirm(practiceToday()
            ? `Today’s round is a practice round. Round ${st.round} is a Cup round, on the schedule for ${fmtDay(sched.date)}. Start Round ${st.round} today anyway?`
            : `Round ${st.round} is on the schedule for ${fmtDay(sched.date)}. Start it today anyway?`)) return;
    btn.disabled = true;
    btn.textContent = 'Starting…';
    try {
        const round = await findOrCreateRound(st.round, st.courseId);
        const course = S.courses.find(c => c.id === round.course_id) || S.courses.find(c => c.id === st.courseId);
        if (round.course_id && round.course_id !== st.courseId && course) {
            showToast(`Round ${st.round} is already under way at ${course.name}, so you’re scoring there.`, 'success');
        }
        await Promise.all(st.playerIds.map(pid => ensureScoreRow(round.id, pid)));
        let matchups = [];
        try { matchups = await loadMatchups(round.round_number); } catch (e) { matchups = st.matchups || []; }

        const keepHoles = S.sess && S.sess.roundId === round.id ? S.sess.holes : {};
        S.sess = {
            v: 2,
            roundId: round.id,
            roundNumber: round.round_number,
            date: round.date,
            courseId: round.course_id,
            courseName: course ? course.name : '',
            pars: parsFor(course, round.round_number),
            info: holeInfoFor(round.round_number, round.course_id),
            playerIds: st.playerIds.slice(),
            names: {},
            matchups,
            holes: keepHoles,
            hole: 1,
            needsLoad: true
        };
        st.playerIds.forEach(id => { const p = playerById(id); if (p) S.sess.names[id] = { id, name: p.name, team_id: p.team_id }; });
        S.warnedOtherPhone = false;
        S.board.round = round.round_number;
        saveSession();
        clearSetupDraft(); // the picks are this phone's group now
        S.refreshFailed = false;
        await refreshSession();
        if (S.sess && S.sess.needsLoad && S.refreshFailed) {
            // Couldn't read the group's scores yet: start at hole 1, they fill in when the signal's back
            delete S.sess.needsLoad;
            saveSession();
            showToast('Couldn’t load the group’s scores yet. They’ll fill in when the signal’s back.', 'error');
        } else if (S.sess && S.sess.hole > 1) {
            showToast(`Holes 1–${S.sess.hole - 1} are already in. Picking up at hole ${S.sess.hole}.`, 'success');
        }
        go('score');
        flush();
    } catch (err) {
        console.error('Start failed:', err);
        showToast(isNetworkError(err)
            ? 'No signal. Try again once you have a bar or two.'
            : isAuthError(err) ? 'Your login expired. Log in again, then start scoring.'
                : isRefused(err) ? 'Your login can’t keep score yet. Open The Bookie and link your login to your name on the roster.'
                    : `Couldn’t start: ${err.message || err}`, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = startLabel();
    }
}

function endSession(silent) {
    S.sess = null;
    saveSession();
    S.setup = null;
    clearSetupDraft();
    if (!silent) {
        showToast(pendingCount()
            ? 'Done. Keep this page open until it says All saved: some scores are still sending.'
            : 'Done scoring. Nice round.', pendingCount() ? 'error' : 'success');
    }
    if (location.hash !== '#setup') location.replace('#setup');
    else route();
}

// ==========================================
// Views and routing
// ==========================================
const VIEWS = ['setup', 'score', 'card', 'board', 'match'];
// Live scores and a match's scorecard: the public screens
const onLiveView = () => S.view === 'board' || S.view === 'match';
function renderLive() {
    if (S.view === 'match') renderMatch();
    else if (S.view === 'board') renderBoard();
}

function go(view) {
    if (location.hash !== `#${view}`) location.hash = view;
    else route();
}

function route() {
    const hash = location.hash || '';
    const ref = parseMatchHash(hash);
    let view = ref ? 'match' : hash.replace('#', '');
    if (!VIEWS.includes(view) || (view === 'match' && !ref)) view = S.sess ? 'score' : (!S.ready || !sb || S.authUser ? 'setup' : 'board');
    if ((view === 'score' || view === 'card') && !S.sess) view = 'setup';
    S.matchRef = view === 'match' ? ref : null;
    const wantHash = view === 'match' ? hash : `#${view}`;
    // Every screen is a history entry, so Back steps between them instead of doing nothing
    // (only once the login is known: before that the screen is just a placeholder)
    if (S.ready && location.hash !== wantHash) history.replaceState(history.state, '', wantHash);
    const changed = S.view !== view || (view === 'match' && S.matchHash !== wantHash);
    S.matchHash = view === 'match' ? wantHash : null;
    const act = document.activeElement;
    const focusWasInView = S.view && (!act || act === document.body || ($(`view-${S.view}`) && $(`view-${S.view}`).contains(act)));
    // Live scores -> a match: remember the spot, so Back lands on the same card. Each match card and
    // player link carries a data-key (they share an address), and where it sat on screen keeps it in
    // place even if a refresh moved things meanwhile.
    if (S.view === 'board' && view === 'match') {
        // The focused link (keyboard), or the one just tapped (a tap doesn't focus a link on iPhone)
        const focused = act && act.dataset && act.dataset.key && $('board-body').contains(act)
            ? { key: act.dataset.key, top: act.getBoundingClientRect().top } : null;
        const hit = focused || S.tappedMatch || { key: null, top: null };
        S.boardReturn = { y: window.scrollY, round: S.board.round, scope: S.board.scope || 'round', key: hit.key, top: hit.key ? hit.top : null };
    } else if (view !== 'board' && view !== 'match') {
        S.boardReturn = null;
    }
    S.tappedMatch = null;
    // A match opened while scoring (the match line above the players, or the card) goes back there;
    // one opened from Live scores goes back to Live scores. Kept for this tab, so a reload on the
    // match still knows.
    if (view === 'match') {
        if (S.view === 'score' || S.view === 'card') {
            S.matchFrom = S.view;
            try { sessionStorage.setItem(MATCH_FROM_KEY, JSON.stringify({ hash: wantHash, from: S.view })); } catch (e) { /* this visit only */ }
        } else if (S.view === 'board') {
            S.matchFrom = null;
            try { sessionStorage.removeItem(MATCH_FROM_KEY); } catch (e) { /* ignore */ }
        } else if (S.view !== 'match') {
            let saved = null;
            try { saved = JSON.parse(sessionStorage.getItem(MATCH_FROM_KEY) || 'null'); } catch (e) { saved = null; }
            S.matchFrom = saved && saved.hash === wantHash && (saved.from === 'score' || saved.from === 'card') ? saved.from : null;
        }
    } else {
        S.matchFrom = null;
    }
    const fromScoring = view === 'match' && S.matchFrom && S.sess ? S.matchFrom : null;
    S.view = view;
    if (view === 'match') {
        const back = $('match-back');
        if (back) {
            back.setAttribute('href', fromScoring ? `#${fromScoring}` : '#board');
            back.querySelector('.bl-text').textContent = fromScoring === 'card' ? 'Back to the card' : fromScoring ? 'Back to scoring' : 'Live scores';
        }
    }
    const live = view === 'board' || view === 'match';
    // The tab (and a home-screen bookmark) names the screen: watching or entering scores
    document.title = `${live ? 'Live scores' : 'Keep score'} · ${(CFG.trip && CFG.trip.name) || 'Bros before Boges'}`;
    // ...and the header's Log in comes back to it (a spectator shouldn't land on the scoring setup)
    $('nav-login').href = `bookie.html?next=${live ? 'board' : 'round'}&mode=login`;
    VIEWS.forEach(v => { $(`view-${v}`).hidden = v !== view; });
    document.querySelectorAll('.tracker-nav [data-view]').forEach(a => {
        const v = a.dataset.view;
        a.hidden = (v === 'score' || v === 'card') ? !S.sess : (v === 'setup' ? !!S.sess && view !== 'setup' : false);
        const here = v === view || (view === 'match' && v === (fromScoring || 'board'));
        if (here) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (S.keypad && changed) closeKeypad();
    S.viewStale = false;
    if (view === 'setup') renderSetup();
    else if (view === 'score') renderScore();
    else if (view === 'card') renderCard();
    else if (view === 'match') renderMatch();
    else renderBoard();
    const back = view === 'board' && changed && S.boardReturn && S.boardReturn.round === S.board.round &&
        S.boardReturn.scope === (S.board.scope || 'round') && S.board.data[S.board.round] ? S.boardReturn : null;
    if (view === 'board') S.boardReturn = null;
    if (changed) {
        const esc = s => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));
        const card = back && back.key ? $('board-body').querySelector(`[data-key="${esc(back.key)}"]`) : null;
        window.scrollTo(0, back ? back.y : 0);
        if (card && back.top !== null) window.scrollBy(0, card.getBoundingClientRect().top - back.top);
        // Keyboard and screen-reader users land on the new screen's heading (or, back from a match,
        // on the card they opened)
        if (focusWasInView) {
            const h = card || document.querySelector(`#view-${view} h2`);
            if (h) { if (!card) h.tabIndex = -1; h.focus({ preventScroll: true }); }
        }
    }
}

// ---------- Setup
function startLabel() {
    return S.setup ? `Start scoring Round ${S.setup.round}` : 'Start scoring';
}

function defaultSetup() {
    const rounds = tripRounds();
    // Picked in this tab a moment ago (a look at the rules, then back)
    const draft = readSetupDraft();
    if (draft && rounds.some(r => r.number === draft.round)) {
        const fallback = dbCourseForRound(draft.round);
        const playerIds = draft.playerIds.filter(id => playerById(id));
        return {
            round: draft.round,
            courseId: S.courses.some(c => c.id === draft.courseId) ? draft.courseId : (fallback ? fallback.id : ''),
            playerIds,
            matchups: null,
            touched: !!draft.touched && playerIds.length > 0 // nobody left: pick my match again
        };
    }
    const prev = S.sess && S.sess.date === localDay() ? S.sess : null;
    const round = prev ? prev.roundNumber : (scheduledRoundToday() || (rounds[0] && rounds[0].number) || 1);
    const course = dbCourseForRound(round);
    return { round, courseId: prev ? prev.courseId : (course ? course.id : ''), playerIds: prev ? prev.playerIds.slice() : [], matchups: null, touched: !!prev };
}

async function renderSetup() {
    const body = $('setup-body');
    if (!S.ready) {
        body.innerHTML = '<p class="muted">Loading…</p>';
        return;
    }
    const waitingNote = () => (pendingCount()
        ? `<div class="notice" data-waiting><div data-sync>${syncChipHTML()}</div><p class="small" style="margin-top: 8px;">Keep this page open until these send.</p></div>`
        : '');
    const waiting = waitingNote();
    if (!sb) {
        body.innerHTML = `${waiting}<p class="muted">Connecting to the score database…</p>`;
        return;
    }
    if (!S.authUser) {
        body.innerHTML = `${waiting}
            <div class="panel">
                <p style="margin-bottom: 14px;">Log in to keep score. It’s the same login as The Bookie and your RSVP.</p>
                <a class="t-btn gold block" href="bookie.html?next=round&amp;mode=login">Log in to keep score</a>
            </div>
            <a class="t-btn block" href="#board">See live scores</a>`;
        return;
    }
    if (S.loadError && (!S.players.length || !S.courses.length || !S.me)) {
        body.innerHTML = `${waiting}<div class="notice error">Couldn’t load the roster and courses. Check your signal.</div><button type="button" class="t-btn block" data-action="retry-load">Try again</button>`;
        return;
    }
    if (S.me && S.me.status === 'potential') {
        body.innerHTML = `${waiting}<div class="notice">The commissioner still needs to confirm you for the trip before you can keep score. You can still follow the <a href="#board">live scores</a>.</div>`;
        return;
    }
    if (!S.me || S.me.user_id !== S.authUser.id) {
        body.innerHTML = `${waiting}<div class="notice">Your login isn’t linked to your name on the roster yet, so it can’t keep score. <a href="bookie.html">Open The Bookie</a> and pick your name, then come back.</div><a class="t-btn block" href="#board">See live scores</a>`;
        return;
    }
    if (!S.setup) S.setup = defaultSetup();
    const st = S.setup;
    if (!st.matchups || st.matchupsFor !== st.round) {
        swapKeepingFocus(body, waiting + setupHTML(st, true));
        const forRound = st.round;
        let list = null;
        try {
            list = await loadMatchups(forRound);
        } catch (e) {
            list = null;
        }
        if (st !== S.setup || st.round !== forRound || S.view !== 'setup') return; // a newer choice is loading
        if (list === null) {
            body.innerHTML = `${waitingNote()}<div class="notice error">Couldn’t load the Round ${forRound} matches (no signal?).</div><button type="button" class="t-btn block" data-action="pick-round" data-round="${forRound}">Try again</button>`;
            return;
        }
        st.matchups = list;
        st.matchupsFor = forRound;
        // First time on this round: pick my match(es), and the rest of my group once Admin has set
        // groups (on singles day a foursome is two matches)
        if (!st.touched && S.me) {
            const all = SC.matchesFrom(st.matchups);
            const own = all.filter(m => m.sides.some(s => s.ids.includes(S.me.id)));
            const groups = new Set(own.map(groupOf).filter(Boolean));
            const mine = groups.size ? all.filter(m => own.includes(m) || groups.has(groupOf(m))) : own;
            st.playerIds = mine.length ? [...new Set(mine.flatMap(m => m.sides.flatMap(s => s.ids)))] : [S.me.id];
        }
    }
    swapKeepingFocus(body, waitingNote() + setupHTML(st, false));
}

function setupHTML(st, loading) {
    const rounds = tripRounds();
    const format = formatOf(st.round);
    const info = formatInfo(format);
    // A shared ball is worth saying only when there's no rules section to explain the format
    const about = info.about.concat(!FORMAT_RULES[format.key] && format.sharedBall ? 'partners share one score' : []);
    const chosen = new Set(st.playerIds);
    const matches = SC.matchesFrom(st.matchups || []);
    const meId = S.me ? S.me.id : null;
    const sideNames = side => side.ids.map(id => escHtml(side.ids.length > 1 ? firstName(nameOf(id)) : nameOf(id))).join(' &amp; ');
    const matchHTML = m => {
        const all = m.sides.flatMap(s => s.ids);
        const on = all.every(id => chosen.has(id));
        const mine = meId && all.includes(meId);
        const tag = [`Match ${m.number}`, groupOf(m) ? `Group ${groupOf(m)}` : '', teeTimeOf(m) ? teeClock(teeTimeOf(m)) : '', mine ? 'your match' : ''].filter(Boolean).join(' · ');
        return `<button type="button" class="match-pick" data-action="toggle-match" data-ids="${escHtml(all.join(','))}" aria-pressed="${on}">
            <span class="tag${mine ? ' mine' : ''}">${escHtml(tag)}</span>
            <span class="team-1">${sideNames(m.sides[0])}</span><span class="vs">vs</span><span class="team-2 side-b">${sideNames(m.sides[1])}</span>
        </button>`;
    };
    const confirmed = S.players.filter(p => p.status !== 'potential');
    const teams = [...new Set(confirmed.map(p => p.team_id || 0))].sort((a, b) => (a || 99) - (b || 99));
    const chips = teams.map(t => `
        <div class="chip-team ${t ? `team-${t}` : 'muted'}">${t ? `${TEAM_NAMES[t] || `Team ${t}`} team` : 'No team yet'}</div>
        ${confirmed.filter(p => (p.team_id || 0) === t).map(p => `<button type="button" class="chip" data-action="toggle-player" data-id="${escHtml(p.id)}" aria-pressed="${chosen.has(p.id)}">${escHtml(p.name)}${p.id === meId ? ' (you)' : ''}</button>`).join('')}`).join('');
    const picked = st.playerIds.map(id => escHtml(firstName(nameOf(id))));
    // This trip's courses first, the rest below
    const tripCourseIds = new Set(rounds.map(r => dbCourseForRound(r.number)).filter(Boolean).map(c => c.id));
    const opt = c => `<option value="${escHtml(c.id)}"${c.id === st.courseId ? ' selected' : ''}>${escHtml(c.name)}</option>`;
    const tripCourses = S.courses.filter(c => tripCourseIds.has(c.id));
    const otherCourses = S.courses.filter(c => !tripCourseIds.has(c.id));
    // Thursday's practice round isn't kept here: say so before anyone starts it as Round 1
    const prac = practiceToday();
    const pracNote = prac
        ? `<div class="notice" data-practice>${escHtml(`Today’s round${prac.slot.what ? ` at ${prac.slot.what}` : ''} is a practice round: no Cup points, and the tracker doesn’t keep it.${prac.next ? ` The Cup starts with Round ${prac.next.number}, ${prac.next.day}.` : ''}`)}</div>`
        : '';

    return `
        ${S.sess ? `<div class="notice">You’re scoring Round ${S.sess.roundNumber} on this phone. <a href="#score">Back to hole ${S.sess.hole}</a>. Starting again below switches this phone to the new group (scores already entered stay saved).</div>` : ''}
        ${pracNote}
        <div class="panel">
            <span class="field-label" style="margin-top: 0;">Round</span>
            <div class="seg" role="group" aria-label="Round">
                ${rounds.map(r => `<button type="button" data-action="pick-round" data-round="${r.number}" aria-pressed="${r.number === st.round}">R${r.number}${r.day ? `<small>${escHtml(r.day)}</small>` : ''}</button>`).join('')}
            </div>
            <p class="muted small fmt-line">Format: <strong>${escHtml(info.name)}</strong>&nbsp;· ${formatLineHTML(about, info)}</p>
            ${st.courseId ? `<p class="setup-course" id="setup-course">${courseLineHTML(st)}</p>` : ''}
            ${st.courseId ? `<details class="more course-other"${atTripCourse(st) ? '' : ' open'}><summary>Playing a different course?</summary>` : ''}
            <label class="field-label" for="course-select">${st.courseId ? 'Another course' : 'Course'}</label>
            <select id="course-select" class="t-select">
                <option value="">Choose a course…</option>
                ${tripCourses.length && otherCourses.length
                    ? `<optgroup label="This trip">${tripCourses.map(opt).join('')}</optgroup><optgroup label="Other courses">${otherCourses.map(opt).join('')}</optgroup>`
                    : S.courses.map(opt).join('')}
            </select>
            ${st.courseId ? '</details>' : ''}
        </div>
        <div class="panel">
            <span class="field-label" style="margin-top: 0;">Who is this phone scoring?</span>
            ${loading ? '<p class="muted">Loading the matches…</p>' : matches.length
                ? `<p class="muted small" style="margin-bottom: 10px;">Tap your match. Playing with another match (a foursome of singles)? Tap that one too.</p><div class="match-list">${mineFirst(matches, new Set(meId ? [meId] : [])).map(matchHTML).join('')}</div>`
                : '<p class="muted small">No matches set for this round yet. Pick the players in your group.</p>'}
            <details class="more"${matches.length ? '' : ' open'}>
                <summary>${matches.length ? 'Pick players one by one' : 'Players'}</summary>
                <div class="chips">${chips}</div>
            </details>
        </div>
        <div class="start-bar">
            <div id="singles-check" hidden></div>
            <p class="muted small" id="setup-summary" style="margin-bottom: 8px;">${picked.length ? `Scoring ${picked.length}: ${picked.join(', ')}` : 'Nobody picked yet.'}</p>
            <button type="button" id="start-btn" class="t-btn gold block" data-action="start"${loading ? ' disabled' : ''}>${startLabel()}</button>
        </div>`;
}

// The setup's course: picked for the round by the trip plan, so it's a line of text ("We-Ko-Pa -
// Cholla · Composite tees, 6,436 yds"); the list to pick another course sits behind "Playing a
// different course?"
function atTripCourse(st) {
    const db = dbCourseForRound(st.round);
    return !!db && db.id === st.courseId;
}
function courseLineHTML(st) {
    const course = S.courses.find(c => c.id === st.courseId);
    if (!course) return '';
    const tees = atTripCourse(st) ? teesText(holeInfoFor(st.round, st.courseId)) : '';
    return `<span class="field-label">Course</span><strong>${escHtml(course.name)}</strong>${tees ? `<span class="sc-tees">${escHtml(tees)}</span>` : ''}`;
}

// Singles day: a foursome is two matches, and the phone should score both. When only one singles
// match is picked, ask before starting: name the other match in the group when Admin has set groups,
// else a reminder. { picked, mates } or null.
function singlesCheck(st) {
    if (formatOf(st.round).key !== 'singles') return null;
    const all = SC.matchesFrom(st.matchups || []);
    if (all.length < 2) return null;
    const chosen = new Set(st.playerIds);
    const picked = all.filter(m => m.sides.every(s => s.ids.every(id => chosen.has(id))));
    if (picked.length !== 1 || chosen.size !== picked[0].sides.flatMap(s => s.ids).length) return null;
    const g = groupOf(picked[0]);
    const mates = g ? all.filter(m => m !== picked[0] && groupOf(m) === g) : [];
    if (g && !mates.length) return null; // Admin says this match plays on its own
    return { picked: picked[0], mates };
}

function showSinglesCheck(check) {
    const box = $('singles-check');
    if (!box) return;
    const vs = m => m.sides.map(s => s.ids.map(nameOf).join(' & ')).join(' vs ');
    const add = check.mates;
    const ids = add.flatMap(m => m.sides.flatMap(s => s.ids));
    // The question is each button's description, so a screen reader reads it with the button it lands on
    box.innerHTML = `<div class="notice singles-check" role="group" aria-label="Your group">
        <p id="singles-check-q">${add.length
            ? `Your group also has ${escHtml(add.map(m => `Match ${m.number} (${vs(m)})`).join(' and '))}. Score ${add.length > 1 ? 'them' : 'it'} on this phone too?`
            : 'On singles day a foursome is two matches. Playing with another match? Tap it above so this phone scores all four of you.'}</p>
        <div class="btn-row">
            ${add.length ? `<button type="button" class="t-btn gold" data-action="singles-add" data-ids="${escHtml(ids.join(','))}" aria-describedby="singles-check-q">Add ${add.length > 1 ? 'them' : `Match ${add[0].number}`} and start</button>` : ''}
            <button type="button" class="t-btn" data-action="singles-skip" aria-describedby="singles-check-q">Start with just Match ${check.picked.number}</button>
        </div>
    </div>`;
    box.hidden = false;
    // Its two buttons are the ways on: the plain Start would be a third
    const start = $('start-btn');
    if (start) start.hidden = true;
    const first = box.querySelector('button');
    if (first) first.focus({ preventScroll: true });
}
function hideSinglesCheck() {
    const box = $('singles-check');
    if (box && !box.hidden) { box.hidden = true; box.innerHTML = ''; }
    const start = $('start-btn');
    if (start) start.hidden = false;
}

// Show who's picked without rebuilding the screen (keeps the player list open and in place)
function syncSetupSelection() {
    const st = S.setup;
    const chosen = new Set(st.playerIds);
    document.querySelectorAll('#setup-body [data-action="toggle-match"]').forEach(b => {
        b.setAttribute('aria-pressed', String(b.dataset.ids.split(',').every(id => chosen.has(id))));
    });
    document.querySelectorAll('#setup-body [data-action="toggle-player"]').forEach(b => {
        b.setAttribute('aria-pressed', String(chosen.has(b.dataset.id)));
    });
    const summary = $('setup-summary');
    const picked = st.playerIds.map(id => firstName(nameOf(id)));
    if (summary) summary.textContent = picked.length ? `Scoring ${picked.length}: ${picked.join(', ')}` : 'Nobody picked yet.';
}

// ---------- Score
// How each of this group's matches stands, one card per match (a line per nine in split). The card
// opens the match's scorecard, tinted line by line in the colour of whoever's ahead.
function holeStatusLines() {
    const sess = S.sess;
    const format = formatOf(sess.roundNumber);
    if (format.key === 'stroke') return '';
    const holesById = holesByIdFromSession();
    return trackedMatches(sess).map(m => {
        const r = SC.matchResult(format, m, holesById, sess.pars);
        const names = m.sides.map(s => (format.teams && TEAM_NAMES[s.team]) || s.ids.map(id => firstName(nameOf(id))).join(' & '));
        const lines = r.parts.map(p => {
            const leader = p.lead > 0 ? 1 : p.lead < 0 ? 2 : 0;
            const team = leader && p.started ? m.sides[leader - 1].team : 0;
            return `<span class="sl-line${team ? ` lead-t${team}` : ''}"><span class="sl-what">${p.label ? `${escHtml(p.label)} · ` : ''}Match ${m.number}</span><b class="${team ? `team-${team}` : ''}">${escHtml(SC.partText(p, names))}</b></span>`;
        }).join('');
        return `<a class="status-line" href="${escHtml(matchHref(sess.roundNumber, m.id))}"><span class="sl-lines">${lines}</span><span class="sr-only">. Open the match scorecard</span><span class="sl-go" aria-hidden="true">›</span></a>`;
    }).join('');
}

// "Bet on this match": The Bookie's new-bet form with the other side of my match picked (one opponent
// in singles; in a pairs round both go to the top of its list) and the round and match filled in.
// Only when the signed-in player is in one of the matches this phone is scoring.
function betLinkHTML(sess) {
    if (!S.me || !S.authUser || formatOf(sess.roundNumber).key === 'stroke') return '';
    const m = trackedMatches(sess).find(x => x.sides.some(s => s.ids.includes(S.me.id)));
    const other = m && m.sides.find(s => !s.ids.includes(S.me.id));
    if (!other || !other.ids.length) return '';
    const href = `bookie.html?new=h2h&vs=${other.ids.map(encodeURIComponent).join(',')}&round=${sess.roundNumber}&match=${m.number}`;
    return `<a class="t-btn small ghost" href="${escHtml(href)}" data-bet-link>Bet on this match</a>`;
}

// This hole's score in words: "Bogey", or "Bogey · 1 pt" in a points round
function holeResultText(v, par, format) {
    if (v === null || !par) return '';
    const d = v - par;
    const word = { ace: 'Ace', albatross: 'Albatross', eagle: 'Eagle', birdie: 'Birdie', par: 'Par', bogey: 'Bogey', double: 'Double' }[SC.scoreName(v, par)]
        || (d === 3 ? 'Triple' : `+${d}`);
    return format.key === 'points' ? `${word} · ${ptsText(SC.quotaPoints(v, par))}` : word;
}

// Under a player's name: this hole's result ("Bogey · 1 pt", in the score's colour), then the round
// so far ("9 pts · +2 thru 4 · 22"). Two lines of fixed height, or one line on a short phone; either
// way a tap never moves the rows below. On a narrow row the later parts drop out whole.
function unitSubline(unit, hole) {
    const sess = S.sess;
    const format = formatOf(sess.roundNumber);
    const holes = unitHoles(unit);
    const t = SC.totals(holes, sess.pars);
    const sep = '<span class="u-sep" aria-hidden="true"> | </span>';
    if (!t.thru) return `<div class="unit-sub"><span class="u-res"></span>${sep}<span class="u-tot">No scores yet</span></div>`;
    const toPar = SC.fmtToPar(t.toPar);
    const segs = format.key === 'points'
        ? [ptsText(unitPoints(holes, sess.pars)), `· ${toPar}`, `thru ${t.thru}`, `· ${t.strokes}`]
        : [toPar, `thru ${t.thru}`, `· ${t.strokes}`];
    const v = holes[hole - 1];
    const res = holeResultText(v, sess.pars[hole - 1], format);
    return `<div class="unit-sub"><span class="u-res${res ? ` ${SC.scoreName(v, sess.pars[hole - 1])}` : ''}">${escHtml(res)}</span>${sep}<span class="u-tot">${segs.map(s => `<span class="seg">${escHtml(s)}</span>`).join(' ')}</span></div>`;
}

// Holes in a round: scored by everyone this phone enters, or by some of them
function holeState(units, hole) {
    const vals = units.map(u => unitValue(u, hole));
    const done = vals.length > 0 && vals.every(v => v !== null);
    return { done, part: !done && vals.some(v => v !== null) };
}

// Re-render the Score view, keeping keyboard focus on the same control
function renderScore() {
    const sess = S.sess;
    if (!sess) return;
    const body = $('score-body');
    const act = document.activeElement && body.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = act ? { action: act.dataset.action, unit: act.dataset.unit, label: act.getAttribute('aria-label'), href: act.tagName === 'A' ? act.getAttribute('href') : null } : null;
    if (!sess.pars) {
        body.innerHTML = '<p class="muted">Loading your round…</p>';
        return;
    }
    const format = formatOf(sess.roundNumber);
    const h = Math.min(Math.max(sess.hole || 1, 1), HOLES);
    sess.hole = h;
    const par = sess.pars[h - 1];
    const cap = SC.holeCap(format, par);
    const units = unitsOf(sess);
    const narrow = window.innerWidth < 360;
    const nine = format.key === 'split'
        ? (narrow ? (h <= 9 ? ' · scramble' : ' · alt shot') : (h <= 9 ? ' · front 9 scramble' : ' · back 9 alternate shot'))
        : '';
    // Par, then the yardage and handicap for the tees we play (when the round is at its trip course)
    const info = sess.info || null;
    const facts = [`Par ${par}`]
        .concat(info && info.yards ? `${info.yards[h - 1]} yds` : [], info && info.hcps ? `Hcp ${info.hcps[h - 1]}` : [])
        .map(escHtml).join(' · ') + (nine ? ` · <span class="nowrap">${escHtml(nine.replace(/^ · /, ''))}</span>` : '') + (cap ? ` · <span class="nowrap">max ${cap}</span>` : '');

    // 18 slim bars under the hole: scored, partly scored, and this hole
    const progress = Array.from({ length: HOLES }, (_, i) => {
        const st = holeState(units, i + 1);
        return `<span class="${[i + 1 === h ? 'cur' : '', st.done ? 'done' : st.part ? 'part' : ''].filter(Boolean).join(' ')}"></span>`;
    }).join('');

    const rows = units.map((u, i) => {
        const v = unitValue(u, h);
        const name = unitName(u, narrow);
        const kind = SC.scoreName(v, par);
        const pend = unitPending(u, h);
        return `
            <div class="unit${u.team ? ` t${u.team}` : ''}">
                <div class="unit-main">
                    <div class="unit-name">${escHtml(name)}</div>
                    ${unitSubline(u, h)}
                </div>
                <div class="stepper">
                    <button type="button" class="step minus" data-action="minus" data-unit="${i}" aria-label="One stroke fewer for ${escHtml(unitName(u))} on hole ${h}"${v === 1 ? ' disabled' : ''}>−</button>
                    <button type="button" class="score-value${v !== null ? ` set ${kind}` : ''}${pend ? ' pend' : ''}" data-action="keypad" data-unit="${i}" data-pend-ids="${escHtml(u.ids.join(','))}" data-pend-hole="${h}" aria-label="${escHtml(unitName(u))}: ${v !== null ? `${v}${kindText(kind)} on hole ${h}` : `no score on hole ${h}`}. Pick a score." title="${pend ? 'Not sent yet' : ''}">${v !== null ? digitHTML(v) : '·'}</button>
                    <button type="button" class="step plus" data-action="plus" data-unit="${i}" aria-label="One stroke more for ${escHtml(unitName(u))} on hole ${h}"${cap && v !== null && v >= cap ? ' disabled' : ''}>+</button>
                </div>
            </div>`;
    }).join('');

    const allIn = units.length > 0 && units.every(u => unitValue(u, h) !== null);
    const open = firstOpenHole(sess);
    const openHasGap = units.some(u => unitValue(u, open) === null);
    // Always there under the last player: a quiet "Hole 5 ›" while the hole is being entered, then
    // gold and pinned above the tabs once every score is in
    let next;
    if (allIn && openHasGap && open !== h && open !== h + 1) next = `<button type="button" class="t-btn gold" data-action="hole" data-hole="${open}">Back to hole ${open} →</button>`;
    else if (allIn && h < HOLES) next = `<button type="button" class="t-btn gold" data-action="hole" data-hole="${h + 1}">Hole ${h + 1} →</button>`;
    else if (allIn) next = '<a class="t-btn gold" href="#card">Check the card →</a>'; // "18 of 18" beside it says they're all in
    else if (h < HOLES) next = `<button type="button" class="t-btn quiet" data-action="hole" data-hole="${h + 1}">Hole ${h + 1} ›</button>`;
    else next = '<a class="t-btn quiet" href="#card">Card ›</a>';
    // The gold button lands right under the thumb as the last score goes in: ignore taps for a moment
    const nextKey = allIn ? `${sess.roundNumber}:${h}` : null;
    if (nextKey !== S.nextShown.key) S.nextShown = { key: nextKey, at: Date.now(), cover: false };

    const roundLine = `Round ${sess.roundNumber}${sess.courseName ? ` · ${sess.courseName}` : ''}`;
    legendShown(); // the sync chip's gold dot, drawn below
    body.innerHTML = `
        <div class="score-top">
            <div class="eyebrow" title="${escHtml(roundLine)}">${escHtml(roundLine)}</div>
            <div data-sync>${syncChipHTML()}</div>
        </div>
        <div class="hole-head-wrap"><div class="hole-head">
            <button type="button" class="step-hole" data-action="hole" data-hole="${h - 1}" aria-label="Previous hole"${h === 1 ? ' disabled' : ''}>‹</button>
            <div class="hole-title">
                <h2 tabindex="-1"><button type="button" class="hole-jump" data-action="jump" aria-haspopup="dialog">Hole ${h}<span class="caret" aria-hidden="true">▼</span><span class="sr-only">. Pick another hole</span></button></h2>
                <span class="hole-facts">${facts}</span>
                ${format.key === 'points' ? '<small class="hole-hint">Picked up? Tap the score.</small>' : ''}
            </div>
            <button type="button" class="step-hole${allIn && h < HOLES ? ' ready' : ''}" data-action="hole" data-hole="${h + 1}" aria-label="Next hole"${h === HOLES ? ' disabled' : ''}>›</button>
        </div></div>
        <div class="hole-progress" aria-hidden="true">${progress}</div>
        <div class="status-lines">${holeStatusLines()}</div>
        ${rows || '<p class="muted">Nobody to score. Tap Change group to pick your group.</p>'}
        <div class="next-bar${allIn ? ' ready' : ''}${nextKey && armLeft() > 0 ? ' arming' : ''}">
            <span class="nb-count">${h} of ${HOLES}</span>
            ${next}
        </div>
        <div class="btn-row score-links">
            <a class="t-btn small ghost" href="#setup">Change group</a>
            <a class="t-btn small ghost" href="#board">Live scores</a>
            ${betLinkHTML(sess)}
        </div>`;
    if (nextKey) {
        const bar = body.querySelector('.next-bar');
        S.nextShown.cover = barCoversSteppers(bar);
        const left = armLeft();
        bar.classList.toggle('arming', left > 0);
        if (left > 0) {
            setTimeout(() => {
                // Re-armed since (another tap on a stepper): that redraw set its own, later timer
                if (S.nextShown.key !== nextKey || armLeft() > 15) return;
                const now = $('score-body').querySelector('.next-bar');
                if (now) now.classList.remove('arming');
            }, left);
        }
    }
    const head = body.querySelector('.hole-head-wrap');
    if (head) document.documentElement.style.setProperty('--holehead', `${head.offsetHeight}px`);
    // The buttons were rebuilt: put keyboard focus back on the same control
    if (focusKey) {
        let target = null;
        if (['minus', 'plus', 'keypad'].includes(focusKey.action)) {
            target = body.querySelector(`[data-action="${focusKey.action}"][data-unit="${focusKey.unit}"]`);
        } else if (focusKey.label === 'Previous hole' || focusKey.label === 'Next hole') {
            target = body.querySelector(`[aria-label="${focusKey.label}"]`);
        } else if (focusKey.action === 'jump') {
            target = body.querySelector('.hole-jump');
        } else if (focusKey.action === 'hole') {
            // The Hole N+1 button: on to the first player of the new hole
            target = body.querySelector('[data-action="keypad"][data-unit="0"]');
        } else if (focusKey.href) {
            // A match card, Change group, Live scores, the card link: the same link again
            target = [...body.querySelectorAll('a[href]')].find(a => a.getAttribute('href') === focusKey.href) || null;
        }
        if (!target || target.disabled) target = body.querySelector('.hole-title h2');
        if (target) target.focus({ preventScroll: true });
    }
}

function goHole(n) {
    if (!S.sess) return;
    const next = Math.min(Math.max(n, 1), HOLES);
    const changed = next !== S.sess.hole;
    S.sess.hole = next;
    saveSession();
    renderScore();
    if (changed) {
        window.scrollTo(0, 0); // a new hole starts at the first player
        // Another phone in the group may have entered holes: catch up now and then
        if (Date.now() - (S.sess.syncedAt || 0) > 15000) refreshSession();
    }
}

function stepScore(unitIndex, delta) {
    const sess = S.sess;
    const unit = unitsOf(sess)[unitIndex];
    if (!unit) return;
    const h = sess.hole;
    const par = sess.pars[h - 1];
    const cap = SC.holeCap(formatOf(sess.roundNumber), par);
    const v = unitValue(unit, h);
    // First tap on an empty hole: + is par, − is a birdie
    let next = v === null ? (delta > 0 ? par : par - 1) : v + delta;
    next = Math.max(1, next);
    if (cap) next = Math.min(next, cap);
    if (next === v) return;
    setScore(unit, h, next);
    if (navigator.vibrate) navigator.vibrate(10);
    rearmNext();
    renderScore();
}

// Still fixing a score on a finished hole: the Hole N+1 button ignores taps again for a moment, so
// a run of taps on a stepper near it can't end on it
function rearmNext() {
    if (S.nextShown.key) S.nextShown.at = Date.now();
}
// How much longer the Hole N+1 button ignores taps (longer while it's pinned over a player's buttons,
// where the taps that reach it are meant for the stepper underneath)
function armLeft() {
    return (S.nextShown.cover ? NEXT_ARM_COVER_MS : NEXT_ARM_MS) - (Date.now() - S.nextShown.at);
}
function barCoversSteppers(bar) {
    if (!bar) return false;
    const b = bar.getBoundingClientRect();
    return [...$('score-body').querySelectorAll('.unit .stepper')].some(s => {
        const r = s.getBoundingClientRect();
        return r.bottom > b.top + 1 && r.top < b.bottom - 1;
    });
}

// ---------- Keypad and the jump-to-hole grid (one bottom sheet)
function openSheet(state, title, className, html, focusSelector) {
    S.keypad = Object.assign(state, { returnFocus: document.activeElement });
    $('keypad-title').textContent = title;
    $('keypad-buttons').className = className;
    $('keypad-buttons').innerHTML = html;
    $('keypad').hidden = false;
    // The page behind can't be reached (or scrolled) while the sheet is up
    ['tracker', 'site-header', 'tracker-nav'].forEach(id => { const el = $(id) || document.querySelector(`.${id}`); if (el) el.inert = true; });
    document.documentElement.style.overflow = 'hidden';
    // Back closes the sheet instead of leaving the page. Going back to the entry underneath mustn't
    // put back its old scroll over the new hole a pick in Go to hole just drew.
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    history.pushState({ keypad: 1 }, '', location.hash);
    const first = $('keypad-buttons').querySelector(focusSelector) || $('keypad-buttons').querySelector('button');
    if (first) first.focus();
}

// The score's name under each key near par ("Birdie", "Par", "Bogey"…)
const KEY_WORDS = { '-3': 'Albatross', '-2': 'Eagle', '-1': 'Birdie', 0: 'Par', 1: 'Bogey', 2: 'Double', 3: 'Triple' };

function openKeypad(unitIndex) {
    const sess = S.sess;
    const unit = unitsOf(sess)[unitIndex];
    if (!unit) return;
    const h = sess.hole;
    const par = sess.pars[h - 1];
    const format = formatOf(sess.roundNumber);
    const cap = SC.holeCap(format, par);
    const max = Math.max(10, par + 4);
    const keys = Array.from({ length: 10 }, (_, i) => {
        const n = i + 1 + (max > 10 ? max - 10 : 0);
        const word = n === 1 ? 'Ace' : KEY_WORDS[n - par];
        return `<button type="button" data-action="pick" data-value="${n}" class="${n === par ? 'par' : ''}"${cap && n > cap ? ' disabled' : ''}>${n}${word ? `<small> ${word}</small>` : ''}</button>`;
    }).join('');
    openSheet({ unitIndex }, `${unitName(unit)} · hole ${h} (par ${par})`, 'keypad',
        keys +
        (format.key === 'points' ? `<button type="button" class="wide" data-action="pick" data-value="${par + 2}">Picked up (0 pts)</button>` : '') +
        '<button type="button" class="wide" data-action="pick" data-value="">Clear this score</button><button type="button" class="wide" data-action="close-keypad">Cancel</button>',
        '.par');
}

// Tap the hole number: all 18 holes, scored ones in green, partly scored with a gold dot
function openJump() {
    const sess = S.sess;
    if (!sess || !sess.pars) return;
    const units = unitsOf(sess);
    const keys = Array.from({ length: HOLES }, (_, i) => {
        const hole = i + 1;
        const st = holeState(units, hole);
        return `<button type="button" data-action="jump-to" data-hole="${hole}" class="${st.done ? 'done' : st.part ? 'part' : ''}"${hole === sess.hole ? ' aria-current="true"' : ''} aria-label="Hole ${hole}, par ${sess.pars[i]}${st.done ? ', scored' : st.part ? ', partly scored' : ''}">${hole}<small>Par ${sess.pars[i]}</small></button>`;
    }).join('');
    openSheet({ jump: true }, 'Go to hole', 'keypad jump', keys + '<button type="button" class="wide" data-action="close-keypad">Cancel</button>', '[aria-current="true"]');
}

// fromHistory: Back already removed the sheet's history entry
function closeKeypad(fromHistory) {
    const k = S.keypad;
    if (!k) return;
    $('keypad').hidden = true;
    S.keypad = null;
    ['tracker', 'site-header', 'tracker-nav'].forEach(id => { const el = $(id) || document.querySelector(`.${id}`); if (el) el.inert = false; });
    document.documentElement.style.overflow = '';
    if (!fromHistory && history.state && history.state.keypad) history.back();
    if (k.returnFocus && document.contains(k.returnFocus)) k.returnFocus.focus({ preventScroll: true });
}

function pickFromKeypad(value) {
    const k = S.keypad;
    if (!k || !S.sess || k.jump) return;
    const unit = unitsOf(S.sess)[k.unitIndex];
    closeKeypad();
    if (!unit) return;
    setScore(unit, S.sess.hole, value === '' ? null : Number(value));
    rearmNext();
    renderScore();
    const again = document.querySelector(`#score-body [data-action="keypad"][data-unit="${k.unitIndex}"]`);
    if (again) again.focus({ preventScroll: true });
}

// ---------- Card
function renderCard() {
    const sess = S.sess;
    if (!sess) return;
    const body = $('card-body');
    if (!sess.pars) {
        body.innerHTML = '<p class="muted">Loading your round…</p>';
        return;
    }
    const format = formatOf(sess.roundNumber);
    const units = unitsOf(sess);
    const info = sess.info || null;
    // First names keep the name column narrow, so the hole cells get the room ("David O." when two
    // players share a first name; a pair shows one name per line). The full name is in the title and
    // in every cell's label.
    const names = cardNames(units.filter(u => u.ids.length === 1).map(u => u.ids[0]));
    const cardName = u => (u.ids.length > 1
        ? u.ids.map(id => `<span class="pair">${escHtml(firstName(nameOf(id)))}</span>`).join('')
        : escHtml(names[u.ids[0]]));
    const nine = from => nineHTML(from, sess.pars, info, units.map(u => {
        let sum = 0;
        const cells = nineHoles(from).map(h => {
            const v = unitValue(u, h);
            if (v !== null) sum += v;
            const kind = SC.scoreName(v, sess.pars[h - 1]);
            return { html: `<button type="button" data-action="card-hole" data-hole="${h}" data-pend-ids="${escHtml(u.ids.join(','))}" data-pend-hole="${h}" class="${kind || 'empty'}${unitPending(u, h) ? ' pend' : ''}" aria-label="${escHtml(unitName(u))}, hole ${h}: ${v !== null ? `${v}${kindText(kind)}` : 'no score'}">${v !== null ? digitHTML(v) : '·'}</button>` };
        });
        return { cls: u.team ? `t${u.team}` : '', head: cardName(u), title: unitName(u), cells, sum: sum || '–' };
    }));
    const totals = totalsHTML(format, sess.pars, units.map(u => ({ label: unitName(u), team: u.team, holes: unitHoles(u) })));

    body.innerHTML = `
        <div class="score-top">
            <div class="eyebrow">Round ${sess.roundNumber}${sess.courseName ? ` · ${escHtml(sess.courseName)}` : ''}</div>
            <div data-sync>${syncChipHTML()}</div>
        </div>
        <p class="muted small" style="margin-bottom: 10px;">Tap any score to fix it. A gold dot means it hasn’t reached the database yet.${info && info.teeName ? ` Yards are from the ${escHtml(info.teeName)}.` : ''}</p>
        ${nine(1)}
        ${nine(10)}
        ${cardKeyHTML()}
        ${totals}
        <div class="status-lines">${holeStatusLines()}</div>
        <div class="panel" style="margin-top: 14px;">
            <p class="small muted" style="margin-bottom: 12px;">Finished, or handing scoring to another phone? This only stops scoring on this phone. The round stays open for everyone else.</p>
            <button type="button" class="t-btn block" data-action="done">Done scoring on this phone</button>
        </div>`;
}

// ---------- Scorecard pieces (the Card, and a match's scorecard)
const nineHoles = from => Array.from({ length: 9 }, (_, i) => from + i);

// First names for a card's name column; "David O." for two who share one
function cardNames(ids) {
    const firsts = ids.map(id => firstName(nameOf(id)));
    const out = {};
    ids.forEach((id, i) => {
        out[id] = firsts.filter(f => f === firsts[i]).length > 1 ? shortName(nameOf(id)) : firsts[i];
    });
    return out;
}

// One nine of a scorecard (from = 1 or 10): hole numbers, yards, par and handicap (yards and handicap
// when the course has them), then the rows: [{ cls, head (HTML), title, cells: [9 × { html, cls }], sum }]
function nineHTML(from, pars, info, rows) {
    const holes = nineHoles(from);
    const parSum = holes.reduce((s, h) => s + (pars[h - 1] || 0), 0);
    const infoRow = (label, list, sum) => (list
        ? `<tr class="info"><td class="name">${label}</td>${holes.map(h => `<td>${list[h - 1]}</td>`).join('')}<td class="sum">${sum ? holes.reduce((s, h) => s + list[h - 1], 0) : ''}</td></tr>`
        : '');
    return `
        <div class="card-scroll">
            <table class="card">
                <thead><tr><th class="name" scope="col">${from === 1 ? 'Front' : 'Back'}</th>${holes.map(h => `<th scope="col">${h}</th>`).join('')}<th scope="col" class="sum">${from === 1 ? 'Out' : 'In'}</th></tr></thead>
                <tbody>
                    ${infoRow('Yds', info && info.yards, true)}
                    <tr class="par"><td class="name">Par</td>${holes.map(h => `<td>${pars[h - 1]}</td>`).join('')}<td class="sum">${parSum}</td></tr>
                    ${infoRow('Hcp', info && info.hcps, false)}
                    ${rows.map(r => `<tr class="${r.cls || ''}"><th class="name" scope="row"${r.title ? ` title="${escHtml(r.title)}"` : ''}>${r.head}</th>${r.cells.map(c => `<td${c.cls ? ` class="${c.cls}"` : ''}>${c.html}</td>`).join('')}<td class="sum">${r.sum}</td></tr>`).join('')}
                </tbody>
            </table>
        </div>`;
}

function cardKeyHTML(extra) {
    return `<p class="card-key"><span class="k birdie"><span class="digit" aria-hidden="true"></span>birdie</span><span class="k eagle"><span class="digit" aria-hidden="true"></span>eagle+</span><span class="k bogey"><span class="digit" aria-hidden="true"></span>bogey</span><span class="k double"><span class="digit" aria-hidden="true"></span>double+</span>${extra ? `<span class="k wide">${extra}</span>` : ''}</p>`;
}

// Out, In, Total and to par for each row (points too in a points round): [{ label, team, holes }]
function totalsHTML(format, pars, list) {
    const isPoints = format.key === 'points';
    const rows = list.map(r => {
        const t = SC.totals(r.holes, pars);
        const out = SC.totals(r.holes.slice(0, 9), pars.slice(0, 9));
        const inn = SC.totals(r.holes.slice(9), pars.slice(9));
        const missing = r.holes.filter(v => v === null).length;
        return `<tr class="${r.team ? `t${r.team}` : ''}">
            <td><span class="tt-name">${escHtml(r.label)}</span>${missing && t.thru ? `<span class="tt-sub">${missing} to go</span>` : ''}</td>
            <td>${out.thru ? out.strokes : '–'}</td><td>${inn.thru ? inn.strokes : '–'}</td>
            <td class="big">${t.thru ? t.strokes : '–'}</td><td class="big">${t.thru ? SC.fmtToPar(t.toPar) : '–'}</td>
            ${isPoints ? `<td class="big">${t.thru ? unitPoints(r.holes, pars) : '–'}</td>` : ''}
        </tr>`;
    }).join('');
    return `<div class="panel totals-panel"><table class="totals">
        <thead><tr><th scope="col">Totals</th><th scope="col">Out</th><th scope="col">In</th><th scope="col">Total</th><th scope="col">To par</th>${isPoints ? '<th scope="col"><span aria-hidden="true">Pts</span><span class="sr-only">Points</span></th>' : ''}</tr></thead>
        <tbody>${rows}</tbody>
    </table></div>`;
}

// ---------- Board
// A round number can have rounds on more than one day (a stray start on the wrong day, e.g. Thursday's
// practice round scored as Round 1, or a replay). Once the round's scheduled day has come, an earlier
// trip day is dropped before the board picks a day (boardRounds), so a stray never stands in for the
// Cup round, even before the first group starts or when the round is kept on paper. Of what's left, the
// scheduled day wins on its own day and, after that, as soon as it has any scores, so a stray day with
// more holes can't take its place. Otherwise show the day with the most scores; on a tie, the scheduled
// day, then the latest.
// Admin's Fill from Round Tracker (fillFromTracker in admin.js) follows the same rules.
function boardRounds(roundNumber, rounds) {
    const sched = scheduleOf(roundNumber);
    const tripStart = CFG.trip && CFG.trip.dates && CFG.trip.dates.start;
    if (!sched || !sched.date || !tripStart || localDay() < sched.date) return rounds;
    return rounds.filter(r => !(r.date && r.date >= tripStart && r.date < sched.date));
}

function pickBoardDay(roundNumber, rounds, rows) {
    const holesByDay = {};
    rounds.forEach(r => { holesByDay[r.date || ''] = holesByDay[r.date || ''] || 0; });
    const dayOf = new Map(rounds.map(r => [r.id, r.date || '']));
    rows.forEach(row => { holesByDay[dayOf.get(row.round_id)] += SC.countEntered(SC.holesOf(row)); });
    const sched = scheduleOf(roundNumber);
    // The scheduled day: today (even before anyone has a score in), or any day once it has scores
    if (sched && sched.date in holesByDay && (sched.date === localDay() || holesByDay[sched.date] > 0)) return sched.date;
    // Once trip-dated rounds exist, earlier (practice) days stay out
    const tripStart = CFG.trip && CFG.trip.dates && CFG.trip.dates.start;
    const inTrip = Object.keys(holesByDay).filter(d => tripStart && d >= tripStart);
    const days = inTrip.length ? inTrip : Object.keys(holesByDay);
    return days.sort((a, b) =>
        (holesByDay[b] - holesByDay[a]) ||
        ((sched && b === sched.date) - (sched && a === sched.date)) ||
        b.localeCompare(a))[0];
}

// The official Cup total, hand-entered by the commissioner in Admin (ryder_cup_scores row 1). It loads
// beside the board and never holds it up. The phone keeps the last total that loaded (also across
// visits, so the row doesn't push the board down when it lands); with none yet, the row stays hidden.
function cachedCup() {
    if (!SEASON_LIVE) return null;
    const c = readStore(CUP_KEY, null);
    return c && c.year === CUP_YEAR && Number.isFinite(c.blue) && Number.isFinite(c.red) ? { blue: c.blue, red: c.red } : null;
}

let cupLoading = false;
async function loadCup() {
    if (!SEASON_LIVE || !sb || cupLoading) return;
    cupLoading = true;
    try {
        const { data, error } = await sb.from('ryder_cup_scores').select('blue_score, red_score').eq('id', 1).maybeSingle();
        if (error) throw error;
        const cup = data ? { blue: Number(data.blue_score) || 0, red: Number(data.red_score) || 0 } : null;
        const changed = JSON.stringify(cup) !== JSON.stringify(S.cup);
        S.cup = cup;
        writeStore(CUP_KEY, cup ? { year: CUP_YEAR, blue: cup.blue, red: cup.red } : null);
        if (changed && S.view === 'board') renderBoard();
    } catch (err) {
        console.warn('Cup total failed:', err);
    } finally {
        cupLoading = false;
    }
}

// Each round's first tee time, set in Admin > Tee times. Anyone can read them. Like the Cup total it
// loads beside the board and never holds it up; every few minutes is plenty.
let teeLoading = false;
async function loadTeeTimes() {
    if (!sb || teeLoading || !CUP_YEAR || Date.now() - S.teeAt < TEE_REFRESH_MS) return;
    teeLoading = true;
    try {
        const { data, error } = await sb.rpc('trip_tee_times', { p_trip_year: Number(CUP_YEAR) });
        if (error) {
            if (isMissingFunction(error)) S.teeAt = Date.now(); // not set up: don't ask again for a while
            else throw error;
            return;
        }
        S.teeAt = Date.now();
        const times = cleanTeeTimes(data);
        const changed = JSON.stringify(times) !== JSON.stringify(S.teeTimes);
        S.teeTimes = times;
        writeStore(TEE_KEY, times);
        if (changed && S.view === 'board') renderBoard();
    } catch (err) {
        console.warn('Tee times failed:', err);
    } finally {
        teeLoading = false;
    }
}

// The crew's shared photo album (Admin > Photos, photos_2027.sql). The database hands the link only
// to approved players and admins, so it's asked once per login and kept in memory only, never in
// the board copy saved on the phone (a shared phone mustn't keep it after a log out).
let albumLoading = false;
async function loadAlbum() {
    const key = S.authUser ? `in:${S.authUser.id}` : null;
    if (!key) { S.album = null; return; }
    // Asked again now and then, so a link Admin saves while the page is open turns up
    if (!sb || albumLoading || (S.album && S.album.key === key && Date.now() - S.album.at < 10 * 60000)) return;
    albumLoading = true;
    try {
        const { data, error } = await sb.rpc('trip_album', { p_trip_year: Number(CUP_YEAR) });
        if (error) {
            if (isMissingFunction(error)) S.album = { key, url: null, at: Date.now() };
            else throw error;
            return;
        }
        const url = data && typeof data.url === 'string' && /^https:\/\/[^\s<>"']+$/i.test(data.url) ? data.url : null;
        const changed = !S.album || S.album.url !== url;
        // Logged out meanwhile: drop it
        S.album = S.authUser && `in:${S.authUser.id}` === key ? { key, url, at: Date.now() } : null;
        if (changed && S.view === 'board') renderBoard();
    } catch (err) {
        console.warn('Photo album failed:', err); // asked again on the next load
    } finally {
        albumLoading = false;
    }
}

// Every Cup round loads together (three requests in all), so the Cup total and the whole-trip table
// are always there and the round tabs switch instantly. B.data[n] per round, as before.
async function loadBoard(roundNumber, quiet) {
    const B = S.board;
    if (!sb || B.busy) return;
    loadCup();
    loadTeeTimes();
    loadAlbum();
    const numbers = [...new Set(tripRounds().map(r => r.number).concat(Number.isFinite(roundNumber) ? roundNumber : []))];
    B.busy = true;
    const tried = Date.now();
    numbers.forEach(n => { B.loading[n] = true; B.tried[n] = tried; });
    if (!quiet && onLiveView()) renderLive();
    try {
        const [found, allMatchups] = await Promise.all([
            sb.from('rounds').select('*').in('round_number', numbers).gte('date', WINDOW_START),
            sb.from('matchups').select('*').in('round_number', numbers)
        ]);
        if (found.error) throw found.error;
        // Filtered here, not in pickBoardDay: a round with nothing left draws the empty board
        const kept = numbers.flatMap(n => boardRounds(n, (found.data || []).filter(r => Number(r.round_number) === n)));
        let rows = [];
        if (kept.length) {
            const scores = await sb.from('scores').select('*').in('round_id', kept.map(r => r.id));
            if (scores.error) throw scores.error;
            rows = scores.data || [];
        }
        numbers.forEach(n => {
            // Matchups that didn't load: keep the ones this phone already had
            const matchups = allMatchups.error
                ? ((B.data[n] && B.data[n].matchups) || [])
                : (allMatchups.data || []).filter(m => Number(m.round_number) === n);
            const rounds = kept.filter(r => Number(r.round_number) === n);
            let data = { rounds: [], rows: [], matchups, pars: parsFor(null, n), courseName: '', courseId: null, date: null, info: holeInfoFor(n, null) };
            if (rounds.length) {
                const roundIds = new Set(rounds.map(r => r.id));
                const allRows = rows.filter(r => roundIds.has(r.round_id));
                const date = pickBoardDay(n, rounds, allRows);
                const sameDay = rounds.filter(r => (r.date || '') === date);
                const ids = new Set(sameDay.map(r => r.id));
                const course = S.courses.find(c => c.id === pickRound(sameDay).course_id);
                data = {
                    rounds: sameDay,
                    rows: allRows.filter(r => ids.has(r.round_id)),
                    matchups,
                    pars: parsFor(course, n),
                    courseName: course ? course.name : '',
                    courseId: course ? course.id : null,
                    date,
                    info: holeInfoFor(n, course ? course.id : null)
                };
            }
            B.data[n] = data;
            B.error[n] = null;
            B.at[n] = Date.now();
            // The matchups can fail on their own (the old ones are kept): a match view mustn't call a
            // match removed on the strength of that
            if (allMatchups.error) B.mErr[n] = allMatchups.error;
            else { B.mAt[n] = B.at[n]; B.mErr[n] = null; }
        });
        writeStore(BOARD_KEY, { since: WINDOW_START, data: B.data, at: B.at });
    } catch (err) {
        console.warn('Leaderboard failed:', err);
        numbers.forEach(n => { B.error[n] = err; });
    } finally {
        B.busy = false;
        numbers.forEach(n => { B.loading[n] = false; });
        if (onLiveView()) renderLive();
    }
}

// Everyone's holes in a round on the board, with this phone's own unsent (or not yet loaded)
// scores in, so they show right away
function boardHoles(n) {
    const data = S.board.data[n];
    const holesById = {};
    if (!data) return holesById;
    const byPlayer = {};
    data.rows.forEach(r => { (byPlayer[r.player_id] = byPlayer[r.player_id] || []).push(r); });
    Object.keys(byPlayer).forEach(pid => { holesById[pid] = SC.mergeHoles(byPlayer[pid]); });
    if (S.sess && S.sess.roundNumber === n && data.rounds.some(r => r.id === S.sess.roundId)) {
        S.sess.playerIds.forEach(pid => {
            const local = holesFor(pid);
            const server = holesById[pid] || Array(HOLES).fill(null);
            holesById[pid] = server.map((v, i) => (pendingFor(S.sess.roundId, pid, i + 1) || v === null ? local[i] : v));
        });
    }
    return holesById;
}

// The Cup across every round on the board. toWin: trip-config cup.pointsToWin (the rules), else
// worked out once every round's matches are set.
function cupState() {
    // How many matches a full round has: every player on the smaller team in one (two a side in team
    // formats). Players count once they're in some Cup round's matches, so a waitlisted player or one
    // still holding last year's team doesn't make every round look short. Unknown roster: no round
    // counts as complete, so nothing is decided.
    const inMatches = new Set();
    tripRounds().forEach(r => {
        const d = S.board.data[r.number];
        if (d) SC.matchesFrom(d.matchups).forEach(m => m.sides.forEach(s => s.ids.forEach(id => inMatches.add(String(id)))));
    });
    const team = t => S.players.filter(p => p.status !== 'potential' && Number(p.team_id) === t && inMatches.has(String(p.id))).length;
    const perSide = Math.min(team(1), team(2));
    const rounds = tripRounds().map(r => {
        const data = S.board.data[r.number];
        const format = formatOf(r.number);
        const matches = data ? SC.matchesFrom(data.matchups) : [];
        const expected = Math.floor(perSide / (format.teams ? 2 : 1));
        return {
            number: r.number,
            format,
            matches,
            holesById: boardHoles(r.number),
            pars: data ? data.pars : parsFor(null, r.number),
            loaded: !!data,
            complete: expected > 0 && matches.length >= expected
        };
    });
    const c = SC.cupTotals(rounds);
    // toWin and decided come from the real matchups (cupTotals). Before every round has them, a
    // trip-config cup.pointsToWin is only a placeholder for the display: it never names a winner.
    const fromConfig = Number(CFG.cup && CFG.cup.pointsToWin);
    if (!c.toWin && fromConfig > 0) c.toWin = fromConfig;
    else if (c.toWin && fromConfig > 0 && fromConfig !== c.toWin) console.warn('trip-config cup.pointsToWin is', fromConfig, 'but the matches add up to', c.toWin);
    // Rounds the board has loaded whose matches aren't all set (none yet, or not the whole roster)
    c.unset = rounds.filter(r => r.loaded && r.format.key !== 'stroke' && (!r.matches.length || !r.complete)).map(r => r.number);
    return { c, rounds };
}

// The commissioner's official Cup total (season live, once loaded): a line under the Cup scoreboard,
// or on its own when the scoreboard can't be drawn (nothing loaded yet, or older files on the phone)
function officialCupHTML(alone) {
    if (!SEASON_LIVE || !S.cup) return '';
    const f = SC.fmtPoints;
    const p = `<p class="ch-official">Official, from the commissioner: <span class="nowrap"><span class="team-1">Blue <b>${escHtml(f(S.cup.blue))}</b></span> – <span class="team-2"><b>${escHtml(f(S.cup.red))}</b> Red</span></span></p>`;
    return alone ? `<section class="cup-hero cup-official-only" aria-label="The Cup">${p}</section>` : p;
}

// A small tag under the Cup score: who's ahead on banked points and, once the target is known from
// the matchups, what the leader still needs ("Blue up 1½ · needs 3 more"). Nothing until a point is
// banked, and nothing once it's decided or tied (the line under the bar says so).
function cupLead(c, tied) {
    const f = SC.fmtPoints;
    if (c.decided || tied) return null;
    const banked = c.won[0] + c.won[1];
    if (!banked) return null;
    const diff = c.won[0] - c.won[1];
    const real = c.allSet && c.toWin ? c.toWin : null; // never the trip-config placeholder
    if (!diff) return { team: 0, text: real ? `Level · each needs ${f(real - c.won[0])} more` : 'Level' };
    const t = diff > 0 ? 1 : 2;
    return { team: t, text: `${TEAM_NAMES[t]} up ${f(Math.abs(diff))}${real ? ` · needs ${f(real - c.won[t - 1])} more` : ''}` };
}

// The top of Live scores: Blue and Red with the points they've banked, what wins it, a bar
// (solid: banked; light: where the matches under way are heading) and the commissioner's official
// total once the season is live
function cupHeroHTML(cup) {
    const c = cup.c;
    const f = SC.fmtPoints;
    const [wb, wr] = c.won.map(f);
    const [pb, pr] = c.projected.map(f);
    const inPlay = c.projected[0] + c.projected[1] > c.won[0] + c.won[1];
    // The size of the whole Cup: exact once every round has its matches; before that, what a
    // trip-config target implies; with neither, unknown (no bar, no "of N")
    const full = c.allSet ? c.total : (c.toWin ? Math.max(c.total, 2 * c.toWin - 1) : 0);
    const banked = c.won[0] + c.won[1];
    const tied = c.allSet && c.total > 0 && banked === c.total && c.won[0] === c.won[1];
    const unset = c.unset.length ? `<span>${c.unset.length > 1 ? 'Rounds' : 'Round'} ${c.unset.join(' & ')} matches aren’t all set yet</span>` : '';
    let line;
    if (c.decided) line = `<b>${TEAM_NAMES[c.decided]} wins the Cup.</b>`;
    else if (tied) line = `<b>Tied ${wb}–${wr}.</b> A team putting contest decides it (<a href="rules.html#playoff">the playoff</a>).`;
    else if (!c.total) line = 'The matches show here once the commissioner sets them.';
    else {
        const stake = full
            ? (c.started ? `${f(full - banked)} of ${f(full)} points still to play` : `${f(full)} points on the line.${c.toWin ? ` First to ${f(c.toWin)} wins.` : ''}`)
            : `${f(c.total - banked)} point${c.total - banked > 0 && c.total - banked <= 1 ? '' : 's'} to play in the matches set so far`;
        line = `${c.started && inPlay ? `<span>As it stands: <b>Blue ${pb}–${pr} Red</b></span><span class="ch-sep"> · </span>` : ''}<span>${stake}</span>${unset ? `<span class="ch-sep"> · </span>${unset}` : ''}`;
    }
    // Scaled to the whole Cup, so the line in the middle is the winning line (more than half wins)
    const pct = v => Math.max(0, Math.min(100, (100 * v) / full)).toFixed(2);
    const bar = full ? `<div class="ch-track" aria-hidden="true"><div class="ch-bar">
            <span class="p1" style="left: 0; width: ${pct(c.projected[0])}%"></span><span class="b1" style="width: ${pct(c.won[0])}%"></span>
            <span class="p2" style="right: 0; width: ${pct(c.projected[1])}%"></span><span class="b2" style="width: ${pct(c.won[1])}%"></span>
        </div></div>` : '';
    const official = officialCupHTML(false);
    const lead = cupLead(c, tied);
    const spoken = tied
        ? `The Cup is tied, Blue ${wb}, Red ${wr}. A team putting contest decides it.`
        : `The Cup: Blue ${wb}, Red ${wr}${c.toWin ? `, ${f(c.toWin)} to win` : ''}.${lead ? ` ${lead.text}.` : ''}`;
    return `<section class="cup-hero${c.decided ? ' decided' : ''}" aria-label="The Cup">
        <p class="sr-only">${escHtml(spoken)}</p>
        <div aria-hidden="true">
            <p class="ch-label">The Cup</p>
            <div class="ch-score">
                <div class="ch-team t1"><span class="ch-name">Blue</span><span class="ch-num">${wb}</span></div>
                <div class="ch-mid">${c.toWin ? `<span class="ch-towin">${f(c.toWin)}</span><span class="ch-towin-l">to win</span>` : '<span class="ch-vs">vs</span>'}</div>
                <div class="ch-team t2"><span class="ch-name">Red</span><span class="ch-num">${wr}</span></div>
            </div>
            ${lead ? `<p class="ch-lead${lead.team ? ` t${lead.team}` : ''}">${escHtml(lead.text)}</p>` : ''}
            ${bar}
        </div>
        <p class="ch-line">${line}</p>
        ${official}
    </section>`;
}

// "Kyle Smith", "Kyle Smith and Sam Cole", "Kyle Smith, Sam Cole and Ryan Ford", or the first two
// "and 3 others" for a long tie
function namesList(ids) {
    const list = ids.map(nameOf);
    if (list.length > 3) return `${list.slice(0, 2).join(', ')} and ${list.length - 2} others`;
    return list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : (list[0] || '');
}

// Once the Cup is won (or every match is in and it's tied): the trip's standouts, worked out from the
// scorecards, under the Cup on every round tab. While matches are still out it says so, and the
// numbers move as they finish.
function tripWrapHTML(cup) {
    if (typeof SC.tripHighlights !== 'function') return ''; // an older scoring.js on the phone
    const c = cup.c;
    const f = SC.fmtPoints;
    const banked = c.won[0] + c.won[1];
    const allIn = c.allSet && c.total > 0 && banked === c.total;
    const tied = allIn && c.won[0] === c.won[1];
    if (!c.decided && !tied) return '';
    const hl = SC.tripHighlights(cup.rounds.filter(r => r.loaded));
    let title;
    if (tied) title = `Tied ${f(c.won[0])}–${f(c.won[1])}. On to the playoff.`;
    else {
        const w = c.decided;
        title = allIn
            ? `${TEAM_NAMES[w]} wins the Cup ${f(c.won[w - 1])}–${f(c.won[2 - w])}`
            : `${TEAM_NAMES[w]} has clinched the Cup`;
    }
    const left = c.total - banked;
    const note = allIn ? 'From the scorecards.' : `${f(left)} point${left > 0 && left <= 1 ? '' : 's'} still being played: these update as the last matches finish.`;
    const rows = [];
    if (hl.topPoints) rows.push(['Top points', `${namesList(hl.topPoints.ids)} · ${f(hl.topPoints.value)} pt${hl.topPoints.value === 1 ? '' : 's'}`]);
    if (hl.mostBirdies) rows.push(['Most birdies', `${namesList(hl.mostBirdies.ids)} · ${hl.mostBirdies.value}`]);
    if (hl.lowRound) {
        const lr = hl.lowRound;
        const oneRound = lr.entries.every(e => e.round === lr.entries[0].round);
        const who = oneRound || lr.entries.length > 3
            ? namesList(lr.entries.map(e => e.id))
            : lr.entries.map(e => `${nameOf(e.id)} (Round ${e.round})`).join(', ');
        rows.push(['Low round', `${who} · ${lr.strokes} (${SC.fmtToPar(lr.toPar)})${oneRound ? `, Round ${lr.entries[0].round}` : ''}`]);
    }
    if (hl.biggestWin) {
        const list = hl.biggestWin.entries;
        const one = e => `${namesList(e.winners)} ${e.text} over ${namesList(e.losers)} (Round ${e.round})`;
        rows.push(['Biggest win', list.length > 2 ? `${one(list[0])}, and ${list.length - 1} more by ${list[0].text}` : list.map(one).join('; ')]);
    }
    return `<section class="trip-wrap" aria-label="Trip wrap-up">
        <p class="tw-label">Trip wrap-up</p>
        <h3 class="tw-title">${escHtml(title)}</h3>
        ${rows.length ? `<dl class="tw-list">${rows.map(([k, v]) => `<div><dt>${escHtml(k)}</dt><dd>${escHtml(v)}</dd></div>`).join('')}</dl>` : ''}
        <p class="tw-note">${escHtml(note)}</p>
    </section>`;
}

// The round's first tee time: the earliest match tee time set in Admin > Matchups, else the round's
// time from Admin > Tee times. { text: '8:10 AM', note } or null.
function firstTee(n, matches) {
    const times = (matches || []).map(teeTimeOf).filter(Boolean).sort();
    if (times.length) return { text: teeClock(times[0]), note: null };
    const sched = scheduleOf(n);
    const t = sched && sched.tee ? S.teeTimes[sched.tee] : null;
    return t ? { text: teeClock(t.time), note: t.note || null } : null;
}

// The line under the round tabs: "We-Ko-Pa - Cholla · Composite tees, 6,436 yds · first tee 7:20 AM ·
// Fri, Apr 9". Before any group starts, the course and day come from the trip plan.
function roundWhereHTML(n, data, matches) {
    const sched = scheduleOf(n);
    const cc = configCourse(n);
    const course = data.courseName || (sched && sched.what) || (cc ? cc.name : '');
    // A copy saved by an older version has no info: work it out
    const info = data.info !== undefined ? data.info : holeInfoFor(n, data.courseId);
    const tee = firstTee(n, matches);
    const date = data.date || (sched && sched.date);
    const parts = [course, teesText(info), tee ? `first tee ${tee.text}` : '', date ? fmtDay(date) : ''].filter(Boolean);
    return parts.length ? `<div class="bm-where">${parts.map(p => `<span class="nowrap">${escHtml(p)}</span>`).join(' · ')}</div>` : '';
}

// Before a round has any scores: a slim photo of its course, from the homepage's course photos, with
// the club's credit. Skipped when the round is being played somewhere else, or when the photo sizes
// file isn't on the phone (it would mean the full-size original).
function courseBandHTML(n, data) {
    const sizes = window.BBB_PHOTO_SIZES;
    const cc = configCourse(n);
    const img = cc && Array.isArray(cc.images) ? cc.images[0] : null;
    if (!sizes || !img || !img.src) return '';
    const db = dbCourseForRound(n);
    if (data.courseId && db && db.id !== data.courseId) return '';
    const p = sizes[img.src];
    if (!p || !Array.isArray(p.sizes) || !p.sizes.length) return '';
    const base = img.src.replace(/([^/]+)\.jpe?g$/i, 'sized/$1');
    const srcset = p.sizes.map(w => `${base}-${w}.jpg ${w}w`).join(', ');
    const src = `${base}-${p.sizes.find(w => w >= 640) || p.sizes[p.sizes.length - 1]}.jpg`;
    const sched = scheduleOf(n);
    const name = (sched && sched.what) || cc.name;
    // The homepage's course cards are id="course-<anchor>", one per club entry (a course that's one
    // of a club's options links to its club's card)
    const group = (CFG.courses || []).find(c => c.id === cc.id || (c.options || []).some(o => o.id === cc.id)) || cc;
    const anchor = group.anchor || group.id;
    // The club's credit sits small in the corner (the course guide on the homepage links the club)
    const credit = cc.credit && cc.credit.name ? `<span class="cb-credit">Photo: ${escHtml(cc.credit.name)}</span>` : '';
    return `<figure class="course-band" data-band="${escHtml(img.src)}">
        <img src="${escHtml(src)}" srcset="${escHtml(srcset)}" sizes="(max-width: 752px) calc(100vw - 32px), 688px" alt="" decoding="async" width="${Number(img.w) || 1600}" height="${Number(img.h) || 900}">
        ${credit}
        <figcaption><a class="cb-name" href="index.html#course-${escHtml(anchor)}">${escHtml(name)}<span aria-hidden="true">&nbsp;›</span><span class="sr-only">. The course guide</span></a></figcaption>
    </figure>`;
}

// One row per match on Live scores when the names fit beside how it stands; a card whose names
// don't fit stacks instead (both sides on top, the status under them), so a name is never cut off
function fitMatchCards(box) {
    const cards = [...box.querySelectorAll('.match-card')];
    cards.forEach(card => card.classList.remove('stack'));
    const tight = cards.filter(card => [...card.querySelectorAll('.mc-side span')].some(s => s.scrollWidth > s.clientWidth + 1));
    tight.forEach(card => card.classList.add('stack'));
}

// The bottom of Live scores: share the public link, and the crew's photo album once Admin has saved it
function boardLinksHTML() {
    const album = S.album && S.authUser && S.album.key === `in:${S.authUser.id}` ? S.album.url : null;
    return `<div class="board-links">
        <div class="btn-row">
            <button type="button" class="t-btn" data-action="board-share">Share live scores</button>
            ${album ? `<a class="t-btn" href="${escHtml(album)}" target="_blank" rel="noopener">Trip photos<span class="sr-only"> (the shared album, opens in a new tab)</span></a>` : ''}
        </div>
        <p class="muted small">Family and friends back home can follow every match here. No login needed, and bets stay private.</p>
    </div>`;
}

// Phones get the share sheet (straight into a text); computers copy the link
async function shareLive() {
    const payload = { title: 'Live scores', text: `Follow the ${(CFG.trip && CFG.trip.name) || 'Bros before Boges'} Cup live:`, url: LIVE_URL };
    const coarse = !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (typeof navigator.share === 'function' && coarse) {
        try {
            await navigator.share(payload);
            return;
        } catch (e) {
            if (e && e.name === 'AbortError') return;
            // No share sheet after all: copy instead
        }
    }
    let ok = false;
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(LIVE_URL); ok = true; }
    } catch (e) { ok = false; }
    if (!ok) {
        const had = document.activeElement;
        const box = document.createElement('textarea');
        box.value = LIVE_URL;
        box.setAttribute('readonly', '');
        box.style.cssText = 'position: fixed; top: 0; left: 0; opacity: 0;';
        document.body.appendChild(box);
        box.select();
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        box.remove();
        if (had && had.focus) had.focus({ preventScroll: true });
    }
    showToast(ok ? 'Link copied. Paste it into a text.' : `Couldn’t copy it. The link is ${LIVE_URL}`, ok ? 'success' : 'error');
}

function defaultBoardRound() {
    if (S.sess && S.sess.roundNumber) return S.sess.roundNumber;
    return scheduledRoundToday() || (tripRounds()[0] || { number: 1 }).number;
}

// The round's Cup points. The big numbers are the live projection (every match as it stands), with
// what's already banked under them; once every match is final they're the result. Before any match
// has started, just what the round is worth (and `empty`, the no-scores line).
function boardHeadHTML(n, format, matches, holesById, pars, empty) {
    const results = matches.map(m => SC.matchResult(format, m, holesById, pars));
    const onLine = results.reduce((sum, r) => sum + r.parts.length, 0); // a point per match, or per nine in split
    const onLineText = `${onLine} point${onLine === 1 ? '' : 's'} on the line`;
    if (!results.some(r => r.started)) {
        return `<div class="panel board-head"><p class="bh-stake">${onLineText} this round</p>${empty}</div>`;
    }
    const pts = SC.roundPoints(format, matches, holesById, pars);
    const final = results.every(r => r.final);
    const [b, r] = (final ? pts.won : pts.projected).map(SC.fmtPoints);
    const [wb, wr] = pts.won.map(SC.fmtPoints);
    // Once points are banked, say what's still in play ("4 of 8"), not the round's whole worth
    const banked = pts.won[0] + pts.won[1];
    const stakeText = banked > 0 ? `${SC.fmtPoints(onLine - banked)} of ${onLine} points still on the line` : `${onLineText} this round`;
    const label = final ? `Round ${n} final` : `Round ${n} · if it ended now`;
    const spoken = `${label}: Blue ${b}, Red ${r}.${final ? '' : ` Banked so far ${wb} to ${wr}. ${stakeText}.`}`;
    return `<div class="panel board-head${final ? ' final' : ''}">
        <p class="sr-only">${spoken}</p>
        <div aria-hidden="true">
            <p class="bh-label">${label}</p>
            <div class="bh-score">
                <span class="bh-team team-1">Blue</span><span class="bh-num team-1">${b}</span>
                <span class="bh-dash">–</span>
                <span class="bh-num team-2">${r}</span><span class="bh-team team-2">Red</span>
            </div>
            ${final ? '' : `<p class="bh-line"><span>Banked so far: <b>${wb}–${wr}</b></span><span class="bh-sep"> · </span><span>${stakeText}</span></p>`}
        </div>
    </div>`;
}

// "2:14 PM", or "Fri 2:14 PM" for scores kept on the phone from an earlier day
function updatedAt(ms) {
    const d = new Date(ms);
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return localDay(d) === localDay() ? time : `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${time}`;
}

function renderBoard() {
    const B = S.board;
    if (B.round === null) B.round = defaultBoardRound();
    const n = B.round;
    const body = $('board-body');
    const rounds = tripRounds();
    const data = B.data[n];
    const format = formatOf(n);
    // Round 1, with its day and course under it
    const tabs = `<div class="round-tabs" role="group" aria-label="Round">${rounds.map(r => {
        const cc = configCourse(r.number);
        const course = cc ? (cc.shortName || cc.name) : '';
        const sub = `${escHtml(r.day || '')}${course ? `<span class="rt-course">${r.day ? ' · ' : ''}${escHtml(course)}</span>` : ''}`;
        return `<button type="button" data-action="board-round" data-round="${r.number}" aria-pressed="${r.number === n}">Round ${r.number}${sub ? `<small>${sub}</small>` : ''}</button>`;
    }).join('')}</div>`;
    const centerTabs = () => centerInStrip(body.querySelector('.round-tabs'), '[aria-pressed="true"]');
    // Worked out once per draw: the Cup, the wrap-up and the whole-trip table all read it
    const cup = SC_FULL && rounds.some(r => B.data[r.number]) ? cupState() : null;
    const hero = cup ? cupHeroHTML(cup) + tripWrapHTML(cup) : officialCupHTML(true);

    if (!data) {
        swapKeepingFocus(body, hero + tabs + (B.error[n] ? boardErrorHTML(B.error[n]) : '<p class="muted">Loading…</p>'));
        centerTabs();
        // Failed tries wait like successful ones do (the timer, Refresh and the signal coming back retry)
        if (!B.busy && (!B.error[n] || Date.now() - (B.tried[n] || 0) > BOARD_STALE_MS)) loadBoard(n);
        return;
    }
    if (!B.busy && Date.now() - (B.tried[n] || 0) > BOARD_STALE_MS) setTimeout(() => loadBoard(n, true), 0);

    const holesById = boardHoles(n);
    const matches = SC.matchesFrom(data.matchups);
    const mine = new Set(S.sess && S.sess.roundNumber === n ? S.sess.playerIds : (S.me ? [S.me.id] : []));

    // A group that pressed Start has blank rows: those aren't scores yet
    const anyScores = Object.values(holesById).some(h => SC.countEntered(h) > 0);

    // The format by the rules' name, what it is, and a link to how it's scored; then where and when
    const info = formatInfo(format);
    let html = hero + tabs + (anyScores ? '' : courseBandHTML(n, data));
    html += `<div class="board-meta">
        <div><div class="eyebrow">${escHtml(info.name)}</div><p class="fmt-line">${formatLineHTML(info.about, info, true)}</p>${roundWhereHTML(n, data, matches)}</div>
        <div class="btn-row">
            <span class="muted small">${B.at[n] ? `Updated ${updatedAt(B.at[n])}` : ''}</span>
            <button type="button" class="t-btn small" data-action="board-refresh"${B.loading[n] ? ' aria-busy="true"' : ''}>${B.loading[n] ? 'Updating…' : 'Refresh'}</button>
        </div>
    </div>`;
    if (B.error[n]) html += `<div class="notice error">Couldn’t update just now${isNetworkError(B.error[n]) ? ' (no signal)' : ''}. Showing the last scores that loaded.</div>`;

    // On a practice day nothing is being kept: say when the Cup starts instead of "as groups enter them"
    const prac = practiceToday();
    const tee = firstTee(n, matches);
    const emptyNext = !prac ? `${tee ? `First tee ${tee.text}${tee.note ? ` (${tee.note})` : ''}. ` : ''}They show up here as groups enter them.`
        : prac.next ? `Today’s round is a practice round, so nothing counts until Round ${prac.next.number}, ${prac.next.day}.`
            : 'Today’s round is a practice round: no Cup points.';
    const empty = `<p class="board-empty">No scores for Round ${n} yet. ${escHtml(emptyNext)}</p>`;
    if (matches.length && format.key !== 'stroke') html += boardHeadHTML(n, format, matches, holesById, data.pars, anyScores ? '' : empty);
    else if (!anyScores) html += `<div class="panel">${empty}</div>`;

    if (matches.length && format.key !== 'stroke') {
        html += mineFirst(matches, mine).map(m => {
            const r = SC.matchResult(format, m, holesById, data.pars);
            const colors = m.sides.map(s => s.team);
            const isMine = m.sides.some(s => s.ids.some(id => mine.has(id)));
            // Team formats say "Blue 2 UP"; singles say "Kyle 2 UP"
            const sideNames = m.sides.map(s => s.ids.map(id => (s.ids.length > 1 ? firstName(nameOf(id)) : nameOf(id))).join(' & '));
            const who = format.teams
                ? [TEAM_NAMES[colors[0]] || sideNames[0], TEAM_NAMES[colors[1]] || sideNames[1]]
                : sideNames.map(firstName);
            const pills = r.parts.map(p => {
                const leader = p.lead > 0 ? 0 : p.lead < 0 ? 1 : -1;
                const cls = leader >= 0 && p.started ? `t${colors[leader]}` : '';
                return `<span class="pill ${cls}${p.final ? ' final' : ''}">${p.label ? `${escHtml(p.label)}: ` : ''}${escHtml(SC.partText(p, who))}</span>`;
            }).join('');
            // One name per line: a pair's partners stack, a singles player's first and last name stack
            // (like a draw sheet), so the card keeps to one row on a phone
            const nameLines = (id, pair) => {
                if (pair) return [firstName(nameOf(id))];
                const parts = nameOf(id).trim().split(/\s+/);
                return parts.length > 1 ? [parts[0], parts.slice(1).join(' ')] : parts;
            };
            const side = (s, i) => `<div class="mc-side ${i ? 'b' : 'a'} t${s.team}">${s.ids.flatMap(id => nameLines(id, s.ids.length > 1)).map(t => `<span>${escHtml(t)}</span>`).join('')}</div>`;
            const tt = teeTimeOf(m);
            return `<a class="match-card${isMine ? ' mine' : ''}" data-key="match-${escHtml(String(m.id))}" href="${escHtml(matchHref(n, m.id))}">
                <div class="mc-cap"><span>Match ${m.number}${tt ? ` · ${escHtml(teeClock(tt))}` : ''}${isMine ? ' · <span class="mine-tag">yours</span>' : ''}</span><span class="mc-go" aria-hidden="true">›</span></div>
                <div class="mc-row">${side(m.sides[0], 0)}<div class="mc-status">${pills}</div>${side(m.sides[1], 1)}</div>
                <span class="sr-only">. Open the scorecard</span>
            </a>`;
        }).join('');
    }

    html += playerTableHTML(n, format, data, holesById, matches, cup);
    html += boardLinksHTML();
    // The course photo stays the same element across redraws (every refresh rebuilds the board), so
    // it never flickers or loads again
    const oldPhoto = body.querySelector('.course-band img');
    swapKeepingFocus(body, html);
    const band = body.querySelector('.course-band');
    if (band) {
        const img = band.querySelector('img');
        const same = oldPhoto && !body.contains(oldPhoto) && oldPhoto.dataset.band === band.dataset.band;
        // One that failed (no signal) isn't kept: the fresh one tries again, out of sight until it loads
        const failed = same && oldPhoto.complete && oldPhoto.naturalWidth === 0;
        if (same && !failed) img.replaceWith(oldPhoto);
        const shown = band.querySelector('img');
        shown.dataset.band = band.dataset.band;
        // No signal and not kept on the phone yet: no broken image, just the line below
        const hide = () => { band.hidden = true; };
        if (shown.complete && shown.naturalWidth === 0 && shown.currentSrc) hide();
        else {
            if (failed && !(shown.complete && shown.naturalWidth > 0)) {
                band.hidden = true;
                shown.addEventListener('load', () => { band.hidden = false; }, { once: true });
            }
            shown.addEventListener('error', hide, { once: true });
        }
    }
    fitMatchCards(body);
    centerTabs();
}

// The player table under the matches: this round (each player's own card) or the whole trip
// (record, Cup points and birdies). A player opens his match's scorecard.
function playerTableHTML(n, format, data, holesById, matches, cupNow) {
    const B = S.board;
    const scope = B.scope === 'trip' ? 'trip' : 'round';
    const head = (title, note) => `<div class="bt-head"><h3 class="bt-title">${title}</h3>
        <div class="scope" role="group" aria-label="Show">
            <button type="button" data-action="board-scope" data-scope="round" aria-pressed="${scope === 'round'}">Round ${n}</button>
            <button type="button" data-action="board-scope" data-scope="trip" aria-pressed="${scope === 'trip'}">Whole trip</button>
        </div></div>${note ? `<p class="bt-note">${note}</p>` : ''}`;
    // Phones show "David O." so each player keeps to one line; two who'd look alike keep full names
    const nameCellFor = list => {
        const shortCount = {};
        list.forEach(u => { const s = u.side ? u.label : shortName(u.label); shortCount[s] = (shortCount[s] || 0) + 1; });
        return u => {
            const s = u.side ? u.label : shortName(u.label);
            const text = s !== u.label && shortCount[s] === 1
                ? `<span class="nm-full">${escHtml(u.label)}</span><span class="nm-short">${escHtml(s)}</span>`
                : escHtml(u.label);
            return u.href ? `<a class="row-link"${u.key ? ` data-key="${escHtml(u.key)}"` : ''} href="${escHtml(u.href)}">${text}</a>` : text;
        };
    };
    // Ties share a position: T2, T2, 4
    const positions = (list, rank) => list.map(u => {
        const first = list.findIndex(x => rank(x) === rank(u));
        return `${list.filter(x => rank(x) === rank(u)).length > 1 ? 'T' : ''}${first + 1}`;
    });

    if (scope === 'trip' && !SC_FULL) return `<div class="panel board-table">${head('Player records')}<p class="board-empty" style="padding-bottom: 10px;">Live scores is still updating on this phone. It fills in once the signal’s back (or close and reopen the page).</p></div>`;
    if (scope === 'trip') {
        const cup = cupNow || cupState();
        const rec = SC.playerRecords(cup.rounds.filter(r => r.loaded));
        const ids = new Set(Object.keys(rec));
        cup.rounds.forEach(r => r.matches.forEach(m => m.sides.forEach(s => s.ids.forEach(id => ids.add(id)))));
        if (!ids.size) return `<div class="panel board-table">${head('Player records')}<p class="board-empty" style="padding-bottom: 10px;">The table fills in once the matches are set.</p></div>`;
        const list = [...ids].map(id => ({ id, label: nameOf(id), team: teamOf(id), r: rec[id] || { w: 0, l: 0, h: 0, pts: 0, birdies: 0 } }))
            .sort((a, b) => b.r.pts - a.r.pts || b.r.w - a.r.w || b.r.birdies - a.r.birdies || a.label.localeCompare(b.label));
        const pos = positions(list, u => u.r.pts);
        const nameCell = nameCellFor(list);
        return `<div class="panel board-table">${head('Player records', 'Finished matches count (each nine in the Split Decision). Every player on a side gets its result.')}
            <table class="standings">
                <thead><tr><th scope="col">#</th><th scope="col">Player</th><th scope="col"><span aria-hidden="true">W-L-H</span><span class="sr-only">Won, lost, halved</span></th><th scope="col"><span aria-hidden="true">Pts</span><span class="sr-only">Cup points</span></th><th scope="col">Birdies</th></tr></thead>
                <tbody>${list.map((u, i) => `<tr><td class="pos">${pos[i]}</td><td class="nm ${u.team ? `team-${u.team}` : ''}">${nameCell(u)}</td><td>${u.r.w}-${u.r.l}-${u.r.h}</td><td class="lead-col">${escHtml(SC.fmtPoints(u.r.pts))}</td><td>${u.r.birdies}</td></tr>`).join('')}</tbody>
            </table>
        </div>`;
    }

    // This round: everyone's own card, gross score to par (one ball per pair in one-ball formats). In
    // team points rounds each player's quota points lead, the same number his Score view shows.
    const isPoints = format.key === 'points';
    const ids = Object.keys(holesById);
    const matchOf = id => matches.find(m => m.sides.some(s => s.ids.includes(id)));
    const hrefFor = id => { const m = matchOf(id); return m && format.key !== 'stroke' ? matchHref(n, m.id) : null; };
    let units = [];
    if (ids.length) {
        if (format.sharedBall && matches.length) {
            const used = new Set();
            matches.forEach(m => m.sides.forEach(s => {
                const inRows = s.ids.filter(id => holesById[id]);
                if (!inRows.length) return;
                units.push({ label: s.ids.map(id => firstName(nameOf(id))).join(' & '), side: true, team: s.team, holes: SC.sideHoles(format, { ids: inRows }, holesById, data.pars), href: matchHref(n, m.id), key: `s-${m.id}-${s.team}` });
                s.ids.forEach(id => used.add(id));
            }));
            ids.filter(id => !used.has(id)).forEach(id => units.push({ label: nameOf(id), team: teamOf(id), holes: holesById[id], href: hrefFor(id), key: `p-${id}` }));
        } else {
            units = ids.map(id => ({ label: nameOf(id), team: teamOf(id), holes: holesById[id], href: hrefFor(id), key: `p-${id}` }));
        }
    }
    // Points rounds rank on points against par pace (a par is 2), so a group that teed off later
    // isn't buried under one that has simply played more holes; at the finish it's the raw points order
    const pace = u => u.pts - 2 * u.t.thru;
    const rows = units.map(u => ({ ...u, t: SC.totals(u.holes, data.pars), pts: isPoints ? unitPoints(u.holes, data.pars) : 0 })).filter(u => u.t.thru)
        .sort((a, b) => (isPoints ? pace(b) - pace(a) : 0) || a.t.toPar - b.t.toPar || b.t.thru - a.t.thru || a.label.localeCompare(b.label));
    const title = isPoints ? 'Players · team points' : `${format.sharedBall ? 'Team cards' : 'Players'} · gross`;
    if (!rows.length) return `<div class="panel board-table">${head(title)}<p class="board-empty" style="padding-bottom: 10px;">No scores for Round ${n} yet.</p></div>`;
    // Ties share a position (on points against pace in a points round, else on to par)
    const pos = positions(rows, u => (isPoints ? pace(u) : u.t.toPar));
    const nameCell = nameCellFor(rows);
    return `<div class="panel board-table">${head(title)}
        <table class="standings${isPoints ? ' has-pts' : ''}">
            <thead><tr><th scope="col">#</th><th scope="col">${format.sharedBall ? 'Team' : 'Player'}</th>${isPoints ? '<th scope="col"><span aria-hidden="true">Pts</span><span class="sr-only">Points</span></th>' : ''}<th scope="col">To par</th><th scope="col">Thru</th><th scope="col" class="col-strokes">Strokes</th></tr></thead>
            <tbody>${rows.map((u, i) => `<tr><td class="pos">${pos[i]}</td><td class="nm ${u.team ? `team-${u.team}` : ''}">${nameCell(u)}</td>${isPoints ? `<td class="lead-col">${u.pts}</td>` : ''}<td${isPoints ? '' : ' class="lead-col"'}>${SC.fmtToPar(u.t.toPar)}</td><td>${u.t.thru === HOLES ? 'F' : u.t.thru}</td><td class="col-strokes">${u.t.strokes}</td></tr>`).join('')}</tbody>
        </table>
    </div>`;
}

// ---------- A match's scorecard (#match=2-<id>): both sides hole by hole, with the margin between
function renderMatch() {
    const ref = S.matchRef;
    const body = $('match-body');
    const title = $('match-title');
    const B = S.board;
    if (!ref) return;
    const n = ref.round;
    B.round = n; // Back to Live scores lands on this round
    const data = B.data[n] || null;
    const format = formatOf(n);
    const stale = () => Date.now() - (B.tried[n] || 0) > BOARD_STALE_MS;
    if (!sb) loadSupabase();
    else if (!B.busy && (data ? stale() : (!B.error[n] || stale()))) setTimeout(() => loadBoard(n, true), 0);

    // The match: from the board, or (this phone's own round, before the board has it, or with no
    // signal) from the group this phone is scoring, with its pars and its own scores
    const own = S.sess && S.sess.roundNumber === n ? S.sess : null;
    const findIn = list => SC.matchesFrom(list || []).find(x => String(x.id) === String(ref.id));
    // A board loaded on this visit, matchups included (a copy kept on the phone from before, or old
    // matchups kept when theirs failed, doesn't count)
    const fresh = !!data && !!B.tried[n] && !B.error[n] && !B.loading[n] && (B.at[n] || 0) >= B.tried[n] && (B.mAt[n] || 0) >= B.tried[n];
    // No database client once start-up has checked (before that it's just loading)
    const noClient = !sb && S.ready;
    let m = data ? findIn(data.matchups) : null;
    // The group's own matchups stand in until the board answers, or when they're newer than it
    if (!m && own && (!fresh || (own.syncedAt || 0) > (B.mAt[n] || 0))) m = findIn(own.matchups);
    if (!m || format.key === 'stroke') {
        title.innerHTML = `Round ${n} <span class="accent">match</span>`;
        const err = B.error[n] || B.mErr[n];
        swapKeepingFocus(body, fresh || format.key === 'stroke'
            ? '<div class="notice">That match isn’t on the board any more (the commissioner may have changed the matchups).</div><a class="t-btn block" href="#board">See every match</a>'
            : err ? boardErrorHTML(err)
                : noClient ? '<div class="notice error">No connection to the score database yet (no signal?). It loads once the signal’s back.</div>'
                    : '<p class="muted">Loading…</p>');
        return;
    }
    title.innerHTML = `Round ${n} · <span class="accent">Match ${m.number}</span>`;
    const onBoard = !!(data && data.rounds.length);
    const pars = onBoard ? data.pars : own ? own.pars : (data ? data.pars : parsFor(null, n));
    const holeInfo = onBoard ? data.info : own ? (own.info || null) : (data ? data.info : null);
    const courseName = onBoard ? data.courseName : own ? own.courseName : '';
    const day = onBoard ? data.date : own ? own.date : null;
    const holesById = boardHoles(n);
    // This phone's own scores, sent or not (boardHoles adds them only once the board has the round)
    const overlay = !!own && (!onBoard || data.rounds.some(r => r.id === own.roundId));
    if (overlay) {
        own.playerIds.forEach(pid => {
            const local = (own.holes && own.holes[pid]) || Array(HOLES).fill(null);
            const server = holesById[pid] || Array(HOLES).fill(null);
            holesById[pid] = server.map((v, i) => (pendingFor(own.roundId, pid, i + 1) || v === null ? local[i] : v));
        });
    }
    const problem = B.error[n] || noClient;
    const res = SC.matchResult(format, m, holesById, pars);
    const mg = SC_FULL ? SC.holeMargins(format, m, holesById, pars) : null;
    const info = formatInfo(format);
    const sideNames = m.sides.map(s => s.ids.map(id => (s.ids.length > 1 ? firstName(nameOf(id)) : nameOf(id))).join(' & '));
    const who = format.teams ? m.sides.map((s, i) => TEAM_NAMES[s.team] || sideNames[i]) : sideNames.map(firstName);
    const pills = res.parts.map(p => {
        const leader = p.lead > 0 ? 0 : p.lead < 0 ? 1 : -1;
        const cls = leader >= 0 && p.started ? `t${m.sides[leader].team}` : '';
        return `<span class="pill ${cls}${p.final ? ' final' : ''}">${p.label ? `${escHtml(p.label)}: ` : ''}${escHtml(SC.partText(p, who))}</span>`;
    }).join('');

    // The rows: each player's own card, or one row per side when partners share a ball
    const names = cardNames(m.sides.flatMap(s => s.ids));
    const cell = (v, par) => {
        const kind = SC.scoreName(v, par);
        return { html: v !== null ? `<span class="cell ${kind}">${digitHTML(v)}</span>` : '<span class="cell empty">·</span>' };
    };
    const sideRows = (s, i) => (format.sharedBall
        ? [{ team: s.team, head: s.ids.map(id => `<span class="pair">${escHtml(firstName(nameOf(id)))}</span>`).join(''), label: sideNames[i], holes: mg ? (i ? mg.b : mg.a) : SC.sideHoles(format, s, holesById, pars) }]
        : s.ids.map(id => ({ team: s.team, head: escHtml(names[id]), label: nameOf(id), holes: holesById[id] || Array(HOLES).fill(null) })));
    const all = m.sides.map(sideRows);
    // The margin after a hole: "B2" (Blue 2 up, or ahead by 2), "AS" all square ("Tie" in a stroke
    // or points contest); the shading is the side that took the hole
    const marginText = x => {
        if (!x || x.lead === null) return x && x.over ? '<span class="l0">–</span>' : '';
        if (x.lead === 0) return `<span class="l0">${mg.kind === 'match' ? 'AS' : 'Tie'}</span>`;
        const side = m.sides[x.lead > 0 ? 0 : 1];
        return `<span class="l${side.team}">${teamLetter(side.team)}${Math.abs(x.lead)}</span>`;
    };
    const lastMargin = (from, to) => {
        for (let h = to; h >= from; h--) if (mg.holes[h - 1] && mg.holes[h - 1].lead !== null) return marginText(mg.holes[h - 1]);
        return '';
    };
    const nineRows = from => {
        const row = r => {
            const vals = nineHoles(from).map(h => r.holes[h - 1]);
            const sum = vals.reduce((t, v) => t + (v || 0), 0);
            return { cls: `t${r.team}`, head: r.head, title: r.label, cells: nineHoles(from).map(h => cell(r.holes[h - 1], pars[h - 1])), sum: vals.some(v => v !== null) ? sum : '–' };
        };
        if (!mg) return all[0].map(row).concat(all[1].map(row));
        const margin = {
            cls: 'margin', head: 'Margin', title: '',
            cells: nineHoles(from).map(h => {
                const x = mg.holes[h - 1];
                const won = x && !x.over && x.win ? m.sides[x.win - 1].team : 0;
                return { html: marginText(x), cls: won ? `w${won}` : '' };
            }),
            // A split nine is its own contest; otherwise the running margin through the nine (blank
            // until a hole on it counts)
            sum: mg.kind === 'strokes' || !lastMargin(from, from + 8) ? lastMargin(from, from + 8) : lastMargin(1, from + 8)
        };
        return all[0].map(row).concat(margin, all[1].map(row));
    };
    const keyNote = `Margin: who’s up after each hole (${teamLetter(m.sides[0].team)} = ${escHtml(TEAM_NAMES[m.sides[0].team] || 'side A')}, ${teamLetter(m.sides[1].team)} = ${escHtml(TEAM_NAMES[m.sides[1].team] || 'side B')}). A shaded box is the side that took the hole.${format.key === 'points' ? ' In team points the margin is in points.' : format.key === 'split' ? ' Each nine is its own stroke contest.' : ''}`;

    const notice = problem
        ? `<div class="notice error">Couldn’t update just now${noClient || isNetworkError(B.error[n]) ? ' (no signal)' : ''}. Showing ${onBoard ? 'the last scores that loaded' : 'what’s on this phone'}${overlay && onBoard ? ' and this phone’s own' : ''}.</div>`
        : '';

    swapKeepingFocus(body, `
        <p class="mv-sub">${[info.name, courseName, teesText(holeInfo), day ? fmtDay(day) : '', teeTimeOf(m) ? `tee time ${teeClock(teeTimeOf(m))}` : '']
            .filter(Boolean).map(p => `<span class="nowrap">${escHtml(p)}</span>`).join(' · ')}</p>
        ${notice}
        <div class="mv-sides">${m.sides.map((s, i) => `<div class="mc-side ${i ? 'b' : 'a'} t${s.team}">${s.ids.map(id => `<span>${escHtml(nameOf(id))}</span>`).join('')}</div>`).join('')}</div>
        <div class="mv-status">${pills}</div>
        ${nineHTML(1, pars, holeInfo, nineRows(1))}
        ${nineHTML(10, pars, holeInfo, nineRows(10))}
        ${cardKeyHTML(mg ? keyNote : '')}
        ${totalsHTML(format, pars, all.flat())}
        ${problem ? '' : `<p class="muted small">${B.at[n] ? `Updated ${updatedAt(B.at[n])}. ` : ''}It refreshes by itself as scores come in.</p>`}`);
}

function boardErrorHTML(err) {
    // Anyone can read the board: logging in only helps when the database turned a signed-out visitor away
    if (!S.authUser && (isAuthError(err) || isRefused(err))) {
        return `<div class="notice">Log in to see live scores. <a href="bookie.html?next=board&amp;mode=login">Log in</a></div>`;
    }
    return `<div class="notice error">Couldn’t load live scores${isNetworkError(err) ? ' (no signal)' : ''}.</div><button type="button" class="t-btn block" data-action="board-refresh">Try again</button>`;
}

// ==========================================
// Events
// ==========================================
function onClick(e) {
    // A match card or player link on Live scores: note which, so Back from the match lands on it
    const ml = e.target.closest('#board-body a[href^="#match="]');
    if (ml) S.tappedMatch = { key: ml.dataset.key || null, top: ml.getBoundingClientRect().top };
    // The Bookie isn't kept on the phone: with no signal it would open a dead page, with no way back
    // from the home-screen app. Scores entered meanwhile are safe here either way.
    if (e.target.closest('a[data-bet-link]') && navigator.onLine === false) {
        e.preventDefault();
        showToast('The Bookie needs a signal. Try again once you have a bar or two.', 'error');
        return;
    }
    const el = e.target.closest('[data-action]');
    if (!el) {
        if (e.target === $('keypad')) closeKeypad();
        return;
    }
    const a = el.dataset.action;
    const st = S.setup;
    switch (a) {
        case 'pick-round':
            if (!st) return;
            st.round = Number(el.dataset.round);
            st.touched = false;
            st.matchups = null;
            { const c = dbCourseForRound(st.round); st.courseId = c ? c.id : ''; }
            saveSetupDraft();
            renderSetup();
            break;
        case 'toggle-match': {
            const ids = el.dataset.ids.split(',');
            const on = ids.every(id => st.playerIds.includes(id));
            st.playerIds = on ? st.playerIds.filter(id => !ids.includes(id)) : [...new Set(st.playerIds.concat(ids))];
            st.touched = true;
            hideSinglesCheck();
            saveSetupDraft();
            syncSetupSelection();
            break;
        }
        case 'toggle-player': {
            const id = el.dataset.id;
            st.playerIds = st.playerIds.includes(id) ? st.playerIds.filter(x => x !== id) : st.playerIds.concat(id);
            st.touched = true;
            hideSinglesCheck();
            saveSetupDraft();
            syncSetupSelection();
            break;
        }
        case 'start': startScoring(); break;
        case 'singles-add': {
            if (!st) return;
            st.playerIds = [...new Set(st.playerIds.concat(el.dataset.ids.split(',').filter(Boolean)))];
            st.touched = true;
            saveSetupDraft();
            syncSetupSelection();
            st.singlesOk = true;
            startScoring();
            break;
        }
        case 'singles-skip':
            if (!st) return;
            st.singlesOk = true;
            startScoring();
            break;
        case 'retry-load': init(true); break;
        case 'hole': goHole(Number(el.dataset.hole)); break;
        case 'card-hole':
            S.sess.hole = Number(el.dataset.hole);
            saveSession();
            go('score');
            break;
        case 'minus': stepScore(Number(el.dataset.unit), -1); break;
        case 'plus': stepScore(Number(el.dataset.unit), 1); break;
        case 'keypad': openKeypad(Number(el.dataset.unit)); break;
        case 'pick': pickFromKeypad(el.dataset.value); break;
        case 'close-keypad': closeKeypad(); break;
        case 'jump': openJump(); break;
        case 'jump-to': {
            const hole = Number(el.dataset.hole);
            closeKeypad();
            goHole(hole);
            const btn = document.querySelector('#score-body .hole-jump');
            if (btn) btn.focus({ preventScroll: true });
            break;
        }
        case 'done': {
            const units = unitsOf(S.sess);
            const missing = units.map(u => ({ u, n: unitHoles(u).filter(v => v === null).length })).filter(x => x.n);
            const blank = missing.length ? `\n\nStill blank: ${missing.map(x => `${unitName(x.u)} (${x.n} hole${x.n === 1 ? '' : 's'})`).join(', ')}.` : '';
            const unsent = pendingCount() ? `\n\n${pendingCount()} score${pendingCount() === 1 ? ' hasn’t' : 's haven’t'} reached the database yet. Keep this page open until it says All saved.` : '';
            if (confirm(`Stop scoring on this phone?${blank}${unsent}\n\nThe round stays open for the other groups.`)) endSession(false);
            break;
        }
        case 'board-round':
            S.board.round = Number(el.dataset.round);
            renderBoard();
            break;
        case 'board-refresh':
            if (S.loadError) init(true);
            loadBoard(S.board.round);
            break;
        case 'board-scope':
            S.board.scope = el.dataset.scope === 'trip' ? 'trip' : 'round';
            renderBoard();
            break;
        case 'board-share': shareLive(); break;
        default: break;
    }
}

function onChange(e) {
    if (e.target.id === 'course-select' && S.setup) {
        S.setup.courseId = e.target.value;
        saveSetupDraft();
        const line = $('setup-course');
        if (line) line.innerHTML = courseLineHTML(S.setup);
    }
}

function onKey(e) {
    if (e.key === 'Escape' && S.keypad) closeKeypad();
}

// Catch up whenever the phone comes back: pick up changes from other tabs, send what's
// waiting, pull other phones' scores
function onVisible() {
    if (document.visibilityState !== 'visible') return;
    reloadForNewFiles();
    const changedHere = reloadFromStore();
    const dropped = dropStaleSession();
    if (dropped) showToast(`Round ${S.droppedStale.round} from ${fmtDay(S.droppedStale.date)} is saved. Pick today’s group.`, 'success');
    if (!sb) { loadSupabase(); if (dropped || changedHere || S.viewStale) route(); return; }
    if (S.loadError) {
        if (S.board.round !== null) S.board.tried[S.board.round] = 0;
        init(true);
        return;
    }
    if (dropped && (S.view === 'score' || S.view === 'card')) go('setup');
    else if (dropped || changedHere || S.viewStale) route();
    else if (S.view === 'setup' && S.setup && !S.setup.matchups) renderSetup();
    flush();
    if (S.sess && (S.view === 'score' || S.view === 'card')) refreshSession();
    if (onLiveView() && S.board.round !== null) loadBoard(S.board.round, true);
}

let refreshTimer = null;
function startTimers() {
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        if (!sb) { loadSupabase(); return; }
        // The signal came back without an 'online' event: finish loading
        if (S.loadError && !S.keypad) { init(true); return; }
        if (pendingCount()) flush();
        if (S.sess && (S.view === 'score' || S.view === 'card')) refreshSession();
        else if (onLiveView() && S.board.round !== null) loadBoard(S.board.round, true);
    }, REFRESH_MS);
}

// The database library comes from a CDN; on a flaky signal it can fail to load. Try again
// when the signal comes back (scores entered meanwhile are kept on the phone).
let supabaseLoading = false;
function loadSupabase() {
    if (window.supabase || supabaseLoading) return;
    supabaseLoading = true;
    const tag = document.createElement('script');
    tag.src = SUPABASE_CDN;
    tag.onload = () => { supabaseLoading = false; init(true); };
    tag.onerror = () => { supabaseLoading = false; tag.remove(); };
    document.head.appendChild(tag);
}

// ==========================================
// Start up
// ==========================================
// tracker-sw.js keeps a copy of this page and its files, so it reopens with no signal. It's
// handed what this visit loaded, since the very first visit loads before it's running.
function keepOffline() {
    if (!navigator.serviceWorker || !window.isSecureContext) return;
    navigator.serviceWorker.register('tracker-sw.js', { scope: './round_tracker' }).catch(err => console.warn('Offline copy unavailable:', err));
    const keep = urls => urls.length && navigator.serviceWorker.ready
        .then(reg => { if (reg.active) reg.active.postMessage({ type: 'keep', urls }); })
        .catch(() => { /* fine: the next visit tries again */ });
    const pageFiles = () => keep([location.href.split('#')[0]]
        .concat([...document.querySelectorAll('script[src], link[rel~="stylesheet"][href], link[rel~="icon"][href], link[rel="apple-touch-icon"][href]')].map(el => el.src || el.href)));
    if (document.readyState === 'complete') pageFiles();
    else window.addEventListener('load', pageFiles, { once: true });
    // Font files are only known once the page has asked for them, often after 'load'
    try {
        new PerformanceObserver(list => keep(list.getEntries().map(e => e.name).filter(u => /^https:\/\/fonts\.gstatic\.com\//.test(u))))
            .observe({ type: 'resource', buffered: true });
    } catch (e) { /* an old browser: fonts are kept from the next visit on */ }
}

function measureHeader() {
    const header = document.querySelector('.site-header');
    if (header) document.documentElement.style.setProperty('--hdr', `${header.offsetHeight}px`);
}

let listening = false;
function listen() {
    if (listening) return;
    listening = true;
    // The browser keeps the scroll on reloads and on Back from another page. Only a sheet's own
    // history entry turns that off (openSheet), and closing the sheet turns it back on (one task
    // after popstate).
    if ('scrollRestoration' in history) history.scrollRestoration = 'auto';
    measureHeader();
    window.addEventListener('resize', measureHeader);
    // A turn of the phone, or the web fonts arriving, changes how much room the names have
    let refit = 0;
    const fitAgain = () => {
        cancelAnimationFrame(refit);
        refit = requestAnimationFrame(() => { if (S.view === 'board') fitMatchCards($('board-body')); });
    };
    window.addEventListener('resize', fitAgain);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitAgain).catch(() => { /* fine */ });
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', route);
    window.addEventListener('popstate', () => {
        if (S.keypad) closeKeypad(true);
        // Safari (WebKit) reads the setting for the entry it lands on only after popstate has run, so
        // 'auto' comes back one task later; otherwise it would put the old scroll back over the hole
        // a Go to hole pick just drew
        setTimeout(() => {
            if (!S.keypad && !(history.state && history.state.keypad) && 'scrollRestoration' in history) history.scrollRestoration = 'auto';
        }, 0);
    });
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    window.addEventListener('online', () => { retryDelay = 0; onVisible(); });
    // Another tab on this phone saved something
    window.addEventListener('storage', e => {
        if (e.key !== OUTBOX_KEY && e.key !== SESSION_KEY) return;
        if (reloadFromStore()) {
            // A hidden tab redraws when it comes back, so a tap never lands on the wrong hole
            if (document.visibilityState === 'visible') route();
            else S.viewStale = true;
        }
        renderSyncOnly();
    });
    startTimers();
}

async function init(retry) {
    if (!retry) {
        loadStored();
        // Until supabase-js has checked it (with no signal that can take most of a minute), the
        // login saved on this phone counts, so unsent scores don't say "Log in" meanwhile
        S.authUser = savedLoginUser();
        listen();
        keepOffline();
        // Show what's saved on this phone right away, signal or not
        route();
        if (S.droppedStale) showToast(`Round ${S.droppedStale.round} from ${fmtDay(S.droppedStale.date)} is saved. Pick today’s group.`, 'success');
    } else {
        reloadFromStore();
        if (dropStaleSession()) showToast(`Round ${S.droppedStale.round} from ${fmtDay(S.droppedStale.date)} is saved. Pick today’s group.`, 'success');
    }
    if (!window.supabase) {
        S.ready = true;
        // Redraw what was waiting on start-up (setup, Live scores, a match), never the hole under a finger
        if (S.view !== 'score' && S.view !== 'card') route();
        showToast('No connection to the score database yet. Scores you enter are kept on this phone.', 'error');
        loadSupabase();
        return;
    }
    if (!sb) {
        sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

        // The notification bell, top right (bell.js)
        if (window.BBBBell) {
            const header = document.querySelector('.site-header .header-container');
            const menuBtn = header && header.querySelector('.menu-toggle');
            window.BBBBell.mount({ client: sb, place: el => {
                if (!header) { document.body.appendChild(el); return; }
                header.classList.add('has-bell');
                header.insertBefore(el, menuBtn || null);
            } });
        }
        sb.auth.onAuthStateChange((event, session) => {
            S.authUser = session ? session.user : (event === 'SIGNED_OUT' ? null : savedLoginUser());
            if (event === 'SIGNED_OUT') {
                // The album link is crew-only: off the screen too
                const hadAlbum = !!(S.album && S.album.url);
                S.album = null;
                if (hadAlbum && S.view === 'board') renderBoard();
                setSync('auth');
                renderSyncOnly();
            } else if (session && pendingCount() && S.ready) {
                setTimeout(flush, 0);
            }
        });
    }

    try {
        const { data: { session }, error } = await sb.auth.getSession();
        S.authUser = session ? session.user : (error && isNetworkError(error) ? savedLoginUser() : null);
    } catch (e) {
        S.authUser = isNetworkError(e) ? savedLoginUser() : null;
    }
    $('nav-login').hidden = !!S.authUser;

    try {
        await loadBase();
        if (S.authUser) S.me = await findMe(S.authUser);
    } catch (err) {
        S.loadError = err;
    }
    if (!S.authUser) S.me = null;
    // A phone with notifications on re-saves its subscription now and then (push.js)
    if (S.me && window.BBBPush) window.BBBPush.refresh(sb);
    if (S.sess) await refreshSession();
    S.ready = true;
    route();
    flush();
}

init();
