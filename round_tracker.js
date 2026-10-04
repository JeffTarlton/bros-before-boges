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
    board: { round: null, data: {}, loading: {}, error: {}, at: {}, tried: {} },
    cup: cachedCup(),    // the official Cup total { blue, red } (season live only): the last one saved, then the database's
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

// Replace a container's contents, keeping keyboard focus on the same control
function swapKeepingFocus(box, html) {
    const a = document.activeElement;
    const inBox = a && box.contains(a);
    const sel = inBox && a.dataset && a.dataset.action
        ? `[data-action="${a.dataset.action}"]${a.dataset.round ? `[data-round="${a.dataset.round}"]` : ''}`
        : inBox && a.classList.contains('fmt-link') ? '.fmt-link' : null;
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
        if (m) list.push({ number: Number(m[1]), date: day.date, what: slot.what, meta: slot.meta });
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

function formatOf(roundNumber) {
    return SC.formatFor(roundNumber, CFG);
}

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
function applyLegend() {
    const on = legendShown();
    document.querySelectorAll('[data-legend]').forEach(el => {
        el.classList.toggle('off', !on);
        el.setAttribute('aria-hidden', String(!on));
    });
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
    if (!sb) return `<span class="sync pending">${escHtml(syncText())}</span>`;
    if (S.sync === 'auth' || !S.authUser) {
        return `<a class="sync problem" href="bookie.html?next=round&amp;mode=login">${escHtml(syncText())}</a>`;
    }
    if (S.sync === 'error') return `<span class="sync problem wrap">${escHtml(syncText())}</span>`;
    return `<span class="sync pending">${escHtml(syncText())}</span>`;
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
        if (firstLoad || JSON.stringify(sess.holes) !== before) {
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
const VIEWS = ['setup', 'score', 'card', 'board'];

function go(view) {
    if (location.hash !== `#${view}`) location.hash = view;
    else route();
}

function route() {
    let view = (location.hash || '').replace('#', '');
    if (!VIEWS.includes(view)) view = S.sess ? 'score' : (!S.ready || !sb || S.authUser ? 'setup' : 'board');
    if ((view === 'score' || view === 'card') && !S.sess) view = 'setup';
    // Every screen is a history entry, so Back steps between them instead of doing nothing
    // (only once the login is known: before that the screen is just a placeholder)
    if (S.ready && location.hash !== `#${view}`) history.replaceState(history.state, '', `#${view}`);
    const changed = S.view !== view;
    const act = document.activeElement;
    const focusWasInView = S.view && (!act || act === document.body || ($(`view-${S.view}`) && $(`view-${S.view}`).contains(act)));
    S.view = view;
    // The tab (and a home-screen bookmark) names the screen: watching or entering scores
    document.title = `${view === 'board' ? 'Live scores' : 'Keep score'} · ${(CFG.trip && CFG.trip.name) || 'Bros before Boges'}`;
    // ...and the header's Log in comes back to it (a spectator shouldn't land on the scoring setup)
    $('nav-login').href = `bookie.html?next=${view === 'board' ? 'board' : 'round'}&mode=login`;
    VIEWS.forEach(v => { $(`view-${v}`).hidden = v !== view; });
    document.querySelectorAll('.tracker-nav [data-view]').forEach(a => {
        const v = a.dataset.view;
        a.hidden = (v === 'score' || v === 'card') ? !S.sess : (v === 'setup' ? !!S.sess && view !== 'setup' : false);
        if (v === view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (S.keypad && changed) closeKeypad();
    S.viewStale = false;
    if (view === 'setup') renderSetup();
    else if (view === 'score') renderScore();
    else if (view === 'card') renderCard();
    else renderBoard();
    if (changed) {
        window.scrollTo(0, 0);
        // Keyboard and screen-reader users land on the new screen's heading
        if (focusWasInView) {
            const h = document.querySelector(`#view-${view} h2`);
            if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
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
        // First time on this round: pick my match(es)
        if (!st.touched && S.me) {
            const mine = SC.matchesFrom(st.matchups).filter(m => m.sides.some(s => s.ids.includes(S.me.id)));
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
        return `<button type="button" class="match-pick" data-action="toggle-match" data-ids="${escHtml(all.join(','))}" aria-pressed="${on}">
            <span class="tag${mine ? ' mine' : ''}">Match ${m.number}${mine ? ' · your match' : ''}</span>
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
            <label class="field-label" for="course-select">Course</label>
            <select id="course-select" class="t-select">
                <option value="">Choose a course…</option>
                ${tripCourses.length && otherCourses.length
                    ? `<optgroup label="This trip">${tripCourses.map(opt).join('')}</optgroup><optgroup label="Other courses">${otherCourses.map(opt).join('')}</optgroup>`
                    : S.courses.map(opt).join('')}
            </select>
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
            <p class="muted small" id="setup-summary" style="margin-bottom: 8px;">${picked.length ? `Scoring ${picked.length}: ${picked.join(', ')}` : 'Nobody picked yet.'}</p>
            <button type="button" id="start-btn" class="t-btn primary block" data-action="start"${loading ? ' disabled' : ''}>${startLabel()}</button>
        </div>`;
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
function holeStatusLines() {
    const sess = S.sess;
    const format = formatOf(sess.roundNumber);
    if (format.key === 'stroke') return '';
    const holesById = holesByIdFromSession();
    return trackedMatches(sess).map(m => {
        const r = SC.matchResult(format, m, holesById, sess.pars);
        const names = m.sides.map(s => (format.teams && TEAM_NAMES[s.team]) || s.ids.map(id => firstName(nameOf(id))).join(' & '));
        return r.parts.map(p => {
            const leader = p.lead > 0 ? 1 : p.lead < 0 ? 2 : 0;
            const team = leader && p.started ? m.sides[leader - 1].team : 0;
            return `<div class="status-line${team ? ` lead-t${team}` : ''}"><span>${p.label ? `${escHtml(p.label)} · ` : ''}Match ${m.number}</span><b class="${leader && p.started ? `team-${m.sides[leader - 1].team}` : ''}">${escHtml(SC.partText(p, names))}</b></div>`;
        }).join('');
    }).join('');
}

// This hole's score in words: "Bogey", or "Bogey · 1 pt" in a points round
function holeResultText(v, par, format) {
    if (v === null || !par) return '';
    const d = v - par;
    const word = { ace: 'Ace', albatross: 'Albatross', eagle: 'Eagle', birdie: 'Birdie', par: 'Par', bogey: 'Bogey', double: 'Double' }[SC.scoreName(v, par)]
        || (d === 3 ? 'Triple' : `+${d}`);
    return format.key === 'points' ? `${word} · ${ptsText(SC.quotaPoints(v, par))}` : word;
}

// "Bogey · 1 pt  2 pts · E thru 1 · 4" as HTML parts: this hole's result first (in the score's
// colour), then the round so far. On a narrow row the later parts drop out whole. It stays one
// line whether or not the hole is scored, so a tap never moves the rows below.
function unitSubline(unit, hole) {
    const sess = S.sess;
    const format = formatOf(sess.roundNumber);
    const holes = unitHoles(unit);
    const t = SC.totals(holes, sess.pars);
    if (!t.thru) return 'No scores yet';
    const toPar = SC.fmtToPar(t.toPar);
    const segs = format.key === 'points'
        ? [ptsText(unitPoints(holes, sess.pars)), `· ${toPar}`, `thru ${t.thru}`, `· ${t.strokes}`]
        : [toPar, `thru ${t.thru}`, `· ${t.strokes}`];
    const v = holes[hole - 1];
    const res = holeResultText(v, sess.pars[hole - 1], format);
    const lead = res ? `<b class="seg hole-res ${SC.scoreName(v, sess.pars[hole - 1])}">${escHtml(res)}</b> <span class="seg res-sep" aria-hidden="true">|</span> ` : '';
    return lead + segs.map(s => `<span class="seg">${escHtml(s)}</span>`).join(' ');
}

// Re-render the Score view, keeping keyboard focus on the same control
function renderScore() {
    const sess = S.sess;
    if (!sess) return;
    const body = $('score-body');
    const act = document.activeElement && body.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = act ? { action: act.dataset.action, unit: act.dataset.unit, label: act.getAttribute('aria-label'), inStrip: !!act.closest('.hole-strip') } : null;
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

    const strip = Array.from({ length: HOLES }, (_, i) => {
        const hole = i + 1;
        const vals = units.map(u => unitValue(u, hole));
        const done = vals.length && vals.every(v => v !== null);
        const part = !done && vals.some(v => v !== null);
        return `<button type="button" data-action="hole" data-hole="${hole}" class="${done ? 'done' : part ? 'part' : ''}"${hole === h ? ' aria-current="true"' : ''} aria-label="Hole ${hole}${done ? ', scored' : part ? ', partly scored' : ''}">${hole}</button>`;
    }).join('');

    const rows = units.map((u, i) => {
        const v = unitValue(u, h);
        const name = unitName(u, narrow);
        const kind = SC.scoreName(v, par);
        const pend = unitPending(u, h);
        return `
            <div class="unit${u.team ? ` t${u.team}` : ''}">
                <div style="min-width: 0;">
                    <div class="unit-name">${escHtml(name)}</div>
                    <div class="unit-sub">${unitSubline(u, h)}</div>
                </div>
                <div class="stepper">
                    <button type="button" class="step minus" data-action="minus" data-unit="${i}" aria-label="One stroke fewer for ${escHtml(unitName(u))} on hole ${h}"${v === 1 ? ' disabled' : ''}>−</button>
                    <button type="button" class="score-value${v !== null ? ` set ${kind}` : ''}${pend ? ' pend' : ''}" data-action="keypad" data-unit="${i}" data-pend-ids="${escHtml(u.ids.join(','))}" data-pend-hole="${h}" aria-label="${escHtml(unitName(u))}: ${v !== null ? `${v}${kindText(kind)} on hole ${h}` : `no score on hole ${h}`}. Pick a score." title="${pend ? 'Not sent yet' : ''}">${v !== null ? digitHTML(v) : '·'}</button>
                    <button type="button" class="step plus" data-action="plus" data-unit="${i}" aria-label="One stroke more for ${escHtml(unitName(u))} on hole ${h}"${cap && v !== null && v >= cap ? ' disabled' : ''}>+</button>
                </div>
            </div>`;
    }).join('');

    const allIn = units.length && units.every(u => unitValue(u, h) !== null);
    const open = firstOpenHole(sess);
    const openHasGap = units.some(u => unitValue(u, open) === null);
    let next = '';
    if (allIn && openHasGap && open !== h && open !== h + 1) next = `<button type="button" class="t-btn gold block" data-action="hole" data-hole="${open}">Back to hole ${open} →</button>`;
    else if (allIn && h < HOLES) next = `<button type="button" class="t-btn gold block" data-action="hole" data-hole="${h + 1}">Hole ${h + 1} →</button>`;
    else if (allIn && h === HOLES) next = '<a class="t-btn gold block" href="#card">All 18 in. Check the card →</a>';
    // The button appears right under the thumb as the last score goes in: ignore taps for a moment
    const nextKey = next ? `${sess.roundNumber}:${h}` : null;
    if (nextKey !== S.nextShown.key) S.nextShown = { key: nextKey, at: Date.now(), cover: false };

    const roundLine = `Round ${sess.roundNumber}${sess.courseName ? ` · ${sess.courseName}` : ''}`;
    const legendOn = legendShown();
    body.innerHTML = `
        <div class="score-top">
            <div class="eyebrow" title="${escHtml(roundLine)}">${escHtml(roundLine)}</div>
            <div data-sync>${syncChipHTML()}</div>
        </div>
        <div class="hole-head">
            <button type="button" class="step-hole" data-action="hole" data-hole="${h - 1}" aria-label="Previous hole"${h === 1 ? ' disabled' : ''}>‹</button>
            <div class="hole-title"><h2 tabindex="-1">Hole ${h}</h2><span>Par ${par}${escHtml(nine)}${cap ? ` · <span class="nowrap">max ${cap}</span>` : ''}</span>${format.key === 'points' ? '<small class="hole-hint">Picked up? Tap the score.</small>' : ''}</div>
            <button type="button" class="step-hole${allIn && h < HOLES ? ' ready' : ''}" data-action="hole" data-hole="${h + 1}" aria-label="Next hole"${h === HOLES ? ' disabled' : ''}>›</button>
        </div>
        <div class="hole-strip" role="group" aria-label="Jump to a hole">${strip}</div>
        <div class="status-lines">${holeStatusLines()}</div>
        ${rows || '<p class="muted">Nobody to score. Tap Change group to pick your group.</p>'}
        <div class="next-bar${nextKey && armLeft() > 0 ? ' arming' : ''}">${next}</div>
        <p class="legend${legendOn ? '' : ' off'}" data-legend aria-hidden="${!legendOn}"><span class="legend-dot" aria-hidden="true"></span><span>Gold dot = not sent yet. It keeps trying.</span></p>
        <div class="btn-row" style="margin-top: 14px; justify-content: space-between;">
            <a class="t-btn small ghost" href="#setup">Change group</a>
            <a class="t-btn small ghost" href="#board">Live scores</a>
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
    // Keep the current hole visible in the strip, without scrolling the page
    centerInStrip(body.querySelector('.hole-strip'), '[aria-current="true"]');
    const head = body.querySelector('.hole-head');
    if (head) document.documentElement.style.setProperty('--holehead', `${head.offsetHeight}px`);
    // The buttons were rebuilt: put keyboard focus back on the same control
    if (focusKey) {
        let target = null;
        if (['minus', 'plus', 'keypad'].includes(focusKey.action)) {
            target = body.querySelector(`[data-action="${focusKey.action}"][data-unit="${focusKey.unit}"]`);
        } else if (focusKey.label === 'Previous hole' || focusKey.label === 'Next hole') {
            target = body.querySelector(`[aria-label="${focusKey.label}"]`);
        } else if (focusKey.action === 'hole') {
            target = focusKey.inStrip
                ? body.querySelector('.hole-strip [aria-current="true"]')
                : body.querySelector('[data-action="keypad"][data-unit="0"]');
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

// ---------- Keypad
function openKeypad(unitIndex) {
    const sess = S.sess;
    const unit = unitsOf(sess)[unitIndex];
    if (!unit) return;
    const h = sess.hole;
    const par = sess.pars[h - 1];
    const format = formatOf(sess.roundNumber);
    const cap = SC.holeCap(format, par);
    S.keypad = { unitIndex, returnFocus: document.activeElement };
    $('keypad-title').textContent = `${unitName(unit)} · hole ${h} (par ${par})`;
    const max = Math.max(10, par + 4);
    $('keypad-buttons').innerHTML = Array.from({ length: 10 }, (_, i) => {
        const n = i + 1 + (max > 10 ? max - 10 : 0);
        return `<button type="button" data-action="pick" data-value="${n}" class="${n === par ? 'par' : ''}"${cap && n > cap ? ' disabled' : ''}>${n}</button>`;
    }).join('') +
        (format.key === 'points' ? `<button type="button" class="wide" data-action="pick" data-value="${par + 2}">Picked up (0 pts)</button>` : '') +
        '<button type="button" class="wide" data-action="pick" data-value="">Clear this score</button><button type="button" class="wide" data-action="close-keypad">Cancel</button>';
    $('keypad').hidden = false;
    // The page behind can't be reached (or scrolled) while the sheet is up
    ['tracker', 'site-header', 'tracker-nav'].forEach(id => { const el = $(id) || document.querySelector(`.${id}`); if (el) el.inert = true; });
    document.documentElement.style.overflow = 'hidden';
    // Back closes the sheet instead of leaving the page
    history.pushState({ keypad: 1 }, '', location.hash);
    const first = $('keypad-buttons').querySelector('.par') || $('keypad-buttons').querySelector('button');
    if (first) first.focus();
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
    if (!k || !S.sess) return;
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
    // First names keep the name column narrow, so the hole cells get the room ("David O." when two
    // players share a first name; a pair shows one name per line). The full name is in the title and
    // in every cell's label.
    const firsts = units.filter(u => u.ids.length === 1).map(u => firstName(nameOf(u.ids[0])));
    const cardName = u => {
        if (u.ids.length > 1) return u.ids.map(id => `<span class="pair">${escHtml(firstName(nameOf(id)))}</span>`).join('');
        const full = nameOf(u.ids[0]);
        const first = firstName(full);
        return escHtml(firsts.filter(f => f === first).length > 1 ? shortName(full) : first);
    };
    const table = (from, to, label) => {
        const holes = Array.from({ length: to - from + 1 }, (_, i) => from + i);
        const parSum = holes.reduce((s, h) => s + sess.pars[h - 1], 0);
        return `
            <div class="card-scroll">
                <table class="card">
                    <thead><tr><th class="name" scope="col">${label}</th>${holes.map(h => `<th scope="col">${h}</th>`).join('')}<th scope="col" class="sum">${from === 1 ? 'Out' : 'In'}</th></tr></thead>
                    <tbody>
                        <tr class="par"><td class="name">Par</td>${holes.map(h => `<td>${sess.pars[h - 1]}</td>`).join('')}<td class="sum">${parSum}</td></tr>
                        ${units.map(u => {
                            let sum = 0;
                            const cells = holes.map(h => {
                                const v = unitValue(u, h);
                                if (v !== null) sum += v;
                                const kind = SC.scoreName(v, sess.pars[h - 1]);
                                return `<td><button type="button" data-action="card-hole" data-hole="${h}" data-pend-ids="${escHtml(u.ids.join(','))}" data-pend-hole="${h}" class="${kind}${unitPending(u, h) ? ' pend' : ''}" aria-label="${escHtml(unitName(u))}, hole ${h}: ${v !== null ? `${v}${kindText(kind)}` : 'no score'}">${v !== null ? digitHTML(v) : '·'}</button></td>`;
                            }).join('');
                            return `<tr><th class="name" scope="row" title="${escHtml(unitName(u))}">${cardName(u)}</th>${cells}<td class="sum">${sum || '–'}</td></tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>`;
    };
    const totalsList = units.map(u => {
        const holes = unitHoles(u);
        const t = SC.totals(holes, sess.pars);
        const pts = format.key === 'points' ? ` · ${ptsText(unitPoints(holes, sess.pars))}` : '';
        const missing = holes.filter(v => v === null).length;
        return `<div class="status-line"><span>${escHtml(unitName(u))}</span><b>${t.thru ? `${t.strokes} (${SC.fmtToPar(t.toPar)})${pts}` : '–'}${missing && t.thru ? ` · ${missing} to go` : ''}</b></div>`;
    }).join('');

    body.innerHTML = `
        <div class="score-top">
            <div class="eyebrow">Round ${sess.roundNumber}${sess.courseName ? ` · ${escHtml(sess.courseName)}` : ''}</div>
            <div data-sync>${syncChipHTML()}</div>
        </div>
        <p class="muted small" style="margin-bottom: 10px;">Tap any score to fix it. A gold dot means it hasn’t reached the database yet.</p>
        ${table(1, 9, 'Front')}
        ${table(10, 18, 'Back')}
        <p class="card-key"><span class="k birdie"><span class="digit" aria-hidden="true"></span>birdie</span><span class="k eagle"><span class="digit" aria-hidden="true"></span>eagle+</span><span class="k bogey"><span class="digit" aria-hidden="true"></span>bogey</span><span class="k double"><span class="digit" aria-hidden="true"></span>double+</span></p>
        <div class="status-lines">${totalsList}</div>
        <div class="status-lines">${holeStatusLines()}</div>
        <div class="panel" style="margin-top: 14px;">
            <p class="small muted" style="margin-bottom: 12px;">Finished, or handing scoring to another phone? This only stops scoring on this phone. The round stays open for everyone else.</p>
            <button type="button" class="t-btn block" data-action="done">Done scoring on this phone</button>
        </div>`;
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

async function loadBoard(roundNumber, quiet) {
    const B = S.board;
    if (!sb || B.loading[roundNumber]) return;
    loadCup();
    B.loading[roundNumber] = true;
    B.tried[roundNumber] = Date.now();
    if (!quiet && S.view === 'board' && B.round === roundNumber) renderBoard();
    try {
        const { data: found, error } = await sb.from('rounds').select('*').eq('round_number', roundNumber).gte('date', WINDOW_START);
        if (error) throw error;
        // Filtered here, not in pickBoardDay: with nothing left, the no-rounds branch below draws the empty board
        const rounds = boardRounds(roundNumber, found || []);
        let data = { rounds: [], rows: [], matchups: [], pars: parsFor(null, roundNumber), courseName: '', date: null };
        const matchupsQ = sb.from('matchups').select('*').eq('round_number', roundNumber);
        if (rounds && rounds.length) {
            const [scores, matchups] = await Promise.all([
                sb.from('scores').select('*').in('round_id', rounds.map(r => r.id)),
                matchupsQ
            ]);
            if (scores.error) throw scores.error;
            const allRows = scores.data || [];
            const date = pickBoardDay(roundNumber, rounds, allRows);
            const sameDay = rounds.filter(r => (r.date || '') === date);
            const ids = new Set(sameDay.map(r => r.id));
            const course = S.courses.find(c => c.id === pickRound(sameDay).course_id);
            data = {
                rounds: sameDay,
                rows: allRows.filter(r => ids.has(r.round_id)),
                matchups: matchups.error ? [] : (matchups.data || []),
                pars: parsFor(course, roundNumber),
                courseName: course ? course.name : '',
                date
            };
        } else {
            const { data: m } = await matchupsQ;
            data.matchups = m || [];
        }
        B.data[roundNumber] = data;
        B.error[roundNumber] = null;
        B.at[roundNumber] = Date.now();
        writeStore(BOARD_KEY, { since: WINDOW_START, data: B.data, at: B.at });
    } catch (err) {
        console.warn('Leaderboard failed:', err);
        B.error[roundNumber] = err;
    } finally {
        B.loading[roundNumber] = false;
        if (S.view === 'board' && B.round === roundNumber) renderBoard();
    }
}

function defaultBoardRound() {
    if (S.sess && S.sess.roundNumber) return S.sess.roundNumber;
    return scheduledRoundToday() || (tripRounds()[0] || { number: 1 }).number;
}

// The official Cup total, above the round tabs (only once the season is live and it has loaded).
// On a narrow phone "(official)" drops under "The Cup" so the score keeps to one line.
function cupRowHTML() {
    if (!SEASON_LIVE || !S.cup) return '';
    const [b, r] = [S.cup.blue, S.cup.red].map(v => escHtml(SC.fmtPoints(v)));
    return `<div class="cup-row">
        <div class="cup-name"><span class="cup-title">The Cup</span> <span class="cup-off">(official)</span></div>
        <div class="cup-score"><span class="team-1">Blue <b>${b}</b></span><span class="cup-dash" aria-hidden="true">–</span><span class="sr-only"> to </span><span class="team-2"><b>${r}</b> Red</span></div>
        <div class="cup-note">Updated by the commissioner after each session</div>
    </div>`;
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
    const label = final ? `Round ${n} final` : 'If it ended now';
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
    const tabs = cupRowHTML() + `<div class="round-tabs" role="group" aria-label="Round">${rounds.map(r => `<button type="button" data-action="board-round" data-round="${r.number}" aria-pressed="${r.number === n}">Round ${r.number}${r.day ? ` · ${escHtml(r.day)}` : ''}</button>`).join('')}</div>`;
    const centerTabs = () => centerInStrip(body.querySelector('.round-tabs'), '[aria-pressed="true"]');

    if (!data) {
        swapKeepingFocus(body, tabs + (B.error[n] ? boardErrorHTML(B.error[n]) : '<p class="muted">Loading…</p>'));
        centerTabs();
        // Failed tries wait like successful ones do (the timer, Refresh and the signal coming back retry)
        if (!B.loading[n] && (!B.error[n] || Date.now() - (B.tried[n] || 0) > BOARD_STALE_MS)) loadBoard(n);
        return;
    }
    if (!B.loading[n] && Date.now() - (B.tried[n] || 0) > BOARD_STALE_MS) setTimeout(() => loadBoard(n, true), 0);

    const holesById = {};
    const byPlayer = {};
    data.rows.forEach(r => { (byPlayer[r.player_id] = byPlayer[r.player_id] || []).push(r); });
    Object.keys(byPlayer).forEach(pid => { holesById[pid] = SC.mergeHoles(byPlayer[pid]); });
    // This phone's own unsent (or not yet loaded) scores show right away on its own board
    if (S.sess && S.sess.roundNumber === n && data.rounds.some(r => r.id === S.sess.roundId)) {
        S.sess.playerIds.forEach(pid => {
            const local = holesFor(pid);
            const server = holesById[pid] || Array(HOLES).fill(null);
            holesById[pid] = server.map((v, i) => (pendingFor(S.sess.roundId, pid, i + 1) || v === null ? local[i] : v));
        });
    }
    const matches = SC.matchesFrom(data.matchups);
    const mine = new Set(S.sess && S.sess.roundNumber === n ? S.sess.playerIds : (S.me ? [S.me.id] : []));

    // The format by the rules' name, what it is, and a link to how it's scored
    const info = formatInfo(format);
    let html = tabs;
    html += `<div class="board-meta">
        <div><div class="eyebrow">${escHtml(info.name)}</div><p class="fmt-line">${formatLineHTML(info.about, info, true)}</p>${data.courseName ? `<div class="muted small">${escHtml(data.courseName)}${data.date ? ` · ${escHtml(fmtDay(data.date))}` : ''}</div>` : ''}</div>
        <div class="btn-row" style="align-items: center;">
            <span class="muted small">${B.at[n] ? `Updated ${updatedAt(B.at[n])}` : ''}</span>
            <button type="button" class="t-btn small" data-action="board-refresh"${B.loading[n] ? ' aria-busy="true"' : ''}>${B.loading[n] ? 'Updating…' : 'Refresh'}</button>
        </div>
    </div>`;
    if (B.error[n]) html += `<div class="notice error">Couldn’t update just now${isNetworkError(B.error[n]) ? ' (no signal)' : ''}. Showing the last scores that loaded.</div>`;

    // A group that pressed Start has blank rows: those aren't scores yet
    const anyScores = Object.values(holesById).some(h => SC.countEntered(h) > 0);
    // On a practice day nothing is being kept: say when the Cup starts instead of "as groups enter them"
    const prac = practiceToday();
    const emptyNext = !prac ? 'They show up here as groups enter them.'
        : prac.next ? `Today’s round is a practice round, so nothing counts until Round ${prac.next.number}, ${prac.next.day}.`
            : 'Today’s round is a practice round: no Cup points.';
    const empty = `<p class="board-empty">No scores for Round ${n} yet. ${escHtml(emptyNext)}</p>`;
    if (matches.length && format.key !== 'stroke') html += boardHeadHTML(n, format, matches, holesById, data.pars, anyScores ? '' : empty);
    else if (!anyScores) html += `<div class="panel">${empty}</div>`;

    if (matches.length && format.key !== 'stroke') {
        html += mineFirst(matches, mine).map(m => {
            const r = SC.matchResult(format, m, holesById, data.pars);
            const sideNames = m.sides.map(s => s.ids.map(id => (s.ids.length > 1 ? firstName(nameOf(id)) : nameOf(id))).join(' & '));
            const colors = m.sides.map(s => s.team);
            const isMine = m.sides.some(s => s.ids.some(id => mine.has(id)));
            // Team formats say "Blue 2 UP"; singles say "Kyle 2 UP"
            const who = format.teams
                ? [TEAM_NAMES[colors[0]] || sideNames[0], TEAM_NAMES[colors[1]] || sideNames[1]]
                : sideNames.map(firstName);
            const lines = r.parts.map(p => {
                const leader = p.lead > 0 ? 0 : p.lead < 0 ? 1 : -1;
                const cls = leader >= 0 && p.started ? `t${colors[leader]}` : '';
                return `<div><span class="pill ${cls}${p.final ? ' final' : ''}">${p.label ? `${escHtml(p.label)}: ` : ''}${escHtml(SC.partText(p, who))}</span></div>`;
            }).join('');
            return `<div class="match-card${isMine ? ' mine' : ''}">
                <div class="muted small" style="margin-bottom: 6px;">Match ${m.number}${isMine ? ' · yours' : ''}</div>
                <div class="sides"><div class="team-${colors[0]}">${escHtml(sideNames[0])}</div><div class="team-${colors[1]}">${escHtml(sideNames[1])}</div></div>
                <div class="lead">${lines}</div>
            </div>`;
        }).join('');
    }

    // Everyone's own card: gross score to par (one ball per pair in one-ball formats). In team points
    // rounds each player's quota points lead, the same number his Score view shows.
    const isPoints = format.key === 'points';
    const ids = Object.keys(holesById);
    if (ids.length) {
        let units;
        if (format.sharedBall && matches.length) {
            const used = new Set();
            units = [];
            matches.forEach(m => m.sides.forEach(s => {
                const inRows = s.ids.filter(id => holesById[id]);
                if (!inRows.length) return;
                units.push({ label: s.ids.map(id => firstName(nameOf(id))).join(' & '), side: true, team: s.team, holes: SC.sideHoles(format, { ids: inRows }, holesById, data.pars) });
                s.ids.forEach(id => used.add(id));
            }));
            ids.filter(id => !used.has(id)).forEach(id => units.push({ label: nameOf(id), team: teamOf(id), holes: holesById[id] }));
        } else {
            units = ids.map(id => ({ label: nameOf(id), team: teamOf(id), holes: holesById[id] }));
        }
        // Points rounds rank on points against par pace (a par is 2), so a group that teed off later
        // isn't buried under one that has simply played more holes; at the finish it's the raw points order
        const pace = u => u.pts - 2 * u.t.thru;
        const rows = units.map(u => ({ ...u, t: SC.totals(u.holes, data.pars), pts: isPoints ? unitPoints(u.holes, data.pars) : 0 })).filter(u => u.t.thru)
            .sort((a, b) => (isPoints ? pace(b) - pace(a) : 0) || a.t.toPar - b.t.toPar || b.t.thru - a.t.thru || a.label.localeCompare(b.label));
        // Phones show "David O." so each player keeps to one line; two who'd look alike keep full names
        const shortOf = u => (u.side ? u.label : shortName(u.label));
        const shortCount = {};
        rows.forEach(u => { shortCount[shortOf(u)] = (shortCount[shortOf(u)] || 0) + 1; });
        const nameCell = u => (shortOf(u) !== u.label && shortCount[shortOf(u)] === 1
            ? `<span class="nm-full">${escHtml(u.label)}</span><span class="nm-short">${escHtml(shortOf(u))}</span>`
            : escHtml(u.label));
        if (rows.length) {
            // Ties share a position: T2, T2, 4 (on points against pace in a points round, else on to par)
            const rank = u => (isPoints ? pace(u) : u.t.toPar);
            const pos = u => {
                const first = rows.findIndex(x => rank(x) === rank(u));
                const tied = rows.filter(x => rank(x) === rank(u)).length > 1;
                return `${tied ? 'T' : ''}${first + 1}`;
            };
            const heading = isPoints ? 'Individual · team points' : `${format.sharedBall ? 'Team cards' : 'Individual'} · gross`;
            html += `<div class="panel board-table">
                <div class="eyebrow" style="margin-bottom: 8px;">${heading}</div>
                <table class="standings${isPoints ? ' has-pts' : ''}">
                    <thead><tr><th scope="col">#</th><th scope="col">${format.sharedBall ? 'Team' : 'Player'}</th>${isPoints ? '<th scope="col"><span aria-hidden="true">Pts</span><span class="sr-only">Points</span></th>' : ''}<th scope="col">To par</th><th scope="col">Thru</th><th scope="col" class="col-strokes">Strokes</th></tr></thead>
                    <tbody>${rows.map(u => `<tr><td>${pos(u)}</td><td class="${u.team ? `team-${u.team}` : ''}" style="font-weight: 700;">${nameCell(u)}</td>${isPoints ? `<td class="lead-col">${u.pts}</td>` : ''}<td${isPoints ? '' : ' class="lead-col"'}>${SC.fmtToPar(u.t.toPar)}</td><td>${u.t.thru === HOLES ? 'F' : u.t.thru}</td><td class="col-strokes">${u.t.strokes}</td></tr>`).join('')}</tbody>
                </table>
            </div>`;
        }
    }
    swapKeepingFocus(body, html);
    centerTabs();
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
            saveSetupDraft();
            syncSetupSelection();
            break;
        }
        case 'toggle-player': {
            const id = el.dataset.id;
            st.playerIds = st.playerIds.includes(id) ? st.playerIds.filter(x => x !== id) : st.playerIds.concat(id);
            st.touched = true;
            saveSetupDraft();
            syncSetupSelection();
            break;
        }
        case 'start': startScoring(); break;
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
        default: break;
    }
}

function onChange(e) {
    if (e.target.id === 'course-select' && S.setup) {
        S.setup.courseId = e.target.value;
        saveSetupDraft();
    }
}

function onKey(e) {
    if (e.key === 'Escape' && S.keypad) closeKeypad();
}

// Catch up whenever the phone comes back: pick up changes from other tabs, send what's
// waiting, pull other phones' scores
function onVisible() {
    if (document.visibilityState !== 'visible') return;
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
    if (S.view === 'board' && S.board.round !== null) loadBoard(S.board.round, true);
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
        else if (S.view === 'board' && S.board.round !== null) loadBoard(S.board.round, true);
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
    measureHeader();
    window.addEventListener('resize', measureHeader);
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', route);
    window.addEventListener('popstate', () => { if (S.keypad) closeKeypad(true); });
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
        if (!S.sess) route();
        showToast('No connection to the score database yet. Scores you enter are kept on this phone.', 'error');
        loadSupabase();
        return;
    }
    if (!sb) {
        sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        sb.auth.onAuthStateChange((event, session) => {
            S.authUser = session ? session.user : (event === 'SIGNED_OUT' ? null : savedLoginUser());
            if (event === 'SIGNED_OUT') {
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
    if (S.sess) await refreshSession();
    S.ready = true;
    route();
    flush();
}

init();
