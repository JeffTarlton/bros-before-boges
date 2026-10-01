// The Bookie: side bets for the trip.
// Supabase tables: wagers, wager_comments, players (players.user_id links a login to a roster spot).
// Season settings (year, whether the Cup is live, which bets count this year) come from trip-config.js.
const SUPABASE_URL = 'https://gxpwgrdyizruzfczzqwn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uo20KpEYmGXAIB9JGL1CnQ_wIxT8GX4';
let supabaseClient = null; // Initialized inside initBookie after CDN loads

const BBB = window.BBB || {};
const TRIP_YEAR = (BBB.trip && BBB.trip.year) || new Date().getFullYear();
const SEASON_LIVE = !!(BBB.season && BBB.season.live);
// Bets created before this date belong to earlier trips (Past Trips tab, left out of the ledger)
const SEASON_START = BBB.bookie && BBB.bookie.seasonStart ? new Date(BBB.bookie.seasonStart) : null;
// Email links land here; read them before supabase-js clears the URL.
// Reset and invite links both need a new password; a failed link carries an error instead.
const LINK_PARAMS = new URLSearchParams((window.location.hash || '').replace(/^#/, '') + '&' + window.location.search.replace(/^\?/, ''));
const OPENED_FROM_RESET_LINK = ['recovery', 'invite'].includes(LINK_PARAMS.get('type'));
const LINK_ERROR = LINK_PARAMS.get('error_code') || LINK_PARAMS.get('error');
const CAME_FROM_AUTH_LINK = /(^|[#&])(access_token|error_code|error)=/.test(window.location.hash) ||
    /[?&]code=/.test(window.location.search);

// Other pages send people here to log in (?next=rsvp etc.). Once their login is linked to
// a roster name they go straight back. `mode` opens the log-in or sign-up form on arrival.
const NEXT_PAGES = { rsvp: 'index.html#rsvp', profile: 'index.html#profile', home: 'index.html', round: 'round_tracker.html', admin: 'admin.html' };
const NEXT = NEXT_PAGES[LINK_PARAMS.get('next')] ? LINK_PARAMS.get('next') : null;
const START_MODE = ['login', 'register'].includes(LINK_PARAMS.get('mode')) ? LINK_PARAMS.get('mode') : null;
const NEW_PLAYER = '__new';
const ALERTS = BBB.alerts || {};

// Here for the RSVP, golf profile or homepage login: the page is "your player account", not
// The Bookie (bookie.html's head script sets the same class before the first paint).
const ACCOUNT_MODE = ['rsvp', 'profile', 'home'].includes(NEXT);
const SITE_NAME = (BBB.trip && BBB.trip.name) || 'Bros before Boges';
const TRIP_CITY = String((BBB.trip && BBB.trip.location) || '').split(',')[0].trim();
const TRIP_DATES = (BBB.trip && BBB.trip.dates && BBB.trip.dates.short) || '';

// What the login wall says, by why they came. RSVP and profile visitors never see betting talk.
// `primary` is the button that comes first and in gold; the unlinked lines are for a login
// that isn't tied to a roster name yet.
const WALL = Object.assign({
    primary: 'login',
    login: 'Log in',
    register: 'Create account',
    unlinkedTitle: 'Almost there',
    unlinkedText: 'Pick your name on the trip roster to finish setting up your player account.'
}, {
    rsvp: {
        title: TRIP_CITY ? `RSVP for ${TRIP_CITY} ${TRIP_YEAR}` : `RSVP for the ${TRIP_YEAR} trip`,
        text: 'One quick step first: set up your player account. You’ll come right back to your RSVP.',
        primary: 'register',
        register: 'Create my account',
        login: 'I have an account: log in',
        unlinkedTitle: 'One more step before your RSVP',
        unlinkedText: 'Pick your name on the trip roster so your RSVP counts.'
    },
    profile: {
        title: 'Your golf profile',
        text: 'Log in to update your GHIN and handicap. It’s the same player account you use to RSVP.',
        unlinkedText: 'Pick your name on the trip roster so your golf profile saves to the right player.'
    },
    home: {
        title: 'Log in',
        text: 'Log in to your player account: one login for RSVPs, The Bookie and live scoring.'
    },
    round: {
        title: 'Keep score',
        text: 'Log in to start scoring a round. It’s the same player account you use to RSVP.'
    },
    admin: {
        title: 'Commissioner login',
        text: 'Log in with your admin account.'
    },
    bookie: {
        title: 'Log in to The Bookie',
        text: 'Side bets, the ledger and settle-up for the trip. It’s the same player account you use to RSVP and keep score.',
        unlinkedText: 'Betting opens once your login is linked to a confirmed name on the trip roster.'
    }
}[NEXT || 'bookie']);

document.documentElement.classList.toggle('account-mode', ACCOUNT_MODE);
if (ACCOUNT_MODE) document.title = NEXT === 'rsvp' ? `RSVP · ${SITE_NAME} ${TRIP_YEAR}` : `Your player account · ${SITE_NAME}`;

// State
let currentUser = null;
let dbPlayers = [];
let allWagers = [];
let allComments = [];
let loadError = null;
let authMode = 'login'; // 'login' | 'register' | 'reset'
let currentFilter = 'all';
let lastRefresh = 0;
let creatingWager = false;
let pendingWagerId = null; // the id a new bet is saved under, so a retry after a lost reply can't double-post it
let pendingWagerTerms = null; // ...but only while the terms are the same: a changed bet is a new bet
let settling = false;
const busyWagers = new Set(); // bets with an action still saving: a second tap does nothing
let rsvpOut = null; // players whose latest RSVP for this trip is "out" (left out of the challenge list)
let modalReturnFocus = null;
let resetPending = OPENED_FROM_RESET_LINK; // don't leave the page before the new password is saved
// 'checking' until the login check decides, then 'out', 'in' (logged in, can't bet yet),
// 'dashboard', or 'leaving' (on the way back to ?next=)
let wallState = 'checking';

// Escape text from the database before it goes into innerHTML.
function escHtml(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// DOM Elements
const authWall = document.getElementById('auth-wall');
const authWallNote = document.getElementById('auth-wall-note');
const wallTitle = document.getElementById('auth-wall-title');
const wallText = document.getElementById('auth-wall-text');
const wallIcon = document.getElementById('auth-wall-icon');
const wallButtons = document.getElementById('wall-buttons');
const wallBackLink = document.getElementById('wall-back-link');
const dashboard = document.getElementById('bookie-dashboard');
const currentUserNameEl = document.getElementById('current-user-name');
const modal = document.getElementById('bookie-modal');
const modalClose = document.getElementById('bookie-modal-close');
const authForm = document.getElementById('auth-form');
const createWagerForm = document.getElementById('create-wager-form');
const settleWagerForm = document.getElementById('settle-wager-form');
const modalTitle = document.getElementById('modal-title');
const modalEyebrow = document.getElementById('modal-eyebrow');

// Auth Form Elements
const wallLoginBtn = document.getElementById('wall-login-btn');
const wallRegisterBtn = document.getElementById('wall-register-btn');
const navLoginBtn = document.getElementById('bookie-login-btn');
const toggleAuthModeBtn = document.getElementById('toggle-auth-mode');
const forgotPasswordBtn = document.getElementById('forgot-password');
const registerFields = document.getElementById('register-fields');
const emailFields = document.getElementById('email-fields');
const authNameInput = document.getElementById('auth-name');
const authEmailInput = document.getElementById('auth-email');
const authPasswordInput = document.getElementById('auth-password');
const authPasswordLabel = document.getElementById('auth-password-label');
const authSubmitBtn = document.getElementById('auth-submit-btn');
const authErrorEl = document.getElementById('auth-error');
const authNoticeEl = document.getElementById('auth-notice');

// Wager Form Elements
const openWagerBtn = document.getElementById('create-wager-btn');
const wagerTypeSelect = document.getElementById('wager-type');
const h2hTargetContainer = document.getElementById('h2h-target-container');
const wagerTargetSelect = document.getElementById('wager-target');
const wagerOddsInput = document.getElementById('wager-odds');
const wagerDescInput = document.getElementById('wager-desc');
const wagerAmtInput = document.getElementById('wager-amt');
const wagerSubmitBtn = document.getElementById('create-wager-submit');
const wagerErrorEl = document.getElementById('wager-error');
const oddsNumberWrap = document.getElementById('odds-number-wrap');

// Containers
const wagersContainer = document.getElementById('wagers-container');
const ledgerContainer = document.getElementById('ledger-container');
const ryderBluePts = document.getElementById('ryder-blue-pts');
const ryderRedPts = document.getElementById('ryder-red-pts');

// ==========================================
// Money & odds
// ==========================================
const roundCents = n => Math.round(n * 100) / 100;

// "$20", "$7.50", "+$30", "−$12.50", "$1,100"
function fmtMoney(n, signed) {
    const v = roundCents(Number(n) || 0);
    const abs = Math.abs(v);
    const digits = Number.isInteger(abs) ? 0 : 2;
    const body = abs.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    const sign = v < 0 ? '−' : (signed && v > 0 ? '+' : '');
    return `${sign}$${body}`;
}

// American odds must be at least 100 either way (+150, -120); 100 is even money.
function isValidOdds(o) {
    return Number.isInteger(o) && Math.abs(o) >= 100 && Math.abs(o) <= 10000;
}
function normOdds(o) {
    const n = parseInt(o, 10);
    return isValidOdds(n) ? n : 100;
}
function fmtOdds(o) {
    const n = normOdds(o);
    return n > 0 ? `+${n}` : String(n);
}

// Head-to-head payouts. The line is quoted for the player being challenged (the target):
// +150 means the target is the underdog and collects $30 on a $20 bet; the creator collects $20.
// -150 means the target is the favorite: the target collects $20, the creator collects $30.
function h2hPayouts(amount, odds) {
    const o = normOdds(odds);
    const m = Math.abs(o) / 100;
    return o > 0
        ? { creatorWins: amount, targetWins: roundCents(amount * m) }
        : { creatorWins: roundCents(amount * m), targetWins: amount };
}

// Whole dollars typed into a text box ("$20", "1,000"). Anything else comes back NaN or a
// fraction, which the form rejects.
function parseDollars(value) {
    const s = String(value || '').replace(/[$,\s]/g, '');
    return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

// A pool pot split between winners, in cents, so the shares add back up to the pot exactly.
// The first winners in the list get the leftover pennies.
function potShares(amount, players, winners) {
    if (!winners) return [];
    const pot = Math.round(amount * 100) * players;
    const base = Math.floor(pot / winners);
    const extra = pot - base * winners;
    return Array.from({ length: winners }, (_, i) => (base + (i < extra ? 1 : 0)) / 100);
}

function fmtPoints(n) {
    const v = Number(n) || 0;
    const whole = Math.floor(v);
    return Math.abs(v - whole - 0.5) < 0.001 ? `${whole || ''}½` : String(roundCents(v));
}

// ==========================================
// Players & seasons
// ==========================================
function getPlayerName(id) {
    const p = dbPlayers.find(player => player.id === id);
    return p ? p.name : 'Unknown';
}
function firstName(id) {
    return getPlayerName(id).split(' ')[0];
}
const normName = s => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

function isCurrentSeason(wager) {
    return !SEASON_START || new Date(wager.created_at) >= SEASON_START;
}
function involvesMe(w) {
    if (!currentUser) return false;
    const me = currentUser.id;
    return w.creator_id === me || w.target_id === me || (w.participants || []).includes(me);
}
function findWager(id) {
    return allWagers.find(w => w.id === id);
}

// ==========================================
// Initialization
// ==========================================
async function initBookie() {
    // Check if CDN loaded properly
    if (!window.supabase) {
        console.error('CRITICAL: window.supabase is undefined. The Supabase CDN script may be blocked by an adblocker or failed to load.');
        // Log in can't work without it, so say what to do instead of offering the buttons
        showWall('Couldn’t reach the login service. Check your signal, turn off any strict ad-blocker, then refresh the page.');
        wallButtons.hidden = true;
        navLoginBtn.closest('li').hidden = true;
        return;
    }

    // Create the Supabase client here so we know the CDN script has run
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    setupEventListeners();

    // Registered once. PASSWORD_RECOVERY fires when someone opens a reset link.
    supabaseClient.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') {
            // Logged out from another tab (or the session ran out) with a bet sheet open
            const sheetOpen = modal.classList.contains('active') && authForm.style.display !== 'block';
            currentUser = null;
            if (sheetOpen) {
                closeModal();
                showToast('You were logged out. Log in again to keep betting.', 'error');
            }
            resetCreateForm();
            showWall();
        } else if (event === 'PASSWORD_RECOVERY') {
            resetPending = true;
            openAuthModal('reset');
        }
    });

    renderCupCard();
    showGoogleButtonsIfEnabled();
    const signedIn = await loadSession();
    if (OPENED_FROM_RESET_LINK && authMode !== 'reset') openAuthModal('reset');
    if (LINK_ERROR && !signedIn) {
        // They already have an account by now: lead with logging in
        // An expired sign-up link leaves the email unconfirmed; "Forgot password?" sends a link
        // that also confirms it, so that's the way out if log in asks for confirmation.
        showWall(`Log in below to keep going. ${LINK_ERROR === 'otp_expired'
            ? 'That email link expired or was already used.'
            : 'That email link didn’t work.'} If log in says to confirm your email, or your password doesn’t work, tap “Forgot password?” for a fresh link.`, false, { linkError: true });
    } else if (modal.classList.contains('active') && authForm.style.display === 'block' && authMode !== 'reset') {
        // A very slow check showed the logged-out wall and they opened a sheet from it:
        // keep what they typed, unless the check found their login after all
        if (signedIn) closeModal();
    } else if (START_MODE && !signedIn && navLoginBtn.dataset.signedIn !== 'true') {
        openAuthModal(START_MODE);
    }
    // Drop tokens and one-time flags from the address bar, but keep ?next= for later links.
    if (CAME_FROM_AUTH_LINK || START_MODE) history.replaceState(null, '', pageUrl());
}

function setupEventListeners() {
    // Modal controls. The backdrop closes the sheet only when the press also started on it,
    // so drag-selecting text and letting go outside the card doesn't throw the form away.
    modalClose.addEventListener('click', closeModal);
    let pressedOnBackdrop = false;
    modal.addEventListener('pointerdown', (e) => { pressedOnBackdrop = e.target === modal; });
    modal.addEventListener('click', (e) => {
        if (e.target === modal && pressedOnBackdrop) closeModal();
        pressedOnBackdrop = false;
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('active')) closeModal();
    });

    // Auth flows
    wallLoginBtn.addEventListener('click', () => openAuthModal('login'));
    navLoginBtn.addEventListener('click', () => {
        if (currentUser || navLoginBtn.dataset.signedIn === 'true') {
            handleLogout();
        } else {
            openAuthModal('login');
        }
    });
    wallRegisterBtn.addEventListener('click', () => openAuthModal('register'));
    toggleAuthModeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        openAuthModal(authMode === 'login' ? 'register' : 'login');
    });
    if (forgotPasswordBtn) forgotPasswordBtn.addEventListener('click', sendPasswordReset);
    const linkBtn = document.getElementById('link-roster-btn');
    if (linkBtn) linkBtn.addEventListener('click', linkSelectedName);
    document.querySelectorAll('[data-google-signin]').forEach(btn => btn.addEventListener('click', signInWithGoogle));
    // "I'm new" reveals a name box in both the sign-up form and the link picker
    authNameInput.addEventListener('change', () => syncNewNameField(authNameInput, 'auth-new-name'));
    const linkSelect = document.getElementById('link-roster-select');
    if (linkSelect) linkSelect.addEventListener('change', () => syncNewNameField(linkSelect, 'link-new-name'));

    authForm.addEventListener('submit', handleAuthSubmit);

    // Wager flows
    openWagerBtn.addEventListener('click', openWagerModal);
    wagerTypeSelect.addEventListener('change', syncWagerTypeFields);
    wagerAmtInput.addEventListener('input', updateOddsPreview);
    wagerOddsInput.addEventListener('input', updateOddsPreview);
    wagerTargetSelect.addEventListener('change', syncWagerTypeFields);
    createWagerForm.querySelectorAll('input[name="odds-side"]').forEach(r => r.addEventListener('change', syncWagerTypeFields));
    createWagerForm.addEventListener('input', () => showCreateError(''));
    createWagerForm.addEventListener('submit', handleCreateWager);

    const refreshBtn = document.getElementById('refresh-board-btn');
    if (refreshBtn) refreshBtn.addEventListener('click', () => refreshNow(refreshBtn));
    const ledgerNavBtn = document.getElementById('ledger-nav-btn');
    if (ledgerNavBtn) ledgerNavBtn.addEventListener('click', () => document.getElementById('ledger-panel').scrollIntoView({ behavior: 'smooth' }));

    // Settle
    settleWagerForm.addEventListener('submit', handleSettleSubmit);
    const settlePushBtn = document.getElementById('settle-push-btn');
    const settleCancelBtn = document.getElementById('settle-cancel-btn');
    if (settlePushBtn) settlePushBtn.addEventListener('click', () => handleAlternativeSettle('push'));
    if (settleCancelBtn) settleCancelBtn.addEventListener('click', () => handleAlternativeSettle('canceled'));

    // Filters (top chips and the phone bottom bar stay in sync)
    document.querySelectorAll('.bookie-nav button[data-filter], .bottom-nav-btn[data-filter]').forEach(btn => {
        btn.addEventListener('click', () => setFilter(btn.dataset.filter));
    });

    // Mobile FAB
    const fabBtn = document.getElementById('fab-create-wager-btn');
    if (fabBtn) fabBtn.addEventListener('click', openWagerModal);

    // Post a comment with Enter
    wagersContainer.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.matches('input[id^="comment-input-"]')) {
            e.preventDefault();
            window.postComment(e.target.id.replace('comment-input-', ''));
        }
    });

    // Catch up when the app comes back to the foreground (no realtime feed)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && currentUser && Date.now() - lastRefresh > 30000) {
            refreshBoard();
        }
    });

    setupMobileGestures();
}

function setupMobileGestures() {
    let startY = 0;
    let currentY = 0;
    let isRefreshing = false;

    // Pull-to-refresh indicator, at the top of the board where the pull happens.
    // iPhone rubber-banding makes scrollY negative mid-pull, hence <= 0.
    const ptrIndicator = document.createElement('div');
    ptrIndicator.className = 'ptr-indicator';
    ptrIndicator.innerHTML = '<i class="fas fa-sync-alt fa-spin" aria-hidden="true"></i> Fetching latest...';
    dashboard.insertBefore(ptrIndicator, dashboard.firstElementChild);

    dashboard.addEventListener('touchstart', (e) => {
        if (window.scrollY <= 0) startY = e.touches[0].clientY;
    }, { passive: true });

    dashboard.addEventListener('touchmove', (e) => {
        if (window.scrollY <= 0 && startY > 0 && !isRefreshing) {
            currentY = e.touches[0].clientY;
            if (currentY - startY > 80) ptrIndicator.classList.add('active');
        }
    }, { passive: true });

    dashboard.addEventListener('touchend', async () => {
        if (ptrIndicator.classList.contains('active') && !isRefreshing) {
            isRefreshing = true;
            if (navigator.vibrate) navigator.vibrate(50);
            await refreshBoard();
            if (loadError) showToast('Couldn’t refresh. Check your signal and try again.', 'error');
            setTimeout(() => {
                ptrIndicator.classList.remove('active');
                isRefreshing = false;
                startY = 0;
            }, 800);
        } else {
            ptrIndicator.classList.remove('active');
            startY = 0;
        }
    });

    // Swipe a card: left = join / accept, right = take back your own bet nobody's in yet.
    // Every action still asks to confirm.
    let touchStart = null;
    wagersContainer.addEventListener('touchstart', (e) => {
        const onControl = e.target.closest('input, textarea, select, button, a');
        const card = e.target.closest('[id^="wager-card-"]');
        touchStart = onControl || !card ? null : { x: e.changedTouches[0].screenX, y: e.changedTouches[0].screenY, card };
    }, { passive: true });

    wagersContainer.addEventListener('touchend', (e) => {
        if (!touchStart) return;
        const dx = e.changedTouches[0].screenX - touchStart.x;
        const dy = e.changedTouches[0].screenY - touchStart.y;
        const card = touchStart.card;
        touchStart = null;
        if (Math.abs(dx) < 100 || Math.abs(dy) > 40) return; // a scroll, not a swipe
        const btn = card.querySelector(dx < 0 ? '.accept-btn, .join-btn' : '.delete-ok');
        if (btn && !btn.disabled) btn.click();
    }, { passive: true });
}

// ==========================================
// Modal
// ==========================================
const INERT_WHILE_MODAL = ['.site-header', 'main', '#mobile-bottom-nav', '#fab-create-wager-btn'];

function showModalForm(which) {
    authForm.style.display = which === 'auth' ? 'block' : 'none';
    createWagerForm.style.display = which === 'create' ? 'block' : 'none';
    settleWagerForm.style.display = which === 'settle' ? 'block' : 'none';
}

function openModal(focusEl) {
    if (!modal.classList.contains('active')) modalReturnFocus = document.activeElement;
    modal.classList.add('active');
    document.body.classList.add('modal-open');
    INERT_WHILE_MODAL.forEach(sel => document.querySelectorAll(sel).forEach(el => { el.inert = true; }));
    const target = focusEl || modal.querySelector('form[style*="block"] input:not([type="hidden"]), form[style*="block"] select');
    if (target) setTimeout(() => target.focus({ preventScroll: true }), 50);
}

function closeModal() {
    modal.classList.remove('active');
    document.body.classList.remove('modal-open');
    INERT_WHILE_MODAL.forEach(sel => document.querySelectorAll(sel).forEach(el => { el.inert = false; }));
    // A sheet that opened on arrival (?mode=) has nothing to go back to: land on the wall's first button
    const back = modalReturnFocus && modalReturnFocus !== document.body ? modalReturnFocus : (wallState === 'out' && wallButtons.querySelector('.wall-btn'));
    if (back && document.contains(back)) back.focus({ preventScroll: true });
    modalReturnFocus = null;
}

// ==========================================
// Auth Logic
// ==========================================
// This page's address for email and Google links to come back to (keeps ?next=).
function pageUrl() {
    return window.location.origin + window.location.pathname + (NEXT ? `?next=${NEXT}` : '');
}

function goToNextPage() {
    showChecking(NEXT === 'rsvp' ? 'You’re logged in. Taking you to your RSVP…' : 'You’re logged in. Taking you back…');
    wallState = 'leaving'; // from here a slow page load only gets the "taking longer" note
    showToast('You’re logged in. Taking you back…', 'success');
    window.location.replace(NEXT_PAGES[NEXT]);
}

// Google buttons only show when trip-config.js turns them on AND the Google provider
// is switched on in Supabase.
async function showGoogleButtonsIfEnabled() {
    if (!(BBB.auth && BBB.auth.google)) return;
    try {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_KEY } });
        const settings = res.ok ? await res.json() : null;
        const on = !!(settings && settings.external && settings.external.google);
        document.querySelectorAll('[data-google-block]').forEach(el => { el.hidden = !on; });
    } catch (e) { /* offline or blocked: email login still works */ }
}

async function signInWithGoogle() {
    const { error } = await supabaseClient.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: pageUrl() } });
    if (error) showToast(friendlyAuthError(error), 'error');
}

// FormSubmit relays these to the alerts inbox in trip-config.js. Never throws. Callers that
// leave the page right after wait for it (up to a few seconds) so the redirect can't cancel it.
function sendAlert(subject, fields) {
    if (!ALERTS.to) return Promise.resolve(false);
    const body = Object.assign({}, fields, { _subject: subject, _template: 'table' });
    if (ALERTS.cc) body._cc = ALERTS.cc;
    const sent = fetch(`https://formsubmit.co/ajax/${ALERTS.to}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(body)
    }).then(res => res.ok).catch(err => { console.error('Alert email failed:', err); return false; });
    const timeout = new Promise(resolve => setTimeout(() => resolve(false), 2500));
    return Promise.race([sent, timeout]);
}

function tidyName(value) {
    let name = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!/[A-Z]/.test(name)) name = name.replace(/(^|[\s'-])([a-z])/g, (m, pre, ch) => pre + ch.toUpperCase());
    return name;
}

function checkNewName(name) {
    if (!/^\S+(\s+\S+)+$/.test(name) || !/[a-z]/i.test(name) || name.length < 3) {
        throw new Error('Enter your first and last name.');
    }
}

function syncNewNameField(select, inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const isNew = select.value === NEW_PLAYER;
    input.closest('.new-name-wrap').hidden = !isNew;
    input.required = isNew;
    if (isNew) setTimeout(() => input.focus(), 30);
}

// A new guy adds himself to the roster as 'potential'; the commissioner approves him in Admin.
async function joinRoster(name, email) {
    const { data, error } = await supabaseClient.rpc('join_roster', { p_name: name });
    if (error) throw error;
    if (data && data.created) {
        // Awaited: a return trip (?next=rsvp) redirects right after this
        await sendAlert(`BBB new player: ${data.name} (needs approval)`, {
            name: data.name,
            email: email || '—',
            next_step: 'Approve them in Admin → RSVPs so they show on the site.'
        });
    }
    return data;
}

async function findLinkedPlayer(userId) {
    const { data, error } = await supabaseClient
        .from('players')
        .select('*')
        .eq('user_id', userId)
        .limit(1);
    if (error) throw error;
    return data && data.length ? data[0] : null;
}

// Link a login to an unclaimed roster spot. Returns true only if a row actually changed.
async function claimPlayer(playerId, userId) {
    const { data, error } = await supabaseClient
        .from('players')
        .update({ user_id: userId })
        .eq('id', playerId)
        .is('user_id', null)
        .select('id');
    return !error && !!data && data.length > 0;
}

const isMissingFunction = err => /PGRST202|could not find the function/i.test(`${err && err.code} ${err && err.message}`);

// The roster spot (or new-player name) saved at sign-up is used once. After it's linked, or
// can never work, it's cleared, so a sign-up the commissioner removes isn't re-added on
// the next visit.
function hasSignupChoice(user) {
    const meta = (user && user.user_metadata) || {};
    return !!(meta.new_player_name || meta.player_id);
}

async function forgetSignupChoice(user) {
    if (!hasSignupChoice(user)) return;
    const { error } = await supabaseClient.auth.updateUser({ data: { new_player_name: null, player_id: null } });
    if (error) console.error('Could not clear the sign-up choice:', error);
}

// Sign-ups that needed email confirmation carry their roster spot (or, for a new guy, the
// name he signed up with) in the account metadata; it's linked the first time they log in.
async function claimFromSignup(user) {
    const meta = (user && user.user_metadata) || {};
    if (meta.new_player_name) {
        try {
            await joinRoster(meta.new_player_name, user.email);
        } catch (err) {
            // A taken or invalid name will never work; a function that isn't set up yet might later
            if (!isMissingFunction(err)) await forgetSignupChoice(user);
            throw err;
        }
        return findLinkedPlayer(user.id);
    }
    const pid = meta.player_id;
    if (!pid) return null;
    if (await claimPlayer(pid, user.id)) return findLinkedPlayer(user.id);
    // Not claimed. If that spot is gone or now someone else's, retrying can't help: say why.
    const { data, error } = await supabaseClient.from('players').select('user_id').eq('id', pid).limit(1);
    if (!error && data && (!data.length || data[0].user_id)) {
        await forgetSignupChoice(user);
        const name = meta.roster_name || 'The roster name you picked';
        throw new Error(data.length
            ? `${name} is already linked to another login. Text the commissioner to sort it out.`
            : `${name} isn’t on the roster any more. Text the commissioner.`);
    }
    return null;
}

// A login made elsewhere (Admin, Round Tracker) links itself when its email is on the roster.
async function claimByEmail(user) {
    const email = normName(user && user.email);
    if (!email) return null;
    const { data, error } = await supabaseClient.from('players').select('id, email, user_id').is('user_id', null);
    if (error || !data) return null;
    const match = data.find(p => normName(p.email) === email);
    if (!match || !(await claimPlayer(match.id, user.id))) return null;
    return findLinkedPlayer(user.id);
}

// Roster names that don't have a Bookie login yet
async function unclaimedRoster() {
    const { data, error } = await supabaseClient.from('players').select('id, name, user_id').is('user_id', null).order('name');
    if (error) throw error;
    return (data || []).filter(p => !p.user_id);
}

const NEW_PLAYER_OPTION = `<option value="${NEW_PLAYER}">I’m new: add me to the roster</option>`;

async function showLinkPicker(user) {
    const box = document.getElementById('link-roster');
    const select = document.getElementById('link-roster-select');
    if (!box || !select) return;
    let open = [];
    try {
        open = await unclaimedRoster();
    } catch (e) {
        console.error('Could not load the roster:', e);
    }
    select.innerHTML = '<option value="">Pick your name…</option>' +
        open.map(p => `<option value="${escHtml(p.id)}">${escHtml(p.name)}</option>`).join('') + NEW_PLAYER_OPTION;
    // Google accounts come with a name; use it as the starting guess for a new guy
    const meta = (user && user.user_metadata) || {};
    const newName = document.getElementById('link-new-name');
    if (newName && !newName.value) newName.value = tidyName(meta.full_name || meta.name || '');
    syncNewNameField(select, 'link-new-name');
    box.hidden = false;
}

async function linkSelectedName() {
    const select = document.getElementById('link-roster-select');
    const btn = document.getElementById('link-roster-btn');
    if (!select.value) return showToast('Pick your name from the list first.', 'error');
    const isNew = select.value === NEW_PLAYER;
    const name = isNew ? tidyName(document.getElementById('link-new-name').value) : select.options[select.selectedIndex].text;
    if (isNew) {
        try { checkNewName(name); } catch (err) { return showToast(err.message, 'error'); }
    }
    const question = isNew
        ? `Add ${name} to the trip roster? The commissioner confirms new players.`
        : `Link this login to ${name}? Only do this if you're ${name}.`;
    if (!confirm(question)) return;

    btn.disabled = true;
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) return showWall();
        if (isNew) {
            try {
                await joinRoster(name, session.user.email);
            } catch (err) {
                showToast(friendlyAuthError(err), 'error');
                return;
            }
        } else if (!(await claimPlayer(select.value, session.user.id))) {
            showToast(`Couldn’t link ${name}: it’s linked to another login or reserved for the commissioner. Text the commissioner.`, 'error');
            await showLinkPicker(session.user);
            return;
        }
        showToast(isNew ? `You’re on the list, ${name.split(' ')[0]}.` : `Linked. Welcome, ${name.split(' ')[0]}.`, 'success');
        await loadSession();
    } finally {
        btn.disabled = false;
    }
}

async function loadSession() {
    let session = null;
    try {
        ({ data: { session } } = await supabaseClient.auth.getSession());
    } catch (e) {
        console.error('Session check failed:', e);
    }
    loginExpected = !!session;
    if (!session) {
        currentUser = null;
        showWall();
        return false;
    }

    // The round tracker and Admin only need a login, not a roster name
    if ((NEXT === 'round' || NEXT === 'admin') && !resetPending) {
        goToNextPage();
        return true;
    }

    // Each way of finding the roster spot gets its own try, so one failing doesn't skip the rest
    let player = null;
    let linkProblem = '';
    try {
        player = await findLinkedPlayer(session.user.id);
    } catch (e) {
        console.error('Could not load your roster spot:', e);
    }
    if (!player) {
        try {
            player = await claimFromSignup(session.user);
        } catch (e) {
            console.error('Could not link the name from your sign-up:', e);
            linkProblem = friendlyAuthError(e);
        }
    }
    if (!player) {
        try {
            player = await claimByEmail(session.user);
        } catch (e) {
            console.error('Could not link by email:', e);
        }
    }
    if (!player) {
        currentUser = null;
        showWall(`${linkProblem ? linkProblem + ' ' : ''}You’re logged in as ${session.user.email || 'this account'}, but that login isn’t linked to a name on the trip roster yet. First trip? Choose “I’m new” at the bottom of the list.`, true);
        await showLinkPicker(session.user);
        return false;
    }
    // Awaited: the redirect below would otherwise cancel the request
    if (hasSignupChoice(session.user)) await forgetSignupChoice(session.user);

    if (NEXT && !resetPending) {
        goToNextPage();
        return true;
    }

    // New guys can RSVP right away, but betting waits until the commissioner confirms them.
    if (player.status === 'potential') {
        currentUser = null;
        showWall('', true, { pending: true, name: String(player.name).split(' ')[0] });
        return false;
    }

    currentUser = player;
    // Admin buttons follow the database's own rule (an is_admin roster row with this login's email),
    // so the page never offers an admin action the database will refuse
    try {
        const { data: isAdmin, error: adminError } = await supabaseClient.rpc('is_trip_admin');
        if (!adminError) currentUser.is_admin = !!isAdmin;
    } catch (e) { /* keep the roster flag */ }
    showDashboard();
    showBoardSkeleton();
    await refreshBoard();
    return true;
}

const WALL_ICONS = {
    checking: '<span class="wall-spinner"></span>',
    bookie: '<i class="fas fa-user-secret"></i>',
    trip: '<img src="bbb-logo.svg" alt="" width="64" height="64">'
};

function setWallCopy(title, text, icon) {
    wallTitle.textContent = title;
    wallText.textContent = text || '';
    wallText.hidden = !text;
    if (wallIcon.dataset.icon !== icon) {
        wallIcon.innerHTML = WALL_ICONS[icon];
        wallIcon.dataset.icon = icon;
    }
}

function setNavLogin(signedIn) {
    navLoginBtn.closest('li').hidden = false;
    navLoginBtn.dataset.signedIn = signedIn ? 'true' : 'false';
    navLoginBtn.textContent = signedIn ? 'Log out' : 'Log in';
}

// While the login check runs (and on the way back to ?next=) the wall says so, with no Log in
// buttons a signed-in player or someone fresh from the confirmation email could mistake as meant for them.
let checkingTimer = null;
// True once a login is known (a stored session, a log-in that just went through, or an email
// link being exchanged), so a slow check never falls back to "Log in" / "Create my account".
let loginExpected = CAME_FROM_AUTH_LINK && !LINK_ERROR;

// Nobody stays on the checking screen. The clock restarts when the check itself starts
// (startBookie), so a slow page load doesn't count against it.
function armCheckingTimeout() {
    clearTimeout(checkingTimer);
    checkingTimer = setTimeout(checkingTimedOut, 10000);
}
function checkingTimedOut() {
    if (wallState !== 'checking' && wallState !== 'leaving') return;
    // The page's load event is what stalled (a slow font file): start the check now
    if (!bookieStarted) return startBookie();
    if (loginExpected || wallState === 'leaving') {
        // Logged in, just a weak signal: keep the message and say what to do
        authWallNote.textContent = 'Taking longer than usual. Check your signal. If nothing happens, refresh the page.';
        authWallNote.hidden = false;
        return;
    }
    showWall(); // still no login after all this time: the normal logged-out wall
}

function showChecking(message) {
    wallState = 'checking';
    armCheckingTimeout();
    navLoginBtn.closest('li').hidden = true; // no "Log in" while logging in
    document.body.classList.remove('is-authed');
    authWall.style.display = 'block';
    authWall.setAttribute('aria-busy', 'true');
    dashboard.style.display = 'none';
    setWallCopy(message, '', 'checking');
    authWallNote.hidden = true;
    wallButtons.hidden = true;
    wallBackLink.hidden = true;
    document.getElementById('link-roster').hidden = true;
    document.getElementById('wall-rsvp-link').hidden = true;
}

function showWall(note, signedIn, opts) {
    opts = opts || {};
    wallState = signedIn ? 'in' : 'out';
    document.body.classList.remove('is-authed');
    authWall.style.display = 'block';
    authWall.removeAttribute('aria-busy');
    dashboard.style.display = 'none';
    authWallNote.textContent = note || '';
    authWallNote.hidden = !note;
    // Logged in but not able to bet yet (unlinked or awaiting the commissioner): don't say "log in".
    // After a failed email link the note says what to do, so the "set up your account" line goes.
    const icon = NEXT ? 'trip' : 'bookie';
    if (opts.pending) {
        setWallCopy(`You’re signed up, ${opts.name}`, 'You can RSVP now. Betting opens once the commissioner confirms you for the trip.', icon);
    } else if (signedIn) {
        setWallCopy(WALL.unlinkedTitle, WALL.unlinkedText, icon);
    } else {
        setWallCopy(WALL.title, opts.linkError ? '' : WALL.text, icon);
    }
    // Signed in but unlinked: offer the name picker instead of log in / create account
    wallButtons.hidden = !!signedIn;
    if (!signedIn) {
        // Someone with a failed email link already has an account, so Log in comes first
        const loginFirst = opts.linkError || WALL.primary === 'login';
        wallLoginBtn.textContent = WALL.login;
        wallRegisterBtn.textContent = WALL.register;
        wallLoginBtn.classList.toggle('btn-primary', loginFirst);
        wallLoginBtn.classList.toggle('btn-ghost', !loginFirst);
        wallRegisterBtn.classList.toggle('btn-primary', !loginFirst);
        wallRegisterBtn.classList.toggle('btn-ghost', loginFirst);
        wallButtons.insertBefore(loginFirst ? wallLoginBtn : wallRegisterBtn, loginFirst ? wallRegisterBtn : wallLoginBtn);
    }
    wallBackLink.hidden = !NEXT;
    const linkBox = document.getElementById('link-roster');
    if (!signedIn || opts.pending) linkBox.hidden = true;
    document.getElementById('wall-rsvp-link').hidden = !opts.pending;
    setNavLogin(signedIn);
}

function showDashboard() {
    wallState = 'dashboard';
    document.body.classList.add('is-authed');
    authWall.style.display = 'none';
    authWall.removeAttribute('aria-busy');
    dashboard.style.display = 'block';
    currentUserNameEl.textContent = currentUser.name;
    setNavLogin(true);
}

function setAuthMessage(text, isError) {
    authErrorEl.style.display = 'none';
    authNoticeEl.style.display = 'none';
    if (!text) return;
    const el = isError ? authErrorEl : authNoticeEl;
    el.textContent = text;
    el.style.display = 'block';
}

function openAuthModal(mode) {
    authMode = mode;
    setAuthMessage('');
    authForm.reset();
    showModalForm('auth');

    const isRegister = mode === 'register';
    const isReset = mode === 'reset';
    registerFields.style.display = isRegister ? 'block' : 'none';
    emailFields.style.display = isReset ? 'none' : 'block';
    authNameInput.required = isRegister;
    authEmailInput.required = !isReset;
    authPasswordLabel.textContent = isReset ? 'New password' : 'Password';
    authPasswordInput.autocomplete = isReset || isRegister ? 'new-password' : 'current-password';
    syncNewNameField(authNameInput, 'auth-new-name');
    const googleBlock = document.getElementById('auth-google');
    if (googleBlock) googleBlock.style.display = isReset ? 'none' : '';
    // '' leaves the layout (44px tap targets) to the stylesheet
    if (forgotPasswordBtn) forgotPasswordBtn.style.display = mode === 'login' ? '' : 'none';
    toggleAuthModeBtn.parentElement.style.display = isReset ? 'none' : '';
    // Here to RSVP: say where this is going ("Step 1 of 2 · Scottsdale · Apr 8–11")
    modalEyebrow.textContent = ['Step 1 of 2', TRIP_CITY, TRIP_DATES].filter(Boolean).join(' · ');
    modalEyebrow.hidden = NEXT !== 'rsvp' || isReset;

    if (isRegister) {
        // One player account covers RSVPs, betting and the round tracker
        modalTitle.textContent = 'Create your player account';
        authSubmitBtn.textContent = 'Create my account';
        toggleAuthModeBtn.textContent = 'Already have an account? Log in';
        loadRosterChoices();
    } else if (isReset) {
        modalTitle.textContent = LINK_PARAMS.get('type') === 'invite' ? 'Choose your password' : 'Choose a new password';
        authSubmitBtn.textContent = 'Save password';
    } else {
        modalTitle.textContent = NEXT ? 'Log in' : 'Log in to The Bookie';
        authSubmitBtn.textContent = 'Log in';
        toggleAuthModeBtn.textContent = 'New here? Create an account';
    }

    openModal(isRegister ? authNameInput : (isReset ? authPasswordInput : authEmailInput));
}

// Sign-up picks a roster name from a list (no typos, no look-alike names)
async function loadRosterChoices() {
    authNameInput.innerHTML = '<option value="">Loading the roster…</option>';
    try {
        const open = await unclaimedRoster();
        authNameInput.innerHTML = '<option value="">Pick your name…</option>' +
            open.map(p => `<option value="${escHtml(p.id)}">${escHtml(p.name)}</option>`).join('') + NEW_PLAYER_OPTION;
    } catch (e) {
        authNameInput.innerHTML = '<option value="">Couldn’t load the roster. Close and try again.</option>';
    }
    syncNewNameField(authNameInput, 'auth-new-name');
}

function friendlyAuthError(err) {
    const msg = (err && err.message) || String(err);
    if (/invalid login credentials/i.test(msg)) return 'That email and password don’t match. Try again, or tap “Forgot password?”.';
    if (/email not confirmed/i.test(msg)) return 'Confirm your email first: open the link we sent you, then log in here. Link expired? Tap “Forgot password?” below for a fresh one.';
    if (/already registered/i.test(msg)) return 'That email already has a login (maybe from the Round Tracker or Admin). Log in with it instead, then pick your name to link it.';
    if (/password should be at least/i.test(msg)) return 'Pick a password with at least 6 characters.';
    if (isMissingFunction(err)) return 'This part of the site is still being set up. Try again in a few minutes, or text the commissioner.';
    return msg;
}

// With "Confirm email" on, Supabase doesn't say an email is taken: it returns a user with no
// identities and sends no email. Treat that like the "already registered" error.
function assertNewAccount(authData) {
    const user = authData && authData.user;
    if (authData && !authData.session && user && Array.isArray(user.identities) && user.identities.length === 0) {
        throw new Error('User already registered');
    }
}

// A new guy: account first, then join_roster adds him as 'potential' (right away, or on his
// first login when email confirmation is on).
async function registerNewPlayer(rawName, email, password) {
    const name = tidyName(rawName);
    checkNewName(name);
    const { data: everyone, error } = await supabaseClient.from('players').select('name, user_id');
    if (error) throw error;
    const same = (everyone || []).find(p => normName(p.name) === normName(name));
    if (same && same.user_id) {
        throw new Error(`${same.name} already has an account. Tap “Already have an account? Log in” below, and use “Forgot password?” there if you need to.`);
    }
    if (same) throw new Error(`${same.name} is already on the roster. Pick that name from the list instead.`);

    const { data: authData, error: regError } = await supabaseClient.auth.signUp({
        email,
        password,
        options: { data: { new_player_name: name, roster_name: name }, emailRedirectTo: pageUrl() }
    });
    if (regError) throw regError;
    assertNewAccount(authData);
    if (!authData.session) return 'confirm';
    await joinRoster(name, email);
    return 'linked';
}

async function registerAccount(playerId, email, password, newName) {
    if (playerId === NEW_PLAYER) return registerNewPlayer(newName, email, password);
    // Only guys on the trip roster can open an account; re-check the spot is still free
    if (!playerId) throw new Error('Pick your name from the roster list, or “I’m new” if it isn’t there.');
    const open = await unclaimedRoster();
    const match = open.find(p => p.id === playerId);
    if (!match) {
        await loadRosterChoices();
        throw new Error('That name already has a player account. Log in instead, or tap “Forgot password?”.');
    }

    const { data: authData, error: regError } = await supabaseClient.auth.signUp({
        email,
        password,
        options: { data: { player_id: match.id, roster_name: match.name }, emailRedirectTo: pageUrl() }
    });
    if (regError) throw regError;
    assertNewAccount(authData);

    // Email confirmation is on: the roster spot is linked on their first login
    if (!authData.session) return 'confirm';

    if (!(await claimPlayer(match.id, authData.session.user.id))) {
        throw new Error(`Your login was created, but ${match.name}’s roster spot couldn’t be linked. Ask the commissioner to link it.`);
    }
    return 'linked';
}

async function handleAuthSubmit(e) {
    e.preventDefault();
    setAuthMessage('');
    authSubmitBtn.disabled = true;
    const idleLabel = authSubmitBtn.textContent;
    authSubmitBtn.textContent = 'Working…';

    const email = authEmailInput.value.trim();
    const password = authPasswordInput.value;
    const playerId = authNameInput.value;

    try {
        if (authMode === 'reset') {
            const { error } = await supabaseClient.auth.updateUser({ password });
            if (error) throw error;
            resetPending = false;
            closeModal();
            showToast('Password updated. You’re logged in.', 'success');
            await loadSession();
            return;
        }

        if (authMode === 'register') {
            const newName = document.getElementById('auth-new-name').value;
            const result = await registerAccount(playerId, email, password, newName);
            if (result === 'confirm') {
                // The email's link logs them in and brings them back here (with ?next= kept)
                setAuthMessage(`Almost done: check ${email} for “Confirm your email” from Bros before Boges. Tap the link in it and you’ll be logged in${NEXT === 'rsvp' ? ' and taken straight to the RSVP' : ''}. Nothing after a few minutes? Check spam, or ask the commissioner.`, false);
                return;
            }
            showToast('Account created. You’re in.', 'success');
            // The name picked at sign-up has been used: clear it now, whichever page comes next
            const { data: { session: newSession } } = await supabaseClient.auth.getSession();
            if (newSession) await forgetSignupChoice(newSession.user);
        } else {
            const { error: loginError } = await supabaseClient.auth.signInWithPassword({ email, password });
            if (loginError) throw loginError;
        }

        closeModal();
        loginExpected = true;
        showChecking('Logging you in…'); // not the logged-out wall while the roster link loads
        await loadSession();
    } catch (err) {
        // A sign-up can create the account (and sign in) and still fail to link the name. Then
        // show the signed-in page: it says what went wrong and offers the name picker.
        if (authMode === 'register') {
            let session = null;
            try {
                ({ data: { session } } = await supabaseClient.auth.getSession());
            } catch (e) { /* treated as not signed in */ }
            if (session) {
                closeModal();
                await loadSession(); // retries the link
                // Only mention the problem if the retry didn't link the name either
                const picker = document.getElementById('link-roster');
                if (picker && !picker.hidden) showToast(friendlyAuthError(err), 'error');
                return;
            }
        }
        setAuthMessage(friendlyAuthError(err), true);
    } finally {
        authSubmitBtn.disabled = false;
        authSubmitBtn.textContent = idleLabel;
    }
}

async function sendPasswordReset(e) {
    if (e) e.preventDefault();
    const email = authEmailInput.value.trim();
    if (!email) {
        setAuthMessage('Enter your email above, then tap “Forgot password?” again.', true);
        authEmailInput.focus();
        return;
    }
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: pageUrl() });
    if (error) {
        setAuthMessage(friendlyAuthError(error), true);
    } else {
        setAuthMessage('If that email has a player account, a reset link is on its way. Open it on this phone. Nothing after a few minutes? Ask the commissioner.', false);
    }
}

// Local sign-out only: a global one would also log this player out of the Round Tracker
// on their other devices mid-round.
async function handleLogout() {
    await supabaseClient.auth.signOut({ scope: 'local' });
    currentUser = null;
    showWall();
}

// ==========================================
// Data
// ==========================================
async function fetchBaseData() {
    loadError = null;

    const { data: players, error: playersError } = await supabaseClient
        .from('players')
        .select('id, name, team_id, user_id, status')
        .order('status') // 'confirmed' before 'potential', so real players always load
        .order('name');
    if (players) dbPlayers = players;
    if (playersError) console.error('Players failed to load:', playersError);

    const { data: wagers, error: wagersError } = await supabaseClient
        .from('wagers')
        .select(`
            *,
            creator:creator_id(name),
            target:target_id(name),
            winner:winner_id(name)
        `)
        .order('created_at', { ascending: false });
    if (wagersError) {
        console.error('Wagers failed to load:', wagersError);
        loadError = wagersError;
    } else {
        // One malformed row shouldn't take the whole board down
        const idList = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : []);
        allWagers = (wagers || []).map(w => Object.assign(w, {
            participants: idList(w.participants),
            winner_ids: idList(w.winner_ids),
            amount: Number(w.amount) || 0
        }));
    }

    const { data: comments, error: commentsError } = await supabaseClient
        .from('wager_comments')
        .select(`
            *,
            player:player_id (name)
        `);
    if (commentsError) console.warn('Trash talk failed to load:', commentsError);
    else allComments = comments || [];

    // Once per visit: who has said they're out this year (fails open: everyone stays listed)
    if (rsvpOut === null) {
        try {
            const { data: rsvps, error: rsvpError } = await supabaseClient.rpc('rsvp_latest', { p_trip_year: TRIP_YEAR });
            if (rsvpError) throw rsvpError;
            rsvpOut = new Set((rsvps || []).filter(r => r.status === 'out' && r.player_id).map(r => r.player_id));
        } catch (e) {
            rsvpOut = new Set();
        }
    }
}

async function refreshBoard() {
    await fetchBaseData();
    renderDashboard();
    lastRefresh = Date.now();
}

// The Refresh button: spins while it works
async function refreshNow(btn) {
    if (btn.getAttribute('aria-busy') === 'true') return;
    btn.setAttribute('aria-busy', 'true'); // not disabled, so keyboard focus stays put
    const icon = btn.querySelector('i');
    if (icon) icon.classList.add('fa-spin');
    try {
        await refreshBoard();
        if (loadError) showToast('Couldn’t refresh. Check your signal and try again.', 'error');
    } finally {
        btn.removeAttribute('aria-busy');
        if (icon) icon.classList.remove('fa-spin');
    }
}
window.refreshBoard = refreshBoard;

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// A request that never reached the server (no signal) reads "Load failed" on iPhone.
// Say what it means, and reload the board so it shows what actually saved.
function isNetworkError(err) {
    return /Failed to fetch|Load failed|NetworkError|network connection|fetch failed/i.test((err && err.message) || String(err || ''));
}
function actionError(prefix, err) {
    if (isNetworkError(err)) {
        showToast('No signal. That may not have gone through. Check the board once you have a bar or two.', 'error');
        refreshBoard().catch(() => {});
        return;
    }
    showToast(`${prefix}: ${(err && err.message) || err}`, 'error');
}

// Runs one action on a bet. Its buttons stay disabled until the action finishes, so a second
// tap on a slow signal can't send it twice (and show a false "someone changed it" error).
async function withBusyWager(id, work) {
    if (busyWagers.has(id)) return;
    busyWagers.add(id);
    const card = document.getElementById(`wager-card-${id}`);
    const hadFocus = !!card && card.contains(document.activeElement);
    const buttons = card ? [...card.querySelectorAll('button')] : [];
    buttons.forEach(b => { b.disabled = true; });
    try {
        await work();
    } finally {
        busyWagers.delete(id);
        buttons.forEach(b => { if (b.isConnected) b.disabled = false; });
        if (hadFocus) focusCard(id);
    }
}

// After a card re-renders, put keyboard focus back on it (its first button, or the card)
function focusCard(id) {
    if (document.activeElement && document.activeElement !== document.body && !wagersContainer.contains(document.activeElement)) return;
    const card = document.getElementById(`wager-card-${id}`);
    if (!card) {
        const next = wagersContainer.querySelector('[id^="wager-card-"] button:not([disabled])') || document.querySelector('.bookie-nav button.active');
        if (next) next.focus({ preventScroll: true });
        return;
    }
    const btn = card.querySelector('button:not([disabled])');
    if (btn) btn.focus({ preventScroll: true });
    else { card.tabIndex = -1; card.focus({ preventScroll: true }); }
}

// Scroll a card into view and flash it (after creating a bet, for example)
function revealCard(id) {
    const card = document.getElementById(`wager-card-${id}`);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.remove('success-pop');
    void card.offsetWidth;
    card.classList.add('success-pop');
}

// Update one wager only while it is still in an expected state, so a stale screen can't
// overwrite a newer result. Returns false when someone else changed the bet first.
async function updateWager(id, values, expectedStatuses, extraFilter) {
    let q = supabaseClient.from('wagers').update(values).eq('id', id).in('status', expectedStatuses);
    if (extraFilter) q = extraFilter(q);
    const { data, error } = await q.select('id');
    if (error) throw error;
    if (data && data.length > 0) return true;
    // Nothing changed. If the bet already looks exactly like this, an earlier try went through
    // and only its reply was lost (a retry on bad signal): that's a success, not a conflict.
    const { data: now } = await supabaseClient.from('wagers').select('*').eq('id', id).maybeSingle();
    return !!now && Object.keys(values).every(k => JSON.stringify(now[k] === undefined ? null : now[k]) === JSON.stringify(values[k]));
}

async function betChangedUnderYou(message) {
    showToast(message || 'That bet just changed on someone else’s phone. Here’s the latest.', 'error');
    // Close the Settle sheet it came from, but never a Create sheet someone is typing in
    if (settleWagerForm.style.display === 'block') closeModal();
    await refreshBoard();
}

// Leaves a note in the bet's trash talk so everyone can see who settled or called it off.
async function logBetNote(wagerId, message) {
    if (!currentUser) return;
    try {
        await supabaseClient.from('wager_comments').insert({ wager_id: wagerId, player_id: currentUser.id, message });
    } catch (e) {
        console.warn('Could not log bet note:', e);
    }
}

// ==========================================
// Rendering
// ==========================================
function renderDashboard() {
    renderCupCard();
    renderWagers();
    renderLedger();
    updateNotificationBadges();
}

function setFilter(filter) {
    currentFilter = filter;
    document.querySelectorAll('.bookie-nav button[data-filter], .bottom-nav-btn[data-filter]').forEach(b => {
        const on = b.dataset.filter === filter;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
    });
    // The Cup card belongs on the main board only
    const cupCard = document.getElementById('cup-card');
    if (cupCard) cupCard.hidden = filter !== 'all';
    renderWagers();
    // Scrolled down the list (or at the ledger)? Jump back to the top of the new list.
    const nav = document.querySelector('.bookie-nav');
    if (nav && nav.getBoundingClientRect().top < 0) nav.scrollIntoView({ block: 'start' });
}

// Bets waiting on you: a challenge to answer, or your pool or prop to settle after betting closed.
// (Either player can settle a head-to-head, so those aren't flagged.)
function needsMe(w) {
    if (!currentUser || !isCurrentSeason(w)) return false;
    const me = currentUser.id;
    return (w.status === 'proposed' && w.target_id === me) ||
        (w.type !== 'h2h' && w.status === 'active' && w.creator_id === me);
}

function updateNotificationBadges() {
    if (!currentUser) return;

    const mine = allWagers.filter(needsMe);
    const counts = { h2h: mine.filter(w => w.type === 'h2h').length, pools: mine.filter(w => w.type !== 'h2h').length, me: mine.length };
    document.querySelectorAll('button[data-filter="h2h"], button[data-filter="pools"], button[data-filter="me"]').forEach(btn => {
        const waiting = counts[btn.dataset.filter] || 0;
        const label = waiting === 1 ? '1 bet needs you' : `${waiting} bets need you`;
        let badge = btn.querySelector('.count-badge');
        if (!waiting) {
            if (badge) badge.remove();
            return;
        }
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'count-badge';
            btn.appendChild(badge);
        }
        if (badge.textContent !== String(waiting)) badge.textContent = String(waiting);
        badge.setAttribute('aria-label', label);
    });
}

// The Cup card: last year's final score stays out of it until the new Cup is live.
async function renderCupCard() {
    const yearEl = document.getElementById('cup-card-year');
    const noteEl = document.getElementById('cup-card-note');
    if (yearEl) yearEl.textContent = TRIP_YEAR;

    if (!SEASON_LIVE || !supabaseClient) {
        if (ryderBluePts) ryderBluePts.textContent = '–';
        if (ryderRedPts) ryderRedPts.textContent = '–';
        if (noteEl) noteEl.textContent = 'Points show up here once the Cup starts.';
        return;
    }
    try {
        const { data, error } = await supabaseClient
            .from('ryder_cup_scores')
            .select('*')
            .eq('id', 1)
            .maybeSingle();
        if (error) throw error;
        if (ryderBluePts) ryderBluePts.textContent = fmtPoints(data ? data.blue_score : 0);
        if (ryderRedPts) ryderRedPts.textContent = fmtPoints(data ? data.red_score : 0);
        if (noteEl) noteEl.textContent = '';
    } catch (err) {
        console.error('Error fetching Cup scores for the Bookie:', err);
    }
}

function wagersForFilter(filter) {
    const current = allWagers.filter(isCurrentSeason);
    switch (filter) {
        case 'pools': return current.filter(w => w.type === 'pool' || w.type === 'prop');
        case 'h2h': return current.filter(w => w.type === 'h2h');
        case 'me': return current.filter(involvesMe);
        case 'past': return allWagers.filter(w => !isCurrentSeason(w));
        // The main board skips called-off bets; they're still under My Wagers and the type tabs
        default: return current.filter(w => w.status !== 'canceled');
    }
}

// Board order: challenges waiting on you, then live bets, then finished ones (newest first within each)
function boardRank(w) {
    if (needsMe(w)) return 0;
    if (['proposed', 'open', 'active'].includes(w.status)) return 1;
    return 2;
}

const RETRY_BUTTON = '<button type="button" class="refresh-btn" onclick="refreshBoard()"><i class="fas fa-sync-alt" aria-hidden="true"></i>Retry</button>';

function renderWagers() {
    // The Cup card may have been moved in among the cards last time: put it back first
    const cupCard = document.getElementById('cup-card');
    if (cupCard && wagersContainer.contains(cupCard)) wagersContainer.parentNode.insertBefore(cupCard, wagersContainer);

    if (loadError && !allWagers.length) {
        wagersContainer.innerHTML = `
            <div style="text-align: center; padding: 40px; background: rgba(239,68,68,0.06); border-radius: 12px; border: 1px dashed rgba(239,68,68,0.35);">
                <p style="color: var(--text-muted); margin-bottom: 15px;">Couldn’t load the betting board. Check your signal and try again.</p>
                ${RETRY_BUTTON}
            </div>`;
        return;
    }

    const displayWagers = wagersForFilter(currentFilter).sort((a, b) => boardRank(a) - boardRank(b));
    // A refresh that failed while older bets are on screen: say so, instead of silently showing stale data
    const staleBanner = loadError
        ? `<div class="stale-banner" role="status"><span>Couldn’t refresh. This is the last board that loaded.</span>${RETRY_BUTTON}</div>`
        : '';

    if (displayWagers.length === 0) {
        const empty = {
            past: 'No bets from past trips.',
            me: 'You’re not in any bets yet.',
            h2h: 'No head-to-head challenges yet.',
            pools: 'No pools or props yet.'
        }[currentFilter] || 'No action on the board yet.';
        wagersContainer.innerHTML = staleBanner + `
            <div style="text-align: center; padding: 40px; background: rgba(255,255,255,0.02); border-radius: 12px; border: 1px dashed rgba(255,255,255,0.1);">
                <p style="color: var(--text-muted); margin-bottom: 15px;">${empty}</p>
                ${currentFilter === 'past' ? '' : '<button class="btn" style="border: 1px solid var(--accent-emerald); color: var(--accent-emerald);" onclick="openWagerModal()">Be the first to bet</button>'}
            </div>
        `;
        return;
    }

    // Keep open trash-talk threads open, and half-typed comments in their boxes, across re-renders
    const openThreads = new Set([...wagersContainer.querySelectorAll('[id^="comments-"]')]
        .filter(el => el.style.display === 'block').map(el => el.id));
    const drafts = [...wagersContainer.querySelectorAll('input[id^="comment-input-"]')]
        .filter(i => i.value && !i.dataset.posting).map(i => [i.id, i.value]);
    const focusedId = wagersContainer.contains(document.activeElement) && document.activeElement.matches('input[id^="comment-input-"]')
        ? document.activeElement.id : '';

    wagersContainer.innerHTML = staleBanner + displayWagers.map(wagerCardHTML).join('');

    openThreads.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.style.display = 'block';
        const toggle = el.previousElementSibling;
        if (toggle) toggle.setAttribute('aria-expanded', 'true');
        const thread = el.firstElementChild;
        if (thread) thread.scrollTop = thread.scrollHeight; // newest comment in view
    });
    drafts.forEach(([inputId, value]) => {
        const el = document.getElementById(inputId);
        if (el) el.value = value;
    });
    const focused = focusedId && document.getElementById(focusedId);
    if (focused) focused.focus({ preventScroll: true });

    // Bets that need you sit above the Cup card on the main board
    const firstOther = displayWagers.find(w => boardRank(w) !== 0);
    if (cupCard && currentFilter === 'all' && displayWagers.some(w => boardRank(w) === 0)) {
        const anchor = firstOther ? document.getElementById(`wager-card-${firstOther.id}`) : null;
        wagersContainer.insertBefore(cupCard, anchor);
    }
}

const STATUS_BADGES = {
    open: ['Open', 'rgba(16, 185, 129, 0.2)', 'var(--accent-emerald)'],
    proposed: ['Proposed', 'rgba(251, 191, 36, 0.2)', 'var(--accent-gold)'],
    settled: ['Settled', 'rgba(255, 255, 255, 0.1)', 'var(--text-muted)'],
    push: ['Pushed (Tie)', 'rgba(251, 191, 36, 0.1)', 'var(--accent-gold)'],
    canceled: ['Canceled', 'rgba(239, 68, 68, 0.1)', '#ef4444']
};

function statusBadgeHTML(wager) {
    let badge = STATUS_BADGES[wager.status];
    if (wager.status === 'active') {
        badge = [wager.type === 'h2h' ? 'Active' : 'Betting Closed', 'rgba(59, 130, 246, 0.2)', '#60a5fa'];
    }
    if (!badge) return '';
    return `<span style="background: ${badge[1]}; color: ${badge[2]}; padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; white-space: nowrap;">${badge[0]}</span>`;
}

function statPill(label, value, color) {
    return `<div class="stat-pill"${color ? ` style="color: ${color}"` : ''}>${label ? `<span style="color:var(--text-muted)">${label}</span> ` : ''}<span style="font-weight:700">${value}</span></div>`;
}

// What's at stake, per bet type, for the card's stat row
function stakesHTML(wager) {
    const parts = wager.participants || [];
    if (wager.type === 'h2h') {
        const { creatorWins, targetWins } = h2hPayouts(wager.amount, wager.odds);
        const odds = normOdds(wager.odds);
        return statPill(`${escHtml(firstName(wager.creator_id))} wins`, fmtMoney(creatorWins)) +
            statPill(`${escHtml(firstName(wager.target_id))} wins`, fmtMoney(targetWins)) +
            (odds !== 100 && odds !== -100 ? statPill('', `<i class="fas fa-chart-line" aria-hidden="true"></i> ${escHtml(firstName(wager.target_id))} ${fmtOdds(odds)}`, 'var(--accent-gold)') : '');
    }
    if (wager.type === 'prop') {
        const takers = parts.filter(id => id !== wager.creator_id).length;
        return statPill('Per taker', fmtMoney(wager.amount)) +
            statPill(`${escHtml(firstName(wager.creator_id))} covers`, fmtMoney(wager.amount * takers), 'var(--accent-emerald)') +
            statPill('', `${takers} <i class="fas fa-users" style="font-size: 0.8rem; color: var(--text-muted)" aria-label="players"></i>`);
    }
    return statPill('Buy-In', fmtMoney(wager.amount)) +
        statPill('Pot', fmtMoney(wager.amount * parts.length), 'var(--accent-emerald)') +
        statPill('', `${parts.length} <i class="fas fa-users" style="font-size: 0.8rem; color: var(--text-muted)" aria-label="players"></i>`);
}

// Who won and who owes whom, in dollars
function resultsHTML(wager) {
    const box = (color, icon, title, detail) => `
        <div style="margin-top: 15px; padding: 15px; background: ${color}1a; border-radius: 8px; border: 1px solid ${color}33;">
            <div style="color: ${color}; font-weight: 700; margin-bottom: 5px;"><i class="fas ${icon}" aria-hidden="true"></i> ${title}</div>
            <div style="font-size: 0.85rem; color: var(--text-muted);">${detail}</div>
        </div>`;
    const GREEN = '#10b981', GOLD = '#fbbf24', RED = '#ef4444';

    if (wager.status === 'push') return box(GOLD, 'fa-handshake', 'Push (Tie)', 'All bets refunded. No blood drawn.');
    if (wager.status === 'canceled') return box(RED, 'fa-ban', 'Bet Canceled', 'This wager was called off.');
    if (wager.status !== 'settled' || !wager.winner_id) return '';

    const parts = wager.participants || [];
    const winnerIds = wager.winner_ids && wager.winner_ids.length ? wager.winner_ids : [wager.winner_id];
    const name = id => escHtml(getPlayerName(id));

    if (wager.type === 'h2h') {
        const { creatorWins, targetWins } = h2hPayouts(wager.amount, wager.odds);
        const targetWon = wager.winner_id === wager.target_id;
        const loser = targetWon ? wager.creator_id : wager.target_id;
        return box(GREEN, 'fa-trophy', `${name(wager.winner_id)} won`, `${name(loser)} owes ${name(wager.winner_id)} ${fmtMoney(targetWon ? targetWins : creatorWins)}.`);
    }
    if (wager.type === 'prop') {
        const takers = parts.filter(id => id !== wager.creator_id);
        if (winnerIds.includes(wager.creator_id)) {
            return box(GREEN, 'fa-trophy', `${name(wager.creator_id)} won the prop`, `Each taker owes ${name(wager.creator_id)} ${fmtMoney(wager.amount)}: ${takers.map(name).join(', ') || 'nobody'}.`);
        }
        return box(GREEN, 'fa-trophy', 'The takers won', `${name(wager.creator_id)} owes each taker ${fmtMoney(wager.amount)} (${fmtMoney(wager.amount * takers.length)} total).`);
    }
    const winners = parts.filter(id => winnerIds.includes(id));
    const losers = parts.filter(id => !winnerIds.includes(id));
    return box(GREEN, 'fa-trophy', `Won by ${winners.map(name).join(' & ') || 'nobody'}`,
        `${potSplitText(wager.amount, parts.length, winners, name)} ${losers.length ? `${losers.map(name).join(', ')} paid ${fmtMoney(wager.amount)} into the pot.` : ''}`);
}

// "Takes the $30 pot." / "$15 each." / "Jeff $13.34, Kelly $13.33, Zac $13.33." (pennies don't split evenly)
function potSplitText(amount, players, winners, name) {
    const shares = potShares(amount, players, winners.length);
    if (!shares.length) return '';
    if (shares.length === 1) return `Takes the ${fmtMoney(shares[0])} pot.`;
    if (shares.every(s => s === shares[0])) return `${fmtMoney(shares[0])} each.`;
    return winners.map((id, i) => `${name(id)} ${fmtMoney(shares[i])}`).join(', ') + '.';
}

// Who's in: everyone for pools and head-to-heads, just the takers for a prop
function peopleLineHTML(wager) {
    const parts = wager.participants || [];
    const people = wager.type === 'prop' ? parts.filter(id => id !== wager.creator_id) : parts;
    if (!people.length) return '';
    return `<div style="margin-top: 10px; font-size: 0.85rem; color: var(--text-muted); line-height: 1.4;"><strong>${wager.type === 'prop' ? 'Takers' : 'Participants'}:</strong> ${people.map(pid => escHtml(getPlayerName(pid))).join(', ')}</div>`;
}

function actionButton(label, icon, onclick, style, extraClass) {
    return `<button class="btn ${extraClass || ''}" style="flex: 1; padding: 10px; min-height: 44px; ${style || ''}" onclick="${onclick}"><i class="fas ${icon}" style="margin-right: 6px;" aria-hidden="true"></i>${label}</button>`;
}

// A bet still only its creator's: an unaccepted challenge, or a pool or prop nobody has joined.
// Cancel Bet takes it off the board entirely.
function isJustMine(wager) {
    return !!currentUser && wager.creator_id === currentUser.id && (
        (wager.type === 'h2h' && wager.status === 'proposed') ||
        (wager.type !== 'h2h' && wager.status === 'open' && (wager.participants || []).length <= 1));
}

function actionsHTML(wager) {
    const me = currentUser ? currentUser.id : null;
    const parts = wager.participants || [];
    const isCreator = wager.creator_id === me;
    const isTarget = wager.target_id === me;
    const isParticipant = parts.includes(me);
    const isAdmin = !!(currentUser && currentUser.is_admin);
    const takers = parts.filter(id => id !== wager.creator_id);
    const id = escHtml(wager.id);
    const RED = 'background: rgba(239, 68, 68, 0.08); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3);';
    const GREEN = 'background: rgba(16, 185, 129, 0.1); color: var(--accent-emerald); border: 1px solid var(--accent-emerald);';
    const row = buttons => `<div style="display: flex; gap: 10px; margin-top: 15px;">${buttons}</div>`;
    const note = text => `<div style="margin-top: 15px; text-align: center; color: var(--text-muted); font-size: 0.9rem;">${text}</div>`;
    const cancelBtn = isJustMine(wager)
        ? actionButton('Cancel Bet', 'fa-ban', `window.deleteWager('${id}')`, RED, 'cancel-btn delete-ok')
        : actionButton('Cancel Bet', 'fa-ban', `window.cancelWager('${id}')`, RED, 'cancel-btn');

    // Last trip's leftovers don't count toward this year's ledger: no joining or settling them,
    // but their creator (or an admin) can still clear them off.
    if (!isCurrentSeason(wager)) {
        const unfinished = ['proposed', 'open', 'active'].includes(wager.status);
        if (unfinished && (isCreator || isAdmin)) return row(cancelBtn) + note(`From the ${new Date(wager.created_at).getFullYear()} trip. It doesn’t count toward this year’s ledger.`);
        return '';
    }

    // An admin can reopen a finished bet that was settled wrong
    const voidedLive = wager.status === 'canceled' && wager.type === 'h2h' && parts.length === 2;
    if (wager.status === 'settled' || wager.status === 'push' || voidedLive) {
        return isAdmin ? row(actionButton('Reopen (admin)', 'fa-undo', `window.reopenWager('${id}')`, RED, 'reopen-btn')) : '';
    }

    if (wager.type === 'h2h') {
        if (wager.status === 'proposed') {
            if (isTarget) {
                return row(actionButton('Accept', 'fa-check', `window.acceptWager('${id}')`, '', 'accept-btn') +
                    actionButton('Decline', 'fa-times', `window.declineWager('${id}')`, RED, 'decline-btn'));
            }
            if (isCreator || isAdmin) {
                return (isCreator ? note(`<i class="fas fa-clock" style="margin-right: 5px;" aria-hidden="true"></i>Waiting for ${wager.target ? escHtml(wager.target.name) : 'your opponent'} to accept…`) : '') +
                    row(cancelBtn);
            }
            return '';
        }
        if (wager.status === 'active' && (isCreator || isTarget || isAdmin)) {
            return row(actionButton('Settle Bet', 'fa-handshake', `window.openSettleModal('${id}')`, GREEN));
        }
        return isParticipant && wager.status === 'active' ? note('You’re in this bet') : '';
    }

    // Pools and props: open for joining → creator closes betting → creator settles
    const canManage = isCreator || isAdmin;
    if (wager.status === 'open') {
        let html = '';
        if (!isParticipant) {
            html += row(`<button class="btn join-btn" style="width: 100%; padding: 10px; min-height: 44px;" onclick="window.joinWager('${id}')">${wager.type === 'prop' ? 'Take the Action' : 'Join Pool'} (${fmtMoney(wager.amount)})</button>`);
        } else if (!isCreator) {
            html += note('You’re in this bet') +
                row(actionButton('Leave', 'fa-sign-out-alt', `window.leaveWager('${id}')`, RED, 'leave-btn'));
        }
        if (canManage) {
            const enough = wager.type === 'prop' ? takers.length >= 1 : parts.length >= 2;
            html += row((enough ? actionButton('Close Betting', 'fa-lock', `window.closeBetting('${id}')`, GREEN) : '') + cancelBtn);
            if (!enough && isCreator) html += note(wager.type === 'prop' ? 'Waiting for someone to take the action.' : 'Waiting for others to join.');
        }
        return html;
    }
    if (wager.status === 'active') {
        if (canManage) return row(actionButton('Settle Bet', 'fa-handshake', `window.openSettleModal('${id}')`, GREEN));
        if (isParticipant) return note(`Betting’s closed. Waiting on ${escHtml(getPlayerName(wager.creator_id))} to settle it.`);
    }
    return '';
}

function wagerCardHTML(wager) {
    const me = currentUser ? currentUser.id : null;
    const parts = wager.participants || [];
    const isCreator = wager.creator_id === me;
    const isTarget = wager.target_id === me;
    const id = escHtml(wager.id);

    const typeLabel = wager.type === 'h2h' ? 'Head-to-Head' : (wager.type === 'prop' ? 'Prop Bet' : 'Pool');
    const targetLabel = wager.target ? `<div style="font-size: 0.85rem; color: var(--accent-gold); margin-bottom: 10px;">Challenging: ${escHtml(wager.target.name)}</div>` : '';
    const pastLabel = isCurrentSeason(wager) ? '' : ` • ${new Date(wager.created_at).getFullYear()}`;

    let cardStyle = `margin-bottom: 20px; padding: 20px; border-left: 4px solid ${wager.type === 'h2h' ? 'var(--accent-gold)' : 'var(--accent-emerald)'}; position: relative;`;
    if (wager.status === 'proposed' && isTarget) {
        cardStyle = `margin-bottom: 20px; padding: 20px; border: 1px solid #ef4444; border-left: 4px solid #ef4444; box-shadow: 0 0 20px rgba(239, 68, 68, 0.3); position: relative;`;
    }

    const comments = allComments.filter(c => c.wager_id === wager.id).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const commentsHtml = comments.length > 0 ? comments.map(c => `
        <div style="margin-bottom: 8px; font-size: 0.85rem; line-height: 1.3;">
            <strong style="color: var(--accent-gold);">${c.player ? escHtml(c.player.name) : 'Unknown'}:</strong>
            <span style="color: var(--text-muted);">${escHtml(c.message)}</span>
        </div>
    `).join('') : '<div style="color: var(--text-muted); font-size: 0.8rem; text-align: center; font-style: italic;">It\'s quiet... too quiet.</div>';

    const trashTalkHtml = `
        <div class="trash-talk-section" style="margin-top: 15px; border-top: 1px solid rgba(255, 255, 255, 0.05); padding-top: 15px;">
            <button class="btn" style="width: 100%; padding: 8px; min-height: 44px; background: rgba(255,255,255,0.02); color: var(--text-muted); font-size: 0.85rem; border: 1px dashed rgba(255,255,255,0.1);" aria-expanded="false" aria-controls="comments-${id}" onclick="const el = document.getElementById('comments-${id}'); const open = el.style.display === 'none'; el.style.display = open ? 'block' : 'none'; this.setAttribute('aria-expanded', open); if (open) { const t = el.firstElementChild; t.scrollTop = t.scrollHeight; }">
               <i class="fas fa-comments" style="margin-right: 6px;" aria-hidden="true"></i>Trash Talk (${comments.length})
            </button>
            <div id="comments-${id}" style="display: none; margin-top: 15px;">
                <div style="max-height: 150px; overflow-y: auto; margin-bottom: 10px; padding-right: 5px;">
                    ${commentsHtml}
                </div>
                ${currentUser ? `
                <div style="display: flex; gap: 8px;">
                    <input type="text" id="comment-input-${id}" maxlength="280" aria-label="Add trash talk" placeholder="Talk smack..." style="flex: 1; min-width: 0; background: rgba(0,0,0,0.2); border: 1px solid var(--glass-border); border-radius: 8px; padding: 8px 12px; color: white;">
                    <button class="btn" style="padding: 8px 15px; min-height: 44px; background: var(--accent-gold); color: #000; font-weight: bold; border: none; border-radius: 8px;" onmousedown="event.preventDefault()" onclick="window.postComment('${id}')">Post</button>
                </div>` : ''}
            </div>
        </div>
    `;

    return `
        <div class="glass-panel" id="wager-card-${id}" style="${cardStyle}">
            <div class="wager-head" style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 10px;">
                <div style="min-width: 0;">
                    <div style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 5px;">${wager.creator ? escHtml(wager.creator.name) : 'Unknown'} • <span style="white-space: nowrap;">${typeLabel}${pastLabel}</span></div>
                    <h4 style="font-size: 1.1rem; margin-bottom: 5px; overflow-wrap: anywhere;">${escHtml(wager.description)}</h4>
                    ${targetLabel}
                </div>
                <div style="text-align: right; flex-shrink: 0;">
                    ${statusBadgeHTML(wager)}
                </div>
            </div>

            <div class="wager-quick-stats">${stakesHTML(wager)}</div>
            ${peopleLineHTML(wager)}
            ${actionsHTML(wager)}
            ${resultsHTML(wager)}
            ${trashTalkHtml}
        </div>
    `;
}

// ==========================================
// Bet actions
// ==========================================
window.joinWager = async function (id) {
    if (!currentUser || busyWagers.has(id)) return;
    const wager = findWager(id);
    if (!wager || !isCurrentSeason(wager)) return;
    const me = currentUser.id;
    const creator = getPlayerName(wager.creator_id);
    const question = wager.type === 'prop'
        ? `Take the action on “${wager.description}” for ${fmtMoney(wager.amount)}?\n\nIf it happens, you pay ${creator} ${fmtMoney(wager.amount)}. If it doesn’t, ${creator} pays you ${fmtMoney(wager.amount)}.`
        : `Join “${wager.description}” for a ${fmtMoney(wager.amount)} buy-in?`;
    if (!confirm(question)) return;

    await withBusyWager(id, async () => {
        try {
            // Add yourself to the latest list, and only if nobody else changed it in between
            for (let attempt = 0; attempt < 4; attempt++) {
                const { data: fresh, error } = await supabaseClient
                    .from('wagers')
                    .select('participants, status')
                    .eq('id', id)
                    .maybeSingle();
                if (error) throw error;
                if (!fresh) return betChangedUnderYou('That bet was deleted.');
                if (fresh.status !== 'open') return betChangedUnderYou('Betting on that one just closed.');

                const current = fresh.participants || [];
                if (current.includes(me)) break;

                let q = supabaseClient.from('wagers').update({ participants: current.concat(me) }).eq('id', id).eq('status', 'open');
                q = fresh.participants ? q.eq('participants', JSON.stringify(current)) : q.is('participants', null);
                const { data, error: updateError } = await q.select('id');
                if (updateError) throw updateError;
                if (data && data.length) {
                    await refreshBoard();
                    showToast(wager.type === 'prop' ? 'You’re on the other side of that prop.' : 'You’re in the pool.', 'success');
                    return;
                }
            }
            await refreshBoard();
        } catch (err) {
            actionError('Error joining', err);
        }
    });
};

// Back out of a pool or prop you joined, while betting is still open
window.leaveWager = async function (id) {
    if (!currentUser || busyWagers.has(id)) return;
    const wager = findWager(id);
    if (!wager) return;
    const me = currentUser.id;
    if (!confirm(`Leave “${wager.description}”? You’re out and owe nothing on it.`)) return;

    await withBusyWager(id, async () => {
        try {
            for (let attempt = 0; attempt < 4; attempt++) {
                const { data: fresh, error } = await supabaseClient
                    .from('wagers')
                    .select('participants, status')
                    .eq('id', id)
                    .maybeSingle();
                if (error) throw error;
                if (!fresh) return betChangedUnderYou('That bet was deleted.');
                if (fresh.status !== 'open') return betChangedUnderYou('Betting on that one just closed, so you’re in. Ask the creator if you need out.');

                const current = fresh.participants || [];
                if (!current.includes(me)) break;

                const { data, error: updateError } = await supabaseClient.from('wagers')
                    .update({ participants: current.filter(pid => pid !== me) })
                    .eq('id', id).eq('status', 'open').eq('participants', JSON.stringify(current))
                    .select('id');
                if (updateError) throw updateError;
                if (data && data.length) {
                    await refreshBoard();
                    showToast('You’re out of that one.', 'success');
                    return;
                }
            }
            await refreshBoard();
        } catch (err) {
            actionError('Error leaving the bet', err);
        }
    });
};

window.acceptWager = async function (id) {
    if (!currentUser || busyWagers.has(id)) return;
    const wager = findWager(id);
    if (!wager) return;
    const { creatorWins, targetWins } = h2hPayouts(wager.amount, wager.odds);
    const creator = getPlayerName(wager.creator_id);
    if (!confirm(`Accept ${creator}’s challenge: “${wager.description}”?\n\nIf you win, ${creator} pays you ${fmtMoney(targetWins)}. If ${creator} wins, you pay ${fmtMoney(creatorWins)}.`)) return;

    await withBusyWager(id, async () => {
        try {
            const ok = await updateWager(id, { status: 'active', participants: [wager.creator_id, currentUser.id] }, ['proposed'],
                q => q.eq('target_id', currentUser.id));
            if (!ok) return betChangedUnderYou('That challenge was canceled before you accepted.');

            const card = document.getElementById(`wager-card-${id}`);
            if (card) card.classList.add('success-pop');
            await pause(card ? 500 : 0);
            await refreshBoard();
            showToast('Challenge accepted. The bet is live.', 'success');
        } catch (err) {
            actionError('Error accepting challenge', err);
        }
    });
};

function fadeCard(id) {
    const card = document.getElementById(`wager-card-${id}`);
    if (card) {
        card.style.transition = 'opacity 0.4s, transform 0.4s';
        card.style.opacity = '0.3';
        card.style.transform = 'scale(0.95)';
    }
}

window.declineWager = async function (id) {
    if (!currentUser || busyWagers.has(id)) return;
    if (!confirm('Decline this challenge? The bet will be canceled.')) return;

    await withBusyWager(id, async () => {
        try {
            const ok = await updateWager(id, { status: 'canceled' }, ['proposed'], q => q.eq('target_id', currentUser.id));
            if (!ok) return betChangedUnderYou();
            await logBetNote(id, 'Declined the challenge.');
            fadeCard(id);
            await pause(400);
            await refreshBoard();
            showToast('Challenge declined.', 'success');
        } catch (err) {
            actionError('Error declining challenge', err);
        }
    });
};

// Cancel a bet that hasn't been decided: an unaccepted challenge, or an open pool or prop.
window.cancelWager = async function (id) {
    if (!currentUser || busyWagers.has(id)) return;
    const wager = findWager(id);
    if (!wager) return;
    const others = (wager.participants || []).filter(pid => pid !== wager.creator_id).length;
    const question = wager.status === 'proposed'
        ? `Cancel the challenge “${wager.description}” before it’s accepted?`
        : `Cancel “${wager.description}”?${others ? ' Everyone who joined is out and no money changes hands.' : ''}`;
    if (!confirm(question)) return;

    await withBusyWager(id, async () => {
        try {
            const ok = await updateWager(id, { status: 'canceled' }, [wager.status]);
            if (!ok) return betChangedUnderYou();
            // A note says who called it off: always when it wasn't the creator
            if (wager.creator_id !== currentUser.id || (others && wager.status !== 'proposed')) {
                await logBetNote(id, 'Canceled the bet. No money changes hands.');
            }
            fadeCard(id);
            await pause(400);
            await refreshBoard();
            showToast('Bet canceled.', 'success');
        } catch (err) {
            actionError('Error canceling bet', err);
        }
    });
};

// Pools and props: stop new joins (e.g. once the round starts) before settling.
window.closeBetting = async function (id) {
    if (!currentUser || busyWagers.has(id)) return;
    const wager = findWager(id);
    if (!wager) return;
    if (!confirm(`Close betting on “${wager.description}”? Nobody else can join after this. You’ll settle it once the result is in.`)) return;

    await withBusyWager(id, async () => {
        try {
            const ok = await updateWager(id, { status: 'active' }, ['open']);
            if (!ok) return betChangedUnderYou();
            await refreshBoard();
            showToast('Betting closed. Settle it when the result is in.', 'success');
        } catch (err) {
            actionError('Error closing betting', err);
        }
    });
};

// Cancel Bet on a bet that's still just yours: it comes off the board.
window.deleteWager = async function (id) {
    if (!currentUser || busyWagers.has(id)) return;
    const wager = findWager(id);
    const question = wager && wager.type === 'h2h'
        ? `Cancel the challenge “${wager.description}”? It comes off the board.`
        : `Cancel “${wager ? wager.description : 'this bet'}”? Nobody’s in it yet, so it comes off the board.`;
    if (!confirm(question)) return;

    await withBusyWager(id, async () => {
        try {
            const { data, error } = await supabaseClient
                .from('wagers')
                .delete()
                .eq('id', id)
                .select('id');
            if (error) throw error;

            if (!data || !data.length) {
                // Not deleted: already gone, someone joined or accepted, or the database doesn't
                // allow deleting this type yet (props before bookie_2027.sql).
                const { data: fresh, error: freshError } = await supabaseClient.from('wagers').select('status, participants').eq('id', id).maybeSingle();
                if (freshError) throw freshError;
                if (!fresh) {
                    await refreshBoard();
                    return showToast('Bet canceled.', 'success');
                }
                if (wager && wager.type === 'h2h' && fresh.status !== 'proposed') {
                    return betChangedUnderYou(fresh.status === 'active'
                        ? `${firstName(wager.target_id)} already accepted, so it’s on. To call it off, use Void Bet in the Settle sheet.`
                        : 'That challenge was already called off.');
                }
                const stillEmpty = Array.isArray(fresh.participants) && fresh.participants.length <= 1 && ['open', 'proposed'].includes(fresh.status);
                if (!stillEmpty) return betChangedUnderYou('Someone just joined, so it’s still on. Cancel it from the card if you need to.');
                const ok = await updateWager(id, { status: 'canceled' }, [fresh.status], q => q.eq('participants', JSON.stringify(fresh.participants)));
                if (!ok) return betChangedUnderYou();
                await refreshBoard();
                showToast('Bet canceled.', 'success');
                return;
            }

            await refreshBoard();
            showToast('Bet canceled.', 'success');
        } catch (err) {
            actionError('Error canceling bet', err);
        }
    });
};

// An admin fixes a bet that was settled wrong: it goes back to unsettled (and out of the ledger)
window.reopenWager = async function (id) {
    if (!currentUser || !currentUser.is_admin || busyWagers.has(id)) return;
    const wager = findWager(id);
    if (!wager) return;
    if (!confirm(`Reopen “${wager.description}”? It goes back to unsettled and drops out of the ledger until someone settles it again.`)) return;

    await withBusyWager(id, async () => {
        try {
            const ok = await updateWager(id, { status: 'active', winner_id: null, winner_ids: [] }, [wager.status]);
            if (!ok) return betChangedUnderYou();
            await logBetNote(id, 'Reopened the bet (admin). It needs settling again.');
            await refreshBoard();
            showToast('Bet reopened. Settle it again from the card.', 'success');
        } catch (err) {
            actionError('Error reopening the bet', err);
        }
    });
};

window.postComment = async function (wagerId) {
    if (!currentUser) return;
    const inputField = document.getElementById(`comment-input-${wagerId}`);
    if (!inputField || inputField.dataset.posting) return;
    const message = inputField.value.trim().slice(0, 280);
    if (!message) return;

    // Only the Post button locks while it saves: the keyboard stays up for the next message
    const postBtn = inputField.nextElementSibling;
    inputField.dataset.posting = '1';
    if (postBtn) postBtn.disabled = true;
    try {
        const { error } = await supabaseClient
            .from('wager_comments')
            .insert({
                wager_id: wagerId,
                player_id: currentUser.id,
                message: message
            });

        if (error) throw error;
        // Clear only what was sent: anything typed since then stays
        if (inputField.value.trim().slice(0, 280) === message) inputField.value = '';
        delete inputField.dataset.posting;

        await refreshBoard();

        // Keep the thread open after the reload, scrolled to the new comment
        const el = document.getElementById(`comments-${wagerId}`);
        if (el) {
            el.style.display = 'block';
            if (el.previousElementSibling) el.previousElementSibling.setAttribute('aria-expanded', 'true');
            const thread = el.firstElementChild;
            if (thread) thread.scrollTop = thread.scrollHeight;
        }
        const next = document.getElementById(`comment-input-${wagerId}`);
        if (next) next.focus({ preventScroll: true });
    } catch (err) {
        actionError('Error posting comment', err);
    } finally {
        delete inputField.dataset.posting;
        if (postBtn && postBtn.isConnected) postBtn.disabled = false;
    }
};

// ==========================================
// Settling
// ==========================================
function settleOptionHTML(type, value, label, detail) {
    return `
        <label style="display: flex; align-items: center; gap: 10px; padding: 8px 0; cursor: pointer; color: white;">
            <input type="${type}" name="settle-winner" value="${escHtml(value)}" style="width: 18px; height: 18px; flex-shrink: 0;">
            <span>${label}${detail ? `<br><span style="color: var(--text-muted); font-size: 0.8rem;">${detail}</span>` : ''}</span>
        </label>`;
}

window.openSettleModal = function (id) {
    const wager = findWager(id);
    if (!wager) return;
    if (settling || busyWagers.has(id)) {
        showToast('Still saving the last change. Give it a second.', 'error');
        return;
    }

    // Earlier toasts would sit over the sheet's close button
    document.querySelectorAll('.toast').forEach(t => t.remove());
    showModalForm('settle');
    // Name the bet, so two look-alike bets (front nine / back nine) can't be mixed up
    modalTitle.textContent = 'Settle Bet';
    document.getElementById('settle-wager-summary').textContent = `“${wager.description}”. Pick the winner. The ledger updates right away, and a note in the trash talk shows who settled it.`;
    document.getElementById('settle-wager-id').value = id;
    setSettleBusy(false);

    const autoBtn = document.getElementById('settle-auto-btn');
    if (autoBtn) {
        autoBtn.style.display = wager.type === 'h2h' ? 'block' : 'none';
        autoBtn.onclick = () => handleAutoSettle(wager);
    }

    const container = document.getElementById('settle-wager-winners-container');
    const parts = wager.participants || [];
    const name = pid => escHtml(getPlayerName(pid));

    if (wager.type === 'pool') {
        const pot = wager.amount * parts.length;
        container.innerHTML = `<p style="color: var(--text-muted); font-size: 0.8rem; margin-bottom: 10px;">Select every winner. The ${fmtMoney(pot)} pot splits evenly.</p>` +
            parts.map(pid => settleOptionHTML('checkbox', pid, name(pid))).join('');
    } else if (wager.type === 'prop') {
        const takers = parts.filter(pid => pid !== wager.creator_id);
        container.innerHTML = `<p style="color: var(--text-muted); font-size: 0.8rem; margin-bottom: 10px;">Did it happen?</p>` +
            settleOptionHTML('radio', wager.creator_id, `${name(wager.creator_id)} wins (it happened)`, `Each taker pays ${name(wager.creator_id)} ${fmtMoney(wager.amount)}`) +
            settleOptionHTML('radio', 'takers', 'The takers win (it didn’t)', `${name(wager.creator_id)} pays ${takers.length} taker${takers.length === 1 ? '' : 's'} ${fmtMoney(wager.amount)} each`);
    } else {
        const { creatorWins, targetWins } = h2hPayouts(wager.amount, wager.odds);
        container.innerHTML =
            settleOptionHTML('radio', wager.creator_id, name(wager.creator_id), `Collects ${fmtMoney(creatorWins)}`) +
            settleOptionHTML('radio', wager.target_id, name(wager.target_id), `Collects ${fmtMoney(targetWins)}`);
    }

    openModal();
};

function describeResult(wager, winnerIds) {
    const parts = wager.participants || [];
    const name = id => getPlayerName(id);
    if (wager.type === 'h2h') {
        const { creatorWins, targetWins } = h2hPayouts(wager.amount, wager.odds);
        const targetWon = winnerIds[0] === wager.target_id;
        const loser = targetWon ? wager.creator_id : wager.target_id;
        return `Settled: ${name(winnerIds[0])} wins. ${name(loser)} owes ${fmtMoney(targetWon ? targetWins : creatorWins)}.`;
    }
    if (wager.type === 'prop') {
        return winnerIds.includes(wager.creator_id)
            ? `Settled: ${name(wager.creator_id)} wins the prop. Each taker owes ${fmtMoney(wager.amount)}.`
            : `Settled: the takers win. ${name(wager.creator_id)} owes each taker ${fmtMoney(wager.amount)}.`;
    }
    const winners = parts.filter(id => winnerIds.includes(id));
    return `Settled: ${winners.map(name).join(' & ')} win${winners.length === 1 ? 's' : ''}. ${potSplitText(wager.amount, parts.length, winners, name)}`;
}

// Is the Settle sheet for this bet the one that's open?
const settleSheetFor = id => modal.classList.contains('active') && settleWagerForm.style.display === 'block' &&
    document.getElementById('settle-wager-id').value === id;

// One settle at a time: its buttons lock while it saves, so a second tap can't send it twice
function setSettleBusy(on) {
    settling = on;
    settleWagerForm.querySelectorAll('button').forEach(b => { b.disabled = on; });
    const submit = document.getElementById('settle-submit-btn');
    if (submit) submit.textContent = on ? 'Settling…' : 'Confirm Winner & Settle';
}

async function handleSettleSubmit(e) {
    e.preventDefault();
    if (settling) return;
    if (!currentUser) return showToast('You were logged out. Log in again to settle bets.', 'error');
    const wagerId = document.getElementById('settle-wager-id').value;
    const wager = findWager(wagerId);
    if (!wager) return;
    const picked = Array.from(document.querySelectorAll('input[name="settle-winner"]:checked')).map(input => input.value);

    if (picked.length === 0) {
        showToast('Pick a winner first.', 'error');
        return;
    }

    let winnerIds = picked;
    if (wager.type === 'prop') {
        winnerIds = picked[0] === 'takers'
            ? (wager.participants || []).filter(pid => pid !== wager.creator_id)
            : [wager.creator_id];
        if (winnerIds.length === 0) {
            showToast('Nobody took this prop. Cancel it instead.', 'error');
            return;
        }
    }

    // Settling moves money, so say exactly what will happen first
    if (!confirm(`${describeResult(wager, winnerIds).replace(/^Settled: /, '')}\n\nSettle “${wager.description}” now? The ledger updates right away.`)) return;

    setSettleBusy(true);
    try {
        await withBusyWager(wagerId, async () => {
            const ok = await updateWager(wagerId, { status: 'settled', winner_id: winnerIds[0], winner_ids: winnerIds }, ['active']);
            if (!ok) return betChangedUnderYou('Someone already settled or changed that bet. Here’s the latest.');
            if (settleSheetFor(wagerId)) closeModal();
            await logBetNote(wagerId, describeResult(wager, winnerIds));
            await refreshBoard();
            focusCard(wagerId);
            showToast('Settled. The ledger is updated.', 'success');
        });
    } catch (err) {
        actionError('Error settling wager', err);
    } finally {
        setSettleBusy(false);
    }
}

async function handleAlternativeSettle(statusType) {
    if (settling) return;
    if (!currentUser) return showToast('You were logged out. Log in again to settle bets.', 'error');
    const wagerId = document.getElementById('settle-wager-id').value;
    const wager = findWager(wagerId);
    const what = wager ? `“${wager.description}”` : 'this bet';
    if (!confirm(statusType === 'push'
        ? `Declare a push (tie) on ${what}? No money changes hands.`
        : `Void ${what}? It's called off and no money changes hands.`)) return;

    setSettleBusy(true);
    try {
        await withBusyWager(wagerId, async () => {
            const ok = await updateWager(wagerId, { status: statusType }, ['active']);
            if (!ok) return betChangedUnderYou('Someone already settled or changed that bet. Here’s the latest.');
            if (settleSheetFor(wagerId)) closeModal();
            await logBetNote(wagerId, statusType === 'push' ? 'Declared a push. No money changes hands.' : 'Voided the bet. No money changes hands.');
            await refreshBoard();
            focusCard(wagerId);
            showToast(statusType === 'push' ? 'Pushed. No money changes hands.' : 'Bet voided.', 'success');
        });
    } catch (err) {
        actionError('Error updating wager', err);
    } finally {
        setSettleBusy(false);
    }
}

// Auto-settle a head-to-head from the Live Tracker: the latest round both players finished
// (all 18 holes entered), lower gross score wins. Each group scores its own session, so
// the two cards are matched by round number and date. The player confirms before it saves.
const HOLE_COLUMNS = Array.from({ length: 18 }, (_, i) => `h${i + 1}`);

async function handleAutoSettle(wager) {
    if (settling) return;
    setSettleBusy(true);
    const autoBtn = document.getElementById('settle-auto-btn');
    const autoLabel = autoBtn ? autoBtn.innerHTML : '';
    if (autoBtn) autoBtn.textContent = 'Checking scores…';
    try {
        const ids = [wager.creator_id, wager.target_id];
        const { data: cards, error: cardsError } = await supabaseClient
            .from('scores')
            .select(`round_id, player_id, total_to_par, total_score, ${HOLE_COLUMNS.join(', ')}`)
            .in('player_id', ids);
        if (cardsError) throw cardsError;

        const complete = (cards || []).filter(c => HOLE_COLUMNS.every(h => c[h] !== null && c[h] !== undefined));
        const roundIds = [...new Set((cards || []).map(c => c.round_id))];

        // Only rounds played on or after the day the bet was made (the bet's local date)
        const betDay = new Date(wager.created_at).toLocaleDateString('en-CA');
        let rounds = [];
        if (roundIds.length) {
            const { data, error } = await supabaseClient
                .from('rounds')
                .select('id, round_number, date')
                .in('id', roundIds);
            if (error) throw error;
            rounds = (data || []).filter(r => (!SEASON_START || !r.date || new Date(r.date) >= SEASON_START) &&
                (!r.date || r.date >= betDay));
        }

        // Pair up the two players' finished cards by (date, round number)
        const roundById = new Map(rounds.map(r => [r.id, r]));
        const byRound = {};
        complete.forEach(c => {
            const r = roundById.get(c.round_id);
            if (!r) return;
            const key = `${r.date || ''}|${String(r.round_number || 0).padStart(2, '0')}`;
            byRound[key] = byRound[key] || { round: r, cards: {} };
            if (!byRound[key].cards[c.player_id]) byRound[key].cards[c.player_id] = c;
        });
        const shared = Object.keys(byRound).filter(k => ids.every(pid => byRound[k].cards[pid])).sort().reverse();
        if (!shared.length) {
            showToast('Auto-settle needs a round you’ve both finished (all 18 holes in the Live Tracker). Settle it by hand instead.', 'error');
            return;
        }

        const { round, cards: pair } = byRound[shared[0]];
        // A later round one of them is still playing may be the one the bet is about
        const newer = (cards || []).filter(c => !complete.includes(c))
            .map(c => roundById.get(c.round_id))
            .find(r => r && r.id !== round.id && (r.date || '') >= (round.date || ''));
        if (newer) {
            showToast(`Round ${newer.round_number || ''} isn’t finished yet, so auto-settle can’t tell which round this bet is about. Settle it by hand, or wait until all 18 are in.`, 'error');
            return;
        }
        // Add up the 18 holes (a stored total can be stale if two phones scored the card).
        // Same round, same course, so gross strokes decide it.
        const strokes = c => HOLE_COLUMNS.reduce((sum, h) => sum + Number(c[h]), 0);
        const cScore = strokes(pair[wager.creator_id]);
        const tScore = strokes(pair[wager.target_id]);
        const summary = `Round ${round.round_number || '?'}${round.date ? ` (${round.date})` : ''}, gross strokes:\n` +
            `${getPlayerName(wager.creator_id)} ${cScore}\n${getPlayerName(wager.target_id)} ${tScore}`;

        const isPush = cScore === tScore;
        const winnerId = cScore < tScore ? wager.creator_id : wager.target_id;
        if (!confirm(`${summary}\n\n${isPush ? 'All square. Declare a push?' : `Settle this bet for ${getPlayerName(winnerId)}?`}\n\nOnly OK this if the bet was about this round's score.`)) return;

        const values = isPush ? { status: 'push' } : { status: 'settled', winner_id: winnerId, winner_ids: [winnerId] };
        await withBusyWager(wager.id, async () => {
            const ok = await updateWager(wager.id, values, ['active']);
            if (!ok) return betChangedUnderYou('Someone already settled or changed that bet. Here’s the latest.');
            if (settleSheetFor(wager.id)) closeModal();
            await logBetNote(wager.id, isPush ? `Auto-settled from Round ${round.round_number}: all square, push.` : `Auto-settled from Round ${round.round_number}: ${describeResult(wager, [winnerId]).replace(/^Settled: /, '')}`);
            await refreshBoard();
            showToast(isPush ? 'All square. Wager pushed.' : `Settled. ${getPlayerName(winnerId)} wins.`, 'success');
        });
    } catch (e) {
        actionError('Error auto-settling', e);
    } finally {
        setSettleBusy(false);
        if (autoBtn) autoBtn.innerHTML = autoLabel;
    }
}

// ==========================================
// Ledger (this trip's settled bets only)
// ==========================================
function computeBalances(wagers) {
    const balances = {};
    const add = (id, amt) => { balances[id] = roundCents((balances[id] || 0) + amt); };

    wagers.forEach(wager => {
        if (wager.status !== 'settled' || !wager.winner_id) return;
        const parts = wager.participants || [];
        const winnerIds = wager.winner_ids && wager.winner_ids.length ? wager.winner_ids : [wager.winner_id];
        const amount = wager.amount;

        if (wager.type === 'h2h') {
            if (!wager.target_id) return;
            const { creatorWins, targetWins } = h2hPayouts(amount, wager.odds);
            if (wager.winner_id === wager.target_id) {
                add(wager.target_id, targetWins);
                add(wager.creator_id, -targetWins);
            } else if (wager.winner_id === wager.creator_id) {
                add(wager.creator_id, creatorWins);
                add(wager.target_id, -creatorWins);
            }
        } else if (wager.type === 'prop') {
            const takers = parts.filter(pid => pid !== wager.creator_id);
            const sign = winnerIds.includes(wager.creator_id) ? 1 : -1;
            add(wager.creator_id, sign * amount * takers.length);
            takers.forEach(tid => add(tid, -sign * amount));
        } else {
            const winners = parts.filter(pid => winnerIds.includes(pid));
            if (!winners.length) return;
            const shares = potShares(amount, parts.length, winners.length);
            parts.forEach(pid => add(pid, -amount));
            winners.forEach((pid, i) => add(pid, shares[i]));
        }
    });
    return balances;
}

// Who pays whom to square up: the biggest loser pays the biggest winner, and so on.
// Works in cents; never more than one payment fewer than the number of people with a balance.
function settleUpPayments(balances) {
    const debtors = [], creditors = [];
    Object.keys(balances).forEach(id => {
        const cents = Math.round(balances[id] * 100);
        if (cents < 0) debtors.push({ id, cents: -cents });
        else if (cents > 0) creditors.push({ id, cents });
    });
    debtors.sort((a, b) => b.cents - a.cents);
    creditors.sort((a, b) => b.cents - a.cents);
    const payments = [];
    let d = 0, c = 0;
    while (d < debtors.length && c < creditors.length) {
        const pay = Math.min(debtors[d].cents, creditors[c].cents);
        payments.push({ from: debtors[d].id, to: creditors[c].id, amount: pay / 100 });
        debtors[d].cents -= pay;
        creditors[c].cents -= pay;
        if (!debtors[d].cents) d++;
        if (!creditors[c].cents) c++;
    }
    return payments;
}

function renderLedger() {
    if (!currentUser) return;
    const balances = computeBalances(allWagers.filter(isCurrentSeason));
    dbPlayers.forEach(p => { if (!(p.id in balances)) balances[p.id] = 0; });

    const sorted = Object.keys(balances)
        .map(id => ({ id, name: getPlayerName(id), balance: balances[id] }))
        .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));

    let ledgerHtml = '';
    sorted.forEach(b => {
        const isMe = b.id === currentUser.id;
        if (b.balance === 0 && !isMe) return;
        const color = b.balance > 0 ? 'var(--accent-emerald)' : (b.balance < 0 ? '#ef4444' : 'var(--text-muted)');
        ledgerHtml += `
            <div style="display: flex; justify-content: space-between; gap: 12px; padding: 12px 10px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                <span style="font-weight: ${isMe ? '700' : 'normal'}">${escHtml(b.name)} ${isMe ? '(You)' : ''}</span>
                <span style="color: ${color}; font-weight: 700; white-space: nowrap;">${fmtMoney(b.balance, true)}</span>
            </div>
        `;
    });

    const top = sorted.length ? sorted[0].balance : 0;
    const bottom = sorted.length ? sorted[sorted.length - 1].balance : 0;
    const namesAt = v => sorted.filter(b => b.balance === v).map(b => escHtml(b.name)).join(', ');

    const scoreboardEl = document.getElementById('big-winner-board');
    if (scoreboardEl) {
        if (top > 0 || bottom < 0) {
            scoreboardEl.style.display = 'flex';
            scoreboardEl.style.justifyContent = 'space-between';
            scoreboardEl.innerHTML = `
                <div style="text-align: center; flex: 1; border-right: 1px solid rgba(255,255,255,0.1);">
                    <div style="font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px;"><i class="fas fa-trophy" style="color: var(--accent-gold);"></i> Big Winner</div>
                    <div style="font-size: 1.2rem; font-weight: bold; color: var(--accent-emerald); margin-top: 5px;">${top > 0 ? fmtMoney(top, true) : '$0'}</div>
                    <div style="font-size: 0.9rem; margin-top: 2px;">${top > 0 ? namesAt(top) : '-'}</div>
                </div>
                <div style="text-align: center; flex: 1;">
                    <div style="font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px;"><i class="fas fa-skull" style="color: #ef4444;"></i> Big Loser</div>
                    <div style="font-size: 1.2rem; font-weight: bold; color: #ef4444; margin-top: 5px;">${bottom < 0 ? fmtMoney(bottom, true) : '$0'}</div>
                    <div style="font-size: 0.9rem; margin-top: 2px;">${bottom < 0 ? namesAt(bottom) : '-'}</div>
                </div>
            `;
        } else {
            scoreboardEl.style.display = 'none';
        }
    }

    if (!ledgerHtml) {
        ledgerHtml = `<div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 15px; text-align: center;">No settled bets yet</div>`;
    }

    // Settle up: the fewest payments that square everyone, yours first
    const payments = settleUpPayments(balances);
    if (payments.length) {
        const me = currentUser.id;
        const mine = p => p.from === me || p.to === me;
        payments.sort((a, b) => mine(b) - mine(a));
        ledgerHtml += `
            <div class="settle-up">
                <h4>Settle up</h4>
                <p>Who pays whom to square everyone for the trip so far.</p>
                ${payments.map(p => `
                    <div class="settle-up-row${mine(p) ? ' mine' : ''}">
                        <span>${p.from === me ? 'You' : escHtml(getPlayerName(p.from))} → ${p.to === me ? 'you' : escHtml(getPlayerName(p.to))}</span>
                        <span style="white-space: nowrap;">${fmtMoney(p.amount)}</span>
                    </div>`).join('')}
            </div>`;
    }

    ledgerContainer.innerHTML = ledgerHtml;
}

// ==========================================
// Creating Wagers
// ==========================================
const TYPE_HINTS = {
    pool: 'Everyone puts in the same buy-in. The winners split the pot.',
    h2h: 'You against one player. Set the line and the stake.',
    prop: 'You’re betting it happens. Anyone who takes the action bets it doesn’t. You win or pay the amount to each taker.'
};
const AMOUNT_LABELS = { pool: 'Buy-in ($)', h2h: 'Wager Amount ($)', prop: 'Amount per Taker ($)' };
const ODDS_HELP = 'Odds start at 100. For 3 to 2, type 150.';

function oddsSide() {
    const picked = createWagerForm.querySelector('input[name="odds-side"]:checked');
    return picked ? picked.value : 'even';
}

// The line is quoted for the opponent: +150 when they're the underdog, -150 when they're favored
function readOdds() {
    const side = oddsSide();
    if (side === 'even') return 100;
    const n = parseDollars(wagerOddsInput.value.replace(/^\s*[+\-−–]\s*/, ''));
    if (!Number.isInteger(n)) return NaN;
    return side === 'dog' ? n : -n;
}

function syncWagerTypeFields() {
    const type = wagerTypeSelect.value;
    const isH2H = type === 'h2h';
    h2hTargetContainer.style.display = isH2H ? 'block' : 'none';
    wagerTargetSelect.required = isH2H;

    const hint = document.getElementById('wager-type-hint');
    if (hint) hint.textContent = TYPE_HINTS[type] || '';
    const amtLabel = document.getElementById('wager-amt-label');
    if (amtLabel) amtLabel.textContent = AMOUNT_LABELS[type] || 'Wager Amount ($)';

    // "Kelly's the underdog" reads better than "They're the underdog" once someone is picked
    const opp = wagerTargetSelect.value ? getPlayerName(wagerTargetSelect.value).split(' ')[0] : '';
    const dogLabel = document.getElementById('odds-dog-label');
    const favLabel = document.getElementById('odds-fav-label');
    const legend = document.getElementById('odds-side-legend');
    if (dogLabel) dogLabel.textContent = opp ? `${opp}’s the underdog` : 'They’re the underdog';
    if (favLabel) favLabel.textContent = opp ? `${opp}’s the favorite` : 'They’re the favorite';
    if (legend) legend.textContent = opp ? `The line on ${opp}` : 'The line';
    if (oddsNumberWrap) oddsNumberWrap.hidden = oddsSide() === 'even';

    updateOddsPreview();
}

function updateOddsPreview() {
    const previewEl = document.getElementById('odds-preview-text');
    if (!previewEl) return;

    const amount = parseDollars(wagerAmtInput.value);
    if (wagerTypeSelect.value !== 'h2h' || !(amount > 0)) {
        previewEl.style.display = 'none';
        return;
    }

    previewEl.style.display = 'block';
    if (!Number.isInteger(amount)) {
        previewEl.textContent = 'Whole dollars only.';
        return;
    }
    const odds = readOdds();
    if (!isValidOdds(odds)) {
        previewEl.textContent = ODDS_HELP;
        return;
    }

    const name = wagerTargetSelect.value ? escHtml(getPlayerName(wagerTargetSelect.value)) : '';
    const opp = name || 'your opponent';
    const Opp = name || 'Your opponent';
    const { creatorWins, targetWins } = h2hPayouts(amount, odds);
    const line = Math.abs(odds) === 100 ? 'Even money.' : `${Opp} is the ${odds > 0 ? 'underdog' : 'favorite'} at ${fmtOdds(odds)}.`;
    previewEl.innerHTML = `${line}<br><strong>You win:</strong> ${opp} pays you ${fmtMoney(creatorWins)}.<br><strong>${Opp} wins:</strong> you pay ${fmtMoney(targetWins)}.`;
}

// Errors show right above the button, and the field that needs fixing gets focus
function showCreateError(message, field) {
    if (!wagerErrorEl) return;
    wagerErrorEl.textContent = message;
    wagerErrorEl.style.display = message ? 'block' : 'none';
    if (message && field) {
        (field.closest('#odds-number-wrap') || field).after(wagerErrorEl);
        field.focus();
        wagerErrorEl.scrollIntoView({ block: 'nearest' });
    } else if (message) {
        wagerSubmitBtn.before(wagerErrorEl);
        const sheet = wagerErrorEl.closest('.modal-content');
        if (sheet) sheet.scrollTop = sheet.scrollHeight;
    }
}

function resetCreateForm() {
    createWagerForm.reset();
    wagerOddsInput.value = '';
    pendingWagerId = null;
    pendingWagerTerms = null;
    showCreateError('');
}

function newWagerId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// The sheet keeps whatever you typed if you close it by accident; it clears after a bet is made
function openWagerModal() {
    if (!currentUser) return;

    showModalForm('create');
    modalTitle.textContent = 'Propose a Wager';
    showCreateError('');

    // Anyone confirmed for the trip can be challenged, except players who RSVP'd out
    const keep = wagerTargetSelect.value;
    const out = rsvpOut || new Set();
    wagerTargetSelect.innerHTML = '<option value="">Select an opponent...</option>' + dbPlayers
        .filter(p => p.id !== currentUser.id && p.status !== 'potential' && !out.has(p.id))
        .map(p => `<option value="${escHtml(p.id)}">${escHtml(p.name)}${p.user_id ? '' : ' (no player account yet)'}</option>`)
        .join('');
    if (keep && [...wagerTargetSelect.options].some(o => o.value === keep)) wagerTargetSelect.value = keep;

    syncWagerTypeFields();
    openModal(wagerTypeSelect);
}
window.openWagerModal = openWagerModal;

async function handleCreateWager(e) {
    e.preventDefault();
    if (creatingWager) return;
    if (!currentUser) return showToast('You were logged out. Log in again to keep betting.', 'error');

    const type = wagerTypeSelect.value;
    const amount = parseDollars(wagerAmtInput.value);
    const desc = wagerDescInput.value.trim();
    const targetId = type === 'h2h' ? wagerTargetSelect.value : null;
    const odds = type === 'h2h' ? readOdds() : 100;

    if (type === 'h2h' && !targetId) return showCreateError('Pick who you’re challenging.', wagerTargetSelect);
    if (type === 'h2h' && !isValidOdds(odds)) return showCreateError(ODDS_HELP, wagerOddsInput);
    if (!desc) return showCreateError('Spell out the terms of the bet.', wagerDescInput);
    if (!Number.isInteger(amount) || amount < 1) return showCreateError('Enter whole dollars, $1 or more.', wagerAmtInput);
    if (amount > 100000) return showCreateError('That’s more than $100,000. Check the amount.', wagerAmtInput);
    if (amount >= 1000 && !confirm(`${fmtMoney(amount)}? Just checking that’s not a typo.`)) return;

    // The same id on every try: if the first try saved but the reply got lost, the retry
    // is rejected as a duplicate instead of posting the bet twice.
    const terms = JSON.stringify([currentUser.id, type, amount, desc, targetId, odds]);
    let firstVersionLive = false;
    if (!pendingWagerId || pendingWagerTerms !== terms) {
        // Changed after a try whose reply was lost: that first version may be live already
        if (pendingWagerId) {
            try {
                const { data: prev } = await supabaseClient.from('wagers').select('id').eq('id', pendingWagerId).maybeSingle();
                firstVersionLive = !!prev;
            } catch (e) { /* no signal: the new one still posts */ }
        }
        pendingWagerId = newWagerId();
        pendingWagerTerms = terms;
    }
    const newWager = {
        id: pendingWagerId,
        creator_id: currentUser.id,
        target_id: targetId,
        type: type,
        amount: amount,
        description: desc,
        status: type === 'h2h' ? 'proposed' : 'open',
        participants: [currentUser.id],
        odds: odds
    };

    creatingWager = true;
    wagerSubmitBtn.disabled = true;
    wagerSubmitBtn.textContent = 'Proposing…';
    try {
        const { error } = await supabaseClient.from('wagers').insert([newWager]);
        if (error && error.code !== '23505') throw error; // 23505: an earlier try already saved it

        if (modal.classList.contains('active') && createWagerForm.style.display === 'block') closeModal();
        resetCreateForm();
        showBoardSkeleton();
        await refreshBoard();
        // Show the new bet: switch to a tab that has it, then scroll to it
        if (!wagersForFilter(currentFilter).some(w => w.id === newWager.id)) setFilter('all');
        revealCard(newWager.id);
        if (!modal.classList.contains('active')) {
            const first = document.querySelector(`#wager-card-${newWager.id} button:not([disabled])`);
            if (first) first.focus({ preventScroll: true });
        }
        showToast(type === 'h2h'
            ? `Challenge posted. ${getPlayerName(targetId).split(' ')[0]} sees it next time they open The Bookie, so give them a heads-up.`
            : (type === 'prop' ? 'Your prop is live.' : 'Your pool is open.'), 'success');
        if (firstVersionLive) showToast('Heads up: your first version posted too. Cancel it from its card if you only want this one.', 'error');
    } catch (err) {
        // Closed the sheet while it was saving? Then say it in a toast instead.
        const sheetUp = modal.classList.contains('active') && createWagerForm.style.display === 'block';
        const say = message => (sheetUp ? showCreateError(message) : showToast(message, 'error'));
        if (/wagers_type_check/.test(err.message || '')) {
            console.warn('Prop bets need bookie_2027.sql run in Supabase.');
            say('Prop bets aren’t switched on yet. Text the commissioner, or make it a pool for now.');
        } else if (isNetworkError(err)) {
            say(sheetUp ? 'No signal. Tap Propose again once you have a bar or two (without changing it) and it won’t post twice.'
                : 'No signal, so that bet may not have posted. Open + and tap Propose again. It won’t post twice.');
        } else {
            say('Couldn’t propose the bet: ' + (err.message || err));
        }
    } finally {
        creatingWager = false;
        wagerSubmitBtn.disabled = false;
        wagerSubmitBtn.textContent = 'Propose Wager';
    }
}

// ==========================================
// Native App Helpers (Skeletons & Toasts)
// ==========================================
// Loading placeholders for the board. The Cup card can sit among the cards: put it back first.
function showBoardSkeleton() {
    const cup = document.getElementById('cup-card');
    if (cup && wagersContainer.contains(cup)) wagersContainer.parentNode.insertBefore(cup, wagersContainer);
    wagersContainer.innerHTML = getSkeletonHtml();
}

function getSkeletonHtml() {
    return Array(3).fill(`
        <div class="glass-panel" style="margin-bottom: 20px; padding: 20px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 15px;">
                <div style="width: 70%;">
                    <div class="skeleton-box skeleton-text" style="width: 40%;"></div>
                    <div class="skeleton-box skeleton-title"></div>
                </div>
                <div class="skeleton-box" style="width: 60px; height: 24px; border-radius: 4px;"></div>
            </div>
            <div style="display: flex; gap: 15px; margin-top: 15px; padding-top: 15px; border-top: 1px solid var(--glass-border);">
                <div class="skeleton-box" style="width: 30%; height: 30px; border-radius: 20px;"></div>
                <div class="skeleton-box" style="width: 30%; height: 30px; border-radius: 20px;"></div>
                <div class="skeleton-box" style="width: 20%; height: 30px; border-radius: 20px;"></div>
            </div>
        </div>
    `).join('');
}

window.showToast = function (message, type = 'success') {
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

    const icon = type === 'success' ? '<i class="fas fa-check-circle" style="color: var(--accent-emerald);"></i>' : '<i class="fas fa-exclamation-circle" style="color: #ef4444;"></i>';
    toast.innerHTML = `${icon} <span></span>`;
    toast.querySelector('span').textContent = message;

    container.appendChild(toast);

    if (navigator.vibrate) {
        navigator.vibrate(type === 'success' ? 50 : [50, 100, 50]);
    }

    const dismiss = () => {
        if (!toast.isConnected || toast.classList.contains('fade-out')) return;
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    };
    toast.addEventListener('click', dismiss); // tap to dismiss
    setTimeout(dismiss, type === 'error' ? 7000 : 3000);
};

// The page opens on "checking your login". Fresh from the confirmation email, say that instead.
showChecking(CAME_FROM_AUTH_LINK && !LINK_ERROR && !OPENED_FROM_RESET_LINK
    ? (NEXT === 'rsvp' ? 'Confirming your email… taking you to your RSVP' : 'Signing you in…')
    : 'One sec, checking your login…');

let bookieStarted = false;
function startBookie() {
    if (bookieStarted) return;
    bookieStarted = true;
    if (wallState === 'checking') armCheckingTimeout();
    initBookie().catch(err => {
        console.error('The Bookie failed to start:', err);
        if (wallState === 'checking') showWall();
    });
}

// Kickoff: handles both early and late script execution
if (document.readyState === 'complete') {
    startBookie();
} else {
    window.addEventListener('load', startBookie);
}
