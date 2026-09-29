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

// Other pages send people here to sign in (?next=rsvp etc.). Once their login is linked to
// a roster name they go straight back. `mode` opens the log-in or sign-up form on arrival.
const NEXT_PAGES = { rsvp: 'index.html#rsvp', profile: 'index.html#profile', round: 'round_tracker.html', admin: 'admin.html' };
const NEXT_NOTES = {
    rsvp: 'RSVPs need a player account: the same login you use for The Bookie and the round tracker. It takes a minute.',
    profile: 'Log in to update your GHIN and handicap.',
    round: 'Log in to start a round.',
    admin: 'Log in with your admin account.'
};
const NEXT = NEXT_PAGES[LINK_PARAMS.get('next')] ? LINK_PARAMS.get('next') : null;
const START_MODE = ['login', 'register'].includes(LINK_PARAMS.get('mode')) ? LINK_PARAMS.get('mode') : null;
const NEW_PLAYER = '__new';
const ALERTS = BBB.alerts || {};

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
let modalReturnFocus = null;
let resetPending = OPENED_FROM_RESET_LINK; // don't leave the page before the new password is saved

// Escape text from the database before it goes into innerHTML.
function escHtml(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// DOM Elements
const authWall = document.getElementById('auth-wall');
const authWallNote = document.getElementById('auth-wall-note');
const dashboard = document.getElementById('bookie-dashboard');
const currentUserNameEl = document.getElementById('current-user-name');
const modal = document.getElementById('bookie-modal');
const modalClose = document.getElementById('bookie-modal-close');
const authForm = document.getElementById('auth-form');
const createWagerForm = document.getElementById('create-wager-form');
const settleWagerForm = document.getElementById('settle-wager-form');
const modalTitle = document.getElementById('modal-title');

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
        alert('Error: Betting backend failed to load. Please disable any strict ad-blockers or try refreshing the page.');
        return;
    }

    // Create the Supabase client here so we know the CDN script has run
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    setupEventListeners();

    // Registered once. PASSWORD_RECOVERY fires when someone opens a reset link.
    supabaseClient.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') {
            currentUser = null;
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
        showWall(LINK_ERROR === 'otp_expired'
            ? 'That email link expired or was already used. Log in, or tap “Forgot password?” to get a fresh one.'
            : 'That email link didn’t work. Log in, or tap “Forgot password?” to get a fresh one.');
    } else if (START_MODE && !signedIn && navLoginBtn.dataset.signedIn !== 'true') {
        openAuthModal(START_MODE);
    }
    // Drop tokens and one-time flags from the address bar, but keep ?next= for later links.
    if (CAME_FROM_AUTH_LINK || START_MODE) history.replaceState(null, '', pageUrl());
}

function setupEventListeners() {
    // Modal controls
    modalClose.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
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
    wagerTargetSelect.addEventListener('change', updateOddsPreview);
    createWagerForm.addEventListener('submit', handleCreateWager);

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

    // Pull-to-refresh indicator
    const ptrIndicator = document.createElement('div');
    ptrIndicator.className = 'ptr-indicator';
    ptrIndicator.innerHTML = '<i class="fas fa-sync-alt fa-spin"></i> Fetching latest...';
    const dashboardGrid = document.querySelector('.bookie-grid > div:first-child');
    if (dashboardGrid) dashboardGrid.insertBefore(ptrIndicator, wagersContainer);

    dashboard.addEventListener('touchstart', (e) => {
        if (window.scrollY === 0) startY = e.touches[0].clientY;
    }, { passive: true });

    dashboard.addEventListener('touchmove', (e) => {
        if (window.scrollY === 0 && startY > 0 && !isRefreshing) {
            currentY = e.touches[0].clientY;
            if (currentY - startY > 80) ptrIndicator.classList.add('active');
        }
    }, { passive: true });

    dashboard.addEventListener('touchend', async () => {
        if (ptrIndicator.classList.contains('active') && !isRefreshing) {
            isRefreshing = true;
            if (navigator.vibrate) navigator.vibrate(50);
            await refreshBoard();
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

    // Swipe a card: left = join / accept, right = delete. Every action still asks to confirm.
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
        const btn = card.querySelector(dx < 0 ? '.accept-btn, .join-btn' : '.delete-btn');
        if (btn) btn.click();
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
    if (modalReturnFocus && document.contains(modalReturnFocus)) modalReturnFocus.focus({ preventScroll: true });
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
    showToast('You’re signed in. Taking you back…', 'success');
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
        showWall(`${linkProblem ? linkProblem + ' ' : ''}You're logged in as ${session.user.email || 'this account'}, but that login isn't linked to a name on the trip roster yet. Pick your name below. First trip? Choose “I’m new”.`, true);
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
        showWall(`You’re signed up, ${String(player.name).split(' ')[0]}. The commissioner still needs to confirm you for the trip before you can place bets. You can RSVP now.`, true, { pending: true });
        return false;
    }

    currentUser = player;
    showDashboard();
    wagersContainer.innerHTML = getSkeletonHtml();
    await refreshBoard();
    return true;
}

function showWall(note, signedIn, opts) {
    document.body.classList.remove('is-authed');
    authWall.style.display = 'block';
    dashboard.style.display = 'none';
    const text = note || (!signedIn && NEXT ? NEXT_NOTES[NEXT] : '');
    if (authWallNote) {
        authWallNote.textContent = text;
        authWallNote.hidden = !text;
    }
    // Signed in but unlinked: offer the name picker instead of log in / sign up
    const wallButtons = document.getElementById('wall-buttons');
    if (wallButtons) wallButtons.style.display = signedIn ? 'none' : 'flex';
    const linkBox = document.getElementById('link-roster');
    if (linkBox && (!signedIn || (opts && opts.pending))) linkBox.hidden = true;
    const rsvpLink = document.getElementById('wall-rsvp-link');
    if (rsvpLink) rsvpLink.hidden = !(opts && opts.pending);
    navLoginBtn.dataset.signedIn = signedIn ? 'true' : 'false';
    navLoginBtn.textContent = signedIn ? 'Log Out' : 'Login / Register';
}

function showDashboard() {
    document.body.classList.add('is-authed');
    authWall.style.display = 'none';
    dashboard.style.display = 'block';
    currentUserNameEl.textContent = currentUser.name;
    navLoginBtn.dataset.signedIn = 'true';
    navLoginBtn.textContent = 'Log Out';
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
    if (forgotPasswordBtn) forgotPasswordBtn.style.display = mode === 'login' ? 'inline' : 'none';
    toggleAuthModeBtn.parentElement.style.display = isReset ? 'none' : 'block';

    if (isRegister) {
        // One account covers RSVPs, betting and the round tracker; name it for why they came
        modalTitle.textContent = NEXT ? 'Create Your Player Account' : 'Create Betting Account';
        authSubmitBtn.textContent = 'Sign Up';
        toggleAuthModeBtn.textContent = 'Already have an account? Log in here.';
        loadRosterChoices();
    } else if (isReset) {
        modalTitle.textContent = LINK_PARAMS.get('type') === 'invite' ? 'Choose Your Password' : 'Choose a New Password';
        authSubmitBtn.textContent = 'Save Password';
    } else {
        modalTitle.textContent = NEXT ? 'Log In' : 'Log In to The Bookie';
        authSubmitBtn.textContent = 'Log In';
        toggleAuthModeBtn.textContent = 'Need an account? Sign up here.';
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
    if (/email not confirmed/i.test(msg)) return 'Confirm your email first: open the link we sent you, then log in here.';
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
        throw new Error(`${same.name} already has an account. Tap “Already have an account? Log in here.” below, and use “Forgot password?” there if you need to.`);
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
        throw new Error('That name already has a Bookie account. Log in instead, or tap “Forgot password?”.');
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
                setAuthMessage(`Almost done: we sent a confirmation link to ${email}. Open it, then log in here. No email after a few minutes? Ask the commissioner.`, false);
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
        setAuthMessage('If that email has a Bookie account, a reset link is on its way. Open it on this phone. Nothing after a few minutes? Ask the commissioner.', false);
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
}

async function refreshBoard() {
    await fetchBaseData();
    renderDashboard();
    lastRefresh = Date.now();
}

// Update one wager only while it is still in an expected state, so a stale screen can't
// overwrite a newer result. Returns false when someone else changed the bet first.
async function updateWager(id, values, expectedStatuses, extraFilter) {
    let q = supabaseClient.from('wagers').update(values).eq('id', id).in('status', expectedStatuses);
    if (extraFilter) q = extraFilter(q);
    const { data, error } = await q.select('id');
    if (error) throw error;
    return !!data && data.length > 0;
}

async function betChangedUnderYou(message) {
    showToast(message || 'That bet just changed on someone else’s phone. Here’s the latest.', 'error');
    closeModal();
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
    renderWagers();
}

function updateNotificationBadges() {
    if (!currentUser) return;

    const hasPending = allWagers.some(w => isCurrentSeason(w) && w.status === 'proposed' && w.target_id === currentUser.id);
    document.querySelectorAll('button[data-filter="h2h"], button[data-filter="me"]').forEach(btn => {
        const dot = btn.querySelector('.notif-dot');
        if (hasPending && !dot) {
            btn.insertAdjacentHTML('beforeend', '<span class="notif-dot" aria-label="You have a challenge waiting" style="display:inline-block; width:8px; height:8px; background:#ef4444; border-radius:50%; margin-left:6px; vertical-align:middle; box-shadow: 0 0 5px rgba(239, 68, 68, 0.8);"></span>');
        } else if (!hasPending && dot) {
            dot.remove();
        }
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
        default: return current;
    }
}

function renderWagers() {
    if (loadError && !allWagers.length) {
        wagersContainer.innerHTML = `
            <div style="text-align: center; padding: 40px; background: rgba(239,68,68,0.06); border-radius: 12px; border: 1px dashed rgba(239,68,68,0.35);">
                <p style="color: var(--text-muted); margin-bottom: 15px;">Couldn’t load the betting board. Check your signal and pull down to refresh.</p>
            </div>`;
        return;
    }

    const displayWagers = wagersForFilter(currentFilter);

    if (displayWagers.length === 0) {
        const empty = {
            past: 'No bets from past trips.',
            me: 'You’re not in any bets yet.',
            h2h: 'No head-to-head challenges yet.',
            pools: 'No pools or props yet.'
        }[currentFilter] || 'No action on the board yet.';
        wagersContainer.innerHTML = `
            <div style="text-align: center; padding: 40px; background: rgba(255,255,255,0.02); border-radius: 12px; border: 1px dashed rgba(255,255,255,0.1);">
                <p style="color: var(--text-muted); margin-bottom: 15px;">${empty}</p>
                ${currentFilter === 'past' ? '' : '<button class="btn" style="border: 1px solid var(--accent-emerald); color: var(--accent-emerald);" onclick="openWagerModal()">Be the first to bet</button>'}
            </div>
        `;
        return;
    }

    // Keep open trash-talk threads open across re-renders
    const openThreads = new Set([...wagersContainer.querySelectorAll('[id^="comments-"]')]
        .filter(el => el.style.display === 'block').map(el => el.id));

    wagersContainer.innerHTML = displayWagers.map(wagerCardHTML).join('');

    openThreads.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'block';
    });
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
            (odds !== 100 && odds !== -100 ? statPill('', `<i class="fas fa-chart-line"></i> ${escHtml(firstName(wager.target_id))} ${fmtOdds(odds)}`, 'var(--accent-gold)') : '');
    }
    if (wager.type === 'prop') {
        const takers = parts.filter(id => id !== wager.creator_id).length;
        return statPill('Per taker', fmtMoney(wager.amount)) +
            statPill(`${escHtml(firstName(wager.creator_id))} covers`, fmtMoney(wager.amount * takers), 'var(--accent-emerald)') +
            statPill('', `${takers} <i class="fas fa-users" style="font-size: 0.8rem; color: var(--text-muted)"></i>`);
    }
    return statPill('Buy-In', fmtMoney(wager.amount)) +
        statPill('Pot', fmtMoney(wager.amount * parts.length), 'var(--accent-emerald)') +
        statPill('', `${parts.length} <i class="fas fa-users" style="font-size: 0.8rem; color: var(--text-muted)"></i>`);
}

// Who won and who owes whom, in dollars
function resultsHTML(wager) {
    const box = (color, icon, title, detail) => `
        <div style="margin-top: 15px; padding: 15px; background: ${color}1a; border-radius: 8px; border: 1px solid ${color}33;">
            <div style="color: ${color}; font-weight: 700; margin-bottom: 5px;"><i class="fas ${icon}"></i> ${title}</div>
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
    const share = winners.length ? (wager.amount * parts.length) / winners.length : 0;
    return box(GREEN, 'fa-trophy', `Won by ${winners.map(name).join(' & ') || 'nobody'}`,
        `${fmtMoney(share)} each. ${losers.length ? `${losers.map(name).join(', ')} paid ${fmtMoney(wager.amount)} into the pot.` : ''}`);
}

// Who's in: everyone for pools and head-to-heads, just the takers for a prop
function peopleLineHTML(wager) {
    const parts = wager.participants || [];
    const people = wager.type === 'prop' ? parts.filter(id => id !== wager.creator_id) : parts;
    if (!people.length) return '';
    return `<div style="margin-top: 10px; font-size: 0.85rem; color: var(--text-muted); line-height: 1.4;"><strong>${wager.type === 'prop' ? 'Takers' : 'Participants'}:</strong> ${people.map(pid => escHtml(getPlayerName(pid))).join(', ')}</div>`;
}

function actionButton(label, icon, onclick, style, extraClass) {
    return `<button class="btn ${extraClass || ''}" style="flex: 1; padding: 10px; ${style || ''}" onclick="${onclick}"><i class="fas ${icon}" style="margin-right: 6px;"></i>${label}</button>`;
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

    if (wager.type === 'h2h') {
        if (wager.status === 'proposed') {
            if (isTarget) {
                return row(actionButton('Accept', 'fa-check', `window.acceptWager('${id}')`, '', 'accept-btn') +
                    actionButton('Decline', 'fa-times', `window.declineWager('${id}')`, RED, 'decline-btn'));
            }
            if (isCreator || isAdmin) {
                return (isCreator ? note(`<i class="fas fa-clock" style="margin-right: 5px;"></i>Waiting for ${wager.target ? escHtml(wager.target.name) : 'your opponent'} to accept…`) : '') +
                    row(actionButton('Cancel Bet', 'fa-ban', `window.cancelWager('${id}')`, RED, 'cancel-btn'));
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
            html += row(`<button class="btn join-btn" style="width: 100%; padding: 10px;" onclick="window.joinWager('${id}')">${wager.type === 'prop' ? 'Take the Action' : 'Join Pool'} (${fmtMoney(wager.amount)})</button>`);
        } else if (!isCreator) {
            html += note('You’re in this bet');
        }
        if (canManage) {
            const enough = wager.type === 'prop' ? takers.length >= 1 : parts.length >= 2;
            html += row((enough ? actionButton('Close Betting', 'fa-lock', `window.closeBetting('${id}')`, GREEN) : '') +
                actionButton('Cancel Bet', 'fa-ban', `window.cancelWager('${id}')`, RED, 'cancel-btn'));
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

    const canDelete = isCreator && (
        (wager.type === 'h2h' && wager.status === 'proposed') ||
        (wager.type !== 'h2h' && wager.status === 'open' && parts.length <= 1)
    );
    const deleteBtnHtml = canDelete
        ? `<div style="margin-top: 8px;"><button class="delete-btn" style="background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; cursor: pointer; transition: all 0.2s;" onclick="window.deleteWager('${id}')"><i class="fas fa-trash" style="margin-right: 4px;"></i>Delete</button></div>`
        : '';

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
            <button class="btn" style="width: 100%; padding: 8px; background: rgba(255,255,255,0.02); color: var(--text-muted); font-size: 0.85rem; border: 1px dashed rgba(255,255,255,0.1);" aria-expanded="false" onclick="const el = document.getElementById('comments-${id}'); const open = el.style.display === 'none'; el.style.display = open ? 'block' : 'none'; this.setAttribute('aria-expanded', open);">
               <i class="fas fa-comments" style="margin-right: 6px;"></i>Trash Talk (${comments.length})
            </button>
            <div id="comments-${id}" style="display: none; margin-top: 15px;">
                <div style="max-height: 150px; overflow-y: auto; margin-bottom: 10px; padding-right: 5px;">
                    ${commentsHtml}
                </div>
                ${currentUser ? `
                <div style="display: flex; gap: 8px;">
                    <input type="text" id="comment-input-${id}" maxlength="280" aria-label="Add trash talk" placeholder="Talk smack..." style="flex: 1; min-width: 0; background: rgba(0,0,0,0.2); border: 1px solid var(--glass-border); border-radius: 8px; padding: 8px 12px; color: white;">
                    <button class="btn" style="padding: 8px 15px; min-height: 44px; background: var(--accent-gold); color: #000; font-weight: bold; border: none; border-radius: 8px;" onclick="window.postComment('${id}')">Post</button>
                </div>` : ''}
            </div>
        </div>
    `;

    return `
        <div class="glass-panel" id="wager-card-${id}" style="${cardStyle}">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 10px;">
                <div style="min-width: 0;">
                    <div style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 5px;">${wager.creator ? escHtml(wager.creator.name) : 'Unknown'} • <span style="white-space: nowrap;">${typeLabel}${pastLabel}</span></div>
                    <h4 style="font-size: 1.1rem; margin-bottom: 5px; overflow-wrap: anywhere;">${escHtml(wager.description)}</h4>
                    ${targetLabel}
                </div>
                <div style="text-align: right; flex-shrink: 0;">
                    ${statusBadgeHTML(wager)}
                    ${deleteBtnHtml}
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
    if (!currentUser) return;
    const wager = findWager(id);
    if (!wager) return;
    const me = currentUser.id;
    const creator = getPlayerName(wager.creator_id);
    const question = wager.type === 'prop'
        ? `Take the action on “${wager.description}” for ${fmtMoney(wager.amount)}?\n\nIf it happens, you pay ${creator} ${fmtMoney(wager.amount)}. If it doesn’t, ${creator} pays you ${fmtMoney(wager.amount)}.`
        : `Join “${wager.description}” for a ${fmtMoney(wager.amount)} buy-in?`;
    if (!confirm(question)) return;

    try {
        // Add yourself to the latest list, and only if nobody else changed it in between
        for (let attempt = 0; attempt < 4; attempt++) {
            const { data: fresh, error } = await supabaseClient
                .from('wagers')
                .select('participants, status')
                .eq('id', id)
                .single();
            if (error) throw error;
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
        showToast('Error joining: ' + err.message, 'error');
    }
};

window.acceptWager = async function (id) {
    if (!currentUser) return;
    const wager = findWager(id);
    if (!wager) return;
    const { creatorWins, targetWins } = h2hPayouts(wager.amount, wager.odds);
    const creator = getPlayerName(wager.creator_id);
    if (!confirm(`Accept ${creator}’s challenge: “${wager.description}”?\n\nIf you win, ${creator} pays you ${fmtMoney(targetWins)}. If ${creator} wins, you pay ${fmtMoney(creatorWins)}.`)) return;

    try {
        const ok = await updateWager(id, { status: 'active', participants: [wager.creator_id, currentUser.id] }, ['proposed'],
            q => q.eq('target_id', currentUser.id));
        if (!ok) return betChangedUnderYou('That challenge was canceled before you accepted.');

        const card = document.getElementById(`wager-card-${id}`);
        if (card) card.classList.add('success-pop');
        setTimeout(async () => {
            await refreshBoard();
            showToast('Challenge accepted. The bet is live.', 'success');
        }, card ? 500 : 0);
    } catch (err) {
        showToast('Error accepting challenge: ' + err.message, 'error');
    }
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
    if (!currentUser) return;
    if (!confirm('Decline this challenge? The bet will be canceled.')) return;

    try {
        const ok = await updateWager(id, { status: 'canceled' }, ['proposed'], q => q.eq('target_id', currentUser.id));
        if (!ok) return betChangedUnderYou();
        fadeCard(id);
        setTimeout(async () => {
            await refreshBoard();
            showToast('Challenge declined.', 'success');
        }, 400);
    } catch (err) {
        showToast('Error declining challenge: ' + err.message, 'error');
    }
};

// Cancel a bet that hasn't been decided: an unaccepted challenge, or an open pool or prop.
window.cancelWager = async function (id) {
    if (!currentUser) return;
    const wager = findWager(id);
    if (!wager) return;
    const others = (wager.participants || []).filter(pid => pid !== wager.creator_id).length;
    const question = wager.status === 'proposed'
        ? 'Cancel this challenge before it’s accepted?'
        : `Cancel this ${wager.type === 'prop' ? 'prop' : 'pool'}?${others ? ' Everyone who joined is out and no money changes hands.' : ''}`;
    if (!confirm(question)) return;

    try {
        const ok = await updateWager(id, { status: 'canceled' }, [wager.status]);
        if (!ok) return betChangedUnderYou();
        if (others && wager.status !== 'proposed') await logBetNote(id, 'Canceled the bet. No money changes hands.');
        fadeCard(id);
        setTimeout(async () => {
            await refreshBoard();
            showToast('Bet canceled.', 'success');
        }, 400);
    } catch (err) {
        showToast('Error canceling bet: ' + err.message, 'error');
    }
};

// Pools and props: stop new joins (e.g. once the round starts) before settling.
window.closeBetting = async function (id) {
    if (!currentUser) return;
    const wager = findWager(id);
    if (!wager) return;
    if (!confirm(`Close betting on “${wager.description}”? Nobody else can join after this. You’ll settle it once the result is in.`)) return;

    try {
        const ok = await updateWager(id, { status: 'active' }, ['open']);
        if (!ok) return betChangedUnderYou();
        await refreshBoard();
        showToast('Betting closed. Settle it when the result is in.', 'success');
    } catch (err) {
        showToast('Error closing betting: ' + err.message, 'error');
    }
};

window.deleteWager = async function (id) {
    if (!confirm('Delete this wager? It disappears from the board.')) return;

    try {
        const { data, error } = await supabaseClient
            .from('wagers')
            .delete()
            .eq('id', id)
            .select('id');
        if (error) throw error;

        if (!data || !data.length) {
            // Not deleted: either someone just joined, or the database doesn't allow deleting
            // this type yet (props before bookie_2027.sql). Only cancel it if it's still just yours.
            const { data: fresh } = await supabaseClient.from('wagers').select('status, participants').eq('id', id).maybeSingle();
            const stillEmpty = fresh && Array.isArray(fresh.participants) && fresh.participants.length <= 1;
            if (!stillEmpty) return betChangedUnderYou('Someone just joined, so it can’t be deleted. Cancel it from the card if you need to.');
            const ok = await updateWager(id, { status: 'canceled' }, [fresh.status], q => q.eq('participants', JSON.stringify(fresh.participants)));
            if (!ok) return betChangedUnderYou();
            await refreshBoard();
            showToast('Couldn’t delete it, so it’s been canceled instead.', 'success');
            return;
        }

        await refreshBoard();
        showToast('Wager deleted.', 'success');
    } catch (err) {
        showToast('Error deleting wager: ' + err.message, 'error');
    }
};

window.postComment = async function (wagerId) {
    if (!currentUser) return;
    const inputField = document.getElementById(`comment-input-${wagerId}`);
    if (!inputField) return;
    const message = inputField.value.trim().slice(0, 280);
    if (!message) return;

    inputField.disabled = true;
    try {
        const { error } = await supabaseClient
            .from('wager_comments')
            .insert({
                wager_id: wagerId,
                player_id: currentUser.id,
                message: message
            });

        if (error) throw error;

        await refreshBoard();

        // Keep the thread open after the reload
        const el = document.getElementById(`comments-${wagerId}`);
        if (el) el.style.display = 'block';
    } catch (err) {
        showToast('Error posting comment: ' + err.message, 'error');
        inputField.disabled = false;
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

    showModalForm('settle');
    modalTitle.textContent = 'Settle Wager';
    document.getElementById('settle-wager-id').value = id;

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
    const share = (wager.amount * parts.length) / winnerIds.length;
    return `Settled: ${winnerIds.map(name).join(' & ')} win${winnerIds.length === 1 ? 's' : ''} ${fmtMoney(share)}${winnerIds.length > 1 ? ' each' : ''}.`;
}

async function handleSettleSubmit(e) {
    e.preventDefault();
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

    try {
        const ok = await updateWager(wagerId, { status: 'settled', winner_id: winnerIds[0], winner_ids: winnerIds }, ['active']);
        if (!ok) return betChangedUnderYou('Someone already settled or changed that bet. Here’s the latest.');
        await logBetNote(wagerId, describeResult(wager, winnerIds));

        closeModal();
        await refreshBoard();
        showToast('Settled. The ledger is updated.', 'success');
    } catch (err) {
        showToast('Error settling wager: ' + err.message, 'error');
    }
}

async function handleAlternativeSettle(statusType) {
    const wagerId = document.getElementById('settle-wager-id').value;
    if (!confirm(`Are you sure you want to ${statusType === 'push' ? 'declare a Push (Tie)' : 'Cancel'} this bet? No money will change hands.`)) return;

    try {
        const ok = await updateWager(wagerId, { status: statusType }, ['active']);
        if (!ok) return betChangedUnderYou('Someone already settled or changed that bet. Here’s the latest.');
        await logBetNote(wagerId, statusType === 'push' ? 'Declared a push. No money changes hands.' : 'Canceled the bet. No money changes hands.');

        closeModal();
        await refreshBoard();
        showToast(`Wager ${statusType === 'push' ? 'pushed' : 'canceled'}.`, 'success');
    } catch (err) {
        showToast('Error updating wager: ' + err.message, 'error');
    }
}

// Auto-settle a head-to-head from the Live Tracker: the latest round both players finished
// (all 18 holes entered), lower gross score to par wins. Each group scores its own session, so
// the two cards are matched by round number and date. The player confirms before it saves.
const HOLE_COLUMNS = Array.from({ length: 18 }, (_, i) => `h${i + 1}`);

async function handleAutoSettle(wager) {
    try {
        const ids = [wager.creator_id, wager.target_id];
        const { data: cards, error: cardsError } = await supabaseClient
            .from('scores')
            .select(`round_id, player_id, total_to_par, total_score, ${HOLE_COLUMNS.join(', ')}`)
            .in('player_id', ids);
        if (cardsError) throw cardsError;

        const complete = (cards || []).filter(c => HOLE_COLUMNS.every(h => c[h] !== null && c[h] !== undefined));
        const roundIds = [...new Set(complete.map(c => c.round_id))];

        let rounds = [];
        if (roundIds.length) {
            const { data, error } = await supabaseClient
                .from('rounds')
                .select('id, round_number, date')
                .in('id', roundIds);
            if (error) throw error;
            rounds = (data || []).filter(r => !SEASON_START || !r.date || new Date(r.date) >= SEASON_START);
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
        const cScore = pair[wager.creator_id].total_to_par;
        const tScore = pair[wager.target_id].total_to_par;
        const toPar = n => (n === 0 ? 'E' : n > 0 ? `+${n}` : String(n));
        const summary = `Round ${round.round_number || '?'}${round.date ? ` (${round.date})` : ''}, gross score to par:\n` +
            `${getPlayerName(wager.creator_id)} ${toPar(cScore)}\n${getPlayerName(wager.target_id)} ${toPar(tScore)}`;

        const isPush = cScore === tScore;
        const winnerId = cScore < tScore ? wager.creator_id : wager.target_id;
        if (!confirm(`${summary}\n\n${isPush ? 'All square. Declare a push?' : `Settle this bet for ${getPlayerName(winnerId)}?`}\n\nOnly OK this if the bet was about this round's score.`)) return;

        const values = isPush ? { status: 'push' } : { status: 'settled', winner_id: winnerId, winner_ids: [winnerId] };
        const ok = await updateWager(wager.id, values, ['active']);
        if (!ok) return betChangedUnderYou('Someone already settled or changed that bet. Here’s the latest.');
        await logBetNote(wager.id, isPush ? `Auto-settled from Round ${round.round_number}: all square, push.` : `Auto-settled from Round ${round.round_number}: ${describeResult(wager, [winnerId])}`);

        closeModal();
        await refreshBoard();
        showToast(isPush ? 'All square. Wager pushed.' : `Settled. ${getPlayerName(winnerId)} wins.`, 'success');
    } catch (e) {
        showToast('Error auto-settling: ' + e.message, 'error');
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
            const share = (amount * parts.length) / winners.length;
            parts.forEach(pid => add(pid, -amount));
            winners.forEach(pid => add(pid, share));
        }
    });
    return balances;
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

    ledgerContainer.innerHTML = ledgerHtml;
}

// ==========================================
// Creating Wagers
// ==========================================
function syncWagerTypeFields() {
    const isH2H = wagerTypeSelect.value === 'h2h';
    h2hTargetContainer.style.display = isH2H ? 'block' : 'none';
    wagerTargetSelect.required = isH2H;
    updateOddsPreview();
}

function updateOddsPreview() {
    const previewEl = document.getElementById('odds-preview-text');
    if (!previewEl) return;

    const amount = parseFloat(wagerAmtInput.value);
    const odds = parseInt(wagerOddsInput.value, 10);
    if (wagerTypeSelect.value !== 'h2h' || isNaN(amount) || amount <= 0) {
        previewEl.style.display = 'none';
        return;
    }

    previewEl.style.display = 'block';
    if (!isValidOdds(odds)) {
        previewEl.textContent = 'Odds need to be 100 or more either way, like +150 or -120. Use 100 for even money.';
        return;
    }

    const opp = wagerTargetSelect.value ? escHtml(getPlayerName(wagerTargetSelect.value)) : 'your opponent';
    const { creatorWins, targetWins } = h2hPayouts(amount, odds);
    const line = Math.abs(odds) === 100 ? 'Even money.' : `${opp} is the ${odds > 0 ? 'underdog' : 'favorite'} at ${fmtOdds(odds)}.`;
    previewEl.innerHTML = `${line}<br><strong>You win:</strong> ${opp} pays you ${fmtMoney(creatorWins)}.<br><strong>${opp} wins:</strong> you pay ${fmtMoney(targetWins)}.`;
}

function openWagerModal() {
    if (!currentUser) return;

    showModalForm('create');
    createWagerForm.reset();
    if (wagerOddsInput) wagerOddsInput.value = '100'; // Default even odds
    modalTitle.textContent = 'Propose a Wager';

    // Anyone confirmed for the trip (not just drafted players) can be challenged
    wagerTargetSelect.innerHTML = '<option value="">Select an opponent...</option>' + dbPlayers
        .filter(p => p.id !== currentUser.id && p.status !== 'potential')
        .map(p => `<option value="${escHtml(p.id)}">${escHtml(p.name)}${p.user_id ? '' : ' (no Bookie account yet)'}</option>`)
        .join('');

    syncWagerTypeFields();
    openModal(wagerTypeSelect);
}
window.openWagerModal = openWagerModal;

async function handleCreateWager(e) {
    e.preventDefault();
    if (!currentUser || creatingWager) return;

    const type = wagerTypeSelect.value;
    const amount = parseInt(wagerAmtInput.value, 10);
    const desc = wagerDescInput.value.trim();
    const targetId = type === 'h2h' ? wagerTargetSelect.value : null;
    const odds = type === 'h2h' ? parseInt(wagerOddsInput.value, 10) : 100;

    if (!desc) return showToast('Spell out the terms of the bet.', 'error');
    if (!(amount >= 1)) return showToast('Enter a wager of at least $1.', 'error');
    if (type === 'h2h' && !targetId) return showToast('Pick who you’re challenging.', 'error');
    if (!isValidOdds(odds)) return showToast('Odds need to be 100 or more either way, like +150 or -120.', 'error');

    const newWager = {
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
        if (error) throw error;

        closeModal();
        wagersContainer.innerHTML = getSkeletonHtml();
        await refreshBoard();
        showToast(type === 'h2h' ? `Challenge sent to ${getPlayerName(targetId)}.` : (type === 'prop' ? 'Your prop is live.' : 'Your pool is open.'), 'success');
    } catch (err) {
        const msg = /wagers_type_check/.test(err.message || '')
            ? 'Prop bets need a one-time database update (bookie_2027.sql). Ask the commissioner.'
            : 'Error proposing bet: ' + err.message;
        showToast(msg, 'error');
    } finally {
        creatingWager = false;
        wagerSubmitBtn.disabled = false;
        wagerSubmitBtn.textContent = 'Propose Wager';
    }
}

// ==========================================
// Native App Helpers (Skeletons & Toasts)
// ==========================================
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

// Kickoff: handles both early and late script execution
if (document.readyState === 'complete') {
    initBookie();
} else {
    window.addEventListener('load', initBookie);
}
