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
// A link to one bet (bookie.html?bet=<id>, or #bet=<id>), e.g. a challenge someone texted: the
// board opens on that card once it loads, after logging in if need be (pageUrl keeps it).
const BET_LINK = /^[\w-]{1,80}$/.test(LINK_PARAMS.get('bet') || '') ? LINK_PARAMS.get('bet') : null;

// Other pages send people here to log in (?next=rsvp etc.). Once their login is linked to
// a roster name they go straight back. `mode` opens the log-in or sign-up form on arrival.
// `round` (keep score) and `board` (live scores) both go to the tracker, but someone who only
// came to watch lands back on the scores, not on "Who is this phone scoring?".
const NEXT_PAGES = { rsvp: 'index.html#rsvp', profile: 'index.html#profile', home: 'index.html', round: 'round_tracker.html', board: 'round_tracker.html#board', admin: 'admin.html' };
// An invite from the Supabase dashboard is someone new to the trip: like a sign-up link, it
// ends on the RSVP unless the link says otherwise
const NEXT_PARAM = LINK_PARAMS.get('next') || (LINK_PARAMS.get('type') === 'invite' ? 'rsvp' : null);
const NEXT = NEXT_PAGES[NEXT_PARAM] ? NEXT_PARAM : null;
// Admin's section (?next=admin&tab=rsvps) rides along through a password reset, so the
// commissioner lands back where he was (admin.js opens admin.html#rsvps on that tab)
const ADMIN_TAB = NEXT === 'admin' && /^(roster|rsvps|drafting|matchups|scores|score-entry|potential)$/.test(LINK_PARAMS.get('tab') || '')
    ? LINK_PARAMS.get('tab') : null;
if (ADMIN_TAB) NEXT_PAGES.admin = `admin.html#${ADMIN_TAB}`;
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
    board: {
        title: 'Live scores',
        text: 'Log in to follow every match hole by hole. It’s the same player account you use to RSVP.'
    },
    admin: {
        title: 'Commissioner login',
        text: 'Log in with your admin account.'
    },
    bookie: {
        title: BET_LINK ? 'Log in to see the bet' : 'Log in to The Bookie',
        text: BET_LINK
            ? 'Someone sent you a bet on The Bookie. Log in and it opens right up. It’s the same player account you use to RSVP and keep score.'
            : 'Side bets, the ledger and settle-up for the trip. It’s the same player account you use to RSVP and keep score.',
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
// "Settle up" on the homepage links to #ledger-panel, but the ledger only shows once the login
// check and the board load finish, so the browser's own jump to it misses
let openLedgerOnLoad = window.location.hash === '#ledger-panel';
let betLinkPending = !!BET_LINK; // a ?bet= link not shown yet (once, after the first board load)
// True once the trash talk has loaded at least once (who called a bet off comes from it)
let commentsLoaded = false;
// 'checking' until the login check decides, then 'out', 'in' (logged in, can't bet yet),
// 'dashboard', or 'leaving' (on the way back to ?next=)
let wallState = 'checking';

// Venmo usernames and Settle up's "Paid" marks (payments_2027.sql), loaded with the board for the
// player on the dashboard (always a confirmed one, so the database lets him read them). Until that
// script has run the tables aren't there: Settle up says "being set up" and works as before.
const payData = {
    state: 'idle',     // 'idle' (not loaded yet), 'ready', 'setup' (not set up yet), 'error' (didn't load), 'off' (not a confirmed player)
    owner: null,        // the player they were loaded for
    handles: new Map(), // player id -> Venmo username (checked, lowercase)
    marks: {},          // trip year -> that year's Paid marks
    busy: new Set(),    // marks and undos still saving: a second tap does nothing
    seq: 0,             // only the latest load counts
    recent: [],         // marks this page saved: {id, year, from, to, cents, at} (the 2-minute duplicate rule)
    lineOf: new Map(),  // mark id -> the bet whose bet-by-bet line it was marked from (this visit)
    lastError: null,    // why the last load failed
    firstWait: false    // the first load: Settle up waits for the marks (PAY_WAIT_MS at most)
};
const PAY_WAIT_MS = 4000; // how long the first Ledger waits for the Paid marks before showing without them
const PAY_DUP_MS = 120000; // mark_paid treats the same payer, payee and amount within 2 minutes as one mark

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
    // Typing a number is a custom line: the box stays open even as "15" becomes "150"
    wagerOddsInput.addEventListener('input', () => { customLine = true; syncWagerTypeFields(); });
    wagerTargetSelect.addEventListener('change', syncWagerTypeFields);
    createWagerForm.querySelectorAll('input[name="odds-side"]').forEach(r => r.addEventListener('change', syncWagerTypeFields));
    createWagerForm.querySelectorAll('.line-chip').forEach(chip => chip.addEventListener('click', () => pickLine(chip.dataset.line)));
    createWagerForm.addEventListener('input', () => showCreateError(''));
    createWagerForm.addEventListener('submit', handleCreateWager);

    const refreshBtn = document.getElementById('refresh-board-btn');
    if (refreshBtn) refreshBtn.addEventListener('click', () => refreshNow(refreshBtn));
    const ledgerNavBtn = document.getElementById('ledger-nav-btn');
    if (ledgerNavBtn) ledgerNavBtn.addEventListener('click', goToLedger);
    const myNetBtn = document.getElementById('my-net-btn');
    if (myNetBtn) myNetBtn.addEventListener('click', goToLedger);

    // Ledger: a row opens to its bets; Settle up copies for the group text or lists bet by bet,
    // and marks payments paid (or undoes a mark)
    ledgerContainer.addEventListener('click', (e) => {
        const row = e.target.closest('[data-ledger-row]');
        if (row) return toggleLedgerRow(row);
        const betByBet = e.target.closest('#bet-by-bet-btn');
        if (betByBet) return toggleBetByBet(betByBet);
        if (e.target.closest('#copy-settle-up-btn')) return shareSettleUp();
        const markBtn = e.target.closest('[data-pay-mark]');
        if (markBtn) return markPaid(markBtn);
        const undoBtn = e.target.closest('[data-pay-undo]');
        if (undoBtn) return undoPaid(undoBtn);
    });
    watchLedgerForFab();

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
            await refreshBoard({ recheck: true });
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
// This page's address for email and Google links to come back to (keeps ?next= and ?bet=,
// so someone who opened a texted challenge lands on it after logging in or signing up).
function pageUrl() {
    const query = [];
    if (NEXT) query.push(`next=${NEXT}`);
    if (ADMIN_TAB) query.push(`tab=${ADMIN_TAB}`);
    if (BET_LINK) query.push(`bet=${encodeURIComponent(BET_LINK)}`);
    return window.location.origin + window.location.pathname + (query.length ? `?${query.join('&')}` : '');
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
            next_step: 'Approve them in Admin → RSVPs (link below) so they show on the site.',
            admin_link: 'https://bros-before-boges.vercel.app/admin#rsvps'
        });
    }
    return data;
}

// The login's own roster row, public columns only (emails and GHINs can't be read once
// privacy_2027.sql has run). The page uses its id, name and status; the admin flag comes from
// loadAdminFlag.
async function findLinkedPlayer(userId) {
    const { data, error } = await supabaseClient
        .from('players')
        .select('id, name, status, team_id, handicap, user_id')
        .eq('user_id', userId)
        .limit(1);
    if (error) throw error;
    return data && data.length ? data[0] : null;
}

// Link a login to an unclaimed roster spot. Returns the row as linked ({ id, name, status, held }),
// or null if nothing changed. Once payments_2027.sql has run, a name whose roster email isn't this
// login's comes back 'potential' and held: it waits for the commissioner, who gets an email to
// check it's him.
async function claimPlayer(playerId, user) {
    const { data, error } = await supabaseClient
        .from('players')
        .update({ user_id: user.id })
        .eq('id', playerId)
        .is('user_id', null)
        .select('id, name, status');
    if (error || !data || !data.length) return null;
    const row = data[0];
    // Someone else's name waits for the commissioner (payments_2027.sql). If we can't tell, he
    // gets the alert anyway: a potential name needs him either way.
    row.held = await pickIsHeld(row, true);
    if (row.held) {
        // Awaited: a return trip (?next=) can leave the page right after this
        await sendAlert(`BBB: ${row.name} was claimed by ${user.email || 'a login with no email'} (needs approval)`, {
            name: row.name,
            login_email: user.email || '—',
            next_step: 'Check it’s really him, then approve him in Admin → RSVPs (link below). If it isn’t him, unlink that login there.',
            admin_link: 'https://bros-before-boges.vercel.app/admin#rsvps'
        });
    }
    return row;
}

// Is this row a held pick (someone else's name this login picked, waiting for the commissioner)?
// Asked of the database (payments_me.own_ok), never by comparing emails: roster emails can't be
// read once privacy_2027.sql has run. onError: the answer when payments_me fails other than
// "not set up" (before payments_2027.sql nothing was ever held).
async function pickIsHeld(row, onError) {
    if (!row || row.status !== 'potential') return false;
    if (typeof row.own_ok === 'boolean') return !row.own_ok;
    try {
        const { data, error } = await supabaseClient.rpc('payments_me');
        if (error) return isMissingFunction(error) ? false : onError;
        if (!data || data.player_id !== row.id) return onError;
        return data.own_ok === false;
    } catch (e) {
        return onError;
    }
}

// A roster name this login picked whose roster email isn't the login's: payments_2027.sql holds it
// for the commissioner, and until he approves it can't RSVP or bet. (A new guy's own sign-up has
// his email on it, so it isn't one.) Before that script runs there's no such thing.
async function isHeldPick(player, user) {
    return pickIsHeld(player, false);
}

const isMissingFunction = err => /PGRST202|could not find the function/i.test(`${err && err.code} ${err && err.message}`);
const isMissingTable = err => /PGRST205|42P01|could not find the table/i.test(`${err && err.code} ${err && err.message}`);

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
    if (await claimPlayer(pid, user)) return findLinkedPlayer(user.id);
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
// The database finds the row (privacy_2027.sql); the site never sees roster emails.
async function claimByEmail(user) {
    if (!normName(user && user.email)) return null;
    const { data, error } = await supabaseClient.rpc('claim_roster_by_email');
    if (error) {
        if (isMissingFunction(error)) return legacyClaimByEmail(user);
        console.error('Could not link by email:', error);
        return null;
    }
    return data ? findLinkedPlayer(user.id) : null;
}
// Until privacy_2027.sql has run: today's body, verbatim
async function legacyClaimByEmail(user) {
    const email = normName(user && user.email);
    if (!email) return null;
    const { data, error } = await supabaseClient.from('players').select('id, email, user_id').is('user_id', null);
    if (error || !data) return null;
    const match = data.find(p => normName(p.email) === email);
    if (!match || !(await claimPlayer(match.id, user))) return null;
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
        let claimed = null;
        if (isNew) {
            try {
                await joinRoster(name, session.user.email);
            } catch (err) {
                showToast(friendlyAuthError(err), 'error');
                return;
            }
        } else {
            claimed = await claimPlayer(select.value, session.user);
            if (!claimed) {
                showToast(`Couldn’t link ${name}: it’s linked to another login or reserved for the commissioner. Text the commissioner.`, 'error');
                await showLinkPicker(session.user);
                return;
            }
        }
        // Someone else's name (his email isn't this login's) waits for the commissioner: the wall
        // that loads next says why
        if (claimed && claimed.held) {
            showToast('Linked. The commissioner checks it’s really you first.', 'info');
        } else {
            showToast(isNew ? `You’re on the list, ${name.split(' ')[0]}.` : `Linked. Welcome, ${name.split(' ')[0]}.`, 'success');
        }
        await loadSession();
    } finally {
        btn.disabled = false;
    }
}

// Admin buttons follow the database's own rule (is_trip_admin: an is_admin roster row with this
// login's email), so the page never offers an admin action the database will refuse
async function loadAdminFlag(playerId) {
    try {
        const { data, error } = await supabaseClient.rpc('is_trip_admin');
        if (!error) return data === true;
        if (isMissingFunction(error)) return legacyIsAdminFlag(playerId);
        console.error('Admin check failed:', error);
    } catch (e) { /* offline: no admin buttons until the next load */ }
    return false;
}
// Only while is_trip_admin is missing (never live: rsvp_accounts.sql made it; the plain test fake lacks it)
async function legacyIsAdminFlag(playerId) {
    const { data, error } = await supabaseClient.from('players').select('is_admin').eq('id', playerId).limit(1);
    return !error && !!(data && data[0] && data[0].is_admin);
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

    // Keeping score, live scores and Admin only need a login, not a roster name
    if (['round', 'board', 'admin'].includes(NEXT) && !resetPending) {
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

    // Someone else's roster name (his email isn't this login's) waits for the commissioner and
    // can't RSVP yet, so it stays here to say so instead of going on to the RSVP
    const held = player.status === 'potential' && await isHeldPick(player, session.user);
    if (NEXT && !resetPending && !held) {
        goToNextPage();
        return true;
    }

    // New guys can RSVP right away, but betting waits until the commissioner confirms them.
    if (player.status === 'potential') {
        currentUser = null;
        showWall('', true, { pending: true, held, name: String(player.name).split(' ')[0], fullName: String(player.name) });
        return false;
    }

    currentUser = player;
    currentUser.is_admin = await loadAdminFlag(player.id);
    showDashboard();
    showBoardSkeleton();
    await refreshBoard();
    if (openLedgerOnLoad) {
        openLedgerOnLoad = false;
        document.getElementById('ledger-panel').scrollIntoView({ block: 'start' });
    }
    openBetLink();
    return true;
}

// A ?bet=<id> link: show that card on the main board (or the list that has it) and flash it.
// Runs once, after the first board that loaded.
function openBetLink() {
    if (!betLinkPending || !currentUser) return;
    if (loadError && !allWagers.length) return; // the board didn't load: try again on the next refresh
    betLinkPending = false;
    const wager = findWager(BET_LINK);
    if (!wager) {
        showToast('Couldn’t find that bet. It may have been called off.', 'info');
        return;
    }
    let filter = 'past';
    if (isCurrentSeason(wager)) {
        filter = ['all', wager.type === 'h2h' ? 'h2h' : 'pools', 'me']
            .find(f => wagersForFilter(f).some(w => w.id === wager.id)) || 'all';
    } else {
        showToast(`That bet is from the ${seasonYear(wager)} trip, under Past Trips.`, 'info');
    }
    setFilter(filter);
    // On a phone the chip row scrolls sideways: bring the list it opened on into view
    const nav = document.querySelector('.bookie-nav');
    const chip = nav && nav.querySelector('button.active');
    if (chip && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = Math.max(0, chip.offsetLeft - nav.offsetLeft - 16);
    const card = document.getElementById(`wager-card-${wager.id}`);
    if (!card) return;
    revealCard(wager.id);
    // Screen readers start reading at the card; a tap anywhere still does nothing by accident
    card.tabIndex = -1;
    card.focus({ preventScroll: true });
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
    if (opts.pending && opts.held) {
        // A roster name picked with a different email than the one on the roster
        setWallCopy(`Almost there, ${opts.name}`, `The commissioner checks it’s really you first, since your login email isn’t the one on the roster for ${opts.fullName}. Once he confirms you, you can RSVP and ${ACCOUNT_MODE ? 'update your golf profile' : 'bet'}. Picked the wrong name? Text the commissioner to unlink it.`, icon);
    } else if (opts.pending) {
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
    document.getElementById('wall-rsvp-link').hidden = !opts.pending || !!opts.held;
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
    authForm.classList.remove('is-sent');
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
    if (/already registered/i.test(msg)) return 'That email already has a login (maybe from keeping score or Admin). Log in with it instead, then pick your name to link it.';
    if (/password should be at least/i.test(msg)) return 'Pick a password with at least 6 characters.';
    // Supabase sends one email per address per minute
    const wait = msg.match(/only request this after (\d+) seconds?/i);
    if (wait) return `We just sent an email to that address. Check the inbox and spam folder for it. Nothing there? You can ask for another in ${wait[1]} seconds.`;
    if (/email rate limit|over_email_send_rate_limit/i.test(msg)) return 'Too many emails have gone out from the site this hour. Try again later, or ask the commissioner.';
    if (/error sending (confirmation|recovery|magic link)? ?email/i.test(msg)) return 'We couldn’t send the email just now. Try again in a few minutes, or ask the commissioner.';
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

    const claimed = await claimPlayer(match.id, authData.session.user);
    if (!claimed) {
        throw new Error(`Your login was created, but ${match.name}’s roster spot couldn’t be linked. Ask the commissioner to link it.`);
    }
    // Someone else's email on that name: it waits for the commissioner
    return claimed.held ? 'held' : 'linked';
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
                showSignupSent(`Almost done: check ${email} for “Confirm your email” from Bros before Boges. Tap the link in it and you’ll be logged in${NEXT === 'rsvp' ? ' and taken straight to the RSVP' : ''}. Nothing after a few minutes? Check spam, or ask the commissioner.`);
                return;
            }
            if (result === 'held') showToast('Account created. The commissioner checks it’s really you first.', 'info');
            else showToast('Account created. You’re in.', 'success');
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
            // Tapped again within a minute: the first tap already sent the confirmation email
            if (/only request this after \d+ seconds?/i.test((err && err.message) || '')) {
                showSignupSent(`We already sent “Confirm your email” to ${email}. Check the inbox and spam folder, then tap the link in it to log in.`);
                return;
            }
        }
        setAuthMessage(friendlyAuthError(err), true);
    } finally {
        authSubmitBtn.disabled = false;
        authSubmitBtn.textContent = idleLabel;
    }
}

// After sign-up only the "check your email" note shows, so nobody taps "Create my account" twice
function showSignupSent(text) {
    authForm.classList.add('is-sent');
    modalTitle.textContent = 'Check your email';
    setAuthMessage(text, false);
    toggleAuthModeBtn.textContent = 'Confirmed your email? Log in';
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
    else {
        allComments = comments || [];
        commentsLoaded = true;
    }

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

// opts.recheck: look for the Venmo and Paid tables again even if they weren't there (the Refresh
// button and pull-to-refresh; other refreshes don't ask again on this visit)
async function refreshBoard(opts) {
    await fetchBaseData();
    // Venmo usernames and Paid marks load next, without holding up the board, the Ledger or whoever
    // is waiting on them: the Ledger shows the last marks that loaded and re-renders when the new
    // ones land. The first time there are none yet, so Settle up waits for them (a few seconds at
    // most) rather than flash a payment that's already been made.
    if (payState() === 'idle' && !payData.firstWait) {
        payData.firstWait = true;
        pause(PAY_WAIT_MS).then(() => {
            payData.firstWait = false;
            if (payState() === 'idle') renderLedger();
        });
    }
    const paidMarks = loadPayments({ recheck: !!(opts && opts.recheck) });
    renderCupCard();
    renderWagers();
    renderLedger();
    updateNotificationBadges();
    paidMarks.then(result => { if (result !== 'stale' && result !== 'skipped') renderLedger(); });
    lastRefresh = Date.now();
    if (betLinkPending && wallState === 'dashboard') openBetLink(); // a ?bet= link the first load couldn't show
}

// The Refresh button: spins while it works
async function refreshNow(btn) {
    if (btn.getAttribute('aria-busy') === 'true') return;
    btn.setAttribute('aria-busy', 'true'); // not disabled, so keyboard focus stays put
    const icon = btn.querySelector('i');
    if (icon) icon.classList.add('fa-spin');
    try {
        await refreshBoard({ recheck: true });
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
        // The list's own button: a chip, or on a phone (where Board and My Bets are only in the bottom bar) the tab
        const shown = el => !!el && el.getClientRects().length > 0;
        const next = wagersContainer.querySelector('[id^="wager-card-"] button:not([disabled])') ||
            [...document.querySelectorAll('.bookie-nav button.active, .bottom-nav-btn.active')].find(shown);
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
    const still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    card.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' });
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
// The page heading on a phone names the list you're in, since the chips for All bets and My Bets
// give way to the bottom bar there ("The Board" on wider screens, where the chips show it)
const FILTER_TITLES = { pools: ['Pools & ', 'Props'], h2h: ['Head-to-', 'Head'], me: ['My ', 'Bets'], past: ['Past ', 'Trips'] };

function setFilter(filter) {
    currentFilter = filter;
    document.querySelectorAll('.bookie-nav button[data-filter], .bottom-nav-btn[data-filter]').forEach(b => {
        const on = b.dataset.filter === filter;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
    });
    dashboard.dataset.filter = filter;
    const title = FILTER_TITLES[filter];
    const filterTitle = document.getElementById('dash-title-filter');
    if (filterTitle && title) {
        filterTitle.firstChild.textContent = title[0];
        filterTitle.lastChild.textContent = title[1];
    }
    // The Cup card belongs on the main board only
    const cupCard = document.getElementById('cup-card');
    if (cupCard) cupCard.hidden = filter !== 'all';
    renderWagers();
    renderLedger(); // Past Trips shows last trip's ledger
    // Scrolled down the list (or at the ledger)? Jump back to the top of the new list.
    const nav = document.querySelector('.bookie-nav');
    if (nav && nav.getBoundingClientRect().top < 0) nav.scrollIntoView({ block: 'start' });
}

// Bets waiting on you: a challenge to answer, your pool or prop to record a result for after
// betting closed, or a live head-to-head of yours once the trip is over (either player can record it).
function needsMe(w) {
    if (!currentUser || !isCurrentSeason(w)) return false;
    const me = currentUser.id;
    if (w.status === 'proposed') return w.target_id === me;
    if (w.status !== 'active') return false;
    if (w.type === 'h2h') return (w.creator_id === me || w.target_id === me) && tripOverFor(w);
    return w.creator_id === me;
}

// "2027-04-09": the date on the trip's own clocks, never the phone's (the crew flies in from
// other time zones), the same way the homepage decides trip days
const TRIP_TZ = (BBB.trip && BBB.trip.timeZone) || 'America/Phoenix';
let tripDayFormat = null;
function tripDay(ms) {
    try {
        if (!tripDayFormat) tripDayFormat = new Intl.DateTimeFormat('en-US', { timeZone: TRIP_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
        const p = {};
        tripDayFormat.formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; });
        return `${p.year}-${p.month}-${p.day}`;
    } catch (e) {
        return new Date(ms - 7 * 3600000).toISOString().slice(0, 10); // Arizona's fixed UTC-7
    }
}

// A live head-to-head counts as over once the trip it was made for has ended. Nothing on the
// bet says which round (or whether a round at all) it's about, so Live scores can't tell sooner.
function tripOverFor(w) {
    const tripEnd = BBB.trip && BBB.trip.dates && BBB.trip.dates.end;
    const made = new Date(w.created_at).getTime();
    if (!tripEnd || isNaN(made)) return false;
    return tripDay(made) <= tripEnd && tripDay(Date.now()) > tripEnd;
}

// Called-off bets: who did it and when, from the note the page leaves in the trash talk
// (the wagers table has no updated_at; if it ever gets one, that's used for the time).
// Anyone can post trash talk, so only a note its author could have left counts: a decline only
// from the player challenged; a cancel or void from someone in the bet (the latest, in case an
// admin reopened it and it was voided again), else the first one anybody left (an admin's).
const CALL_OFF_NOTE = /^(Declined the challenge\.|Canceled the bet\.|Voided the bet\.)/;
function callOffNote(w) {
    const calls = allComments
        .filter(c => c.wager_id === w.id && CALL_OFF_NOTE.test(String(c.message || '')) &&
            (!/^Declined/.test(c.message) || c.player_id === w.target_id))
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const inBet = id => id === w.creator_id || id === w.target_id || (w.participants || []).includes(id);
    const fromBet = calls.filter(c => inBet(c.player_id));
    return fromBet[fromBet.length - 1] || calls[0] || null;
}
function calledOffAt(w) {
    const stamp = w.updated_at || (callOffNote(w) || {}).created_at;
    const at = stamp ? new Date(stamp) : null;
    return at && !isNaN(at) ? at : null;
}
// "Westin passed on this one." / "Called off by Kelly." / "You called it off."
function calledOffText(w) {
    const note = callOffNote(w);
    if (!note || !note.player_id) return 'This bet was called off.';
    const mine = !!currentUser && note.player_id === currentUser.id;
    if (/^Declined/.test(note.message)) return mine ? 'You passed on this one.' : `${escHtml(firstName(note.player_id))} passed on this one.`;
    return mine ? 'You called it off.' : `Called off by ${escHtml(firstName(note.player_id))}.`;
}
// A bet of yours called off in the last day stays on the main board, so the challenger sees
// the answer where they left the challenge. After that it's under My Bets and the type tabs.
const CALLED_OFF_STAYS_MS = 24 * 60 * 60 * 1000;
function recentlyCalledOff(w) {
    if (w.status !== 'canceled' || !involvesMe(w)) return false;
    // The trash talk hasn't loaded yet, so there's no telling when: keep it in view, not dropped
    if (!w.updated_at && !commentsLoaded) return true;
    const at = calledOffAt(w);
    return !!at && Date.now() - at.getTime() < CALLED_OFF_STAYS_MS;
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
    // No points yet: phones show the card as one short line (bookie.html's .cup-quiet)
    const cupCard = document.getElementById('cup-card');
    if (cupCard) cupCard.classList.toggle('cup-quiet', !SEASON_LIVE || !supabaseClient);

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
        // The main board skips called-off bets (still under My Bets and the type tabs), except
        // yours for a day after they're called off
        default: return current.filter(w => w.status !== 'canceled' || recentlyCalledOff(w));
    }
}

// Board order: bets waiting on you, then live bets (and yours just called off, where they were),
// then finished ones (newest first within each)
function boardRank(w) {
    if (needsMe(w)) return 0;
    if (['proposed', 'open', 'active'].includes(w.status) || recentlyCalledOff(w)) return 1;
    return 2;
}

const RETRY_BUTTON = '<button type="button" class="refresh-btn" onclick="refreshBoard()"><i class="fas fa-sync-alt" aria-hidden="true"></i>Retry</button>';

function renderWagers() {
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
        }[currentFilter] || 'No bets on the board yet.';
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

    // The bets that sort first because they need you get a heading (its count matches the
    // badges on the filter chips), and the rest get one under them
    const waiting = displayWagers.filter(w => boardRank(w) === 0);
    const rest = displayWagers.filter(w => boardRank(w) !== 0);
    const groups = waiting.length
        ? `<h3 class="board-group-head waiting">Waiting on you (${waiting.length})</h3>` + waiting.map(wagerCardHTML).join('') +
            (rest.length ? '<h3 class="board-group-head">Everything else</h3>' + rest.map(wagerCardHTML).join('') : '')
        : displayWagers.map(wagerCardHTML).join('');
    wagersContainer.innerHTML = staleBanner + groups;

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
}

const BADGE_COLORS = {
    red: ['rgba(239, 68, 68, 0.18)', '#fca5a5'],
    gold: ['rgba(251, 191, 36, 0.18)', 'var(--accent-gold)'],
    green: ['rgba(16, 185, 129, 0.2)', 'var(--accent-emerald)'],
    blue: ['rgba(59, 130, 246, 0.2)', '#93c5fd'],
    muted: ['rgba(255, 255, 255, 0.1)', 'var(--text-muted)']
};

// The card's status, from the viewer's side when they're in the bet ("Your call",
// "Waiting on Westin", "Needs a result", "You're in"); plain for everyone else
function statusBadge(wager) {
    const me = currentUser ? currentUser.id : null;
    const inBet = !!me && involvesMe(wager);
    if (needsMe(wager)) return wager.status === 'proposed' ? ['Your call', 'red'] : ['Needs a result', 'red'];
    // Left open when the season moved on (Past Trips): nobody can settle it now. A challenge
    // nobody accepted was never a bet, so it says that instead.
    if (neverSettled(wager)) return [wager.status === 'proposed' ? 'Never answered' : 'Never settled', 'gold'];
    switch (wager.status) {
        case 'proposed': // the challenge's answer is up to its target, whoever's looking
            return wager.target_id
                ? [`Waiting on ${isMe(wager.target_id) ? 'you' : escHtml(firstName(wager.target_id))}`, 'gold'] : ['Challenge sent', 'gold'];
        case 'open':
            return (wager.participants || []).includes(me) ? ['You’re in', 'green'] : ['Open', 'green'];
        case 'active':
            if (wager.type !== 'h2h') return ['Betting closed', 'blue'];
            return inBet ? ['You’re in', 'blue'] : ['Live', 'blue'];
        case 'settled': return ['Settled', 'muted'];
        case 'push': return ['Push (tie)', 'gold'];
        case 'canceled': return ['Called off', 'red'];
        default: return null;
    }
}

function statusBadgeHTML(wager) {
    const badge = statusBadge(wager);
    if (!badge) return '';
    const [bg, color] = BADGE_COLORS[badge[1]];
    return `<span class="status-badge" style="background: ${bg}; color: ${color}; padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; font-weight: 700; white-space: nowrap;">${badge[0]}</span>`;
}

function statPill(label, value, color) {
    return `<div class="stat-pill"${color ? ` style="color: ${color}"` : ''}>${label ? `<span style="color:var(--text-muted)">${label}</span> ` : ''}<span style="font-weight:700">${value}</span></div>`;
}

// Names on a card, from the viewer's side: "you" for yourself, the full name for anyone else
const isMe = id => !!currentUser && id === currentUser.id;
const who = id => (isMe(id) ? 'you' : escHtml(getPlayerName(id)));
const Who = id => (isMe(id) ? 'You' : escHtml(getPlayerName(id)));
const capFirst = s => s.charAt(0).toUpperCase() + s.slice(1);

// You're one of the two players in this head-to-head: what you win and what you lose
// (h2hPayouts is the one place the money comes from)
function myH2hStakes(wager) {
    if (wager.type !== 'h2h' || !currentUser) return null;
    const { creatorWins, targetWins } = h2hPayouts(wager.amount, wager.odds);
    if (wager.creator_id === currentUser.id) return { win: creatorWins, lose: targetWins, other: wager.target_id };
    if (wager.target_id === currentUser.id) return { win: targetWins, lose: creatorWins, other: wager.creator_id };
    return null;
}

// What's at stake, per bet type, for the card's stat row
function stakesHTML(wager) {
    const parts = wager.participants || [];
    if (wager.type === 'h2h') {
        const mine = myH2hStakes(wager);
        if (mine) {
            // What's riding on it while it's live; once it's decided, only what happened
            if (wager.status === 'proposed' || wager.status === 'active') {
                return statPill('You win', fmtMoney(mine.win, true), 'var(--accent-emerald)') +
                    statPill('You lose', fmtMoney(-mine.lose), '#fca5a5');
            }
            if (wager.status === 'settled' && wager.winner_id) {
                return isMe(wager.winner_id)
                    ? statPill('You won', fmtMoney(mine.win, true), 'var(--accent-emerald)')
                    : statPill('You lost', fmtMoney(-mine.lose), '#fca5a5');
            }
            return ''; // a push or called off: the box below says no money changes hands
        }
        const { creatorWins, targetWins } = h2hPayouts(wager.amount, wager.odds);
        const odds = normOdds(wager.odds);
        return statPill(`${escHtml(firstName(wager.creator_id))} wins`, fmtMoney(creatorWins)) +
            statPill(`${escHtml(firstName(wager.target_id))} wins`, fmtMoney(targetWins)) +
            (odds !== 100 && odds !== -100 ? statPill('', `<i class="fas fa-chart-line" aria-hidden="true"></i> ${escHtml(firstName(wager.target_id))} ${fmtOdds(odds)}`, 'var(--accent-gold)') : '');
    }
    if (wager.type === 'prop') {
        const takers = parts.filter(id => id !== wager.creator_id).length;
        const risker = isMe(wager.creator_id) ? 'You' : escHtml(firstName(wager.creator_id));
        return statPill('Per taker', fmtMoney(wager.amount)) +
            statPill(`${risker} risk${isMe(wager.creator_id) ? '' : 's'}`, fmtMoney(wager.amount * takers), 'var(--accent-emerald)') +
            statPill('', `${takers} <i class="fas fa-users" style="font-size: 0.8rem; color: var(--text-muted)" aria-label="${takers === 1 ? 'taker' : 'takers'}"></i>`);
    }
    return statPill('Buy-in', fmtMoney(wager.amount)) +
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

    if (wager.status === 'push') return box(GOLD, 'fa-handshake', 'Push (tie)', 'All bets refunded. No blood drawn.');
    // The badge already says "Called off": the box says who did it
    if (wager.status === 'canceled') return box(RED, 'fa-ban', calledOffText(wager), 'No money changes hands.');
    if (wager.status !== 'settled' || !wager.winner_id) return '';

    const parts = wager.participants || [];
    const winnerIds = wager.winner_ids && wager.winner_ids.length ? wager.winner_ids : [wager.winner_id];
    // "you" when it's the viewer; "owes" / "owe" to match
    const owes = id => (isMe(id) ? 'owe' : 'owes');

    if (wager.type === 'h2h') {
        const { creatorWins, targetWins } = h2hPayouts(wager.amount, wager.odds);
        const targetWon = wager.winner_id === wager.target_id;
        const loser = targetWon ? wager.creator_id : wager.target_id;
        return box(GREEN, 'fa-trophy', `${Who(wager.winner_id)} won`, `${Who(loser)} ${owes(loser)} ${who(wager.winner_id)} ${fmtMoney(targetWon ? targetWins : creatorWins)}.`);
    }
    if (wager.type === 'prop') {
        const takers = parts.filter(id => id !== wager.creator_id);
        if (winnerIds.includes(wager.creator_id)) {
            return box(GREEN, 'fa-trophy', `${Who(wager.creator_id)} won the prop`, `Each taker owes ${who(wager.creator_id)} ${fmtMoney(wager.amount)}: ${takers.map(who).join(', ') || 'nobody'}.`);
        }
        const iTook = takers.some(isMe);
        return box(GREEN, 'fa-trophy', 'The takers won', `${Who(wager.creator_id)} ${owes(wager.creator_id)} ${iTook ? `you ${fmtMoney(wager.amount)}, the same as every taker` : `each taker ${fmtMoney(wager.amount)}`} (${fmtMoney(wager.amount * takers.length)} total).`);
    }
    const winners = parts.filter(id => winnerIds.includes(id));
    const losers = parts.filter(id => !winnerIds.includes(id));
    return box(GREEN, 'fa-trophy', `Won by ${winners.map(who).join(' & ') || 'nobody'}`,
        `${capFirst(potSplitText(wager.amount, parts.length, winners, who))} ${losers.length ? `${capFirst(losers.map(who).join(', '))} paid ${fmtMoney(wager.amount)} into the pot.` : ''}`);
}

// "Takes the $30 pot." / "$15 each." / "Jeff $13.34, Kelly $13.33, Zac $13.33." (pennies don't split evenly)
function potSplitText(amount, players, winners, name) {
    const shares = potShares(amount, players, winners.length);
    if (!shares.length) return '';
    if (shares.length === 1) return `Takes the ${fmtMoney(shares[0])} pot.`;
    if (shares.every(s => s === shares[0])) return `${fmtMoney(shares[0])} each.`;
    return winners.map((id, i) => `${name(id)} ${fmtMoney(shares[i])}`).join(', ') + '.';
}

// Who's in: everyone for pools, just the takers for a prop ("you" first when you're one).
// A head-to-head's line under its terms already says who's on it ("Kelly challenged you"), so
// it gets a players line only for people outside it, and not while it's a pending challenge.
function peopleLineHTML(wager) {
    const parts = wager.participants || [];
    if (wager.type === 'h2h' && (wager.status === 'proposed' || myH2hStakes(wager))) return '';
    let people = wager.type === 'prop' ? parts.filter(id => id !== wager.creator_id) : parts;
    if (!people.length) return '';
    people = people.filter(isMe).concat(people.filter(id => !isMe(id)));
    const label = wager.type === 'prop' ? 'Takers' : (wager.type === 'h2h' ? 'Players' : 'Who’s in');
    return `<div style="margin-top: 10px; font-size: 0.85rem; color: var(--text-muted); line-height: 1.4;"><strong>${label}:</strong> ${capFirst(people.map(who).join(', '))}</div>`;
}

// The line under a bet's terms: who challenged whom, or who's on which side of a prop
function sidesLineHTML(wager) {
    let text = '';
    if (wager.type === 'h2h' && wager.target_id) {
        if (isMe(wager.target_id)) text = `${escHtml(firstName(wager.creator_id))} challenged you`;
        else if (isMe(wager.creator_id)) text = `You challenged ${escHtml(firstName(wager.target_id))}`;
        else text = `Challenging: ${escHtml(wager.target && wager.target.name ? wager.target.name : getPlayerName(wager.target_id))}`;
    } else if (wager.type === 'prop') {
        const iTook = !isMe(wager.creator_id) && (wager.participants || []).includes(currentUser && currentUser.id);
        text = `${isMe(wager.creator_id) ? 'You say' : `${escHtml(firstName(wager.creator_id))} says`} it happens · ${iTook ? 'you say' : 'takers say'} it doesn’t`;
    }
    return text ? `<div class="bet-sides">${text}</div>` : '';
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

// The players who run a bet without admin powers: its creator, and (for recording who won) either
// player in a head-to-head. Anyone else acting on it is an admin overriding them.
function runsBet(wager, eitherPlayer) {
    if (!currentUser) return false;
    const me = currentUser.id;
    return wager.creator_id === me || (!!eitherPlayer && wager.type === 'h2h' && wager.target_id === me);
}

// The first line of an admin's confirm on someone else's bet ("Admin override: this is Kelly
// Dennard’s bet."). Plain text for a native dialog, so names aren't escaped.
function overrideLine(wager, eitherPlayer) {
    if (!currentUser || !currentUser.is_admin || runsBet(wager, eitherPlayer)) return '';
    const owner = wager.type === 'h2h' && wager.target_id
        ? `${getPlayerName(wager.creator_id)} and ${getPlayerName(wager.target_id)}`
        : getPlayerName(wager.creator_id);
    return `Admin override: this is ${owner}’s bet.\n\n`;
}

// Bets from an earlier trip that never got a result (the season date moved past them)
const UNFINISHED = ['proposed', 'open', 'active'];
const neverSettled = w => !isCurrentSeason(w) && UNFINISHED.includes(w.status);

function actionsHTML(wager) {
    const me = currentUser ? currentUser.id : null;
    const parts = wager.participants || [];
    const isCreator = wager.creator_id === me;
    const isTarget = wager.target_id === me;
    const isParticipant = parts.includes(me);
    const isAdmin = !!(currentUser && currentUser.is_admin);
    const takers = parts.filter(id => id !== wager.creator_id);
    const id = escHtml(wager.id);
    // #f87171 on the red tint: 6:1 (#ef4444 was 4.4:1)
    const RED = 'background: rgba(239, 68, 68, 0.08); color: #f87171; border: 1px solid rgba(248, 113, 113, 0.35);';
    const GREEN = 'background: rgba(16, 185, 129, 0.1); color: var(--accent-emerald); border: 1px solid var(--accent-emerald);';
    const row = buttons => `<div class="bet-actions" style="display: flex; gap: 10px; margin-top: 15px;">${buttons}</div>`;
    const note = text => `<div style="margin-top: 15px; text-align: center; color: var(--text-muted); font-size: 0.9rem;">${text}</div>`;
    // Buttons that only show because you're an admin say so, as Reopen (admin) does
    const asAdmin = (label, override) => (override ? `${label} (admin)` : label);
    const cancelBtn = isJustMine(wager)
        ? actionButton('Cancel bet', 'fa-ban', `window.deleteWager('${id}')`, RED, 'cancel-btn delete-ok')
        : actionButton(asAdmin('Cancel bet', !isCreator), 'fa-ban', `window.cancelWager('${id}')`, RED, isCreator ? 'cancel-btn' : 'cancel-btn admin-override');
    const whoWonBtn = actionButton(asAdmin('Who won?', !runsBet(wager, true)), 'fa-trophy', `window.openSettleModal('${id}')`, GREEN, 'who-won-btn');

    // Last trip's leftovers don't count toward this year's ledger: no joining or settling them,
    // but their creator (or an admin) can still clear them off. Everyone sees one never settled.
    if (!isCurrentSeason(wager)) {
        if (!neverSettled(wager)) return '';
        if (isCreator || isAdmin) return row(cancelBtn) + note(`From the ${seasonYear(wager)} trip. It doesn’t count toward this year’s ledger.`);
        const why = wager.status === 'proposed' ? 'The challenge was never accepted' : 'Nobody recorded a result';
        return note(`From the ${seasonYear(wager)} trip. ${why}, so no money changes hands.`);
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
            if (isCreator) {
                // Nobody gets a notification, so make texting them one tap
                const them = escHtml(firstName(wager.target_id));
                return note(`<i class="fas fa-clock" style="margin-right: 5px;" aria-hidden="true"></i>${them} hasn’t answered yet. The Bookie can’t notify them, so send a text.`) +
                    row(`<button type="button" class="btn text-challenge-btn" onclick="window.textChallenge('${id}')"><i class="fas fa-paper-plane" style="margin-right: 6px;" aria-hidden="true"></i>Text ${them} about it</button>`) +
                    row(cancelBtn);
            }
            return isAdmin ? row(cancelBtn) : '';
        }
        if (wager.status === 'active' && (isCreator || isTarget || isAdmin)) {
            return row(whoWonBtn);
        }
        return isParticipant && wager.status === 'active' ? note('You’re in this bet') : '';
    }

    // Pools and props: open for joining → creator closes betting → creator settles
    const canManage = isCreator || isAdmin;
    if (wager.status === 'open') {
        let html = '';
        if (!isParticipant) {
            html += row(`<button class="btn join-btn" style="width: 100%; padding: 10px; min-height: 44px;" onclick="window.joinWager('${id}')">${wager.type === 'prop' ? 'Bet it doesn’t' : 'Join pool'} (${fmtMoney(wager.amount)})</button>`);
        } else if (!isCreator) {
            // The "You're in" badge says it; Leave gets you out while betting's open
            html += row(actionButton('Leave', 'fa-sign-out-alt', `window.leaveWager('${id}')`, RED, 'leave-btn'));
        }
        if (canManage) {
            const enough = wager.type === 'prop' ? takers.length >= 1 : parts.length >= 2;
            html += row((enough ? actionButton(asAdmin('Close betting', !isCreator), 'fa-lock', `window.closeBetting('${id}')`, GREEN, isCreator ? '' : 'admin-override') : '') + cancelBtn);
            if (!enough && isCreator) html += note(wager.type === 'prop' ? 'Waiting for someone to bet it doesn’t.' : 'Waiting for others to join.');
        }
        return html;
    }
    if (wager.status === 'active') {
        if (canManage) return row(whoWonBtn);
        if (isParticipant) return note(`Betting’s closed. Waiting on ${escHtml(getPlayerName(wager.creator_id))} to record who won.`);
    }
    return '';
}

function wagerCardHTML(wager) {
    const id = escHtml(wager.id);
    const stakes = stakesHTML(wager);

    const typeLabel = wager.type === 'h2h' ? 'Head-to-Head' : (wager.type === 'prop' ? 'Prop bet' : 'Pool');
    const creatorLabel = isMe(wager.creator_id) ? 'You' : (wager.creator ? escHtml(wager.creator.name) : 'Unknown');
    // The trip it was for, the same year the ledger's "2026 · Final" uses
    const pastLabel = isCurrentSeason(wager) ? '' : ` • ${seasonYear(wager) || ''}`;

    // Waiting on you (a challenge to answer, or a result to record): red, like the heading over it
    let cardStyle = `margin-bottom: 20px; padding: 20px; border-left: 4px solid ${wager.type === 'h2h' ? 'var(--accent-gold)' : 'var(--accent-emerald)'}; position: relative;`;
    if (needsMe(wager)) {
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
                    <div style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 5px;">${creatorLabel} • <span style="white-space: nowrap;">${typeLabel}${pastLabel}</span></div>
                    <h4 style="font-size: 1.1rem; margin-bottom: 5px; overflow-wrap: anywhere;">${escHtml(wager.description)}</h4>
                    ${sidesLineHTML(wager)}
                </div>
                <div style="text-align: right; flex-shrink: 0;">
                    ${statusBadgeHTML(wager)}
                </div>
            </div>

            ${stakes ? `<div class="wager-quick-stats">${stakes}</div>` : ''}
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
        ? `Bet ${fmtMoney(wager.amount)} that “${wager.description}” doesn’t happen?\n\nIf it happens, you pay ${creator} ${fmtMoney(wager.amount)}. If it doesn’t, ${creator} pays you ${fmtMoney(wager.amount)}.`
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
                    showToast(wager.type === 'prop' ? 'You’re in. You’re betting it doesn’t happen.' : 'You’re in the pool.', 'success');
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
    if (!confirm(overrideLine(wager) + question)) return;

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
    if (!confirm(`${overrideLine(wager)}Close betting on “${wager.description}”? Nobody else can join after this. Once the result is in, tap “Who won?” on the bet.`)) return;

    await withBusyWager(id, async () => {
        try {
            const ok = await updateWager(id, { status: 'active' }, ['open']);
            if (!ok) return betChangedUnderYou();
            await refreshBoard();
            showToast('Betting closed. Tap “Who won?” once the result is in.', 'success');
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
                        ? `${firstName(wager.target_id)} already accepted, so it’s on. To call it off, tap “Who won?” on the bet, then Void bet.`
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
    if (!confirm(`${overrideLine(wager, true)}Reopen “${wager.description}”? It goes back to having no result and drops out of the ledger until someone records who won again.`)) return;

    await withBusyWager(id, async () => {
        try {
            const ok = await updateWager(id, { status: 'active', winner_id: null, winner_ids: [] }, [wager.status]);
            if (!ok) return betChangedUnderYou();
            await logBetNote(id, 'Reopened the bet (admin). It needs settling again.');
            await refreshBoard();
            showToast('Bet reopened. Tap “Who won?” on it to record the result again.', 'success');
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
    modalTitle.textContent = 'Who won?';
    document.getElementById('settle-wager-summary').textContent = `“${wager.description}”. The ledger updates as soon as you save, and a note in the trash talk shows who recorded it.`;
    document.getElementById('settle-wager-id').value = id;
    setSettleBusy(false);

    // Live scores can only settle a head-to-head about the 18-hole gross score; the note under
    // the button says so before anyone taps it (the confirm says it again)
    const autoBtn = document.getElementById('settle-auto-btn');
    if (autoBtn) {
        autoBtn.style.display = wager.type === 'h2h' ? 'block' : 'none';
        autoBtn.onclick = () => handleAutoSettle(wager);
    }
    const autoNote = document.getElementById('settle-auto-note');
    if (autoNote) autoNote.hidden = wager.type !== 'h2h';

    const container = document.getElementById('settle-wager-winners-container');
    const parts = wager.participants || [];
    const name = pid => escHtml(getPlayerName(pid));

    if (wager.type === 'pool') {
        const pot = wager.amount * parts.length;
        container.innerHTML = `<p style="color: var(--text-muted); font-size: 0.8rem; margin-bottom: 10px;">Select every winner. The ${fmtMoney(pot)} pot splits evenly.</p>` +
            parts.map(pid => settleOptionHTML('checkbox', pid, isMe(pid) ? 'You' : name(pid))).join('');
    } else if (wager.type === 'prop') {
        const takers = parts.filter(pid => pid !== wager.creator_id);
        const each = `${takers.length} taker${takers.length === 1 ? '' : 's'} ${fmtMoney(wager.amount)} each`;
        container.innerHTML = `<p style="color: var(--text-muted); font-size: 0.8rem; margin-bottom: 10px;">Did it happen?</p>` +
            (isMe(wager.creator_id)
                ? settleOptionHTML('radio', wager.creator_id, 'You win (it happened)', `Each taker pays you ${fmtMoney(wager.amount)}`) +
                    settleOptionHTML('radio', 'takers', 'The takers win (it didn’t)', `You pay ${each}`)
                : settleOptionHTML('radio', wager.creator_id, `${name(wager.creator_id)} wins (it happened)`, `Each taker pays ${name(wager.creator_id)} ${fmtMoney(wager.amount)}`) +
                    settleOptionHTML('radio', 'takers', 'The takers win (it didn’t)', `${name(wager.creator_id)} pays ${each}`));
    } else {
        const { creatorWins, targetWins } = h2hPayouts(wager.amount, wager.odds);
        const mine = myH2hStakes(wager);
        if (mine) {
            // You're one of the two: "You win" / "Kelly wins", in the order of the card
            const them = escHtml(firstName(mine.other));
            const option = pid => (isMe(pid)
                ? settleOptionHTML('radio', pid, 'You win', `${them} pays you ${fmtMoney(mine.win)}`)
                : settleOptionHTML('radio', pid, `${them} wins`, `You pay ${them} ${fmtMoney(mine.lose)}`));
            container.innerHTML = option(wager.creator_id) + option(wager.target_id);
        } else {
            container.innerHTML =
                settleOptionHTML('radio', wager.creator_id, `${name(wager.creator_id)} wins`, `Collects ${fmtMoney(creatorWins)}`) +
                settleOptionHTML('radio', wager.target_id, `${name(wager.target_id)} wins`, `Collects ${fmtMoney(targetWins)}`);
        }
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

// The same result from the viewer's side, for the confirm before it saves ("You win. Westin owes
// you $15."). describeResult keeps the names: it's also the note everyone reads in the trash talk.
// Plain text (a native dialog), so names aren't escaped.
function resultConfirmText(wager, winnerIds) {
    const parts = wager.participants || [];
    const Name = id => (isMe(id) ? 'You' : getPlayerName(id));
    const name = id => (isMe(id) ? 'you' : getPlayerName(id));
    const s = id => (isMe(id) ? '' : 's'); // "You win" / "Kelly wins", "You owe" / "Kelly owes"
    if (wager.type === 'h2h') {
        const { creatorWins, targetWins } = h2hPayouts(wager.amount, wager.odds);
        const winner = winnerIds[0];
        const targetWon = winner === wager.target_id;
        const loser = targetWon ? wager.creator_id : wager.target_id;
        const toWhom = isMe(winner) || isMe(loser) ? ` ${name(winner)}` : '';
        return `${Name(winner)} win${s(winner)}. ${Name(loser)} owe${s(loser)}${toWhom} ${fmtMoney(targetWon ? targetWins : creatorWins)}.`;
    }
    const c = wager.creator_id;
    if (wager.type === 'prop') {
        return winnerIds.includes(c)
            ? `${Name(c)} win${s(c)} the prop. Each taker owes${isMe(c) ? ' you' : ''} ${fmtMoney(wager.amount)}.`
            : `The takers win. ${Name(c)} owe${s(c)} each taker ${fmtMoney(wager.amount)}.`;
    }
    const winners = parts.filter(id => winnerIds.includes(id));
    const split = potSplitText(wager.amount, parts.length, winners, name);
    if (winners.length === 1) {
        return `${Name(winners[0])} win${s(winners[0])}. ${isMe(winners[0]) ? split.replace(/^Takes/, 'You take') : split}`;
    }
    return `${capFirst(winners.map(name).join(' & '))} win. ${capFirst(split)}`;
}

// Is the Settle sheet for this bet the one that's open?
const settleSheetFor = id => modal.classList.contains('active') && settleWagerForm.style.display === 'block' &&
    document.getElementById('settle-wager-id').value === id;

// One settle at a time: its buttons lock while it saves, so a second tap can't send it twice
function setSettleBusy(on) {
    settling = on;
    settleWagerForm.querySelectorAll('button').forEach(b => { b.disabled = on; });
    const submit = document.getElementById('settle-submit-btn');
    if (submit) submit.textContent = on ? 'Saving…' : 'Save result';
}

async function handleSettleSubmit(e) {
    e.preventDefault();
    if (settling) return;
    if (!currentUser) return showToast('You were logged out. Log in again to record results.', 'error');
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

    // A result moves money, so say exactly what will happen first
    if (!confirm(`${overrideLine(wager, true)}${resultConfirmText(wager, winnerIds)}\n\nSave this result for “${wager.description}”? The ledger updates right away.`)) return;

    setSettleBusy(true);
    try {
        await withBusyWager(wagerId, async () => {
            const ok = await updateWager(wagerId, { status: 'settled', winner_id: winnerIds[0], winner_ids: winnerIds }, ['active']);
            if (!ok) return betChangedUnderYou('Someone already recorded a result or changed that bet. Here’s the latest.');
            if (settleSheetFor(wagerId)) closeModal();
            await logBetNote(wagerId, describeResult(wager, winnerIds));
            await refreshBoard();
            focusCard(wagerId);
            showToast('Result saved. The ledger is updated.', 'success');
        });
    } catch (err) {
        actionError('Couldn’t save the result', err);
    } finally {
        setSettleBusy(false);
    }
}

async function handleAlternativeSettle(statusType) {
    if (settling) return;
    if (!currentUser) return showToast('You were logged out. Log in again to record results.', 'error');
    const wagerId = document.getElementById('settle-wager-id').value;
    const wager = findWager(wagerId);
    const what = wager ? `“${wager.description}”` : 'this bet';
    if (!confirm((wager ? overrideLine(wager, true) : '') + (statusType === 'push'
        ? `Call ${what} a push (tie)? No money changes hands.`
        : `Void ${what}? It's called off and no money changes hands.`))) return;

    setSettleBusy(true);
    try {
        await withBusyWager(wagerId, async () => {
            const ok = await updateWager(wagerId, { status: statusType }, ['active']);
            if (!ok) return betChangedUnderYou('Someone already recorded a result or changed that bet. Here’s the latest.');
            if (settleSheetFor(wagerId)) closeModal();
            await logBetNote(wagerId, statusType === 'push' ? 'Declared a push. No money changes hands.' : 'Voided the bet. No money changes hands.');
            await refreshBoard();
            focusCard(wagerId);
            showToast(statusType === 'push' ? 'Pushed. No money changes hands.' : 'Bet voided.', 'success');
        });
    } catch (err) {
        actionError('Couldn’t update the bet', err);
    } finally {
        setSettleBusy(false);
    }
}

// Record a head-to-head from Live scores: the latest round both players finished
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
            showToast('Using Live scores needs a round you’ve both finished (all 18 holes in). Pick the winner by hand instead.', 'error');
            return;
        }

        const { round, cards: pair } = byRound[shared[0]];
        // A later round one of them is still playing may be the one the bet is about
        const newer = (cards || []).filter(c => !complete.includes(c))
            .map(c => roundById.get(c.round_id))
            .find(r => r && r.id !== round.id && (r.date || '') >= (round.date || ''));
        if (newer) {
            showToast(`Round ${newer.round_number || ''} isn’t finished yet, so Live scores can’t tell which round this bet is about. Pick the winner by hand, or wait until all 18 are in.`, 'error');
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
        if (!confirm(`${overrideLine(wager, true)}${summary}\n\n${isPush ? 'All square. Declare a push?' : `Record ${getPlayerName(winnerId)} as the winner?`}\n\nOnly OK this if the bet was about this round's score.`)) return;

        const values = isPush ? { status: 'push' } : { status: 'settled', winner_id: winnerId, winner_ids: [winnerId] };
        await withBusyWager(wager.id, async () => {
            const ok = await updateWager(wager.id, values, ['active']);
            if (!ok) return betChangedUnderYou('Someone already recorded a result or changed that bet. Here’s the latest.');
            if (settleSheetFor(wager.id)) closeModal();
            await logBetNote(wager.id, isPush ? `Auto-settled from Round ${round.round_number}: all square, push.` : `Auto-settled from Round ${round.round_number}: ${describeResult(wager, [winnerId]).replace(/^Settled: /, '')}`);
            await refreshBoard();
            showToast(isPush ? 'All square. Bet pushed.' : `Result saved. ${isMe(winnerId) ? 'You win' : `${getPlayerName(winnerId)} wins`}.`, 'success');
        });
    } catch (e) {
        actionError('Couldn’t use Live scores', e);
    } finally {
        setSettleBusy(false);
        if (autoBtn) autoBtn.innerHTML = autoLabel;
    }
}

// ==========================================
// Ledger (this trip's settled bets; the last trip's while Past Trips is on)
// ==========================================
// One settled bet's money: what each player in it won (+) or lost (−), to the cent. The nets add
// these up and each player's breakdown lists them, so a breakdown always adds up to its net.
function betMoney(wager) {
    const money = [];
    if (wager.status !== 'settled' || !wager.winner_id) return money;
    const add = (id, amt) => { money.push({ id, amount: roundCents(amt) }); };
    const parts = wager.participants || [];
    const winnerIds = wager.winner_ids && wager.winner_ids.length ? wager.winner_ids : [wager.winner_id];
    const amount = wager.amount;

    if (wager.type === 'h2h') {
        if (!wager.target_id) return money;
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
        if (!winners.length) return money;
        const shares = potShares(amount, parts.length, winners.length);
        parts.forEach(pid => add(pid, -amount));
        winners.forEach((pid, i) => add(pid, shares[i]));
    }
    return money;
}

function computeBalances(wagers) {
    const balances = {};
    wagers.forEach(wager => betMoney(wager).forEach(({ id, amount }) => {
        balances[id] = roundCents((balances[id] || 0) + amount);
    }));
    return balances;
}

const byMade = (a, b) => new Date(a.created_at) - new Date(b.created_at);

// Each player's settled bets, oldest first, with what each one did to their net (and, for a
// pool winner, the share they took out of the pot that the net comes from)
function betsByPlayer(wagers) {
    const byPlayer = {};
    wagers.slice().sort(byMade).forEach(wager => {
        const cents = new Map(), won = new Map();
        betMoney(wager).forEach(({ id, amount }) => {
            const c = Math.round(amount * 100);
            cents.set(id, (cents.get(id) || 0) + c);
            if (c > 0) won.set(id, (won.get(id) || 0) + c);
        });
        cents.forEach((c, id) => (byPlayer[id] = byPlayer[id] || []).push({ wager, amount: c / 100, won: (won.get(id) || 0) / 100 }));
    });
    return byPlayer;
}

// The same bets paid one at a time instead of netted: in each bet, its losers pay its winners
function betByBetPayments(wagers) {
    const payments = [];
    wagers.slice().sort(byMade).forEach(wager => {
        const balances = computeBalances([wager]);
        settleUpPayments(balances).forEach(p => payments.push(Object.assign(p, { wager })));
    });
    return payments;
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

// The trip a bet was for: one made on or after the season's start date (June 1) counts toward
// the next spring's trip
function seasonYear(wager) {
    const made = new Date(wager.created_at);
    if (isNaN(made)) return null;
    const y = made.getUTCFullYear();
    if (!SEASON_START || isNaN(SEASON_START)) return y;
    return made.getTime() >= Date.UTC(y, SEASON_START.getUTCMonth(), SEASON_START.getUTCDate()) ? y + 1 : y;
}

// The bets the ledger adds up: this trip's, or with Past Trips on, the last trip before it
function ledgerView() {
    if (currentFilter !== 'past') return { past: false, year: TRIP_YEAR, wagers: allWagers.filter(isCurrentSeason) };
    const year = pastLedgerYear();
    return { past: true, year, wagers: allWagers.filter(w => !isCurrentSeason(w) && seasonYear(w) === year) };
}

// The trip Past Trips shows: the latest one before this one that had bets
function pastLedgerYear() {
    const years = allWagers.filter(w => !isCurrentSeason(w)).map(seasonYear).filter(Boolean);
    return years.length ? Math.max(...years) : TRIP_YEAR - 1;
}

// "Zac" in a text to the group, or "David O." when someone else on the roster is a David too
function shortName(id) {
    const full = getPlayerName(id).trim();
    const words = full.split(/\s+/);
    const firstOf = name => normName(String(name || '').trim().split(/\s+/)[0]);
    const twins = dbPlayers.filter(p => p.id !== id && firstOf(p.name) === normName(words[0]));
    if (!twins.length || words.length < 2) return words[0];
    const initialOf = name => { const w = String(name || '').trim().split(/\s+/); return normName(w[w.length - 1]).charAt(0); };
    const initial = normName(words[words.length - 1]).charAt(0);
    return twins.some(p => initialOf(p.name) === initial) ? full : `${words[0]} ${initial.toUpperCase()}.`;
}

// Who the player was up against in a bet: "vs Zac" / "vs you", "Kelly’s pool" / "your prop"
function otherSideText(wager, playerId) {
    if (wager.type === 'h2h') {
        const other = playerId === wager.creator_id ? wager.target_id : wager.creator_id;
        return `vs ${isMe(other) ? 'you' : escHtml(shortName(other))}`;
    }
    return `${isMe(wager.creator_id) ? 'your' : `${escHtml(shortName(wager.creator_id))}’s`} ${wager.type === 'prop' ? 'prop' : 'pool'}`;
}

// The arithmetic behind a breakdown line, where the bet's card shows a different number:
// a pool winner's share of the pot ("won $13.33, put in $10"), a prop maker's per-taker amount
function betMathText(x, playerId) {
    const w = x.wager;
    if (w.type === 'prop' && playerId === w.creator_id) {
        const takers = (w.participants || []).filter(id => id !== w.creator_id).length;
        if (takers > 1) return `${fmtMoney(w.amount)} ${x.amount > 0 ? 'from' : 'to'} each of ${takers} takers`;
    } else if (w.type !== 'h2h' && w.type !== 'prop' && x.won > 0) {
        return `won ${fmtMoney(x.won)}, put in ${fmtMoney(roundCents(x.won - x.amount))}`;
    }
    return '';
}

const netColor = (n, soft) => (n > 0 ? 'var(--accent-emerald)' : (n < 0 ? (soft ? '#fca5a5' : '#ef4444') : 'var(--text-muted)'));
const fmtNet = n => (roundCents(n) === 0 ? 'Even' : fmtMoney(n, true));

// Ledger rows the viewer opened, and the bet-by-bet list: kept as they were across refreshes.
// The bet-by-bet list starts closed for this trip (the netted list is the one to use) and open
// for a past trip, where some bets were likely paid already and netting would send money astray.
const ledgerOpenRows = new Set();
const betByBetOpen = { now: false, past: true };
let settleUpText = ''; // the netted payments, written for the group text

// A ledger row: the player and their net, opening to one line per settled bet, then the net.
// Payments marked paid come after it, with what's left to settle, so the lines still add up.
function ledgerRowHTML(b, bets, mine, index, marks, left) {
    const name = `${escHtml(b.name)}${mine ? ' (You)' : ''}`;
    const net = `<span class="ledger-net" style="color: ${netColor(b.balance)};">${fmtNet(b.balance)}</span>`;
    if (!bets.length) {
        // An unseen chevron keeps this amount in line with the rows that open
        return `<div class="ledger-row${mine ? ' mine' : ''}"><div class="ledger-row-head"><span class="ledger-name">${name}</span>${net}<i class="fas fa-chevron-down ledger-chev" aria-hidden="true" style="visibility: hidden;"></i></div></div>`;
    }
    const open = ledgerOpenRows.has(b.id);
    const panelId = `ledger-bets-${index}`;
    const lines = bets.map(x => {
        const math = betMathText(x, b.id);
        return `
                    <li class="ledger-bet">
                        <span class="ledger-bet-what">${escHtml(x.wager.description)}<span class="ledger-bet-side">${otherSideText(x.wager, b.id)}${math ? ` · ${math}` : ''}</span></span>
                        <span class="ledger-bet-amt" style="color: ${netColor(x.amount, true)};">${fmtMoney(x.amount, true)}</span>
                    </li>`;
    }).join('');
    // "Paid Jeff" / "From Westin", oldest first
    const paid = marks && marks.length ? `
                <ul class="ledger-paid" aria-label="${mine ? 'Your payments' : `${escHtml(b.name)}’s payments`}">${marks.map(m => {
                    const other = m.from === b.id ? m.to : m.from;
                    const otherName = isMe(other) ? 'you' : escHtml(shortName(other));
                    const when = shortDate(m.at);
                    return `
                    <li class="ledger-bet ledger-paid-line">
                        <span class="ledger-bet-what">${m.from === b.id ? 'Paid' : 'From'} ${otherName}<span class="ledger-bet-side">Marked paid${when ? ` ${when}` : ''}</span></span>
                        <span class="ledger-bet-amt">${fmtMoney(m.cents / 100)}</span>
                    </li>`;
                }).join('')}
                </ul>
                <div class="ledger-bets-net ledger-left"><span>Left to settle</span><span style="color: ${netColor(left, true)};">${fmtNet(left)}</span></div>` : '';
    return `
        <div class="ledger-row${mine ? ' mine' : ''}">
            <button type="button" class="ledger-row-head" aria-expanded="${open}" aria-controls="${panelId}" data-ledger-row="${escHtml(b.id)}" data-focus-key="row:${escHtml(b.id)}">
                <span class="ledger-name">${name}</span>${net}<i class="fas fa-chevron-down ledger-chev" aria-hidden="true"></i>
            </button>
            <div class="ledger-bets" id="${panelId}"${open ? '' : ' hidden'}>
                <ul aria-label="${mine ? 'Your bets' : `${escHtml(b.name)}’s bets`}">${lines}
                </ul>
                <div class="ledger-bets-net"><span>${mine ? 'Your net' : 'Net'}</span><span style="color: ${netColor(b.balance, true)};">${fmtNet(b.balance)}</span></div>${paid}
            </div>
        </div>`;
}

// Settle up, paid bet by bet instead of netted: each bet's payments under its terms, yours first.
// Payments marked paid take their lines off (greyed "Paid", or what's left on one). The Venmo tip
// shows here only if the netted list above didn't already show it.
function betByBetHTML(payments, me, view, marks, links, tipShown) {
    const { left, unmatched } = coverBetByBet(payments, marks);
    const mine = p => p.from === me || p.to === me;
    const groups = [];
    payments.forEach((p, i) => {
        let g = groups[groups.length - 1];
        if (!g || g.wager !== p.wager) groups.push(g = { wager: p.wager, payments: [] });
        g.payments.push(Object.assign({ left: left[i] }, p));
    });
    const ordered = groups.filter(g => g.payments.some(mine)).concat(groups.filter(g => !g.payments.some(mine)));
    const firstLink = links.length;
    const html = ordered.map(g => {
        const w = g.wager;
        const kind = w.type === 'h2h' ? 'Head-to-head' : otherSideText(w, null).replace(/^./, c => c.toUpperCase());
        return `
                    <div class="bet-by-bet-bet">
                        <div class="bet-by-bet-terms">${escHtml(w.description)}<span class="ledger-bet-side">${kind}</span></div>
                        ${g.payments.map(p => payLineHTML(p, view, links, { left: p.left, key: `bet:${w.id}:`, wager: w.id, noVenmo: unmatched > 0 })).join('')}
                    </div>`;
    }).join('');
    // Marks made from the netted list can pay people who never bet each other. Then these lines
    // aren't what's owed any more: no Venmo links on them, only Paid for a bet paid on its own.
    const offList = unmatched > 0
        ? '<p class="bet-by-bet-note">Some payments were marked paid from the netted list, so these lines don’t show what’s still owed. Pay by the netted list above. Mark paid and Got it here are only for a bet that was paid on its own.</p>'
        : '';
    return offList + (!tipShown && links.slice(firstLink).some(l => l.txn === 'pay') ? VENMO_TIP : '') + html;
}

// The netted payments for the group text: one line when it's short, one payment a line when it
// isn't, then why someone might pay a person they didn't bet with, and where their bets are.
// Payments already marked paid are left out (and counted).
function settleUpMessage(view, payments, paidCount) {
    if (!payments.length) return '';
    const lines = payments.map(p => `${shortName(p.from)} → ${shortName(p.to)} ${fmtMoney(p.amount)}`);
    const head = `BBB ${view.year} settle up${paidCount ? ` (${paidCount} already paid)` : ''}:`;
    const list = lines.length > 4 ? `${head}\n${lines.join('\n')}` : `${head} ${lines.join(' · ')}`;
    const link = location.origin + location.pathname;
    let why = view.past
        ? `Netted across every ${view.year} bet, so it’s only right if nobody has paid any of them yet. If some are paid, use the bet-by-bet list under Past Trips on the Bookie: ${link}`
        : `Payments are netted across every bet so there are fewer Venmos. You might pay someone you didn’t bet with, but every total is right. Tap your name in the Bookie’s Ledger to see your bets: ${link}`;
    if (view.past && paidCount) {
        why = `Netted across every ${view.year} bet, less the payments marked paid on the Bookie, so it’s only right if every payment made so far is marked there. If not, use the bet-by-bet list under Past Trips on the Bookie: ${link}`;
    }
    return `${list}\n\n${why}`;
}

// "Your net: +$15" under "Logged in as" (the same view as the ledger: last trip's on Past Trips).
// With payments of yours marked paid it adds what's left: "· $5 to collect", "· squared up".
function renderMyNet(view, balance, left) {
    const btn = document.getElementById('my-net-btn');
    if (!btn) return;
    btn.hidden = balance === null;
    if (balance === null) return;
    document.getElementById('my-net-label').textContent = view.past ? `Your ${view.year} net` : 'Your net';
    const amount = document.getElementById('my-net-amount');
    amount.textContent = fmtNet(balance);
    amount.style.color = netColor(balance);
    const leftEl = document.getElementById('my-net-left');
    if (leftEl) {
        const cents = left === null || left === undefined ? null : Math.round(left * 100);
        leftEl.textContent = cents === null ? ''
            : ` · ${cents === 0 ? 'squared up' : (cents > 0 ? `${fmtMoney(cents / 100)} to collect` : `${fmtMoney(-cents / 100)} to pay`)}`;
        leftEl.hidden = cents === null;
    }
}

function renderLedger() {
    if (!currentUser) return;
    const view = ledgerView();
    const me = currentUser.id;
    const pill = document.getElementById('ledger-pill');
    if (pill) pill.textContent = view.past ? `${view.year} · Final` : 'This trip · Net';

    // Keep keyboard focus on the same control across a refresh
    const active = document.activeElement;
    const focusKey = active && ledgerContainer.contains(active) ? active.dataset.focusKey : null;
    const scoreboardEl = document.getElementById('big-winner-board');

    if (loadError && !allWagers.length) {
        // Nothing loaded: say so, rather than "no settled bets" and an even net
        settleUpText = '';
        renderMyNet(view, null);
        if (scoreboardEl) scoreboardEl.style.display = 'none';
        ledgerContainer.innerHTML = `<div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 15px; text-align: center;">Couldn’t load the ledger. Check your signal and tap Refresh.</div>`;
        queueFabSync();
        syncLedgerFade();
        return;
    }

    const balances = computeBalances(view.wagers);
    const bets = betsByPlayer(view.wagers);
    dbPlayers.forEach(p => { if (!(p.id in balances)) balances[p.id] = 0; });
    // The nets and Big Winner are what the bets did; what's still owed is that less the payments
    // marked paid for this trip
    const marks = payState() === 'ready' ? (payData.marks[view.year] || []) : [];
    const owed = owedAfter(balances, marks);
    const marksOf = id => marks.filter(m => m.from === id || m.to === id);
    // This trip, you're always on the ledger ("Even" until you bet). A past trip only lists you
    // if you were in its bets, so a newcomer isn't told he finished last year even.
    const listMe = !view.past || !!(bets[me] || []).length;
    renderMyNet(view, listMe ? (balances[me] || 0) : null, marksOf(me).length ? (owed[me] || 0) : null);

    const sorted = Object.keys(balances)
        .map(id => ({ id, name: getPlayerName(id), balance: balances[id] }))
        .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));

    let ledgerHtml = '';
    let rowCount = 0;
    sorted.forEach((b, i) => {
        const mine = b.id === me;
        const theirs = bets[b.id] || [];
        if (b.balance === 0 && !theirs.length && !(mine && listMe)) return;
        ledgerHtml += ledgerRowHTML(b, theirs, mine, i, marksOf(b.id), owed[b.id] || 0);
        if (theirs.length) rowCount++;
    });
    if (rowCount) {
        ledgerHtml = `<p class="ledger-hint">Tap a name to see the bets behind it.</p>` + ledgerHtml;
    }

    const top = sorted.length ? sorted[0].balance : 0;
    const bottom = sorted.length ? sorted[sorted.length - 1].balance : 0;
    const namesAt = v => sorted.filter(b => b.balance === v).map(b => escHtml(b.name)).join(', ');

    if (scoreboardEl) {
        if (top > 0 || bottom < 0) {
            scoreboardEl.style.display = 'flex';
            scoreboardEl.style.justifyContent = 'space-between';
            scoreboardEl.innerHTML = `
                <div style="text-align: center; flex: 1; border-right: 1px solid rgba(255,255,255,0.1);">
                    <div style="font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px;"><i class="fas fa-trophy" style="color: var(--accent-gold);" aria-hidden="true"></i> Big Winner</div>
                    <div style="font-size: 1.2rem; font-weight: bold; color: var(--accent-emerald); margin-top: 5px; white-space: nowrap;">${top > 0 ? fmtMoney(top, true) : '$0'}</div>
                    <div style="font-size: 0.9rem; margin-top: 2px;">${top > 0 ? namesAt(top) : '-'}</div>
                </div>
                <div style="text-align: center; flex: 1;">
                    <div style="font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px;"><i class="fas fa-skull" style="color: #ef4444;" aria-hidden="true"></i> Big Loser</div>
                    <div style="font-size: 1.2rem; font-weight: bold; color: #ef4444; margin-top: 5px; white-space: nowrap;">${bottom < 0 ? fmtMoney(bottom, true) : '$0'}</div>
                    <div style="font-size: 0.9rem; margin-top: 2px;">${bottom < 0 ? namesAt(bottom) : '-'}</div>
                </div>
            `;
        } else {
            scoreboardEl.style.display = 'none';
        }
    }

    if (!ledgerHtml) {
        ledgerHtml = `<div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 15px; text-align: center;">${view.past ? `No settled bets from the ${view.year} trip` : 'No settled bets yet'}</div>`;
    }

    // Settle up: the fewest payments that square everyone after what's been paid, yours first.
    // The group-text version keeps the plain order (biggest first), since it's for everyone.
    // On the first load it waits (a few seconds at most) for the Paid marks.
    const marksPending = payState() === 'idle' && payData.firstWait;
    const payments = settleUpPayments(owed);
    settleUpText = marksPending ? '' : settleUpMessage(view, payments, marks.length);
    const links = []; // Venmo links in this render: their addresses go on once the HTML is in
    if (!marksPending && (payments.length || marks.length)) ledgerHtml += settleUpHTML(view, payments, marks, links);

    ledgerContainer.innerHTML = ledgerHtml;
    fillVenmoLinks(ledgerContainer, links);
    const refocus = focusKey && [...ledgerContainer.querySelectorAll('[data-focus-key]')].find(el => el.dataset.focusKey === focusKey);
    if (refocus) refocus.focus({ preventScroll: true });
    // The bets above may have grown or shrunk: the + button and the panel's fade follow
    queueFabSync();
    syncLedgerFade();
}

// The Settle up section: the netted payments (Venmo and Paid buttons on yours), then the payments
// marked paid, then Copy for the group text and the bet-by-bet list
function settleUpHTML(view, payments, marks, links) {
    const me = currentUser.id;
    const state = payState();
    const mine = p => p.from === me || p.to === me;
    payments.sort((a, b) => mine(b) - mine(a));
    const lastYear = view.year === TRIP_YEAR - 1 ? 'Last year’s' : `The ${view.year}`;
    const pastLine = view.past ? `<p class="settle-up-past">${lastYear} settle up, for anyone still holding out.</p>` : '';
    const paidList = paidListHTML(marks);
    if (!payments.length) {
        return `
            <div class="settle-up">
                ${pastLine}
                <h4 id="settle-up-title" tabindex="-1" data-focus-key="settle-up">Settle up</h4>
                <p class="settle-up-done"><i class="fas fa-check-circle" aria-hidden="true"></i> Everyone’s squared up.</p>
                ${paidList}
            </div>`;
    }
    const bbbKey = view.past ? 'past' : 'now';
    const bbbOpen = betByBetOpen[bbbKey];
    // Netting a past trip only works if the payments made so far are all accounted for
    const caveat = !view.past ? ''
        : state === 'ready'
            ? `<p class="settle-up-caveat">That’s only right if every ${view.year} payment made so far is marked paid here. Paid one that isn’t marked? Mark it, or use the bet-by-bet payments below.</p>`
            : `<p class="settle-up-caveat">That’s only right if nobody has paid any ${view.year} bets yet. If some are paid, use the bet-by-bet payments below and skip the ones already paid.</p>`;
    const status = {
        setup: 'Venmo and Paid tracking are being set up.',
        error: 'Couldn’t load who’s already paid. Check your signal and tap Refresh.',
        idle: 'Checking who’s already paid…'
    }[state];
    const statusLine = status ? `<p class="settle-up-status">${status}</p>` : '';
    // No Venmo of your own yet: the golf profile is where it goes
    const nudge = state === 'ready' && !payData.handles.has(me)
        ? '<a class="settle-up-nudge" href="index.html#profile"><i class="fas fa-user-plus" aria-hidden="true"></i><span>Add your Venmo in your golf profile so people can pay you.</span></a>'
        : '';
    const firstLink = links.length;
    const rows = payments.map(p => payLineHTML(p, view, links, { key: 'net:' })).join('');
    const tip = links.slice(firstLink).some(l => l.txn === 'pay') ? VENMO_TIP : '';
    const betByBet = betByBetHTML(betByBetPayments(view.wagers), me, view, marks, links, !!tip);
    return `
            <div class="settle-up">
                ${pastLine}
                <h4 id="settle-up-title" tabindex="-1" data-focus-key="settle-up">Settle up</h4>
                <p>Payments are netted across every bet so there are fewer Venmos. You might pay someone you didn’t bet with, but every total is right.</p>
                ${caveat}${statusLine}${nudge}
                ${rows}${tip}${paidList}
                <div class="settle-up-actions">
                    <button type="button" class="settle-up-btn" id="copy-settle-up-btn" data-focus-key="copy"><i class="fas fa-copy" aria-hidden="true"></i>Copy for the group text</button>
                    <button type="button" class="settle-up-btn settle-up-toggle" id="bet-by-bet-btn" aria-expanded="${bbbOpen}" aria-controls="bet-by-bet-list" data-focus-key="bet-by-bet" data-view="${bbbKey}">${bbbOpen ? 'Hide' : 'Show'} bet-by-bet payments</button>
                </div>
                <div class="bet-by-bet" id="bet-by-bet-list"${bbbOpen ? '' : ' hidden'}>
                    <p>Or skip the netting and pay one bet at a time, instead of the list above:</p>
                    ${betByBet}
                </div>
            </div>`;
}

// One Settle up payment ("You → Jeff Tarlton  $20") and under it, for the two players on it (or
// an admin), Venmo and the Paid button. opts.left: the cents still owed on it, for a bet-by-bet
// line that marks have paid in part (greyed "Paid" once it's all paid). opts.key keeps the focus
// keys of the netted list and the bet-by-bet list apart.
function payLineHTML(p, view, links, opts) {
    const me = currentUser.id;
    const cents = Math.round(p.amount * 100);
    const left = opts.left === undefined ? cents : opts.left;
    const mine = p.from === me || p.to === me;
    let amount = fmtMoney(p.amount);
    if (left <= 0) amount = `<span class="pay-paid-tag"><i class="fas fa-check" aria-hidden="true"></i> Paid</span> <s>${amount}</s>`;
    else if (left < cents) amount = `${fmtMoney(left / 100)} left <span class="pay-of">of ${amount}</span>`;
    const row = `
                        <div class="settle-up-row${mine ? ' mine' : ''}${left <= 0 ? ' paid' : ''}">
                            <span>${p.from === me ? 'You' : escHtml(getPlayerName(p.from))} → ${p.to === me ? 'you' : escHtml(getPlayerName(p.to))}</span>
                            <span style="white-space: nowrap;">${amount}</span>
                        </div>`;
    const actions = left > 0
        ? payActionsHTML({ from: p.from, to: p.to, cents: left, wager: opts.wager, noVenmo: !!opts.noVenmo }, view, links, opts.key || '')
        : '';
    return actions ? `<div class="settle-up-line">${row}${actions}</div>` : row;
}

// ==========================================
// Venmo and Paid marks (payments_2027.sql)
// ==========================================
const VENMO_TIP = '<p class="venmo-tip"><i class="fas fa-info-circle" aria-hidden="true"></i> Opens Venmo with the amount filled in. Check it’s the right person before you pay.</p>';

// Settle up shows Venmo and Paid only for the player they were loaded for
function payState() {
    return currentUser && payData.owner === currentUser.id ? payData.state : 'idle';
}

// A Venmo username: 5 to 30 letters, numbers, hyphens or underscores, without the @ (Venmo ignores
// case). Anything else gets no link.
function venmoHandle(raw) {
    const h = String(raw || '').trim().replace(/^@/, '').toLowerCase();
    return /^[a-z0-9_-]{5,30}$/.test(h) ? h : null;
}

// Venmo with the amount filled in: txn 'pay' to the player being paid, or 'charge' (a request) to
// the one paying. The note goes first and stays neutral; it's private on Venmo.
function venmoUrl(handle, txn, cents, year) {
    const h = venmoHandle(handle);
    if (!h || !(cents > 0) || !['pay', 'charge'].includes(txn)) return null;
    const url = new URL(`https://venmo.com/${encodeURIComponent(h)}`);
    url.search = new URLSearchParams({ note: `BBB ${year} settle up`, txn, amount: (cents / 100).toFixed(2), audience: 'private' }).toString();
    return url.href;
}

// The link goes into the page without an address; fillVenmoLinks puts it on (never pasted into HTML)
function venmoLinkHTML(links, spec, label, ariaLabel, cls, focusKey) {
    links.push(spec);
    return `<a class="pay-btn ${cls}" data-venmo-link="${links.length - 1}" data-focus-key="${escHtml(focusKey)}" rel="noreferrer" referrerpolicy="no-referrer" aria-label="${escHtml(ariaLabel)}">${label}</a>`;
}

function fillVenmoLinks(root, links) {
    root.querySelectorAll('a[data-venmo-link]').forEach(a => {
        const spec = links[Number(a.dataset.venmoLink)];
        const url = spec && venmoUrl(spec.handle, spec.txn, spec.cents, spec.year);
        if (url) a.href = url;
        else a.remove();
    });
}

// Can this player see Paid marks on the site (a confirmed name with a login)? "I paid him" needs
// that, so he can check it and undo it; otherwise the commissioner marks it.
function onSite(id) {
    const p = dbPlayers.find(x => x.id === id);
    return !!p && !!p.user_id && (!p.status || p.status === 'confirmed');
}

const payKey = (year, p) => `${year}:${p.from}>${p.to}:${p.cents}`;

// Under one payment: "Pay $20 on Venmo ›" for the one paying (when the other has a Venmo), "Request
// on Venmo" for the one being paid, and Paid: "Mark paid" for the one paying (if the other can see
// it on the site), "Got it" for the one being paid, "Mark paid (admin)" for an admin. Nobody else
// gets buttons. p.noVenmo: Paid buttons only (a bet-by-bet line that may not be owed any more).
// p.wager: the bet of a bet-by-bet line, so its mark shows on that line.
function payActionsHTML(p, view, links, keyPrefix) {
    if (payState() !== 'ready') return '';
    const me = currentUser.id;
    const admin = !!currentUser.is_admin;
    const payer = p.from === me;
    const payee = p.to === me;
    if (!payer && !payee && !admin) return '';
    const amount = fmtMoney(p.cents / 100);
    const key = payKey(view.year, p);
    const parts = [];
    let handle = '';
    if (p.noVenmo) {
        // no Venmo links
    } else if (payer && payData.handles.has(p.to)) {
        handle = payData.handles.get(p.to);
        parts.push(venmoLinkHTML(links, { handle, txn: 'pay', cents: p.cents, year: view.year },
            `Pay ${amount} on Venmo<span aria-hidden="true"> ›</span>`, `Pay ${amount} on Venmo to ${getPlayerName(p.to)} (@${handle})`,
            'venmo-pay', `venmo:${keyPrefix}${key}`));
    } else if (payee && payData.handles.has(p.from)) {
        handle = payData.handles.get(p.from);
        parts.push(venmoLinkHTML(links, { handle, txn: 'charge', cents: p.cents, year: view.year },
            'Request on Venmo', `Request on Venmo: ${amount} from ${getPlayerName(p.from)} (@${handle})`,
            'venmo-request', `venmo:${keyPrefix}${key}`));
    }
    const busy = payData.busy.has(`mark:${key}`) ? ' disabled aria-busy="true"' : '';
    const button = (label, aria, cls) => `<button type="button" class="pay-btn pay-mark${cls || ''}" data-pay-mark data-from="${escHtml(p.from)}" data-to="${escHtml(p.to)}" data-cents="${p.cents}" data-year="${view.year}"${p.wager ? ` data-wager="${escHtml(p.wager)}"` : ''} data-focus-key="${escHtml(`mark:${keyPrefix}${key}`)}" aria-label="${escHtml(aria)}"${busy}>${label}</button>`;
    let note = '';
    if (payee) {
        parts.push(button('Got it', `Got it: ${getPlayerName(p.from)} paid you ${amount}`));
    } else if (payer && !admin && !onSite(p.to)) {
        note = `<p class="pay-note">${escHtml(firstName(p.to))} isn’t on the site yet, so once you’ve paid, ask the commissioner to mark it paid.</p>`;
    } else if (payer) {
        parts.push(button('Mark paid', `Mark paid: you paid ${getPlayerName(p.to)} ${amount}`));
    } else {
        parts.push(button('Mark paid (admin)', `Mark paid (admin): ${getPlayerName(p.from)} paid ${getPlayerName(p.to)} ${amount}`, ' admin-override'));
    }
    if (handle) parts.push(`<span class="pay-handle">@${escHtml(handle)}</span>`);
    return (parts.length ? `<div class="pay-actions">${parts.join('')}</div>` : '') + note;
}

// What's still owed: each player's net from the bets, plus what he's paid, less what he's been
// paid (in cents). Settle up nets this again, so a payment that followed the bet-by-bet list (or
// any other) still leaves everyone's total right.
function owedAfter(balances, marks) {
    const cents = {};
    Object.keys(balances).forEach(id => { cents[id] = Math.round(balances[id] * 100); });
    marks.forEach(m => {
        cents[m.from] = (cents[m.from] || 0) + m.cents;
        cents[m.to] = (cents[m.to] || 0) - m.cents;
    });
    const owed = {};
    Object.keys(cents).forEach(id => { owed[id] = cents[id] / 100; });
    return owed;
}

// Which bet-by-bet payments the marks cover. A mark pays off its own payer → payee lines: the line
// it was marked from on this page, else the first one of exactly its amount, then the oldest bets.
// Returns the cents left on each line, and the cents of marks that don't line up with any line
// (they followed the netted list instead).
function coverBetByBet(lines, marks) {
    const full = lines.map(p => Math.round(p.amount * 100));
    const left = full.slice();
    const rest = [];
    const exact = (m, p, j) => p.from === m.from && p.to === m.to && left[j] === full[j] && full[j] === m.cents;
    const byAge = marks.slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
    // Marks made from a bet-by-bet line on this page first, so each lands on the line that was tapped
    const pinned = byAge.filter(m => payData.lineOf.has(m.id));
    pinned.concat(byAge.filter(m => !payData.lineOf.has(m.id))).forEach(m => {
        const bet = payData.lineOf.get(m.id);
        let i = bet ? lines.findIndex((p, j) => p.wager && p.wager.id === bet && exact(m, p, j)) : -1;
        if (i < 0) i = lines.findIndex((p, j) => exact(m, p, j));
        if (i >= 0) left[i] = 0;
        else rest.push({ m, cents: m.cents });
    });
    let unmatched = 0;
    rest.forEach(r => {
        lines.forEach((p, j) => {
            if (!r.cents || !left[j] || p.from !== r.m.from || p.to !== r.m.to) return;
            const take = Math.min(left[j], r.cents);
            left[j] -= take;
            r.cents -= take;
        });
        unmatched += r.cents;
    });
    return { left, unmatched };
}

// "Oct 2"
function shortDate(iso) {
    const d = new Date(iso);
    if (!iso || isNaN(d)) return '';
    try {
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch (e) {
        return '';
    }
}

// The payments marked paid this trip, newest first: "Zac → Kelly $10 · marked by Kelly · Sep 21",
// with Undo for either of the two players or an admin
function paidListHTML(marks) {
    if (!marks.length) return '';
    const me = currentUser.id;
    const admin = !!currentUser.is_admin;
    const name = id => (id === me ? 'you' : escHtml(shortName(id)));
    const rows = marks.slice().sort((a, b) => String(b.at).localeCompare(String(a.at))).map(m => {
        const party = m.from === me || m.to === me;
        const when = shortDate(m.at);
        const meta = `${m.by ? ` · marked by ${name(m.by)}` : ''}${when ? ` · ${when}` : ''}`;
        const plain = `${m.from === me ? 'you' : getPlayerName(m.from)} paid ${m.to === me ? 'you' : getPlayerName(m.to)} ${fmtMoney(m.cents / 100)}`;
        const busy = payData.busy.has(`undo:${m.id}`) ? ' disabled aria-busy="true"' : '';
        const undo = party || admin
            ? `<button type="button" class="pay-undo-btn${party ? '' : ' admin-override'}" data-pay-undo="${escHtml(m.id)}" data-focus-key="${escHtml(`undo:${m.id}`)}" aria-label="${escHtml(`${party ? 'Undo' : 'Undo (admin)'}: ${capFirst(plain)}`)}"${busy}>${party ? 'Undo' : 'Undo (admin)'}</button>`
            : '';
        return `
                    <li class="paid-row${party ? ' mine' : ''}">
                        <span class="paid-what"><i class="fas fa-check" aria-hidden="true"></i> ${capFirst(name(m.from))} → ${name(m.to)} ${fmtMoney(m.cents / 100)}<span class="paid-meta">${meta}</span></span>${undo}
                    </li>`;
    }).join('');
    return `
                <div class="paid-list">
                    <h5 class="paid-head" id="paid-head">Paid</h5>
                    <ul aria-labelledby="paid-head">${rows}
                    </ul>
                </div>`;
}

// One trip's mark, tidied: amounts in cents, anything malformed dropped
function cleanMark(r) {
    const cents = Math.round(Number(r && r.amount) * 100);
    if (!r || typeof r.id !== 'string' || typeof r.from_player !== 'string' || typeof r.to_player !== 'string' || !(cents > 0)) return null;
    return { id: r.id, from: r.from_player, to: r.to_player, cents, by: r.marked_by || null, at: r.created_at || '' };
}

// Venmo usernames and the Paid marks for this trip and the one Past Trips shows. Before
// payments_2027.sql has run the tables aren't there: "being set up", and the later refreshes of
// this visit don't ask again (opts.recheck does). A load that fails on a weak signal keeps the last
// ones that loaded, as the board does. Returns 'ready' (fresh marks), 'setup', 'error', 'off',
// 'stale' (a newer load took over) or 'skipped'.
async function loadPayments(opts) {
    if (!currentUser || !supabaseClient) return 'skipped';
    const owner = currentUser.id;
    if (payState() === 'setup' && !(opts && opts.recheck)) return 'skipped';
    const seq = ++payData.seq;
    // Only confirmed players (and admins) can see them, so nobody else is offered the buttons
    if (currentUser.status && currentUser.status !== 'confirmed' && !currentUser.is_admin) {
        Object.assign(payData, { state: 'off', owner, handles: new Map(), marks: {} });
        return 'off';
    }
    const years = [...new Set([TRIP_YEAR, pastLedgerYear()])];
    try {
        const [venmo, ...byYear] = await Promise.all([
            supabaseClient.from('player_venmo').select('player_id, handle'),
            ...years.map(y => supabaseClient.from('bookie_payments')
                .select('id, trip_year, from_player, to_player, amount, marked_by, created_at')
                .eq('trip_year', y)
                .order('created_at'))
        ]);
        if (seq !== payData.seq) return 'stale'; // a newer load is under way
        const failed = [venmo, ...byYear].map(r => r.error).filter(Boolean);
        if (failed.some(e => isMissingTable(e) || isMissingFunction(e))) {
            Object.assign(payData, { state: 'setup', owner, handles: new Map(), marks: {} });
            return 'setup';
        }
        if (failed.length) throw failed[0];
        const handles = new Map();
        (venmo.data || []).forEach(r => {
            const h = r && venmoHandle(r.handle);
            if (h && typeof r.player_id === 'string') handles.set(r.player_id, h);
        });
        const marks = {};
        years.forEach((y, i) => { marks[y] = (byYear[i].data || []).map(cleanMark).filter(Boolean); });
        Object.assign(payData, { state: 'ready', owner, handles, marks });
        return 'ready';
    } catch (err) {
        if (seq !== payData.seq) return 'stale';
        console.warn('Venmo usernames and Paid marks didn’t load:', err);
        payData.lastError = err;
        if (payData.owner !== owner || payData.state !== 'ready') {
            Object.assign(payData, { state: 'error', owner, handles: new Map(), marks: {} });
        }
        return 'error';
    }
}

// After a Paid mark or undo: just the marks and the Ledger
async function reloadPayments() {
    await loadPayments({ recheck: true });
    renderLedger();
}

// The marks as they are right now, before a mark is saved (the page may be old: the other player
// may have marked it from his phone since). A newer load under way is redone, so this one counts.
async function freshPayments() {
    for (let i = 0; i < 3; i++) {
        payData.lastError = null;
        const result = await loadPayments({ recheck: true });
        if (result !== 'stale') return result;
    }
    return 'stale';
}

// A mark the database just saved (or undid) goes into the page's own copy straight away, so a
// reload that fails on a weak signal can't put the payment back on Settle up
function keepMark(row, year) {
    const m = cleanMark(row);
    if (!m || payState() !== 'ready') return null;
    const list = payData.marks[year] || (payData.marks[year] = []);
    if (!list.some(x => x.id === m.id)) list.push(m);
    return m;
}
function dropMark(id) {
    Object.keys(payData.marks).forEach(y => { payData.marks[y] = payData.marks[y].filter(m => m.id !== id); });
    payData.recent = payData.recent.filter(r => r.id !== id);
}

// A mark or undo that didn't save: say why (the database's messages are written to be shown),
// then show what's actually saved
async function payActionFailed(err) {
    if (isMissingFunction(err) || isMissingTable(err)) {
        payData.state = 'setup';
        renderLedger();
        showToast('Venmo and Paid tracking are being set up. Try again later.', 'info');
        return;
    }
    const msg = (err && err.message) || String(err);
    if (isNetworkError(err)) showToast('No signal. That may not have gone through. Check Settle up once you have a bar or two.', 'error');
    else showToast(['28000', '42501', '22023', 'P0002', '54000'].includes(err && err.code) ? msg : `Couldn’t save that: ${msg}`, 'error');
    await reloadPayments();
}

// Put focus on a control in the Ledger by its focus key (after it re-renders)
function focusLedgerKey(...keys) {
    const all = [...ledgerContainer.querySelectorAll('[data-focus-key]')];
    const el = keys.map(k => all.find(x => x.dataset.focusKey === k)).find(Boolean);
    if (el) el.focus({ preventScroll: true });
}

// Is there a Paid button with this focus key in the Ledger as it is now?
function ledgerHasMark(focusKey) {
    return !!focusKey && [...ledgerContainer.querySelectorAll('[data-pay-mark]')].some(el => el.dataset.focusKey === focusKey);
}

// mark_paid takes the same payer, payee and amount within 2 minutes as the same mark (a double tap,
// or both players tapping at once), so a second bet of the same amount between the same two has to
// wait. Was one marked from this page in the last 2 minutes (and is it still marked)?
function recentSameMark(year, from, to, cents) {
    const now = Date.now();
    payData.recent = payData.recent.filter(r => now - r.at < PAY_DUP_MS);
    return payData.recent.find(r => r.year === year && r.from === from && r.to === to && r.cents === cents
        && (payData.marks[year] || []).some(m => m.id === r.id)) || null;
}
function sameAmountWait(from, to, cents, by) {
    const me = currentUser && currentUser.id;
    const who = id => (id === me ? 'you' : firstName(id));
    const amount = fmtMoney(cents / 100);
    return `${amount} from ${who(from)} to ${who(to)} was just marked paid${by && by !== me ? ` by ${firstName(by)}` : ''}. A second ${amount} between the same two players can only be marked 2 minutes after the first, so mark this one again in a couple of minutes.`;
}

// "Mark paid" / "Got it" / "Mark paid (admin)"
async function markPaid(btn) {
    if (!currentUser || payState() !== 'ready') return;
    const { from, to } = btn.dataset;
    const year = Number(btn.dataset.year);
    const cents = Number(btn.dataset.cents);
    if (!from || !to || !Number.isInteger(cents) || cents <= 0 || !year) return;
    const key = `mark:${payKey(year, { from, to, cents })}`;
    if (payData.busy.has(key)) return;
    const focusKey = btn.dataset.focusKey;
    const wagerId = btn.dataset.wager || null;
    const me = currentUser.id;
    const amount = fmtMoney(cents / 100);
    const fromName = getPlayerName(from);
    const toName = getPlayerName(to);
    const recent = recentSameMark(year, from, to, cents);
    if (recent) {
        showToast(sameAmountWait(from, to, cents, me), 'info');
        return;
    }
    const party = from === me || to === me;
    const question = from === me ? `Mark that you paid ${toName} ${amount}?`
        : (to === me ? `Mark that ${fromName} paid you ${amount}?`
            : `Admin override: this is ${fromName} and ${toName}’s payment.\n\nMark that ${fromName} paid ${toName} ${amount}?`);
    const after = party ? 'It comes off Settle up for both of you, and either of you can undo it.'
        : 'It comes off Settle up for both of them, and either of them can undo it.';
    if (!confirm(`${question}\n\n${after}`)) return;

    const hadFocus = ledgerContainer.contains(document.activeElement);
    payData.busy.add(key);
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    let rendered = false; // the Ledger re-rendered while this button was locked
    try {
        // This page may be old: the other player may have marked this one from his phone since it
        // loaded, and marking it again would tell him to pay it back. So check what's marked now.
        const before = new Set((payData.marks[year] || []).map(m => m.id));
        const check = await freshPayments();
        renderLedger();
        rendered = true;
        if (check !== 'ready') {
            const err = payData.lastError;
            if (check === 'setup') showToast('Venmo and Paid tracking are being set up. Try again later.', 'info');
            else if (check === 'error' && isNetworkError(err)) showToast('No signal, so nothing was marked. Try again once you have a bar or two.', 'error');
            else showToast(`Couldn’t check who’s already paid, so nothing was marked${err && err.message ? `: ${err.message}` : '. Tap Refresh and try again.'}`, 'error');
            if (hadFocus) focusLedgerKey(focusKey, 'settle-up');
            return;
        }
        if (!ledgerHasMark(focusKey)) {
            // It changed: someone marked this one (or another payment that changes it) meanwhile
            const fresh = (payData.marks[year] || []).filter(m => !before.has(m.id));
            const same = fresh.find(m => m.from === from && m.to === to && m.cents === cents);
            showToast(same
                ? `Already marked paid${same.by ? ` by ${same.by === me ? 'you' : firstName(same.by)}` : ''}. Settle up is up to date.`
                : 'Settle up just changed: another payment was marked. Check it, and tap again if this one still needs marking.', 'info');
            if (hadFocus) focusLedgerKey(same ? `undo:${same.id}` : 'settle-up', 'settle-up');
            return;
        }
        const { data, error } = await supabaseClient.rpc('mark_paid', { p_trip_year: year, p_from: from, p_to: to, p_amount: cents / 100 });
        if (error) throw error;
        const saved = keepMark(data, year);
        if (saved && !data.duplicate) {
            payData.recent.push({ id: saved.id, year, from, to, cents, at: Date.now() });
            if (wagerId) payData.lineOf.set(saved.id, wagerId);
        }
        payData.busy.delete(key);
        await reloadPayments();
        // A duplicate that leaves this line open: it was a second bet of the same amount, and the
        // database took it for the first one
        const wait = !!(data && data.duplicate && ledgerHasMark(focusKey));
        if (hadFocus) {
            if (wait) focusLedgerKey(focusKey, 'settle-up');
            else if (data && data.id) focusLedgerKey(`undo:${data.id}`, 'settle-up'); // to its line under Paid
        }
        if (wait) showToast(sameAmountWait(from, to, cents, data.marked_by), 'info');
        else showToast(data && data.duplicate ? 'That one was already marked paid.'
            : `${to === me ? 'Got it' : 'Marked paid'}. It’s off Settle up, under Paid.`, 'success');
    } catch (err) {
        payData.busy.delete(key);
        await payActionFailed(err);
        if (hadFocus) focusLedgerKey(focusKey, 'settle-up');
    } finally {
        const locked = payData.busy.has(key);
        payData.busy.delete(key);
        if (btn.isConnected) { btn.disabled = false; btn.removeAttribute('aria-busy'); }
        // Its copies in the re-rendered Ledger were drawn locked: unlock them
        if (locked && rendered) {
            ledgerContainer.querySelectorAll('[data-pay-mark]').forEach(el => {
                if (`mark:${payKey(Number(el.dataset.year), { from: el.dataset.from, to: el.dataset.to, cents: Number(el.dataset.cents) })}` !== key) return;
                el.disabled = false;
                el.removeAttribute('aria-busy');
            });
        }
    }
}

// Undo a Paid mark (either player on it, or an admin): it goes back on Settle up
async function undoPaid(btn) {
    if (!currentUser || payState() !== 'ready') return;
    const id = btn.dataset.payUndo;
    const mark = Object.values(payData.marks).flat().find(m => m.id === id);
    if (!mark) return;
    const key = `undo:${id}`;
    if (payData.busy.has(key)) return;
    const me = currentUser.id;
    const party = mark.from === me || mark.to === me;
    const what = `${mark.from === me ? 'you' : getPlayerName(mark.from)} paid ${mark.to === me ? 'you' : getPlayerName(mark.to)} ${fmtMoney(mark.cents / 100)}`;
    const override = party ? '' : `Admin override: this is ${getPlayerName(mark.from)} and ${getPlayerName(mark.to)}’s payment.\n\n`;
    if (!confirm(`${override}Undo the Paid mark (${capFirst(what)})? It goes back on Settle up.`)) return;

    const hadFocus = ledgerContainer.contains(document.activeElement);
    payData.busy.add(key);
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    try {
        const { error } = await supabaseClient.rpc('undo_paid', { p_id: id });
        // Already undone (the other player beat you to it): the same outcome
        const gone = error && error.code === 'P0002';
        if (error && !gone) throw error;
        // Off the page's own copy too, so a reload that fails can't put it back under Paid
        dropMark(id);
        payData.lineOf.delete(id);
        payData.busy.delete(key);
        await reloadPayments();
        if (hadFocus) focusLedgerKey('settle-up');
        showToast(gone ? 'That Paid mark was already undone.' : 'Paid mark undone. It’s back on Settle up.', 'success');
    } catch (err) {
        payData.busy.delete(key);
        await payActionFailed(err);
        if (hadFocus) focusLedgerKey(key, 'settle-up');
    } finally {
        payData.busy.delete(key);
        if (btn.isConnected) { btn.disabled = false; btn.removeAttribute('aria-busy'); }
    }
}

function toggleLedgerRow(btn) {
    const open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(open));
    const panel = document.getElementById(btn.getAttribute('aria-controls'));
    if (panel) panel.hidden = !open;
    if (open) ledgerOpenRows.add(btn.dataset.ledgerRow);
    else ledgerOpenRows.delete(btn.dataset.ledgerRow);
    syncLedgerFade();
}

function toggleBetByBet(btn) {
    const open = btn.getAttribute('aria-expanded') !== 'true';
    betByBetOpen[btn.dataset.view === 'past' ? 'past' : 'now'] = open;
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = `${open ? 'Hide' : 'Show'} bet-by-bet payments`;
    const list = document.getElementById('bet-by-bet-list');
    if (list) list.hidden = !open;
    syncLedgerFade();
}

// "Copy for the group text": the share sheet on a phone (Messages is one tap from it),
// the clipboard everywhere else
async function shareSettleUp() {
    const text = settleUpText;
    if (!text) return;
    // Until the Paid marks have loaded, the text could ask for payments already made
    const state = payState();
    if (state === 'idle' || state === 'error') {
        showToast(state === 'idle' ? 'Still checking who’s already paid. Try again in a moment.'
            : 'Couldn’t load who’s already paid, so that could list payments already made. Check your signal and tap Refresh.', 'info');
        return;
    }
    if (navigator.share && isPhone()) {
        try {
            await navigator.share({ text });
            return;
        } catch (err) {
            if (err && err.name === 'AbortError') return; // they closed the share sheet
        }
    }
    if (await copyText(text)) showToast('Copied the settle up. Paste it in the group text.', 'success');
    else window.prompt('Copy this for the group text:', text);
}

// The Ledger tab and "Your net" both land on the ledger (focus follows, for screen readers)
function goToLedger() {
    const panel = document.getElementById('ledger-panel');
    if (!panel) return;
    const still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const behavior = still ? 'auto' : 'smooth';
    panel.scrollIntoView({ behavior });
    // On a wide screen the Ledger scrolls inside its own panel: bring your row into it as well
    const myRow = ledgerContainer.querySelector('.ledger-row.mine');
    if (myRow && panel.scrollHeight - panel.clientHeight > 1) {
        const top = myRow.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop;
        if (top < panel.scrollTop || top + myRow.offsetHeight > panel.scrollTop + panel.clientHeight) {
            panel.scrollTo({ top: Math.max(0, top - 16), behavior });
        }
    }
    const title = document.getElementById('ledger-title');
    if (title) title.focus({ preventScroll: true });
}

// On a wide screen the Ledger panel scrolls on its own and Settle up is often below its edge:
// fade the bottom while there's more to see, since a Mac hides the scroll bar
function syncLedgerFade() {
    const panel = document.getElementById('ledger-panel');
    if (panel) panel.classList.toggle('ledger-more', panel.scrollHeight - panel.clientHeight - panel.scrollTop > 2);
}

// On a phone the + button floats just above the tab bar. It steps aside once the Ledger's
// heading is up out from behind the tab bar (you scrolled to it, or tapped Ledger), so it never
// sits on the amounts. At the top of the page it always shows, even on a short list where the
// Ledger is already peeking up: on a phone it's the only New bet button.
let fabSyncQueued = false;
function syncFabWithLedger() {
    fabSyncQueued = false;
    const nav = document.getElementById('mobile-bottom-nav');
    const title = document.getElementById('ledger-title');
    let hide = false;
    if (nav && title && window.matchMedia && matchMedia('(max-width: 768px)').matches) {
        hide = window.scrollY > 24 && title.getBoundingClientRect().bottom < nav.getBoundingClientRect().top;
    }
    document.body.classList.toggle('ledger-in-view', hide);
}
function queueFabSync() {
    if (fabSyncQueued) return;
    fabSyncQueued = true;
    requestAnimationFrame(syncFabWithLedger);
}
function watchLedgerForFab() {
    window.addEventListener('scroll', queueFabSync, { passive: true });
    window.addEventListener('resize', () => { queueFabSync(); syncLedgerFade(); });
    const panel = document.getElementById('ledger-panel');
    if (panel) panel.addEventListener('scroll', syncLedgerFade, { passive: true });
    queueFabSync();
}

// ==========================================
// Creating Wagers
// ==========================================
const TYPE_HINTS = {
    pool: 'Everyone puts in the same buy-in. The winners split the pot.',
    h2h: 'You against one player. Set the line and the stake.',
    prop: 'You’re betting it happens. Anyone who takes it bets it doesn’t. You win or pay the amount to each taker.'
};
const AMOUNT_LABELS = { pool: 'Buy-in ($)', h2h: 'Bet amount ($)', prop: 'Amount per taker ($)' };
const DESC_PLACEHOLDERS = { pool: 'E.g., Low net, Round 2', h2h: 'E.g., Lower gross, Round 1', prop: 'E.g., Someone makes an ace this trip' };
const ODDS_HELP = 'Odds start at 100. For 3 to 2, type 150.';

// '' while a line is picked but not yet who's the underdog
function oddsSide() {
    const picked = createWagerForm.querySelector('input[name="odds-side"]:checked');
    return picked ? picked.value : '';
}

// The line is quoted for the opponent: +150 when they're the underdog, -150 when they're favored
function readOdds() {
    const side = oddsSide();
    if (side === 'even') return 100;
    if (!side) return NaN;
    const n = parseDollars(wagerOddsInput.value.replace(/^\s*[+\-−–]\s*/, ''));
    if (!Number.isInteger(n)) return NaN;
    return side === 'dog' ? n : -n;
}

// Quick lines: Even, 3:2, 2:1 or Custom (the number box). They only set the side and the number,
// which readOdds() reads as before. Leaving even money doesn't guess who the underdog is.
let customLine = false; // Custom picked: the number box stays open, even on 150 or 200
const LINE_PRESETS = ['150', '200'];

function lineChoice() {
    if (oddsSide() === 'even') return 'even';
    const typed = wagerOddsInput.value.replace(/^\s*[+\-−–]\s*/, '').trim();
    return !customLine && LINE_PRESETS.includes(typed) ? typed : 'custom';
}

function pickLine(line) {
    const sideRadio = value => createWagerForm.querySelector(`input[name="odds-side"][value="${value}"]`);
    const fromEven = oddsSide() === 'even';
    customLine = line === 'custom';
    if (line === 'even') {
        sideRadio('even').checked = true;
    } else {
        if (fromEven) sideRadio('even').checked = false;
        if (!customLine) wagerOddsInput.value = line;
    }
    showCreateError('');
    syncWagerTypeFields();
    // Custom with a side already picked: straight to the number box
    if (customLine && oddsSide()) wagerOddsInput.focus();
}

function syncWagerTypeFields() {
    const type = wagerTypeSelect.value;
    const isH2H = type === 'h2h';
    h2hTargetContainer.style.display = isH2H ? 'block' : 'none';
    wagerTargetSelect.required = isH2H;

    const choice = lineChoice();
    const lined = isH2H && choice !== 'even';
    const hint = document.getElementById('wager-type-hint');
    if (hint) hint.textContent = TYPE_HINTS[type] || '';
    // With a line, the amount is the underdog's side of it (h2hPayouts); the favorite puts up more
    const amtLabel = document.getElementById('wager-amt-label');
    if (amtLabel) amtLabel.textContent = lined ? 'Underdog’s stake ($)' : (AMOUNT_LABELS[type] || 'Bet amount ($)');
    const amtHint = document.getElementById('wager-amt-hint');
    if (amtHint) amtHint.hidden = !lined;
    if (lined) wagerAmtInput.setAttribute('aria-describedby', 'wager-amt-hint');
    else wagerAmtInput.removeAttribute('aria-describedby');
    wagerDescInput.placeholder = DESC_PLACEHOLDERS[type] || '';

    // "Kelly's the underdog" reads better than "They're the underdog" once someone is picked
    const opp = wagerTargetSelect.value ? getPlayerName(wagerTargetSelect.value).split(' ')[0] : '';
    const dogLabel = document.getElementById('odds-dog-label');
    const favLabel = document.getElementById('odds-fav-label');
    const legend = document.getElementById('odds-side-legend');
    if (dogLabel) dogLabel.textContent = opp ? `${opp}’s the underdog` : 'They’re the underdog';
    if (favLabel) favLabel.textContent = opp ? `${opp}’s the favorite` : 'They’re the favorite';
    if (legend) legend.textContent = opp ? `The line on ${opp}` : 'The line';
    createWagerForm.querySelectorAll('.line-chip').forEach(chip => chip.setAttribute('aria-pressed', String(chip.dataset.line === choice)));
    const sideOptions = document.getElementById('odds-side-options');
    if (sideOptions) sideOptions.hidden = choice === 'even';
    if (oddsNumberWrap) oddsNumberWrap.hidden = choice !== 'custom';

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
    const name = wagerTargetSelect.value ? getPlayerName(wagerTargetSelect.value) : '';
    if (!oddsSide()) {
        previewEl.textContent = `Pick whether ${name || 'your opponent'} is the underdog or the favorite.`;
        return;
    }
    const odds = readOdds();
    if (!isValidOdds(odds)) {
        previewEl.textContent = ODDS_HELP;
        return;
    }

    // The money first: what you put up and what you take (h2hPayouts), then their side and the line
    const Opp = name ? escHtml(name) : 'Your opponent';
    const { creatorWins, targetWins } = h2hPayouts(amount, odds);
    const theirStake = `risks ${fmtMoney(creatorWins)} to win ${fmtMoney(targetWins)}`;
    const theirSide = Math.abs(odds) === 100
        ? `Even money: ${Opp} ${theirStake}.`
        : `${Opp} is the ${odds > 0 ? 'underdog' : 'favorite'} at ${fmtOdds(odds)} and ${theirStake}.`;
    previewEl.innerHTML = `<strong>You risk ${fmtMoney(targetWins)} to win ${fmtMoney(creatorWins)}.</strong><br>${theirSide}`;
}

// Errors show right above the button, and the field that needs fixing gets focus
function showCreateError(message, field) {
    if (!wagerErrorEl) return;
    wagerErrorEl.textContent = message;
    wagerErrorEl.style.display = message ? 'block' : 'none';
    if (message && field) {
        (field.closest('#odds-number-wrap, .odds-side') || field).after(wagerErrorEl);
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
    customLine = false;
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
    modalTitle.textContent = 'New bet';
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
    if (type === 'h2h' && !oddsSide()) {
        return showCreateError('Pick who’s the underdog.', createWagerForm.querySelector('input[name="odds-side"][value="dog"]'));
    }
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
    wagerSubmitBtn.textContent = 'Posting…';
    try {
        const { error } = await supabaseClient.from('wagers').insert([newWager]);
        if (error && error.code !== '23505') throw error; // 23505: an earlier try already saved it

        if (modal.classList.contains('active') && createWagerForm.style.display === 'block') closeModal();
        resetCreateForm();
        showBoardSkeleton();
        await refreshBoard();
        // Show the new bet: switch to a tab that has it, then scroll to it. On a challenge the
        // first button is "Text Kelly about it", so that's where focus lands.
        if (!wagersForFilter(currentFilter).some(w => w.id === newWager.id)) setFilter('all');
        revealCard(newWager.id);
        if (!modal.classList.contains('active')) {
            const first = document.querySelector(`#wager-card-${newWager.id} button:not([disabled])`);
            if (first) first.focus({ preventScroll: true });
        }
        showToast(type === 'h2h'
            ? `Challenge posted. Text ${getPlayerName(targetId).split(' ')[0]} so they know it’s waiting.`
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
            say(sheetUp ? 'No signal. Tap Post bet again once you have a bar or two (without changing it) and it won’t post twice.'
                : 'No signal, so that bet may not have posted. Open New bet and tap Post bet again. It won’t post twice.');
        } else {
            say('Couldn’t post the bet: ' + (err.message || err));
        }
    } finally {
        creatingWager = false;
        wagerSubmitBtn.disabled = false;
        wagerSubmitBtn.textContent = 'Post bet';
    }
}

// ==========================================
// Texting a challenge
// ==========================================
// No notifications go out, so the challenger sends the link: the share sheet where the phone
// has one, a text message on a phone without it, otherwise the message is copied.
function betLink(id) {
    return `${window.location.origin}/bookie.html?bet=${encodeURIComponent(id)}`;
}

function challengeText(wager) {
    const { creatorWins, targetWins } = h2hPayouts(wager.amount, wager.odds);
    const terms = String(wager.description || '').trim().replace(/[.!?\s]+$/, '');
    const line = creatorWins === targetWins ? '' : ` (you win ${fmtMoney(targetWins)}, you lose ${fmtMoney(creatorWins)})`;
    return `I challenged you on The Bookie: ${fmtMoney(wager.amount)} on ${terms}${line}. Accept or duck it:`;
}

const isPhone = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1); // iPad in desktop mode

async function copyText(text) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (e) { /* fall back below */ }
    try {
        const box = document.createElement('textarea');
        box.value = text;
        box.setAttribute('readonly', '');
        box.style.cssText = 'position: fixed; top: 0; left: 0; opacity: 0;';
        document.body.appendChild(box);
        box.select();
        const ok = document.execCommand('copy');
        box.remove();
        return ok;
    } catch (e) {
        return false;
    }
}

window.textChallenge = async function (id) {
    const wager = findWager(id);
    if (!wager || !currentUser || wager.type !== 'h2h') return;
    const them = firstName(wager.target_id);
    const text = challengeText(wager);
    const url = betLink(wager.id);
    if (navigator.share) {
        try {
            await navigator.share({ text, url });
            return;
        } catch (err) {
            if (err && err.name === 'AbortError') return; // they closed the share sheet
            // Not allowed here (or it failed): fall through to a text message or the clipboard
        }
    }
    const message = `${text} ${url}`;
    if (isPhone()) {
        // "?&body=" works in both iPhone and Android Messages
        const link = document.createElement('a');
        link.href = `sms:?&body=${encodeURIComponent(message)}`;
        link.click();
        return;
    }
    if (await copyText(message)) {
        showToast(`Copied the message and link. Paste it in a text to ${them}.`, 'success');
    } else {
        window.prompt(`Copy this and text it to ${them}:`, message);
    }
};

// ==========================================
// Native App Helpers (Skeletons & Toasts)
// ==========================================
// Loading placeholders for the board
function showBoardSkeleton() {
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

    const icon = {
        success: '<i class="fas fa-check-circle" style="color: var(--accent-emerald);" aria-hidden="true"></i>',
        info: '<i class="fas fa-info-circle" style="color: var(--accent-gold);" aria-hidden="true"></i>'
    }[type] || '<i class="fas fa-exclamation-circle" style="color: #ef4444;" aria-hidden="true"></i>';
    toast.innerHTML = `${icon} <span></span>`;
    toast.querySelector('span').textContent = message;

    container.appendChild(toast);

    if (navigator.vibrate) {
        navigator.vibrate(type === 'error' ? [50, 100, 50] : 50);
    }

    const dismiss = () => {
        if (!toast.isConnected || toast.classList.contains('fade-out')) return;
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    };
    toast.addEventListener('click', dismiss); // tap to dismiss
    setTimeout(dismiss, type === 'error' ? 7000 : (type === 'info' ? 5000 : 3000));
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
