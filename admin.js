// Supabase Configuration - USER NEEDS TO FILL THESE IN
const SUPABASE_URL = 'https://gxpwgrdyizruzfczzqwn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uo20KpEYmGXAIB9JGL1CnQ_wIxT8GX4';

// Initialize Supabase Client
let supabaseInstance = null;
try {
    if (typeof supabase !== 'undefined' && SUPABASE_URL !== 'YOUR_SUPABASE_URL') {
        supabaseInstance = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    }
} catch (e) {
    console.error('Supabase initialization failed:', e);
}

// Toast Notification System. Successes fade after 3 s; errors stay until tapped, because
// they're often the only record of what did or didn't save. opts.timeout lets a passing
// notice fade anyway; opts.kind ('save') lets the next message about the same thing replace it.
window.showToast = function(message, type = 'success', opts = {}) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const isError = type !== 'success';

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', isError ? 'alert' : 'status');
    if (opts.kind) toast.dataset.kind = opts.kind;
    toast.innerHTML = `
        <div style="font-size: 1.2rem;" aria-hidden="true">${isError ? '⚠️' : '✅'}</div>
        <div class="toast-text">${message}</div>
        ${isError ? '<button type="button" class="toast-close" aria-label="Dismiss message">×</button>' : ''}
    `;
    const dismiss = () => {
        if (toast.classList.contains('fade-out')) return;
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    };
    toast.addEventListener('click', dismiss);

    // A newer result of the same kind (the latest save) replaces the older one, and the same
    // error twice doesn't stack
    const text = toast.querySelector('.toast-text').innerHTML;
    container.querySelectorAll('.toast').forEach(t => {
        if ((opts.kind && t.dataset.kind === opts.kind) ||
            (isError && t.classList.contains('toast-error') && t.querySelector('.toast-text').innerHTML === text)) t.remove();
    });
    container.appendChild(toast);
    const life = isError ? opts.timeout : 3000;
    if (life) setTimeout(dismiss, life);
};

window.clearToasts = function(kind) {
    document.querySelectorAll(`#toast-container .toast[data-kind="${kind}"]`).forEach(t => t.remove());
};

// DOM Elements Registry
let elements = {};

// State
let players = [];
let originalPlayers = []; // To track changes and allow discard
let matchups = [];
let originalMatchups = [];
let currentMatchupRound = adminCupRounds()[0]; // the first Cup round in trip-config.js
let hasChanges = false;
// Each dataset is 'loading', 'ok' or 'error'. Save writes matchups as a diff against what
// loaded, so it stays off unless both loaded in this page session.
const loadState = { roster: 'loading', matchups: 'loading' };
let saving = false;
let saveProblem = null; // what's blocking the last Save attempt, shown above the Save button
let leavingPage = false; // set once Logout is confirmed, so the unload prompt doesn't ask twice
const EDITOR_TABS = ['tab-roster', 'tab-drafting', 'tab-matchups', 'tab-potential'];

// payments_2027.sql's data (see "Payments" near the end). Each part's state is 'idle', 'loading', 'ok',
// 'missing' (the script hasn't run yet: "Being set up") or 'error'. These save right away through the
// admin-only functions, never with Save Changes.
const payData = {
    trip: { state: 'idle', rows: [], error: '', job: 0, reading: false },              // trip_payments, every year
    venmo: { state: 'idle', byPlayer: new Map(), error: '', job: 0, reading: false },  // player_venmo
    logins: { state: 'idle', byPlayer: new Map(), error: '', job: 0, reading: false }  // admin_roster_logins()
};
let rsvpLoading = false; // an RSVP load is running (it draws the table itself when it's done)
let rsvpLoaded = false;  // the RSVPs tab has loaded at least once

// Each sidebar section has an address (admin#rsvps), so a refresh or a bookmark opens it again
const TAB_NAMES = ['roster', 'rsvps', 'drafting', 'matchups', 'scores', 'score-entry', 'potential'];

// Links that go out to the guys (texts and emails), so always the live site, never this page's host
const SITE_URL = 'https://bros-before-boges.vercel.app';
const INVITE_URL = `${SITE_URL}/signup`;
const BOOKIE_URL = `${SITE_URL}/bookie`;

// Initial Load
function init() {
    console.log('Admin Dashboard initializing...');
    try {
        elements = {
            authScreen: document.getElementById('login-screen'),
            dashboard: document.getElementById('dashboard'),
            rosterTbody: document.getElementById('roster-tbody'),
            saveBar: document.getElementById('save-bar'),
            saveNote: document.getElementById('save-note'),
            loginBtn: document.getElementById('login-btn'),
            loginForm: document.getElementById('login-form'),
            loginFormWrap: document.getElementById('login-form-wrap'),
            loginHelp: document.getElementById('login-help'),
            loginDenied: document.getElementById('login-denied'),
            loginDeniedText: document.getElementById('login-denied-text'),
            deniedRetryBtn: document.getElementById('denied-retry-btn'),
            deniedLogoutBtn: document.getElementById('denied-logout-btn'),
            logoutBtn: document.getElementById('logout-btn'),
            loginError: document.getElementById('login-error'),
            emailInput: document.getElementById('email'),
            passwordInput: document.getElementById('password'),
            addPlayerBtn: document.getElementById('add-player-btn'),
            saveBtn: document.getElementById('save-btn'),
            discardBtn: document.getElementById('discard-btn'),
            autoDraftBtn: document.getElementById('auto-draft-btn'),
            team1List: document.getElementById('team1-list'),
            team2List: document.getElementById('team2-list'),
            draftingGrid: document.getElementById('drafting-grid'),
            draftingStatus: document.getElementById('drafting-status'),
            matchupsList: document.getElementById('matchups-list'),
            addMatchupBtn: document.getElementById('add-matchup-btn'),
            potentialList: document.getElementById('potential-list'),
            newPotentialName: document.getElementById('new-potential-name'),
            addPotentialBtn: document.getElementById('add-potential-btn')
        };

        renderMatchupRoundFilters();
        checkInitialAuth();
        setupEventListeners();
        console.log('Admin Dashboard ready.');
    } catch (err) {
        console.error('Admin Dashboard failed to initialize.', err);
    }
}

// Match an email literally in an ilike filter: % and _ are wildcards, so escape them.
// PostgREST turns * into %; escaping it too means an email with * simply never matches.
function escapeLike(value) {
    return String(value || '').replace(/[\\%_*]/g, '\\$&');
}

// supabase-js passes the browser's own network error through ("TypeError: Failed to fetch",
// or "Load failed" on an iPhone). Say what it means instead.
function plainError(err) {
    const text = (err && err.message) || String(err || 'Unknown error');
    return /failed to fetch|load failed|networkerror|network request failed/i.test(text)
        ? 'couldn’t reach the server. Check your connection.'
        : text;
}

// A database function that isn't there yet (its setup script hasn't run). Missing tables don't count:
// only this falls back to the old way of reading the roster.
const isMissingFunction = err => /PGRST202|could not find the function/i.test(`${err && err.code} ${err && err.message}`);

async function checkInitialAuth() {
    if (!supabaseInstance) {
        console.warn('Supabase not configured. Showing demo mode.');
        return;
    }

    showGoogleButtonsIfEnabled();
    try {
        const { data: { session } } = await supabaseInstance.auth.getSession();
        // Coming back from Google: the tokens are in the address bar; clear them
        if (/(^|[#&])(access_token|error)=/.test(window.location.hash)) history.replaceState(null, '', window.location.pathname);
        if (session) {
            await verifyAdminAndShowDashboard(session.user.email);
        }
    } catch (e) {
        console.error('Auth check failed:', e);
    }
}

// Google buttons only show when trip-config.js turns them on AND the Google provider
// is switched on in Supabase.
async function showGoogleButtonsIfEnabled() {
    const cfg = window.BBB || {};
    if (!(cfg.auth && cfg.auth.google)) return;
    try {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_KEY } });
        const settings = res.ok ? await res.json() : null;
        const on = !!(settings && settings.external && settings.external.google);
        document.querySelectorAll('[data-google-block]').forEach(el => { el.hidden = !on; });
    } catch (e) { /* offline or blocked: email login still works */ }
}

async function signInWithGoogle() {
    const redirectTo = window.location.origin + window.location.pathname;
    const { error } = await supabaseInstance.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
    if (error) window.showToast('Google sign-in didn’t start: ' + escHtml(error.message), 'error');
}

// fromForm: the check follows a Log in press, so focus moves to the next thing to press
async function verifyAdminAndShowDashboard(email, fromForm = false) {
    let ok = false;
    let error = null;
    try {
        // The database's own rule (is_trip_admin: an admin roster row with this login's email, even
        // if a second, non-admin row has the same email), so Admin opens exactly when the database
        // will take its saves. It reads the email from the login itself; `email` is for the messages.
        const res = await supabaseInstance.rpc('is_trip_admin');
        if (res.error && isMissingFunction(res.error)) ({ ok, error } = await legacyIsAdmin(email));
        else { error = res.error; ok = res.data === true; }
    } catch (e) {
        error = e;
    }

    // Either way he stays on the login screen. No automatic sign-out: that would also end
    // this player's Round Tracker / Bookie session on the same phone.
    if (error) {
        console.error('Admin verification failed:', error);
        showAccessProblem(email, 'error', plainError(error), fromForm);
        return false;
    }
    if (!ok) {
        showAccessProblem(email, 'denied', '', fromForm);
        return false;
    }
    showDashboard();
    return true;
}

// Only while is_trip_admin is missing (never live: rsvp_accounts.sql made it; the plain test fake
// lacks it): the old query, which finds an admin row by email
async function legacyIsAdmin(email) {
    try {
        const { data, error } = await supabaseInstance.from('players').select('is_admin')
            .ilike('email', escapeLike(email)).eq('is_admin', true).limit(1);
        return { ok: !!(data && data.length), error };
    } catch (e) {
        return { ok: false, error: e };
    }
}

let deniedEmail = '';

// "Logged in, but not as an admin" (or the check didn't go through), in place of the form
function showAccessProblem(email, kind, detail, fromForm) {
    deniedEmail = email || '';
    const who = `<b>${escHtml(email || 'an account with no email')}</b>`;
    if (elements.loginDeniedText) {
        elements.loginDeniedText.innerHTML = kind === 'denied'
            ? `You’re logged in as ${who}, but that login isn’t an admin. Ask Jeff to add this email to your roster row.`
            : `You’re logged in as ${who}, but the admin check didn’t go through: ${escHtml(detail)}`;
    }
    if (elements.deniedRetryBtn) elements.deniedRetryBtn.hidden = kind === 'denied';
    if (elements.loginFormWrap) elements.loginFormWrap.hidden = true;
    if (elements.loginHelp) elements.loginHelp.hidden = true;
    if (elements.loginDenied) elements.loginDenied.hidden = false;
    if (fromForm) {
        const next = kind === 'denied' ? elements.deniedLogoutBtn : elements.deniedRetryBtn;
        if (next) next.focus();
    }
}

function showLoginForm() {
    if (elements.loginDenied) elements.loginDenied.hidden = true;
    if (elements.loginFormWrap) elements.loginFormWrap.hidden = false;
    if (elements.loginHelp) elements.loginHelp.hidden = false;
}

function showLoginError(text) {
    if (!elements.loginError) return;
    elements.loginError.textContent = text || '';
    elements.loginError.hidden = !text;
}

// The same wording the Bookie uses for the same login
function friendlyLoginError(err) {
    const msg = (err && err.message) || String(err || '');
    if (/invalid login credentials/i.test(msg)) return 'That email and password don’t match. Try again, or tap “Forgot password?”.';
    if (/email not confirmed/i.test(msg)) return 'Confirm your email first: open the link we sent you, then log in here.';
    if (/failed to fetch|load failed|networkerror|network request failed/i.test(msg)) return 'Couldn’t reach the server. Check your connection and try again.';
    if (/rate limit|too many/i.test(msg)) return 'Too many tries in a row. Wait a minute, then try again.';
    return msg || 'Something went wrong. Try again.';
}

function setupEventListeners() {
    // Login: a real form, so Enter (or Go on a phone keyboard) logs in
    if (elements.loginForm) {
        elements.loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            handleLogin();
        });
    }
    // A password reset brings him back to the tab he opened (the Bookie keeps &tab= through the reset)
    const forgot = document.getElementById('admin-forgot-link');
    if (forgot) {
        forgot.addEventListener('click', () => {
            const tab = tabFromHash();
            forgot.href = `bookie.html?next=admin&mode=login${tab ? `&tab=${tab}` : ''}`;
        });
    }
    // The email field's phone key says Next: with the password still empty it moves there,
    // instead of submitting and showing "Enter your password." (Enter with both filled still logs in)
    elements.emailInput?.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.isComposing || !elements.passwordInput) return;
        if (!elements.emailInput.value.trim() || elements.passwordInput.value) return;
        e.preventDefault();
        showLoginError('');
        elements.passwordInput.focus();
    });

    if (elements.logoutBtn) {
        elements.logoutBtn.addEventListener('click', handleLogout);
    }
    elements.deniedLogoutBtn?.addEventListener('click', logOutOfDeniedLogin);
    elements.deniedRetryBtn?.addEventListener('click', async () => {
        const btn = elements.deniedRetryBtn;
        btn.disabled = true;
        const ok = await verifyAdminAndShowDashboard(deniedEmail);
        btn.disabled = false;
        // Still not in: keep focus here (it was on this button, which was off during the check)
        if (!ok) (btn.hidden ? elements.deniedLogoutBtn : btn).focus();
    });
    document.getElementById('admin-google-btn')?.addEventListener('click', signInWithGoogle);

    // RSVPs tab
    document.getElementById('rsvp-refresh-btn')?.addEventListener('click', loadRsvpAdmin);
    document.getElementById('rsvp-export-btn')?.addEventListener('click', exportRsvpCsv);
    document.getElementById('rsvp-invite-btn')?.addEventListener('click', copyInviteLink);
    document.getElementById('rsvp-reminder-btn')?.addEventListener('click', copyRsvpReminder);
    document.getElementById('rsvp-filters')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-rsvp-filter]');
        if (!btn) return;
        rsvpFilter = btn.dataset.rsvpFilter;
        renderRsvpAdmin();
    });
    document.getElementById('rsvp-admin-tbody')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-approve]');
        if (btn) approvePlayer(btn.dataset.approve, btn);
        const release = e.target.closest('[data-release]');
        if (release) releaseClaim(release.dataset.release, release);
        const paid = e.target.closest('[data-pay]');
        if (paid) openPaySheet(paid.dataset.pay, paid);
    });
    setupPaymentListeners();
    document.getElementById('rsvp-approved')?.addEventListener('click', (e) => {
        const dismiss = e.target.closest('[data-dismiss-approved]');
        if (dismiss) {
            rsvpJustApproved = rsvpJustApproved.filter(a => a.id !== dismiss.dataset.dismissApproved);
            renderApprovedNotes();
            const tab = document.getElementById('tab-rsvps');
            const heading = tab && tab.querySelector('h2');
            if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus(); }
            return;
        }
        const copy = e.target.closest('[data-copy-approval]');
        if (copy) shareOrCopy({ text: approvalMessage() }, 'Note copied. Text it to him.');
    });

    // Sidebar sections follow the address: #rsvps, #score-entry…
    window.addEventListener('hashchange', () => {
        const tab = tabFromHash();
        if (tab && elements.dashboard && elements.dashboard.classList.contains('active')) openTab(tab, { fromHash: true });
    });

    // Roster "…" menus: one open at a time; a click elsewhere or Escape closes it
    document.addEventListener('click', (e) => {
        document.querySelectorAll('details.row-menu[open]').forEach(d => { if (!d.contains(e.target)) d.open = false; });
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const open = document.querySelector('details.row-menu[open]');
        if (!open) return;
        open.open = false;
        open.querySelector('summary').focus();
    });

    // Add Player Button
    if (elements.addPlayerBtn) {
        elements.addPlayerBtn.addEventListener('click', () => {
            addNewPlayer();
        });
    }

    // Save/Discard
    if (elements.saveBtn) {
        elements.saveBtn.addEventListener('click', saveChanges);
    }
    if (elements.discardBtn) {
        elements.discardBtn.addEventListener('click', discardChanges);
    }

    // Retry buttons appear wherever a failed load would have shown data (and in the save bar)
    document.addEventListener('click', (e) => {
        if (e.target.closest('[data-retry-load]')) retryLoads();
        const show = e.target.closest('[data-show-matchup]');
        if (show) showMatchup(Number(show.dataset.showMatchup));
    });

    // Closing or reloading the tab with unsaved roster/team/matchup edits asks first
    window.addEventListener('beforeunload', (e) => {
        if (!hasChanges || leavingPage) return;
        e.preventDefault();
        e.returnValue = '';
    });

    // Table Interaction (Event Delegation)
    if (elements.rosterTbody) {
        elements.rosterTbody.addEventListener('input', (e) => {
            if (e.target.classList.contains('edit-input')) {
                const index = e.target.closest('tr').dataset.index;
                const field = e.target.dataset.field;
                updatePlayerData(index, field, e.target.value);
            }
        });

        elements.rosterTbody.addEventListener('click', (e) => {
            const btn = e.target.closest('.remove-player-btn');
            if (!btn) return;
            const row = btn.closest('tr');
            const at = [...elements.rosterTbody.querySelectorAll('tr[data-index]')].indexOf(row);
            if (!removePlayer(row.dataset.index)) {
                const menu = btn.closest('details');
                if (menu) { menu.open = false; menu.querySelector('summary').focus(); }
                return;
            }
            // The row is gone: focus the "…" of the row that took its place (or the one above)
            const rows = elements.rosterTbody.querySelectorAll('tr[data-index]');
            const next = rows[Math.min(at, rows.length - 1)];
            const target = next ? next.querySelector('.row-menu summary') : document.querySelector('#tab-roster h2');
            if (target && target.tagName === 'H2') target.setAttribute('tabindex', '-1');
            if (target) target.focus();
        });
    }

    // Tab switching
    document.querySelectorAll('.sidebar-item').forEach(item => {
        item.addEventListener('click', () => openTab(item.dataset.tab));
    });

    if (elements.autoDraftBtn) {
        elements.autoDraftBtn.addEventListener('click', autoDraft);
    }


    if (elements.addMatchupBtn) {
        elements.addMatchupBtn.addEventListener('click', addMatchup);
    }
    // The round filter is drawn from trip-config.js (renderMatchupRoundFilters): one listener serves every button
    document.getElementById('matchup-round-filters')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-round]');
        if (btn) window.filterMatchupRound(Number(btn.dataset.round));
    });

    if (elements.addPotentialBtn) {
        elements.addPotentialBtn.addEventListener('click', addPotentialPlayer);
    }

    // Add Player Modal wiring
    const modal = document.getElementById('add-player-modal');
    document.getElementById('modal-cancel-btn').addEventListener('click', closeAddPlayerModal);
    document.getElementById('modal-save-btn').addEventListener('click', saveNewPlayer);
    // Close on overlay click (outside the box)
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeAddPlayerModal();
    });
    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('open')) closeAddPlayerModal();
    });

    // Enter key to submit in modal
    modal.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
            e.preventDefault();
            saveNewPlayer();
        }
    });
}

let loggingIn = false;

async function handleLogin() {
    if (loggingIn) return;
    const email = elements.emailInput ? elements.emailInput.value.trim() : '';
    const password = elements.passwordInput ? elements.passwordInput.value : '';

    showLoginError('');
    if (!email || !password) {
        showLoginError(!email && !password ? 'Enter your email and password.' : !email ? 'Enter your email.' : 'Enter your password.');
        const missing = email ? elements.passwordInput : elements.emailInput;
        if (missing) missing.focus();
        return;
    }

    if (!supabaseInstance) {
        // DEMO BYPASS
        if (email === 'admin' && password === 'admin') {
            console.log('Demo login successful.');
            showDashboard();
            return;
        }
        showLoginError('The database isn’t set up on this copy of the site. Use admin / admin for the demo.');
        return;
    }

    loggingIn = true;
    if (elements.loginBtn) {
        elements.loginBtn.disabled = true;
        elements.loginBtn.textContent = 'Logging in…';
    }
    try {
        const { data, error } = await supabaseInstance.auth.signInWithPassword({ email, password });
        if (error) {
            showLoginError(friendlyLoginError(error));
            if (elements.passwordInput && /invalid login credentials/i.test(error.message || '')) {
                elements.passwordInput.focus();
                elements.passwordInput.select();
            }
        } else {
            await verifyAdminAndShowDashboard((data && data.user && data.user.email) || email, true);
        }
    } catch (err) {
        console.error('Login error:', err);
        showLoginError(friendlyLoginError(err));
    } finally {
        loggingIn = false;
        if (elements.loginBtn) {
            elements.loginBtn.disabled = false;
            elements.loginBtn.textContent = 'Log in';
        }
    }
}

// Logged in, but not as an admin: log out here (this device only) to try another login
async function logOutOfDeniedLogin() {
    if (supabaseInstance) {
        try {
            await supabaseInstance.auth.signOut({ scope: 'local' });
        } catch (e) {
            console.error('Sign-out failed:', e);
        }
    }
    deniedEmail = '';
    if (elements.passwordInput) elements.passwordInput.value = '';
    showLoginError('');
    showLoginForm();
    if (elements.emailInput) elements.emailInput.focus();
}

// This device only, like the Bookie and the homepage: a global sign-out would also end this
// person's Round Tracker and Bookie sessions on his phone, maybe mid-round
async function handleLogout() {
    if (hasChanges && !confirm('You have unsaved changes. Log out anyway?')) return;
    leavingPage = true;
    if (supabaseInstance) {
        try {
            await supabaseInstance.auth.signOut({ scope: 'local' });
        } catch (e) {
            console.error('Sign-out failed:', e);
        }
    }
    location.reload();
}

function showDashboard() {
    if (elements.authScreen) elements.authScreen.style.display = 'none';
    if (elements.dashboard) elements.dashboard.classList.add('active');
    if (elements.logoutBtn) elements.logoutBtn.hidden = false;
    renderSaveBar(); // the add buttons stay off until the roster is in
    loadRoster();
    loadMatchups();
    loadPaymentExtras(); // Venmo usernames, trip payments, who's signed in as each name
    // admin#rsvps, admin#score-entry…: open the section the address names
    const tab = tabFromHash();
    if (tab) openTab(tab, { fromHash: true });
}

function tabFromHash() {
    let name = '';
    try {
        name = decodeURIComponent((window.location.hash || '').replace(/^#/, '')).trim().toLowerCase();
    } catch (e) { /* a malformed hash names no tab */ }
    return TAB_NAMES.includes(name) ? name : null;
}

// Show one sidebar section. A click also puts it in the address (replaceState, so Back still
// leaves Admin instead of stepping through tabs).
function openTab(tab, { fromHash = false } = {}) {
    const item = document.querySelector(`.sidebar-item[data-tab="${tab}"]`);
    if (!item) return;
    document.querySelectorAll('.sidebar-item').forEach(i => {
        i.classList.remove('active');
        i.removeAttribute('aria-current');
    });
    document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');

    item.classList.add('active');
    item.setAttribute('aria-current', 'true');
    const targetTab = document.getElementById(`tab-${tab}`);
    if (targetTab) targetTab.style.display = 'block';

    if (!fromHash && window.location.hash !== `#${tab}`) {
        try { history.replaceState(history.state, '', `#${tab}`); } catch (e) { /* sandboxed: the tab still opens */ }
    }
    // On a phone the sidebar is a sideways strip: bring the open section into view
    if (fromHash && item.scrollIntoView) item.scrollIntoView({ block: 'nearest', inline: 'nearest' });

    if (tab === 'drafting') renderDraftingUI();
    if (tab === 'matchups') renderMatchupsUI();
    if (tab === 'scores') renderScoresUI();
    if (tab === 'score-entry') renderScoreEntryUI();
    if (tab === 'potential') renderPotentialUI();
    if (tab === 'rsvps') loadRsvpAdmin();
}

async function loadRoster() {
    if (supabaseInstance) {
        try {
            // Every row and column, ordered by status ('confirmed' before 'potential', so real
            // players always load), then name
            const { data, error } = await loadAdminRoster();

            if (error || !data) throw error || new Error('No roster data came back.');
            players = JSON.parse(JSON.stringify(data)); // Deep copy
            originalPlayers = JSON.parse(JSON.stringify(data));
            loadState.roster = 'ok';
        } catch (e) {
            // The tabs show the error instead of an empty list, and Save stays off
            console.error('Roster load failed:', e);
            loadState.roster = 'error';
        }
    } else {
        // Fallback to demo data
        const demoData = [
            { name: "Colby Gibson", ghin: "2360395", handicap: 5.0, status: "confirmed" },
            { name: "Westin Tucker", ghin: "Missing", handicap: 5.6, status: "confirmed" },
            { name: "Jeff Tarlton", ghin: "2360395", handicap: 9.0, status: "confirmed" }
        ];
        players = JSON.parse(JSON.stringify(demoData));
        originalPlayers = JSON.parse(JSON.stringify(demoData));
        loadState.roster = 'ok';
    }
    renderAllTabs();
}

// ---- Emails and GHINs (privacy_2027.sql) ----
// Once that script has run, nobody can read players.email or players.ghin from the table, admins
// included: Admin reads the roster through admin_players(), which only admins can call. Until it
// has run, the table is read directly and the Roster tab says so (the owner's go-signal).
let privacyPending = false; // true while privacy_2027.sql hasn't run (admin_players missing)
const PRIVACY_PENDING_TEXT = 'Email and GHIN privacy isn’t switched on yet: run privacy_2027.sql in the Supabase SQL Editor. Admin works the same either way.';

// The whole roster with emails and GHINs: admin_players (privacy_2027.sql), or the table until it
// has run. Asked fresh each time, so an open page switches over the moment the script runs.
async function loadAdminRoster() {
    const res = await supabaseInstance.rpc('admin_players');
    if (res.error && isMissingFunction(res.error)) {
        privacyPending = true;
        renderPrivacyNote();
        return legacyAdminRoster();
    }
    if (!res.error) {
        privacyPending = false;
        renderPrivacyNote();
    }
    return { data: res.data, error: res.error };
}

// Only while admin_players is missing: the old read of the table
async function legacyAdminRoster() {
    return supabaseInstance.from('players').select('*').order('status').order('name');
}

// One line above the roster while privacy_2027.sql hasn't run (created here: no admin.html change)
function renderPrivacyNote() {
    let el = document.getElementById('roster-privacy-note');
    if (!el) {
        const anchor = document.getElementById('roster-pay-note');
        if (!anchor || !anchor.parentNode) return;
        el = document.createElement('div');
        el.className = 'setup-note';
        el.id = 'roster-privacy-note';
        anchor.parentNode.insertBefore(el, anchor);
    }
    el.textContent = privacyPending ? PRIVACY_PENDING_TEXT : '';
    el.hidden = !privacyPending;
}

async function loadMatchups() {
    if (supabaseInstance) {
        try {
            const { data, error } = await supabaseInstance
                .from('matchups')
                .select('*');

            if (error || !data) throw error || new Error('No matchups data came back.');
            // Same order as the Round Tracker, so Match 3 here is Match 3 on the course
            const ordered = window.BBBScoring ? window.BBBScoring.sortMatchups(data) : data;
            matchups = JSON.parse(JSON.stringify(ordered));
            originalMatchups = JSON.parse(JSON.stringify(ordered));
            loadState.matchups = 'ok';
        } catch (e) {
            console.error('Matchups load failed:', e);
            loadState.matchups = 'error';
        }
    } else {
        loadState.matchups = 'ok';
    }
    renderMatchupRoundFilters(); // a stored round that isn't a Cup round gets its own button
    renderMatchupsUI();
    checkChanges();
}

function renderAllTabs() {
    renderRosterTable();
    renderDraftingUI();
    renderMatchupsUI();
    renderPotentialUI();
    checkChanges();
}

const LOAD_NAMES = { roster: 'the roster', matchups: 'matchups' };

// What a tab shows instead of its data while a load it needs is running or has failed
function loadProblem(needs) {
    const failed = needs.filter(k => loadState[k] === 'error');
    if (failed.length) return { error: true, text: `Couldn’t load ${failed.map(k => LOAD_NAMES[k]).join(' or ')}. Check your connection.` };
    const loading = needs.filter(k => loadState[k] === 'loading');
    if (loading.length) return { error: false, text: `Loading ${loading.map(k => LOAD_NAMES[k]).join(' and ')}…` };
    return null;
}

function loadProblemHtml(problem) {
    return `<div class="load-problem${problem.error ? ' is-error' : ''}" role="${problem.error ? 'alert' : 'status'}">
        <span>${problem.text}</span>
        ${problem.error ? '<button type="button" class="admin-btn secondary" data-retry-load>Retry</button>' : ''}
    </div>`;
}

const canSave = () => loadState.roster === 'ok' && loadState.matchups === 'ok';

// While a save runs, the lists it's writing can't be edited: an edit made then would be
// neither saved nor kept once the page reloads what's stored
function setSaving(on) {
    saving = on;
    EDITOR_TABS.forEach(id => {
        const tab = document.getElementById(id);
        if (tab) tab.inert = on;
    });
    renderSaveBar();
}

// Re-run only the loads that failed, so edits to the dataset that did load survive
async function retryLoads() {
    const focused = document.activeElement && document.activeElement.closest('[data-retry-load]');
    const fromSaveBar = !!(focused && focused.closest('#save-bar'));
    const jobs = [];
    if (loadState.roster === 'error') { loadState.roster = 'loading'; jobs.push(loadRoster); }
    if (loadState.matchups === 'error') { loadState.matchups = 'loading'; jobs.push(loadMatchups); }
    if (!jobs.length) return;
    renderAllTabs();
    await Promise.all(jobs.map(load => load()));
    if (!focused) return;
    // The Retry that had focus was re-drawn: focus the new Retry if it failed again, otherwise
    // Save (from the save bar) or the open tab's heading
    const scope = fromSaveBar ? elements.saveBar : [...document.querySelectorAll('.tab-content')].find(t => t.style.display !== 'none');
    if (!scope) return;
    const target = scope.querySelector('[data-retry-load]') || (fromSaveBar ? elements.saveBtn : scope.querySelector('h2'));
    if (target && target.tagName === 'H2') target.setAttribute('tabindex', '-1');
    if (target) target.focus();
}



function renderRosterTable() {
    if (!elements.rosterTbody) return;

    const problem = loadProblem(['roster']);
    if (problem) {
        elements.rosterTbody.innerHTML = `<tr><td colspan="7" class="load-cell">${loadProblemHtml(problem)}</td></tr>`;
        return;
    }

    const confirmedPlayers = players.filter(p => p.status !== 'potential');

    if (confirmedPlayers.length === 0) {
        elements.rosterTbody.innerHTML = `<tr><td colspan="7" class="load-cell" style="text-align: center; color: rgba(255,255,255,0.3); padding: 50px;">No confirmed players found.</td></tr>`;
        return;
    }

    elements.rosterTbody.innerHTML = confirmedPlayers.map((player) => {
        // Find actual index in main array
        const realIndex = players.indexOf(player);
        // Names the boxes for screen readers ("Colby Gibson email"); data-label is only CSS
        const who = escHtml(player.name || 'New player');
        return `
        <tr data-index="${realIndex}">
            <td data-label="Name"><input type="text" class="edit-input" data-field="name" value="${escHtml(player.name || '')}" placeholder="Name" aria-label="${who} name"></td>
            <td data-label="Email"><input type="email" class="edit-input" data-field="email" value="${escHtml(player.email || '')}" placeholder="Email" aria-label="${who} email"></td>
            <td data-label="GHIN"><input type="text" class="edit-input" data-field="ghin" value="${escHtml(player.ghin || '')}" placeholder="GHIN" aria-label="${who} GHIN"></td>
            <td data-label="Handicap"><input type="number" step="0.1" class="edit-input" data-field="handicap" value="${escHtml(player.handicap !== null ? player.handicap : 0)}" placeholder="HCP" aria-label="${who} handicap"></td>
            <td data-label="Venmo" data-venmo-cell>${venmoCellHtml(player)}</td>
            <td data-label="Status"><span class="status-badge status-confirmed">${escHtml(player.status || 'confirmed')}</span></td>
            <td data-label="Actions">
                <details class="row-menu">
                    <summary aria-label="More for ${who}">…</summary>
                    <div class="row-menu-pop">
                        <button type="button" class="remove-player-btn">Delete player<span class="sr-only"> ${who}</span></button>
                    </div>
                </details>
            </td>
        </tr>
    `}).join('');
}

function updatePlayerData(index, field, value) {
    if (field === 'handicap') {
        players[index][field] = value === '' ? null : parseFloat(value);
    } else {
        players[index][field] = value;
    }
    checkChanges();
}

function addNewPlayer() {
    // Off until the roster loads: otherwise there's no way to see whether he went in
    if (supabaseInstance && loadState.roster !== 'ok') return;
    // Clear previous values & errors
    document.getElementById('modal-name').value = '';
    document.getElementById('modal-email').value = '';
    document.getElementById('modal-ghin').value = '';
    document.getElementById('modal-handicap').value = '';
    const errEl = document.getElementById('modal-error');
    errEl.style.display = 'none';
    errEl.textContent = '';
    document.getElementById('modal-save-btn').disabled = false;
    document.getElementById('modal-save-btn').textContent = 'Save Player';
    // Open the modal
    document.getElementById('add-player-modal').classList.add('open');
    setTimeout(() => document.getElementById('modal-name').focus(), 50);
}

function closeAddPlayerModal() {
    document.getElementById('add-player-modal').classList.remove('open');
}

async function saveNewPlayer() {
    const name = document.getElementById('modal-name').value.trim();
    const email = document.getElementById('modal-email').value.trim();
    const ghin = document.getElementById('modal-ghin').value.trim();
    const handicapRaw = document.getElementById('modal-handicap').value.trim();
    const handicap = handicapRaw === '' ? null : parseFloat(handicapRaw);
    const errEl = document.getElementById('modal-error');
    const saveBtn = document.getElementById('modal-save-btn');

    if (!name) {
        errEl.textContent = 'Full name is required.';
        errEl.style.display = 'block';
        return;
    }

    errEl.style.display = 'none';
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    const newPlayer = {
        name,
        email: email || null,
        ghin: ghin || null,
        handicap,
        status: 'confirmed'
    };

    if (supabaseInstance) {
        // Only the public columns come back: email and GHIN can't be read from the table once
        // privacy_2027.sql has run, and asking for them would refuse the whole insert
        const { data, error } = await supabaseInstance
            .from('players')
            .insert([newPlayer])
            .select('id, name, handicap, team_id, status, user_id');

        if (error) {
            errEl.textContent = 'Error saving: ' + plainError(error);
            errEl.style.display = 'block';
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Player';
            return;
        }

        closeAddPlayerModal();
        // Said now, so a roster reload that fails below can't leave it in doubt
        window.showToast(`${escHtml(name)} is on the roster.`, 'success');
        if (hasChanges && loadState.roster === 'ok' && data && data[0]) {
            // A reload would throw away the unsaved edits: add him to both copies instead. Email and
            // GHIN are what was just typed (they can't be read back from the table).
            const row = Object.assign({}, newPlayer, data[0]);
            players.push(JSON.parse(JSON.stringify(row)));
            originalPlayers.push(JSON.parse(JSON.stringify(row)));
            renderAllTabs();
        } else {
            // Refresh the live roster from DB
            await loadRoster();
        }
    } else {
        // Demo mode — add to local state only
        players.push(newPlayer);
        closeAddPlayerModal();
        renderRosterTable();
        checkChanges();
    }
}

// What deleting him really does, said before anything is marked (the Bookie bet count is
// checked again when Save runs)
function deletePlayerQuestion(p) {
    const name = p.name || 'this player';
    if (!p.id) return `Remove ${name}? He was only added on this page and hasn’t been saved yet.`;
    const after = '\n\nNothing is deleted until you press Save Changes.';
    if (p.status === 'potential') {
        return `Delete ${name} from the site for good? His login is unlinked and his RSVPs show as 'not on roster'.\n\n` +
            `Not coming this year? Leave him here: he stays off the head count until you approve him.${after}`;
    }
    return `Delete ${name} from the site for good? His login is unlinked, his RSVPs show as 'not on roster', and bets he created are deleted.\n\n` +
        `Skipping a year? Keep him: his 'Out' RSVP keeps him off the head count.${after}`;
}

// Marks him for deletion (written on Save). Returns whether he was marked.
function removePlayer(index) {
    const p = players[index];
    // The database keeps trip payments: a player who has any can't be deleted (payments_2027.sql)
    if (p && tripPaymentsBlockRemoval(p)) return false;
    if (!p || !confirm(deletePlayerQuestion(p))) return false;
    players.splice(index, 1);
    renderRosterTable();
    renderPotentialUI(); // Just in case
    checkChanges();
    return true;
}

function checkChanges() {
    const current = JSON.stringify({ players, matchups });
    const original = JSON.stringify({ players: originalPlayers, matchups: originalMatchups });

    hasChanges = current !== original;

    // A blocked save's message follows the edits: it updates as matches are fixed and goes
    // once nothing blocks the save (or nothing is left to save)
    if (saveProblem) saveProblem = hasChanges ? findSaveProblem() : null;
    renderSaveBar();
    markMatchupProblems();
}

function renderSaveBar() {
    if (elements.saveBar) {
        elements.saveBar.style.display = hasChanges ? 'flex' : 'none';
    }
    if (elements.saveBtn) {
        elements.saveBtn.disabled = saving || !canSave();
        elements.saveBtn.textContent = saving ? 'Saving…' : 'Save Changes';
    }
    if (elements.discardBtn) elements.discardBtn.disabled = saving;
    // Lists can't be added to while the data they belong to is missing
    if (elements.addMatchupBtn) elements.addMatchupBtn.disabled = !canSave();
    ['autoDraftBtn', 'addPotentialBtn', 'addPlayerBtn'].forEach(key => {
        if (elements[key]) elements[key].disabled = loadState.roster !== 'ok';
    });

    const note = elements.saveNote;
    if (!note) return;
    let html = '';
    let waiting = false; // still loading: a plain notice, not an alarm
    if (!canSave()) {
        const problem = loadProblem(['roster', 'matchups']);
        waiting = !(problem && problem.error);
        html = !waiting
            ? `<span>${problem.text} Saving is off until it loads, so nothing gets overwritten.</span><button type="button" class="admin-btn secondary" data-retry-load>Retry</button>`
            : '<span>Still loading. Save turns on once the roster and matchups are in.</span>';
    } else if (saveProblem) {
        const more = saveProblem.count > 1 ? ` (${saveProblem.count - 1} more to fix after this.)` : '';
        html = `<span>${escHtml(saveProblem.text)}${more}</span>` +
            (saveProblem.index !== undefined ? `<button type="button" class="admin-btn secondary" data-show-matchup="${saveProblem.index}">Show match</button>` : '');
    }
    note.classList.toggle('is-info', waiting);
    const role = waiting ? 'status' : 'alert';
    if (note.getAttribute('role') !== role) note.setAttribute('role', role);
    // Only touch the note when its text changes, so screen readers don't re-announce it
    if (note.dataset.html !== html) {
        note.dataset.html = html;
        note.innerHTML = html;
    }
    note.hidden = !html;
    // Room to scroll the last rows out from under the floating bar
    document.body.style.paddingBottom = hasChanges && elements.saveBar ? `${elements.saveBar.offsetHeight + 30}px` : '';
}

function renderDraftingUI() {
    if (!elements.team1List || !elements.team2List) return;

    elements.team1List.innerHTML = '';
    elements.team2List.innerHTML = '';

    // A failed load would otherwise look like two empty teams
    const problem = loadProblem(['roster']);
    if (elements.draftingStatus) elements.draftingStatus.innerHTML = problem ? loadProblemHtml(problem) : '';
    if (elements.draftingGrid) elements.draftingGrid.style.display = problem ? 'none' : 'grid';
    if (problem) return;

    const draftablePlayers = players.filter(p => p.status !== 'potential');

    const renderPlayerItem = (p, currentTeam) => {
        const div = document.createElement('div');
        div.style = "display: flex; justify-content: space-between; align-items: center; padding: 10px 15px; background: rgba(255,255,255,0.05); border-radius: 8px; border: 1px solid rgba(255,255,255,0.1);";
        div.innerHTML = `
            <div>
                <div style="font-weight: 600; font-size: 0.9rem;">${escHtml(p.name || 'Unnamed')}</div>
                <div style="font-size: 0.75rem; color: var(--admin-accent);">HCP: ${p.handicap !== null ? p.handicap : 'N/A'}</div>
            </div>
            <div style="display: flex; gap: 5px;">
                ${currentTeam !== 1 ? `<button class="admin-btn" style="width: auto; padding: 4px 8px; font-size: 0.7rem; margin: 0;" data-name="${escHtml(p.name)}" onclick="moveToTeam(this.dataset.name, 1)">To T1</button>` : ''}
                ${currentTeam !== 2 ? `<button class="admin-btn" style="width: auto; padding: 4px 8px; font-size: 0.7rem; margin: 0; background: #ef4444;" data-name="${escHtml(p.name)}" onclick="moveToTeam(this.dataset.name, 2)">To T2</button>` : ''}
                ${currentTeam !== null ? `<button class="admin-btn secondary" style="width: auto; padding: 4px 8px; font-size: 0.7rem; margin: 0;" data-name="${escHtml(p.name)}" onclick="moveToTeam(this.dataset.name, null)">Clear</button>` : ''}
            </div>
        `;
        return div;
    };

    draftablePlayers.forEach(p => {
        if (p.team_id === 1) elements.team1List.appendChild(renderPlayerItem(p, 1));
        else if (p.team_id === 2) elements.team2List.appendChild(renderPlayerItem(p, 2));
        else {
            elements.team1List.appendChild(renderPlayerItem(p, null));
            elements.team2List.appendChild(renderPlayerItem(p, null));
        }
    });
}

// Global exposure for drafting buttons
window.moveToTeam = (playerName, teamId) => {
    const player = players.find(p => p.name === playerName);
    if (player) {
        player.team_id = teamId;
        renderDraftingUI();
        checkChanges();
    }
};

function autoDraft() {
    if (!confirm('This will automatically assign all players with handicaps to teams using a Snake Draft (1, 3, 6) logic. Existing team assignments will be overwritten for these players. Continue?')) return;

    // Filter and sort by handicap
    const squad = players
        .filter(p => p.handicap !== null && p.status !== 'potential')
        .sort((a, b) => a.handicap - b.handicap);

    squad.forEach((player, index) => {
        const rank = index + 1;
        if (rank % 4 === 1 || rank % 4 === 0) {
            player.team_id = 1;
        } else {
            player.team_id = 2;
        }
    });

    renderDraftingUI();
    checkChanges();
    window.showToast('Auto-draft complete! Inspect the teams and click "Save Changes" to commit.', 'success');
}

// Matchups Logic
// The round filter: the Cup rounds (adminCupRounds), then any round a stored match has that isn't
// one, e.g. "Round 4 · not on the schedule" left from an older schedule, so it can be found and
// removed. Drawn at start-up and after each load, so a round emptied by Save loses its button then.
function renderMatchupRoundFilters() {
    const cup = adminCupRounds();
    const stray = [...new Set(matchups.map(m => m && m.round_number).filter(n => Number.isInteger(n) && !cup.includes(n)))].sort((a, b) => a - b);
    const rounds = cup.concat(stray);
    if (!rounds.includes(currentMatchupRound)) currentMatchupRound = cup[0];
    const wrap = document.getElementById('matchup-round-filters');
    if (!wrap) return;
    wrap.innerHTML = rounds.map(n => {
        const on = n === currentMatchupRound;
        const stale = !cup.includes(n);
        const label = stale ? `Round ${n} · not on the schedule` : `Round ${n}`;
        // Looks (pill, picked, stale) live in admin.html under #matchup-round-filters
        return `<button type="button" class="filter-btn${stale ? ' stale' : ''}${on ? ' active' : ''}" data-round="${n}" aria-pressed="${on}">${label}</button>`;
    }).join('\n');
}

window.filterMatchupRound = (roundNum) => {
    currentMatchupRound = Number(roundNum);
    document.querySelectorAll('#matchup-round-filters .filter-btn').forEach(btn => {
        const on = Number(btn.dataset.round) === currentMatchupRound;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', String(on));
    });
    renderMatchupsUI();
};

function renderMatchupsUI() {
    if (!elements.matchupsList) return;
    elements.matchupsList.innerHTML = '';

    const problem = loadProblem(['roster', 'matchups']);
    if (problem) {
        elements.matchupsList.innerHTML = loadProblemHtml(problem);
        return;
    }

    if (players.length === 0) {
        elements.matchupsList.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 40px;">Load players and assign teams first.</p>';
        return;
    }

    const roundMatchups = matchups.filter(m => m.round_number === currentMatchupRound);

    const assignedInRound = new Set();
    roundMatchups.forEach(m => {
        if (m.t1_player1_id) assignedInRound.add(m.t1_player1_id);
        if (m.t1_player2_id) assignedInRound.add(m.t1_player2_id);
        if (m.t2_player1_id) assignedInRound.add(m.t2_player1_id);
        if (m.t2_player2_id) assignedInRound.add(m.t2_player2_id);
    });

    // A pick missing from the team's list still shows, so it can be seen and cleared with "Select…"
    const strayLabel = ref => {
        const p = players.find(x => (x.id || x.name) === ref);
        if (p) return `${p.name} (${p.team_id ? `now Team ${p.team_id}` : 'no team now'})`;
        const removed = originalPlayers.find(x => x.id === ref);
        return removed ? `${removed.name} (off roster)` : 'Player not on the roster';
    };

    const getOptions = (teamId, currentVal) => {
        const team = players.filter(p => p.team_id === teamId);
        const stray = currentVal && !team.some(p => (p.id || p.name) === currentVal)
            ? `<option value="${escHtml(currentVal)}" selected>${escHtml(strayLabel(currentVal))}</option>`
            : '';
        return stray + team.map(p => {
            const pId = p.id || p.name;
            const isAssigned = assignedInRound.has(pId);
            const isCurrent = (pId === currentVal);
            if (!isAssigned || isCurrent) {
                return `<option value="${escHtml(pId)}" ${isCurrent ? 'selected' : ''}>${escHtml(p.name)}</option>`;
            }
            return '';
        }).join('');
    };

    // One player a side when the round's format (trip-config.js roundPlay) is singles
    const play = window.BBBScoring ? window.BBBScoring.formatFor(currentMatchupRound, window.BBB) : null;
    const isSingles = play ? play.key === 'singles' : currentMatchupRound === 3;

    roundMatchups.forEach((match, index) => {
        const globalIndex = matchups.indexOf(match);
        const div = document.createElement('div');
        div.className = 'glass-panel matchup-card';
        div.dataset.matchup = globalIndex;
        div.style = "padding: 20px;";

        div.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px;">
                <h4 style="color: var(--admin-accent);">Match ${index + 1}</h4>
                <button type="button" class="admin-btn secondary" style="width: auto; min-height: 44px; padding: 0 16px; font-size: 0.8rem; margin: 0;" aria-label="Remove match ${index + 1}" onclick="removeMatchup(${globalIndex})">Remove</button>
            </div>
            <p class="matchup-issue" hidden></p>

            <div style="margin-bottom: 15px;">
                <div style="font-size: 0.8rem; font-weight: bold; color: var(--accent-emerald); margin-bottom: 5px;">Team 1</div>
                <select data-field="t1_player1_id" class="admin-input" style="padding: 6px; font-size: 0.85rem;" onchange="updateMatchupTeam(${globalIndex}, 't1_player1_id', this.value)">
                    <option value="">Select T1 Player 1</option>
                    ${getOptions(1, match.t1_player1_id)}
                </select>
                ${!isSingles ? `
                <select data-field="t1_player2_id" class="admin-input" style="padding: 6px; font-size: 0.85rem; margin-top: 5px;" onchange="updateMatchupTeam(${globalIndex}, 't1_player2_id', this.value)">
                    <option value="">Select T1 Player 2</option>
                    ${getOptions(1, match.t1_player2_id)}
                </select>` : ''}
            </div>

            <div>
                <div style="font-size: 0.8rem; font-weight: bold; color: #ef4444; margin-bottom: 5px;">Team 2</div>
                <select data-field="t2_player1_id" class="admin-input" style="padding: 6px; font-size: 0.85rem;" onchange="updateMatchupTeam(${globalIndex}, 't2_player1_id', this.value)">
                    <option value="">Select T2 Player 1</option>
                    ${getOptions(2, match.t2_player1_id)}
                </select>
                ${!isSingles ? `
                <select data-field="t2_player2_id" class="admin-input" style="padding: 6px; font-size: 0.85rem; margin-top: 5px;" onchange="updateMatchupTeam(${globalIndex}, 't2_player2_id', this.value)">
                    <option value="">Select T2 Player 2</option>
                    ${getOptions(2, match.t2_player2_id)}
                </select>` : ''}
            </div>
        `;
        elements.matchupsList.appendChild(div);
    });

    if (roundMatchups.length === 0) {
        elements.matchupsList.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 40px;">No matchups defined for this round. Click "+ Create Matchup" to start.</p>';
    }
    markMatchupProblems();
}

function addMatchup() {
    if (!canSave()) return; // nothing to add to until both lists have loaded
    matchups.push({
        round_number: currentMatchupRound,
        t1_player1_id: null, t1_player2_id: null,
        t2_player1_id: null, t2_player2_id: null
    });
    renderMatchupsUI();
    checkChanges();
}

window.removeMatchup = (index) => {
    matchups.splice(index, 1);
    renderMatchupsUI();
    checkChanges();
};

window.updateMatchupTeam = (index, field, value) => {
    // Back to "Select…" stores null, as loaded, so it doesn't count as an edit
    matchups[index][field] = value || null;
    checkChanges();
};

// New Potential Players Logic
function renderPotentialUI() {
    if (!elements.potentialList) return;
    elements.potentialList.innerHTML = '';

    const problem = loadProblem(['roster']);
    if (problem) {
        elements.potentialList.innerHTML = loadProblemHtml(problem);
        return;
    }

    const potentialPlayers = players.filter(p => p.status === 'potential');

    if (potentialPlayers.length === 0) {
        elements.potentialList.innerHTML = '<p style="text-align: center; color: var(--text-muted);">No new sign-ups waiting.</p>';
        return;
    }

    potentialPlayers.forEach((p) => {
        const realIndex = players.indexOf(p);
        const who = escHtml(p.name);
        // Who's signed in as him (payments_2027.sql's admin_roster_logins), once that's loaded
        const login = loginFor(p);
        const held = isHeldPick(p);
        const badge = !p.user_id ? ''
            : !login ? ' <span class="answer-badge answer-new">Has an account</span>'
            : held ? ` ${heldBadgeHtml(p)}`
            : ' <span class="answer-badge answer-new">New sign-up</span>';
        const btnStyle = 'width: auto; min-height: 44px; padding: 5px 15px; margin: 0; font-size: 0.8rem;';
        const loginText = login ? escHtml(login.login_email || 'a login with no email') : '';
        const div = document.createElement('div');
        div.className = 'glass-panel';
        div.style = "padding: 15px; display: flex; flex-wrap: wrap; gap: 10px; justify-content: space-between; align-items: center;";
        // Approve here is a staged edit like the rest of this page: it lands with Save Changes. A name
        // somebody picked with another email can only be approved by naming that login, right away
        // (the database refuses a plain status change for it, and deleting it).
        div.innerHTML = `
            <div class="pot-who"><span style="font-weight: 600;">${who}${badge}</span>${login ? loginLineHtml(login) : ''}</div>
                <div style="display: flex; flex-wrap: wrap; gap: 10px;">${held ? `
                    <button type="button" class="admin-btn" style="${btnStyle}" data-approve-pick="${escHtml(p.id)}">Approve this login<span class="sr-only">: ${loginText} as ${who}</span></button>
                    <button type="button" class="admin-btn secondary" style="${btnStyle}" data-release="${escHtml(p.id)}">Not him<span class="sr-only">: unlink ${loginText} from ${who}</span></button>` : `
                    <button type="button" class="admin-btn" style="${btnStyle}" onclick="promotePlayer(${realIndex})">Approve (Save to apply)<span class="sr-only">: ${who}</span></button>
                    <button type="button" class="admin-btn secondary" style="${btnStyle}" onclick="removePlayer(${realIndex})">Delete<span class="sr-only"> ${who}</span></button>`}
                </div>
        `;
        elements.potentialList.appendChild(div);
    });
}

function addPotentialPlayer() {
    const name = elements.newPotentialName.value.trim();
    if (!name || loadState.roster !== 'ok') return;

    players.push({
        name: name,
        ghin: null,
        handicap: null,
        status: 'potential'
    });

    elements.newPotentialName.value = '';
    renderPotentialUI();
    checkChanges();
}

window.promotePlayer = (index) => {
    if (players[index]) {
        const hadFocus = elements.potentialList && elements.potentialList.contains(document.activeElement);
        players[index].status = 'confirmed';
        renderRosterTable();
        renderPotentialUI();
        renderDraftingUI();
        checkChanges();
        // His row is gone; keep keyboard focus on this tab
        if (hadFocus) {
            const next = elements.potentialList.querySelector('button') || document.querySelector('#tab-potential h2');
            if (next.tagName === 'H2') next.setAttribute('tabindex', '-1');
            next.focus();
        }
    }
};

function discardChanges() {
    if (confirm('Discard all unsaved changes?')) {
        players = JSON.parse(JSON.stringify(originalPlayers));
        matchups = JSON.parse(JSON.stringify(originalMatchups));
        saveProblem = null;
        renderAllTabs();
    }
}

const ADMIN_PLAYER_FIELDS = ['name', 'email', 'ghin', 'handicap', 'team_id', 'status'];

// Returns a confirm message when players about to be deleted have Bookie bets, else ''.
async function bookieHistoryWarning(playerIds) {
    try {
        const { data: wagers, error } = await supabaseInstance
            .from('wagers')
            .select('creator_id, target_id, participants');
        if (error || !wagers) return '';
        const involved = playerIds.map(id => {
            const count = wagers.filter(w => w.creator_id === id || w.target_id === id || (w.participants || []).includes(id)).length;
            const p = originalPlayers.find(op => op.id === id);
            return count ? `${p ? p.name : 'A player'} (${count} bet${count === 1 ? '' : 's'})` : null;
        }).filter(Boolean);
        if (!involved.length) return '';
        return `These players have bets in The Bookie: ${involved.join(', ')}.\n\n` +
            `Deleting them also deletes the bets they created, leaves "Unknown" in bets they joined, and changes other players' ledger totals. ` +
            `Press Cancel to stop this save, then Discard to bring them back.\n\nDelete anyway?`;
    } catch (e) {
        return '';
    }
}

const MATCHUP_SLOTS = ['t1_player1_id', 't1_player2_id', 't2_player1_id', 't2_player2_id'];
const MATCHUP_FIELDS = ['round_number', ...MATCHUP_SLOTS];

// "Round 2 · Match 3", numbered the way the Matchups tab numbers them
function matchupLabel(m, list = matchups) {
    return `Round ${m.round_number} · Match ${list.filter(x => x.round_number === m.round_number).indexOf(m) + 1}`;
}

const isBlankMatchup = m => MATCHUP_SLOTS.every(k => !m[k]);

// The row as it should be stored. A side with only its second player picked keeps him, as player 1.
function matchupValues(m) {
    const v = { round_number: m.round_number };
    [['t1_player1_id', 't1_player2_id'], ['t2_player1_id', 't2_player2_id']].forEach(([one, two]) => {
        const picks = [m[one], m[two]].filter(Boolean);
        v[one] = picks[0] || null;
        v[two] = picks[1] || null;
    });
    return v;
}

// Every match Save would store wrongly. A fully blank match isn't one: Save just drops it.
function matchupProblems() {
    const problems = [];
    const currentIds = new Set(players.map(p => p.id).filter(Boolean));
    const removed = new Map(originalPlayers.filter(p => p.id && !currentIds.has(p.id)).map(p => [p.id, p]));
    const newNames = new Set(players.filter(p => !p.id).map(p => p.name));
    // Ids already stored in a match stay valid even if that player isn't in this roster copy
    const stored = new Set();
    originalMatchups.forEach(m => MATCHUP_SLOTS.forEach(k => { if (m[k]) stored.add(m[k]); }));

    matchups.forEach((m, index) => {
        if (isBlankMatchup(m)) return;
        const label = matchupLabel(m);
        const v = matchupValues(m);
        const missing = !v.t1_player1_id ? 't1' : !v.t2_player1_id ? 't2' : null;
        if (missing) {
            const team = missing === 't1' ? 'Team 1' : 'Team 2';
            problems.push({ index, field: `${missing}_player1_id`, short: `Missing a ${team} player.`, text: `${label} is missing a ${team} player. Pick one or remove the match.` });
            return;
        }
        MATCHUP_SLOTS.forEach(k => {
            const ref = m[k];
            if (!ref) return;
            if (removed.has(ref)) {
                const name = removed.get(ref).name || 'A player you’re removing';
                problems.push({ index, field: k, short: `${name} is being removed from the roster.`, text: `${name} is still in ${label}. Take him out of the match before removing him, or press Discard.` });
            } else if (!currentIds.has(ref) && !newNames.has(ref) && !stored.has(ref)) {
                problems.push({ index, field: k, short: 'Has a player who isn’t on the roster any more.', text: `${label} has a player who isn’t on the roster any more. Pick again.` });
            }
        });
    });
    return problems;
}

// Players this save moves off a side they're still picked for. Not a block (on draft night
// last year's matches would stop every save), but worth a question: the Round Tracker goes
// by the match, so it would still score them for their old team there.
function teamMismatches() {
    const out = [];
    matchups.forEach((m, index) => {
        if (isBlankMatchup(m)) return;
        const before = m.id ? originalMatchups.find(o => o.id === m.id) : null;
        MATCHUP_SLOTS.forEach(k => {
            const ref = m[k];
            const side = k.startsWith('t1') ? 1 : 2;
            const p = ref && players.find(x => (x.id || x.name) === ref);
            if (!p || p.team_id === side) return;
            // An old mismatch that this session didn't touch isn't this save's doing
            const was = p.id ? originalPlayers.find(o => o.id === p.id) : null;
            if (was && was.team_id === p.team_id && before && before[k] === ref) return;
            out.push({ index, field: k, text: `${p.name} ${p.team_id ? `is now on Team ${p.team_id}` : 'isn’t on a team now'} but still plays for Team ${side} in ${matchupLabel(m)}.` });
        });
    });
    return out;
}

// The first thing blocking a save (with how many there are), or null
function findSaveProblem() {
    const problems = matchupProblems();
    return problems.length ? Object.assign({}, problems[0], { count: problems.length }) : null;
}

// After a blocked save, outline the matches that need fixing on the round being shown.
// Updated in place (not re-drawn) so a select being changed keeps focus.
function markMatchupProblems() {
    if (!elements.matchupsList) return;
    const byIndex = new Map();
    if (saveProblem) matchupProblems().forEach(p => { if (!byIndex.has(p.index)) byIndex.set(p.index, p.short); });
    elements.matchupsList.querySelectorAll('[data-matchup]').forEach(card => {
        const text = byIndex.get(Number(card.dataset.matchup));
        card.classList.toggle('has-problem', !!text);
        const note = card.querySelector('.matchup-issue');
        if (note) {
            note.textContent = text || '';
            note.hidden = !text;
        }
    });
}

// "Show match": open the Matchups tab on that round and put focus on the pick to fix
function showMatchup(index, pick) {
    const m = matchups[index];
    if (!m) return;
    const tabItem = document.querySelector('.sidebar-item[data-tab="matchups"]');
    if (tabItem && !tabItem.classList.contains('active')) tabItem.click();
    window.filterMatchupRound(m.round_number);
    const card = elements.matchupsList.querySelector(`[data-matchup="${index}"]`);
    if (!card) return;
    const field = pick || (saveProblem && saveProblem.index === index ? saveProblem.field : null);
    const target = (field && card.querySelector(`select[data-field="${field}"]`)) || card.querySelector('select');
    // Centre the pick itself: on a phone the bottom of a tall card sits under the save bar
    (target || card).scrollIntoView({ block: 'center' });
    if (target) target.focus({ preventScroll: true });
}

// Only the writes needed to turn the matchups that loaded into `list` (what's being saved).
// resolve() turns a pick into a player id (players added in this save are picked by name).
function diffMatchups(list, resolve) {
    const before = new Map(originalMatchups.filter(m => m.id).map(m => [m.id, matchupValues(m)]));
    const resolved = m => {
        const v = matchupValues(m);
        MATCHUP_SLOTS.forEach(k => { if (v[k]) v[k] = resolve(v[k]); });
        return v;
    };
    const kept = new Set();
    const plan = { deletes: [], updates: [], inserts: [] };
    list.forEach(m => {
        const blank = isBlankMatchup(m);
        if (!m.id) {
            if (!blank) plan.inserts.push(resolved(m)); // a blank new match is simply dropped
            return;
        }
        if (blank) return; // emptied out: same as Remove, deleted below
        kept.add(m.id);
        const now = resolved(m);
        const was = before.get(m.id) || {};
        const fields = {};
        MATCHUP_FIELDS.forEach(k => { if ((now[k] || null) !== (was[k] || null)) fields[k] = now[k]; });
        if (Object.keys(fields).length) plan.updates.push({ id: m.id, label: matchupLabel(m, list), fields });
    });
    before.forEach((v, id) => { if (!kept.has(id)) plan.deletes.push(id); });
    plan.count = plan.deletes.length + plan.updates.length + plan.inserts.length;
    return plan;
}

async function saveChanges() {
    if (!supabaseInstance) {
        alert('Saving is disabled in demo mode.');
        return;
    }
    if (saving) return;
    // Matchups are saved as changes against what loaded. Without a good load, a save could
    // overwrite real pairings with an empty or stale list.
    if (!canSave()) {
        renderSaveBar();
        const problem = loadProblem(['roster', 'matchups']);
        window.showToast(problem && problem.error
            ? `Nothing was saved. ${problem.text} Tap Retry, then save again.`
            : 'Nothing was saved: the roster and matchups are still loading.', 'error', { kind: 'save' });
        return;
    }

    // 1. Check the whole save before writing anything
    saveProblem = findSaveProblem();
    if (saveProblem) {
        renderSaveBar();
        markMatchupProblems();
        return;
    }
    const moved = teamMismatches();
    if (moved.length && !confirm(`${moved[0].text}${moved.length > 1 ? ` And ${moved.length - 1} more like this.` : ''}\n\n` +
        `The Round Tracker goes by the match, so it would still score him for his old team there.\n\nSave anyway? Cancel takes you to the match.`)) {
        showMatchup(moved[0].index, moved[0].field);
        return;
    }

    // Everything below is built from this copy, so what's written is exactly what was checked.
    // Saving starts before the first await, so a second tap or Discard can't start another save.
    const snap = JSON.parse(JSON.stringify({ players, matchups }));
    window.clearToasts('save'); // an earlier save's result no longer applies
    setSaving(true);

    const originalIds = originalPlayers.map(p => p.id).filter(id => id);
    const currentIds = snap.players.map(p => p.id).filter(id => id);
    const deletedIds = originalIds.filter(id => !currentIds.includes(id));
    const nameOf = id => (originalPlayers.find(p => p.id === id) || {}).name || 'A player';

    // Deleting a player also deletes the Bookie bets they created
    if (deletedIds.length > 0) {
        const warning = await bookieHistoryWarning(deletedIds);
        if (warning && !confirm(warning)) {
            setSaving(false);
            return;
        }
    }

    // Roster edits: only the fields you actually changed, only on the players you changed.
    // Writing whole rows from this page's snapshot would undo anything changed since it
    // loaded (a player's own GHIN/handicap update, an approval, a Bookie link).
    const editable = p => ADMIN_PLAYER_FIELDS.reduce((row, key) => {
        if (p[key] !== undefined) row[key] = p[key];
        return row;
    }, {});
    const changedFields = p => {
        const before = originalPlayers.find(o => o.id === p.id) || {};
        return ADMIN_PLAYER_FIELDS.reduce((diff, key) => {
            if (p[key] !== undefined && JSON.stringify(p[key]) !== JSON.stringify(before[key])) diff[key] = p[key];
            return diff;
        }, {});
    };
    const updates = snap.players.filter(p => p.id)
        .map(p => ({ id: p.id, name: p.name, fields: changedFields(p) }))
        .filter(u => Object.keys(u.fields).length > 0);
    const newRows = snap.players.filter(p => !p.id).map(editable);
    const newNames = new Set(newRows.map(r => r.name));
    const matchupsChanged = diffMatchups(snap.matchups, ref => ref).count > 0;

    let step = 'roster';
    let wrote = false;        // anything reached the database
    let savedRoster = false;  // roster edits and new players all saved
    let matchupWrites = 0;
    try {
        console.log('Saving changes to Supabase...');

        // 2. Roster edits
        for (const u of updates) {
            const { data: updated, error: updateError } = await supabaseInstance
                .from('players')
                .update(u.fields)
                .eq('id', u.id)
                .select('id');
            if (updateError) throw updateError;
            // Row-level security can skip a row without an error; say so instead of "saved"
            if (!updated || !updated.length) throw new Error(`${u.name || 'A player'} wasn't updated (no permission, or they were removed). Reload and try again.`);
            wrote = true;
        }

        // 3. New players, with their ids back so matches that picked them by name can use them
        const newIdByName = new Map();
        if (newRows.length > 0) {
            const { data: inserted, error: insertError } = await supabaseInstance
                .from('players')
                .insert(newRows)
                .select('id, name');
            if (insertError) throw insertError;
            wrote = true;
            (inserted || []).forEach(r => { if (!newIdByName.has(r.name)) newIdByName.set(r.name, r.id); });
        }
        savedRoster = updates.length + newRows.length > 0;

        // 4. Matchups: only the ones that changed, each by id. Never delete-all-and-reinsert:
        // the Round Tracker reads these to know who plays whom.
        step = 'matchups';
        if (matchupsChanged) {
            const plan = diffMatchups(snap.matchups, ref => {
                if (!newNames.has(ref)) return ref;
                if (!newIdByName.has(ref)) throw new Error(`${ref} was added, but his new player id didn’t come back.`);
                return newIdByName.get(ref);
            });
            if (plan.deletes.length) {
                const { data: gone, error: delError } = await supabaseInstance
                    .from('matchups')
                    .delete()
                    .in('id', plan.deletes)
                    .select('id');
                if (delError) throw delError;
                matchupWrites += (gone || []).length;
                if (matchupWrites) wrote = true;
                const left = plan.deletes.length - (gone || []).length;
                if (left) throw new Error(`${left} removed match${left === 1 ? ' wasn’t' : 'es weren’t'} deleted (no permission, or already gone).`);
            }
            for (const u of plan.updates) {
                const { data: updated, error: updateError } = await supabaseInstance
                    .from('matchups')
                    .update(u.fields)
                    .eq('id', u.id)
                    .select('id');
                if (updateError) throw updateError;
                if (!updated || !updated.length) throw new Error(`${u.label} wasn’t updated (no permission, or it was deleted).`);
                matchupWrites++;
                wrote = true;
            }
            // One at a time, in screen order: rows saved together share a created_at, and
            // created_at is what numbers the matches (scoring.js sortMatchups)
            for (const row of plan.inserts) {
                const { data: added, error: insertError } = await supabaseInstance
                    .from('matchups')
                    .insert(row)
                    .select('id');
                if (insertError) throw insertError;
                matchupWrites += (added || []).length;
                wrote = true;
            }
        }

        // 5. Removed players last, once no match points at them any more
        step = 'removals';
        if (deletedIds.length > 0) {
            const { data: removedRows, error: delError } = await supabaseInstance
                .from('players')
                .delete()
                .in('id', deletedIds)
                .select('id');
            if (delError) throw new Error(`${deletedIds.map(nameOf).join(', ')} couldn’t be removed: ${plainError(delError)}`);
            const removedIds = new Set((removedRows || []).map(r => r.id));
            if (removedIds.size) wrote = true;
            const stuck = deletedIds.filter(id => !removedIds.has(id));
            if (stuck.length) throw new Error(`${stuck.map(nameOf).join(', ')} ${stuck.length === 1 ? 'wasn’t' : 'weren’t'} removed (no permission, or already gone).`);
        }

        // All of it is now stored, even if the reload below fails (Save stays off until Retry)
        originalPlayers = snap.players;
        originalMatchups = snap.matchups;
        await Promise.all([loadRoster(), loadMatchups()]);
        setSaving(false);
        window.showToast('Changes saved successfully! 🎉', 'success', { kind: 'save' });
    } catch (err) {
        console.error('Save failed:', err);
        let msg = escHtml(plainError(err));
        if (!/[.!?]$/.test(msg)) msg += '.'; // database messages come without a full stop
        if (!wrote) {
            // Nothing reached the database: keep the edits on screen so Save can be tried again
            setSaving(false);
            window.showToast(`Nothing was saved: ${msg}`, 'error', { kind: 'save' });
            return;
        }
        let text;
        if (step === 'roster') {
            text = `Only some roster changes saved: ${msg}${matchupsChanged ? ' Matchups weren’t saved.' : ''}`;
        } else if (step === 'matchups') {
            text = (savedRoster
                ? (matchupWrites ? 'Saved the roster, but only some matchup changes saved: ' : 'Saved the roster, but matchups didn’t save: ')
                : 'Only some matchup changes saved: ') + msg;
            if (deletedIds.length) text += ' Players you removed are still on the roster.';
        } else {
            text = `Saved your other changes, but ${msg}`;
        }
        // Part of the save landed: show what's really stored rather than a mix
        window.showToast(`${text} The page now shows what’s stored, so check it before saving again.`, 'error', { kind: 'save' });
        await Promise.all([loadRoster(), loadMatchups()]);
        setSaving(false);
    }
}

// Global initialization
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// ==========================================
// Score Entry (Manual Per-Round Scoring)
// ==========================================
let scoreEntryRound = adminCupRounds()[0]; // the first Cup round in trip-config.js
let scoreEntryData = {}; // { round_number: [ {player_id, name, team_id, total_score, to_par} ] }

async function renderScoreEntryUI() {
    if (!supabaseInstance) return;
    const tbody = document.getElementById('score-entry-tbody');
    if (!tbody) return;

    renderScoreEntryContext();
    tbody.innerHTML = '<tr><td colspan="22" style="text-align: center; color: rgba(255,255,255,0.3); padding: 30px;">Loading...</td></tr>';

    try {
        // Fetch confirmed players
        const { data: allPlayers, error: pErr } = await supabaseInstance
            .from('players')
            .select('id, name, team_id, handicap')
            .eq('status', 'confirmed')
            .order('team_id', { ascending: true })
            .order('name');

        if (pErr) throw pErr;

        // Fetch existing scores for all rounds
        const { data: existingScores, error: sErr } = await supabaseInstance
            .from('player_round_scores')
            .select('*');

        if (sErr) throw sErr;

        // Build lookup: { `${player_id}_${round_number}`: s }
        const scoreLookup = {};
        (existingScores || []).forEach(s => {
            scoreLookup[`${s.player_id}_${s.round_number}`] = s;
        });

        // Store for rendering
        scoreEntryData.players = allPlayers;
        scoreEntryData.scoreLookup = scoreLookup;

        renderScoreEntryTable();
    } catch (e) {
        console.error('Error loading score entry data:', e);
        tbody.innerHTML = '<tr><td colspan="22" style="text-align: center; color: #fca5a5; padding: 30px;">Error loading data.</td></tr>';
    }
}

// Course pars per round come from trip-config.js (window.BBB). If the config
// isn't loaded, fall back to the original hardcoded 2026 pars.
const LEGACY_ROUND_PARS = {
    1: [4,5,4,3,4,3,4,5,4, 4,4,3,5,4,5,3,4,4],
    2: [4,4,5,4,3,4,4,5,3, 4,4,3,4,5,4,4,5,3]
};

// Escape text from the database before it goes into innerHTML.
function escHtml(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// The Cup rounds, from trip-config.js: itinerary slots labelled R<n> plus the roundCourses and roundPlay
// keys (the same rule as tripRounds() in round_tracker.js). The practice round has no R<n>, so it never shows.
function adminCupRounds() {
    const cfg = window.BBB || {};
    const set = new Set();
    (Array.isArray(cfg.itinerary) ? cfg.itinerary : []).forEach(d => ((d && Array.isArray(d.slots)) ? d.slots : []).forEach(s => { const m = /^R(\d+)$/.exec((s && s.when) || ''); if (m && Number(m[1]) >= 1) set.add(Number(m[1])); }));
    Object.keys(cfg.roundCourses || {}).concat(Object.keys(cfg.roundPlay || {})).forEach(k => { const n = Number(k); if (Number.isInteger(n) && n >= 1) set.add(n); });
    return set.size ? [...set].sort((a, b) => a - b) : [1, 2, 3];
}

function adminParsForRound(roundNumber) {
    const cfg = window.BBB;
    if (!cfg || !cfg.roundCourses || !cfg.courses) return LEGACY_ROUND_PARS[roundNumber] || null;
    const id = cfg.roundCourses[roundNumber];
    const all = [];
    cfg.courses.forEach(c => (c.options || [c]).forEach(o => all.push(o)));
    const course = all.find(c => c.id === id);
    return course && Array.isArray(course.holePars) && course.holePars.length === 18 ? course.holePars : null;
}

function adminScoringForRound(roundNumber) {
    const cfg = window.BBB;
    if (cfg && cfg.roundPlay && cfg.roundPlay[roundNumber] === 'points') return 'stableford';
    if (!cfg || !cfg.roundScoring) return roundNumber === 1 ? 'stableford' : 'stroke';
    return cfg.roundScoring[roundNumber] || 'stroke';
}

// The course a round is played on (trip-config roundCourses), as "Talking Stick O’odham"
function adminCourseNameForRound(roundNumber) {
    const cfg = window.BBB;
    if (!cfg || !cfg.roundCourses || !cfg.courses) return '';
    const id = cfg.roundCourses[roundNumber];
    for (const c of cfg.courses) {
        for (const o of (c.options || [c])) {
            if (o.id !== id) continue;
            const club = String(c.club || o.club || '').split('·')[0].trim().replace(/\s+Golf Club$/i, '');
            const name = String(o.name || c.name || '').replace(/\s+Course$/i, '').trim();
            return !club || name.toLowerCase().startsWith(club.toLowerCase()) ? name : `${club} ${name}`.trim();
        }
    }
    return '';
}

// Total is quota points on a points (Stableford) round with known pars, strokes otherwise:
// the same rule the auto-sum below uses
function scoreEntryIsPoints(roundNumber) {
    return adminScoringForRound(roundNumber) === 'stableford' && !!adminParsForRound(roundNumber);
}

// "Round 1 · We-Ko-Pa Cholla · Par 72 · The Grind · team points (Total = quota points)"
function renderScoreEntryContext() {
    const el = document.getElementById('score-entry-context');
    if (!el) return;
    const pars = adminParsForRound(scoreEntryRound);
    const course = adminCourseNameForRound(scoreEntryRound);
    // The format by the rules page's name, as the Round Tracker shows it (FORMAT_RULES in
    // round_tracker.js); a format the rules don't name keeps scoring.js's label ("Stroke play")
    const rulesNames = { points: 'The Grind · team points', split: 'The Split Decision', singles: 'Championship Singles' };
    const play = window.BBBScoring ? window.BBBScoring.formatFor(scoreEntryRound, window.BBB) : null;
    const format = play ? (rulesNames[play.key] || play.label) : '';
    const what = scoreEntryIsPoints(scoreEntryRound) ? 'Total = quota points' : 'Total = strokes';
    el.innerHTML = [
        `Round ${scoreEntryRound}`,
        course ? `<b>${escHtml(course)}</b>` : 'Course not set in trip-config.js',
        pars ? `Par ${pars.reduce((sum, p) => sum + p, 0)}` : '',
        `${escHtml(format)}${format ? ' ' : ''}(${what})`
    ].filter(Boolean).join(' · ');
}

// Player, Team, Total and To Par first (so they're on screen without scrolling sideways),
// then the 18 holes, with a Par row under the hole numbers
function renderScoreEntryHead(pars, isPoints) {
    const thead = document.getElementById('score-entry-thead');
    if (!thead) return;
    const holes = Array.from({ length: 18 }, (_, i) => `<th scope="col">${i + 1}</th>`).join('');
    const parRow = pars
        ? `<tr class="se-par-row"><th scope="row" class="se-sticky">Par</th><td></td><td class="se-pin-total">${isPoints ? '' : pars.reduce((sum, p) => sum + p, 0)}</td><td class="se-pin-topar"></td>${pars.map(p => `<td>${escHtml(p)}</td>`).join('')}</tr>`
        : '';
    thead.innerHTML = `<tr>
            <th class="se-sticky" scope="col">Player</th>
            <th scope="col" style="min-width: 70px;">Team</th>
            <th class="se-pin-total" scope="col" style="min-width: 90px;">${isPoints ? 'Points' : 'Total'}</th>
            <th class="se-pin-topar" scope="col" style="min-width: 90px;">To Par</th>
            ${holes}
        </tr>${parRow}`;
}

// Desktop: Total and To Par stick right after the name column (CSS .se-pin-*), so they stay
// in view while the back nine is typed. Their offsets are the measured column widths; a hidden
// tab measures 0, so that keeps the last good offsets and the observer re-pins once it shows.
let scoreEntryPinObserver = null;
function pinScoreEntryTotals() {
    const wrap = document.querySelector('#tab-score-entry .table-responsive');
    const thead = document.getElementById('score-entry-thead');
    if (!wrap || !thead) return;
    const nameTh = thead.querySelector('th.se-sticky');
    const totalTh = thead.querySelector('th.se-pin-total');
    const toparTh = thead.querySelector('th.se-pin-topar');
    if (!nameTh || !totalTh || !toparTh) return;
    const nameW = nameTh.getBoundingClientRect().width;
    const totalW = totalTh.getBoundingClientRect().width;
    const toparW = toparTh.getBoundingClientRect().width;
    if (!nameW || !totalW || !toparW) return;
    // Rounded down, so a pinned column overlaps its neighbour by a hair rather than leaving a gap
    wrap.style.setProperty('--se-total-left', `${Math.floor(nameW)}px`);
    wrap.style.setProperty('--se-topar-left', `${Math.floor(nameW + totalW)}px`);
    wrap.style.setProperty('--se-pinned-width', `${Math.ceil(nameW + totalW + toparW)}px`);
}

function watchScoreEntryPins() {
    pinScoreEntryTotals();
    if (scoreEntryPinObserver || typeof ResizeObserver === 'undefined') return;
    const table = document.querySelector('#tab-score-entry .score-entry-table');
    if (!table) return;
    scoreEntryPinObserver = new ResizeObserver(() => pinScoreEntryTotals());
    scoreEntryPinObserver.observe(table);
}

function renderScoreEntryTable() {
    const tbody = document.getElementById('score-entry-tbody');
    if (!tbody || !scoreEntryData.players) return;

    const playersList = scoreEntryData.players;
    const lookup = scoreEntryData.scoreLookup || {};

    // Course pars + scoring for this round come from trip-config.js
    const roundPars = adminParsForRound(scoreEntryRound);
    const isStableford = adminScoringForRound(scoreEntryRound) === 'stableford' && !!roundPars;
    renderScoreEntryContext();
    renderScoreEntryHead(roundPars, isStableford);

    if (playersList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="22" style="text-align: center; color: rgba(255,255,255,0.3); padding: 50px;">No confirmed players found.</td></tr>';
        return;
    }

    const shown = v => (v !== null && v !== undefined ? v : '');
    tbody.innerHTML = playersList.map(p => {
        const key = `${p.id}_${scoreEntryRound}`;
        const existing = lookup[key] || {};
        const pid = escHtml(p.id);
        const who = escHtml(p.name);
        const teamLabel = p.team_id === 1 ? '<span style="color: #60a5fa; font-weight: 700;">Blue</span>'
                        : p.team_id === 2 ? '<span style="color: #fca5a5; font-weight: 700;">Red</span>'
                        : '<span style="color: var(--text-muted);">—</span>';

        let holesHtml = '';
        for (let i = 1; i <= 18; i++) {
            const par = roundPars ? roundPars[i - 1] : null;
            holesHtml += `
                <td class="se-hole" data-label="${i}" data-par="${par ? `Par ${escHtml(par)}` : ''}">
                    <input type="number" class="edit-input score-hole-input" inputmode="numeric" placeholder="–"
                           data-player="${pid}" data-hole="${i}" aria-label="${who} hole ${i}"
                           value="${escHtml(shown(existing[`h${i}`]))}">
                </td>
            `;
        }

        return `
        <tr data-player-id="${pid}">
            <td class="se-name se-sticky" data-label="Player">${who}</td>
            <td class="se-team" data-label="Team">${teamLabel}</td>
            <td class="se-total se-pin-total" data-label="${isStableford ? 'Points' : 'Total'}">
                <input type="number" class="edit-input score-total-input" inputmode="numeric" placeholder="–"
                       data-player="${pid}" aria-label="${who} ${isStableford ? 'points' : 'total'}"
                       value="${escHtml(shown(existing.total_score))}">
            </td>
            <td class="se-topar se-pin-topar" data-label="To Par">
                <input type="number" class="edit-input score-topar-input" placeholder="–"
                       data-player="${pid}" aria-label="${who} to par"
                       value="${escHtml(shown(existing.to_par))}">
            </td>
            ${holesHtml}
        </tr>
        `;
    }).join('');
    watchScoreEntryPins();

    // Attach auto-sum listeners
    const holeInputs = document.querySelectorAll('.score-hole-input');
    holeInputs.forEach(input => {
        input.addEventListener('input', (e) => {
            const pid = e.target.dataset.player;
            let totalVal = 0;
            let toParVal = 0;
            let hasAny = false;
            
            document.querySelectorAll(`.score-hole-input[data-player="${pid}"]`).forEach(inp => {
                const val = parseInt(inp.value);
                const holeIdx = parseInt(inp.dataset.hole) - 1;
                
                if (!isNaN(val)) {
                    hasAny = true;
                    const par = roundPars ? roundPars[holeIdx] : null;
                    if (isStableford) {
                        // Quota points (rules page): eagle or better 5, birdie 3, par 2, bogey 1, double+ 0
                        totalVal += window.BBBScoring ? window.BBBScoring.quotaPoints(val, par)
                            : (val - par <= -2 ? 5 : val - par === -1 ? 3 : val - par === 0 ? 2 : val - par === 1 ? 1 : 0);
                    } else {
                        // Stroke play (tracks to-par when the course pars are known)
                        totalVal += val;
                        if (par) toParVal += (val - par);
                    }
                }
            });
            
            const totInput = document.querySelector(`.score-total-input[data-player="${pid}"]`);
            if (totInput) {
                totInput.value = hasAny ? totalVal : '';
            }

            // Auto fill To Par for stroke-play rounds on a known course
            if (!isStableford && roundPars) {
                const toParInput = document.querySelector(`.score-topar-input[data-player="${pid}"]`);
                if (toParInput) {
                    toParInput.value = hasAny ? toParVal : '';
                }
            }
        });
    });
}

// The round tabs: one per Cup round (adminCupRounds), so the practice round never gets one
function renderScoreEntryRoundTabs() {
    const wrap = document.getElementById('score-entry-round-tabs');
    if (!wrap) return;
    const rounds = adminCupRounds();
    if (!rounds.includes(scoreEntryRound)) scoreEntryRound = rounds[0];
    wrap.innerHTML = rounds.map(n => {
        const on = n === scoreEntryRound;
        return `<button type="button" class="admin-btn${on ? '' : ' secondary'} score-round-tab${on ? ' active' : ''}" data-round="${n}" aria-pressed="${on}" style="width: auto; padding: 10px 20px; margin: 0;">Round ${n}</button>`;
    }).join('\n');
}

// Round tab switching: one listener on the row, so it serves whatever tabs are drawn
document.addEventListener('DOMContentLoaded', () => {
    renderScoreEntryRoundTabs();
    const tabRow = document.getElementById('score-entry-round-tabs');
    tabRow?.addEventListener('click', (e) => {
        const tab = e.target.closest('.score-round-tab');
        if (!tab || !tabRow.contains(tab)) return;
        tabRow.querySelectorAll('.score-round-tab').forEach(t => {
            const on = t === tab;
            t.classList.toggle('active', on);
            t.classList.toggle('secondary', !on);
            t.setAttribute('aria-pressed', String(on));
        });
        scoreEntryRound = Number(tab.dataset.round);
        renderScoreEntryContext();
        renderScoreEntryTable();
    });

    setTimeout(() => {
        // Save scores button
        const saveBtn = document.getElementById('save-score-entry-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', saveScoreEntries);
        }
        const fillBtn = document.getElementById('fill-from-tracker-btn');
        if (fillBtn) {
            fillBtn.addEventListener('click', fillFromTracker);
        }
    }, 500);
});

// Copy the Round Tracker's scorecards for this round into the table, merging duplicates the
// same way the tracker's board does (scoring.js). A round number can have rounds on more than
// one day (a stray start, or the practice round scored as a Cup round by mistake). A practice day
// (an itinerary day with a practice: true slot and no R<n> slot) is never used, so its cards can't
// become Cup scores even before the real round has started. The scheduled day (its R<n> itinerary
// slot) wins once it has any scores entered. Otherwise use the day with the most scores, then the
// latest. Holes the tracker doesn't have keep whatever is typed in. Nothing is saved until
// Save Round Scores.
async function fillFromTracker() {
    if (!supabaseInstance) return;
    const SC = window.BBBScoring;
    const btn = document.getElementById('fill-from-tracker-btn');
    btn.disabled = true;
    try {
        const cfg = window.BBB || {};
        const since = (cfg.bookie && cfg.bookie.seasonStart) || '2000-01-01';
        const { data: rounds, error } = await supabaseInstance
            .from('rounds')
            .select('id, date')
            .eq('round_number', scoreEntryRound)
            .gte('date', since);
        if (error) throw error;
        if (!rounds || !rounds.length) {
            window.showToast(`The Round Tracker has no Round ${scoreEntryRound} cards yet.`, 'error', { timeout: 10000 });
            return;
        }
        const { data: rows, error: rowsError } = await supabaseInstance.from('scores').select('*').in('round_id', rounds.map(r => r.id));
        if (rowsError) throw rowsError;

        const dayOf = new Map(rounds.map(r => [r.id, r.date || '']));
        const holesByDay = {};
        rounds.forEach(r => { holesByDay[r.date || ''] = holesByDay[r.date || ''] || 0; });
        (rows || []).forEach(r => { holesByDay[dayOf.get(r.round_id)] += SC.countEntered(SC.holesOf(r)); });
        const itinerary = Array.isArray(cfg.itinerary) ? cfg.itinerary : [];
        const slotsOf = d => (d && Array.isArray(d.slots) ? d.slots : []).filter(Boolean);
        let planned = null;
        itinerary.forEach(d => slotsOf(d).forEach(slot => { if (slot.when === `R${scoreEntryRound}`) planned = d.date; }));
        const practiceDays = new Set(itinerary.filter(d => slotsOf(d).some(s => s.practice) && !slotsOf(d).some(s => /^R\d+$/.test(s.when || ''))).map(d => d.date));
        const candidates = Object.keys(holesByDay).filter(d => !practiceDays.has(d));
        const skippedPractice = Object.keys(holesByDay).filter(d => practiceDays.has(d) && holesByDay[d] > 0).sort();
        const tripStart = cfg.trip && cfg.trip.dates && cfg.trip.dates.start;
        const inTrip = candidates.filter(d => tripStart && d >= tripStart);
        const day = planned && planned in holesByDay && holesByDay[planned] > 0 ? planned
            : (inTrip.length ? inTrip : candidates).sort((a, b) =>
                (holesByDay[b] - holesByDay[a]) || ((b === planned) - (a === planned)) || b.localeCompare(a))[0];

        const byPlayer = {};
        (rows || []).filter(r => dayOf.get(r.round_id) === day).forEach(r => { (byPlayer[r.player_id] = byPlayer[r.player_id] || []).push(r); });
        let filled = 0, missing = 0, changed = 0;
        Object.keys(byPlayer).forEach(pid => {
            const holes = SC.mergeHoles(byPlayer[pid]);
            if (!holes.some(v => v !== null)) return;
            const inputs = document.querySelectorAll(`.score-hole-input[data-player="${pid}"]`);
            if (!inputs.length) { missing++; return; }
            inputs.forEach(input => {
                const v = holes[Number(input.dataset.hole) - 1];
                if (v === null) return;
                if (input.value !== '' && Number(input.value) !== v) changed++;
                input.value = v;
            });
            inputs[0].dispatchEvent(new Event('input')); // recompute the total and to-par
            filled++;
        });
        const practiceNote = skippedPractice.length
            ? `Round ${scoreEntryRound} cards from ${skippedPractice.map(escHtml).join(', ')} were left out: that’s the practice round, which doesn’t count for the Cup.`
            : '';
        const notes = [
            changed ? `${changed} hole${changed === 1 ? '' : 's'} already typed in were different and got the tracker’s number.` : '',
            missing ? `${missing} card${missing === 1 ? ' belongs' : 's belong'} to players not on the confirmed roster.` : '',
            practiceNote
        ].filter(Boolean).join(' ');
        window.showToast(filled
            ? `Filled ${filled} player${filled === 1 ? '' : 's'} from the Round Tracker (${escHtml(day)}). ${notes} Check the numbers, then press Save Round Scores.`
            : `The Round Tracker has no scores for this round yet. ${practiceNote}`.trim(), filled ? 'success' : 'error');
    } catch (err) {
        console.error('Fill from tracker failed:', err);
        window.showToast('Couldn’t read the Round Tracker: ' + escHtml(err.message || err), 'error');
    } finally {
        btn.disabled = false;
    }
}

async function saveScoreEntries() {
    if (!supabaseInstance) return;
    const saveBtn = document.getElementById('save-score-entry-btn');
    const totalInputs = document.querySelectorAll('.score-total-input');
    const toParInputs = document.querySelectorAll('.score-topar-input');

    saveBtn.textContent = 'Saving...';
    saveBtn.style.opacity = '0.5';
    saveBtn.disabled = true;

    try {
        const upsertData = [];

        totalInputs.forEach(input => {
            const playerId = input.dataset.player;
            const totalScore = input.value.trim() === '' ? null : parseInt(input.value);
            const toParInput = document.querySelector(`.score-topar-input[data-player="${playerId}"]`);
            const toPar = toParInput && toParInput.value.trim() !== '' ? parseInt(toParInput.value) : null;

            let rowHasData = totalScore !== null || toPar !== null;
            const holeData = {};
            for (let i = 1; i <= 18; i++) {
                const hiInput = document.querySelector(`.score-hole-input[data-player="${playerId}"][data-hole="${i}"]`);
                if (hiInput && hiInput.value.trim() !== '') {
                    holeData[`h${i}`] = parseInt(hiInput.value);
                    rowHasData = true;
                } else {
                    holeData[`h${i}`] = null;
                }
            }

            // Only include if at least one field has data
            if (rowHasData) {
                upsertData.push({
                    player_id: playerId,
                    round_number: scoreEntryRound,
                    total_score: totalScore,
                    to_par: toPar,
                    ...holeData
                });
            }
        });

        if (upsertData.length === 0) {
            window.showToast('No scores to save. Enter at least one score.', 'error', { timeout: 10000 });
            return;
        }

        const { error } = await supabaseInstance
            .from('player_round_scores')
            .upsert(upsertData, { onConflict: 'player_id,round_number' });

        if (error) throw error;

        // Update the local lookup cache
        upsertData.forEach(d => {
            scoreEntryData.scoreLookup[`${d.player_id}_${d.round_number}`] = { ...d };
        });

        window.showToast(`Round ${scoreEntryRound} scores saved! \u26f3`, 'success');
        saveBtn.textContent = '\u2705 Saved!';
        saveBtn.style.background = '#10b981';

        setTimeout(() => {
            saveBtn.textContent = '\ud83d\udcbe Save Round Scores';
            saveBtn.style.background = '';
        }, 2000);
    } catch (err) {
        console.error('Error saving round scores:', err);
        window.showToast('Error saving scores: ' + escHtml(err.message), 'error');
        saveBtn.textContent = '\ud83d\udcbe Save Round Scores';
    } finally {
        saveBtn.style.opacity = '1';
        saveBtn.disabled = false;
    }
}

// ==========================================
// Ryder Cup Official Scoring (Admin View)
// ==========================================
async function renderScoresUI() {
    if (!supabaseInstance) return;
    try {
        const { data, error } = await supabaseInstance
            .from('ryder_cup_scores')
            .select('*')
            .eq('id', 1)
            .single();

        if (error && error.code !== 'PGRST116') throw error; // PGRST116 is row not found

        if (data) {
            document.getElementById('admin-blue-score').value = data.blue_score;
            document.getElementById('admin-red-score').value = data.red_score;
        }
    } catch (e) {
        console.error('Error fetching ryder cup scores:', e);
    }
}

// Bind the save button securely inside setupEventListeners or directly here via explicit DOM lookup:
document.addEventListener('DOMContentLoaded', () => {
    // Wait slightly for DOM or hook dynamically
    setTimeout(() => {
        const saveScoresBtn = document.getElementById('save-scores-btn');
        if (saveScoresBtn) {
            saveScoresBtn.addEventListener('click', async () => {
                if (!supabaseInstance) return;
                try {
                    const bluePoints = parseFloat(document.getElementById('admin-blue-score').value) || 0;
                    const redPoints = parseFloat(document.getElementById('admin-red-score').value) || 0;
                    
                    saveScoresBtn.textContent = 'Saving...';
                    saveScoresBtn.style.opacity = '0.5';

                    const { error } = await supabaseInstance
                        .from('ryder_cup_scores')
                        .upsert({ id: 1, blue_score: bluePoints, red_score: redPoints });

                    if (error) throw error;

                    saveScoresBtn.textContent = 'Saved!';
                    saveScoresBtn.style.background = '#10b981';
                    window.showToast('Ryder Cup scores saved!', 'success');
                    
                    setTimeout(() => {
                        saveScoresBtn.textContent = 'Save Scores';
                        saveScoresBtn.style.opacity = '1';
                        saveScoresBtn.style.background = '';
                    }, 2000);
                } catch (err) {
                    console.error('Error updating Ryder Cup scores:', err);
                    window.showToast('Error saving scores: ' + escHtml(err.message), 'error');
                    saveScoresBtn.textContent = 'Save Scores';
                    saveScoresBtn.style.opacity = '1';
                }
            });
        }
    }, 500);
});

// ==========================================
// RSVPs: who's coming, who hasn't answered, and new sign-ups to approve
// ==========================================
const RSVP_ANSWERS = { in: 'In', maybe: 'Probably', out: 'Out' };
const RSVP_ORDER = { in: 0, maybe: 1, out: 2, none: 3 };
let rsvpRows = [];        // every RSVP row for the trip, oldest first (notes included)
let rsvpRoster = [];      // players as of the last RSVP load (fresher than the roster tab's copy)
let rsvpFilter = 'all';
let rsvpLoadError = null;

function rsvpTripYear() {
    const cfg = window.BBB || {};
    return (cfg.rsvp && cfg.rsvp.year) || (cfg.trip && cfg.trip.year) || new Date().getFullYear();
}

async function loadRsvpAdmin() {
    const tbody = document.getElementById('rsvp-admin-tbody');
    const yearEl = document.getElementById('rsvp-admin-year');
    if (yearEl) yearEl.textContent = rsvpTripYear();
    if (!supabaseInstance || !tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" class="rsvp-message">Loading RSVPs…</td></tr>';
    rsvpLoading = true;
    // Who's signed in as each name, and the trip payments (Paid): fetched alongside, and drawn in
    // when they land (payments_2027.sql; until it has run they say "Being set up")
    loadRosterLogins();
    loadTripPayments();
    // The roster is re-read here too, so players who signed up after this page opened show
    // up (with Approve). It's kept apart from the roster tab so unsaved edits there survive.
    const [rsvpResult, rosterResult] = await Promise.all([
        supabaseInstance.rpc('admin_rsvps', { p_trip_year: rsvpTripYear() }),
        // The same read as the roster tab, so rows merged into it below have the same shape
        loadAdminRoster()
    ]);
    const { data, error } = rsvpResult;
    rsvpRoster = !rosterResult.error && rosterResult.data ? rosterResult.data : originalPlayers.filter(p => p.id);
    // Players added since this page loaded (new sign-ups) join the roster tab's lists as well,
    // so they can be removed on the New sign-ups tab without a reload. Both lists get the same
    // copy, so Save sees no change for them. Only once the roster tab's own load is in: opened
    // straight from admin#rsvps, this can finish first, and that load brings everyone anyway.
    if (!rosterResult.error && rosterResult.data && loadState.roster === 'ok') {
        const known = new Set(originalPlayers.map(p => p.id));
        const added = rosterResult.data.filter(p => !known.has(p.id));
        added.forEach(p => {
            originalPlayers.push(JSON.parse(JSON.stringify(p)));
            players.push(JSON.parse(JSON.stringify(p)));
        });
        // Players already here whose login or status changed since (somebody picked a name, so it's
        // waiting for approval; or it was approved or unlinked elsewhere) move to the right list too.
        // Only where this page hasn't edited the status: both copies get the same values, so Save
        // sees no change and never writes them.
        const relinked = syncLinkStatus(rosterResult.data);
        if (added.length || relinked) {
            renderRosterTable();
            renderPotentialUI();
            renderDraftingUI();
            checkChanges();
            if (added.length) loadVenmo(); // a new sign-up may have added his own
        }
    }
    if (error) {
        const text = `${error.code || ''} ${error.message || ''}`;
        rsvpLoadError = /PGRST202|could not find the function/i.test(text)
            ? 'The RSVP setup script hasn’t been run yet. Run rsvp_accounts.sql in the Supabase SQL Editor, then Refresh.'
            : /admins only/i.test(text)
                ? 'Supabase doesn’t see this login as an admin. The player row needs is_admin turned on and the same email as this login.'
                : `Couldn’t load RSVPs: ${error.message}`;
        rsvpRows = [];
    } else {
        rsvpLoadError = null;
        // admin_rsvps sends newest first; the history view wants oldest first
        rsvpRows = (data || []).slice().sort((a, b) => (a.created_at > b.created_at ? 1 : a.created_at < b.created_at ? -1 : 0));
    }
    rsvpLoading = false;
    rsvpLoaded = true;
    renderRsvpAdmin();
}

// Copies status and user_id from a fresh roster read into the page's two copies of each player, where
// this page hasn't changed them (an unsaved Approve or a player marked for removal is left alone).
// Returns how many players changed.
function syncLinkStatus(freshRows) {
    let changed = 0;
    freshRows.forEach(f => {
        const o = originalPlayers.find(x => x.id === f.id);
        const p = players.find(x => x.id === f.id);
        if (!o || !p) return;
        const same = (a, b) => (a === undefined ? null : a) === (b === undefined ? null : b);
        if (!same(p.status, o.status) || !same(p.user_id, o.user_id)) return; // edited here: keep the edit
        if (same(f.status, o.status) && same(f.user_id, o.user_id)) return;
        [o, p].forEach(row => {
            if ('status' in f) row.status = f.status;
            if ('user_id' in f) row.user_id = f.user_id;
        });
        changed++;
    });
    return changed;
}

function rsvpKeyForName(name) {
    return 'name:' + String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// One entry per player on the roster (confirmed or potential), plus any RSVP that
// doesn't belong to a current player (e.g. the player row was deleted).
function rsvpEntries() {
    const byKey = new Map();
    rsvpRows.forEach(r => {
        const key = r.player_id || rsvpKeyForName(r.name);
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(r);
    });
    const entries = rsvpRoster.map(p => ({ player: p, name: p.name, history: byKey.get(p.id) || [] }));
    const known = new Set(entries.map(e => e.player.id));
    byKey.forEach((history, key) => {
        if (!known.has(key)) entries.push({ player: null, name: history[history.length - 1].name, history });
    });
    entries.forEach(e => {
        e.latest = e.history.length ? e.history[e.history.length - 1] : null;
        e.answer = e.latest ? e.latest.status : 'none';
        e.isNew = !!(e.player && e.player.status === 'potential');
        e.needsApproval = e.isNew && !!(e.player.user_id || e.latest);
    });
    return entries.sort((a, b) => (RSVP_ORDER[a.answer] - RSVP_ORDER[b.answer]) || a.name.localeCompare(b.name));
}

// admin_rsvps returns each player's 20 newest answers; say so when a history is trimmed
const RSVP_HISTORY_LIMIT = 20;
function answerCount(e) {
    return e.history.length >= RSVP_HISTORY_LIMIT ? `+` : String(e.history.length);
}

function fmtWhen(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// The CSV's times: this computer's local time, with the year, e.g. "Sep 30, 2026, 5:00 AM"
function fmtWhenFull(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// An email that's safe to put in a mailto: link, or ''
function mailableEmail(value) {
    const email = String(value || '').trim();
    return /^[^\s@<>"'?&#,;:]+@[^\s@<>"'?&#,;:]+\.[^\s@<>"'?&#,;:]+$/.test(email) ? email : '';
}

// ---- Chasing replies: reminder text, invite link, "you're approved" note ----

// "Scottsdale, Apr 8–11"
function tripWhereWhen() {
    const trip = (window.BBB && window.BBB.trip) || {};
    const city = String(trip.location || '').split(',')[0].trim();
    const dates = (trip.dates && trip.dates.short) || '';
    return [city, dates].filter(Boolean).join(', ');
}

// First names, with a last initial where two players share one ("Alex I., Alex M.")
function firstNames(entries) {
    const parts = entries.map(e => String(e.name || '').trim().split(/\s+/).filter(Boolean));
    const seen = new Map();
    parts.forEach(p => { const k = (p[0] || '').toLowerCase(); seen.set(k, (seen.get(k) || 0) + 1); });
    return parts.map(p => (seen.get((p[0] || '').toLowerCase()) > 1 && p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0] || '')).filter(Boolean);
}

function rsvpReminderText(entries) {
    const where = tripWhereWhen();
    return `Still need your RSVP${where ? ` for ${where}` : ''}: ${firstNames(entries).join(', ')}. Takes a minute: ${INVITE_URL}`;
}

function approvalMessage() {
    return `You're confirmed for BBB ${rsvpTripYear()}, so The Bookie is open to you: ${BOOKIE_URL}`;
}

// Phones get the share sheet (straight into the group text); computers copy to the clipboard,
// since desktop browsers' share dialogs are no help for pasting into a text thread
function useShareSheet() {
    return typeof navigator.share === 'function' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
}

async function copyText(text) {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (e) { /* blocked: try the old way */ }
    const had = document.activeElement;
    const box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.style.cssText = 'position: fixed; top: 0; left: 0; opacity: 0;';
    document.body.appendChild(box);
    box.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    box.remove();
    if (had && had.focus) had.focus();
    return ok;
}

// payload is what navigator.share takes ({ text } or { title, url }). Returns 'shared',
// 'cancelled', 'copied' or 'failed'.
async function shareOrCopy(payload, copiedMessage) {
    const text = payload.text || payload.url;
    if (useShareSheet()) {
        try {
            await navigator.share(payload);
            return 'shared';
        } catch (e) {
            if (e && e.name === 'AbortError') return 'cancelled';
            // Share sheet unavailable after all: copy instead
        }
    }
    if (await copyText(text)) {
        window.showToast(copiedMessage, 'success');
        return 'copied';
    }
    window.showToast(`Couldn’t copy automatically. Here it is to copy by hand: ${escHtml(text)}`, 'error');
    return 'failed';
}

function copyInviteLink() {
    return shareOrCopy({ title: 'Bros before Boges: sign up', url: INVITE_URL },
        `Invite link copied: ${escHtml(INVITE_URL.replace(/^https:\/\//, ''))}`);
}

function copyRsvpReminder() {
    const waiting = rsvpEntries().filter(e => e.answer === 'none');
    if (!waiting.length) return window.showToast('Everyone has answered. No reminder needed.', 'success');
    return shareOrCopy({ text: rsvpReminderText(waiting) },
        `Reminder copied with ${waiting.length} name${waiting.length === 1 ? '' : 's'}. Paste it into the group text.`);
}

// Players approved on this visit, each with a ready-made note to tell him
let rsvpJustApproved = []; // { id, name, email, fixEmail (a login to put on his roster row, or '') }

function renderApprovedNotes(focusId) {
    const list = document.getElementById('rsvp-approved');
    if (!list) return;
    list.hidden = !rsvpJustApproved.length;
    const year = rsvpTripYear();
    list.innerHTML = rsvpJustApproved.map(a => {
        const who = escHtml(a.name);
        const action = a.email
            ? `<a class="admin-btn" data-let-know="${escHtml(a.id)}" href="${escHtml(`mailto:${a.email}?subject=${encodeURIComponent(`You're confirmed for BBB ${year}`)}&body=${encodeURIComponent(approvalMessage())}`)}">Let him know<span class="sr-only"> by email: ${who}</span></a>`
            : `<button type="button" class="admin-btn" data-let-know="${escHtml(a.id)}" data-copy-approval>Copy a note for him<span class="sr-only">: ${who}</span></button>`;
        // Approved a login that isn't his roster email: put it on his row, so the two match from now on
        const fix = a.fixEmail
            ? ` His roster email still isn’t that login: put <b>${emailHtml(a.fixEmail)}</b> in his Email on Confirmed Roster, then Save.`
            : '';
        return `<li><span><b>${who}</b> is confirmed: he’s on the head count and The Bookie is open to him.${fix}</span>${action}` +
            `<button type="button" class="rsvp-dismiss" data-dismiss-approved="${escHtml(a.id)}" aria-label="Dismiss the note about ${who}">×</button></li>`;
    }).join('');
    if (focusId) {
        const target = [...list.querySelectorAll('[data-let-know]')].find(el => el.dataset.letKnow === focusId);
        if (target) target.focus();
    }
}

function renderRsvpAdmin() {
    const tbody = document.getElementById('rsvp-admin-tbody');
    const summary = document.getElementById('rsvp-summary');
    if (!tbody) return;
    document.querySelectorAll('[data-rsvp-filter]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.rsvpFilter === rsvpFilter)));

    renderApprovedNotes();
    const chase = document.getElementById('rsvp-chase');

    if (rsvpLoadError) {
        if (summary) summary.innerHTML = '';
        if (chase) chase.hidden = true;
        tbody.innerHTML = `<tr><td colspan="8" class="rsvp-message">${escHtml(rsvpLoadError)}</td></tr>`;
        return;
    }

    const entries = rsvpEntries();
    const count = fn => entries.filter(fn).length;
    if (summary) {
        const pill = (label, n, sub) => `<div class="rsvp-pill"><b>${n}</b>${label}${sub ? ` <span class="rsvp-pill-sub">(${sub})</span>` : ''}</div>`;
        // The homepage head count only counts confirmed roster players: say who else is in here
        const answerPill = (key, label) => {
            const list = entries.filter(e => e.answer === key);
            const waiting = list.filter(e => e.isNew).length;
            const offRoster = list.filter(e => !e.player).length;
            return pill(label, list.length, [
                waiting ? `${waiting} awaiting approval` : '',
                offRoster ? `${offRoster} not on roster` : ''
            ].filter(Boolean).join(', '));
        };
        summary.innerHTML = [
            answerPill('in', 'In'),
            answerPill('maybe', 'Probably'),
            answerPill('out', 'Out'),
            pill('No reply yet', count(e => e.answer === 'none')),
            pill('Sunday round', count(e => e.latest && e.latest.sunday_round && e.answer !== 'out')),
            pill('Needs approval', count(e => e.needsApproval)),
            paidPillHtml(pill),
            rsvpDuePillHtml()
        ].filter(Boolean).join('');
    }

    // "No reply yet": a reminder for the group text
    const noReply = entries.filter(e => e.answer === 'none');
    if (chase) {
        chase.hidden = !(rsvpFilter === 'none' && noReply.length);
        const text = document.getElementById('rsvp-chase-text');
        if (text && !chase.hidden) {
            text.textContent = `${noReply.length} ${noReply.length === 1 ? 'player hasn’t' : 'players haven’t'} answered. ` +
                'Copy a reminder with their first names and the sign-up link for the group text.';
        }
    }

    const shown = entries.filter(e => rsvpFilter === 'all' ? true
        : rsvpFilter === 'approve' ? e.needsApproval
        : rsvpFilter === 'noaccount' ? !!(e.player && !e.player.user_id)
        : e.answer === rsvpFilter);
    if (!shown.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="rsvp-message">Nobody here.</td></tr>';
        return;
    }

    tbody.innerHTML = shown.map(e => {
        const p = e.player;
        // A name somebody picked from the roster with a login that isn't his roster email
        const held = !!(p && e.isNew && isHeldPick(p));
        const tag = !p ? '<span class="answer-badge answer-none">Not on roster</span>'
            : held ? heldBadgeHtml(p)
            : e.isNew ? `<span class="answer-badge answer-new">${p.user_id ? 'New sign-up' : 'Not confirmed'}</span>` : '';
        // Email him straight from the list when the roster has his address
        const email = p ? mailableEmail(p.email) : '';
        const name = email
            ? `<a class="rsvp-name-link" href="mailto:${escHtml(email)}" title="Email ${escHtml(e.name)}">${escHtml(e.name)}</a>`
            : escHtml(e.name);
        // The Sunday round goes with the answer ("In + Sunday", as in the history), which leaves the
        // Note column room to be read
        const sunday = !!(e.latest && e.latest.sunday_round && e.answer !== 'out');
        const answer = e.latest
            ? `<span class="rsvp-answer"><span class="answer-badge answer-${e.answer}">${RSVP_ANSWERS[e.answer]}</span>${sunday ? ' <span class="rsvp-sunday">+ Sunday</span>' : ''}</span>`
            : '<span class="answer-badge answer-none">No reply</span>';
        const history = e.history.length > 1
            ? `<details class="rsvp-history"><summary>${answerCount(e)} answers</summary><ul>${e.history.slice().reverse().map(h =>
                `<li>${escHtml(RSVP_ANSWERS[h.status] || h.status)}${h.sunday_round ? ' + Sunday' : ''} · ${escHtml(fmtWhen(h.created_at))}${h.note ? ` · “${escHtml(h.note)}”` : ''}</li>`).join('')}</ul></details>`
            : `<span class="rsvp-muted">${e.history.length ? '1 answer' : '—'}</span>`;
        // With admin_roster_logins: the email he signs in with, and a flag when it isn't his roster email
        const account = !p ? '—' : p.user_id ? accountCellHtml(p) : '<span class="rsvp-muted">No account yet</span>';
        const pickLogin = held ? escHtml(loginFor(p).login_email || 'a login with no email') : '';
        const action = !e.needsApproval ? ''
            : held ? `<div class="rsvp-actions">
                <button type="button" class="admin-btn" data-approve="${escHtml(p.id)}">Approve this login<span class="sr-only">: ${pickLogin} as ${escHtml(e.name)}</span></button>
                <button type="button" class="admin-btn secondary" data-release="${escHtml(p.id)}">Not him<span class="sr-only">: unlink ${pickLogin} from ${escHtml(e.name)}</span></button>
            </div>`
            : `<button type="button" class="admin-btn" data-approve="${escHtml(p.id)}" style="width: auto; min-height: 44px; margin: 0; padding: 6px 14px; font-size: 0.8rem;">Approve<span class="sr-only"> ${escHtml(e.name)}</span></button>`;
        return `
        <tr>
            <td data-label="Player" style="font-weight: 600;">${name} ${tag}</td>
            <td data-label="Answer">${answer}</td>
            <td data-label="Answered"><span class="rsvp-muted rsvp-when">${e.latest ? escHtml(fmtWhen(e.latest.created_at)).replace(/ /g, '&nbsp;').replace(',&nbsp;', ', ') : '—'}</span></td>
            <td data-label="Note"><div class="rsvp-note">${e.latest && e.latest.note ? escHtml(e.latest.note) : '<span class="rsvp-muted">—</span>'}</div></td>
            <td data-label="Account">${account}</td>
            <td data-label="Paid">${paidCellHtml(p, e.name)}</td>
            <td data-label="History">${history}</td>
            <td data-label="${action ? 'Approve' : ''}">${action}</td>
        </tr>`;
    }).join('');
}

// Confirming a new player puts them on the public roster and head count and lets them bet.
// Goes through approve_player() (admin-only, in rsvp_accounts.sql) so it doesn't depend on
// the players table's update policies.
async function approvePlayer(id, btn) {
    const p = rsvpRoster.find(x => x.id === id);
    // A name somebody picked whose login isn't his roster email: approved by naming that login
    if (p && isHeldPick(p)) return approvePick(id, btn);
    if (!p || !confirm(`Confirm ${p.name} for the trip? They'll show on the site's head count and can use The Bookie.`)) return;
    btn.disabled = true;
    const { error } = await supabaseInstance.rpc('approve_player', { p_player_id: id });
    if (error) {
        btn.disabled = false;
        window.showToast('Couldn’t approve: ' + escHtml(error.message), 'error');
        // payments_2027.sql wants the login behind a picked name checked first: fetch who's signed
        // in as each name, so this row turns into Approve (naming the login) / Not him
        if (/check who this is/i.test(error.message || '')) loadRosterLogins();
        return;
    }
    markApproved(id, p, mailableEmail(p.email));
}

// The page's copies after an approval (approve_player or admin_approve_pick), and the note to tell him
function markApproved(id, p, email, fixEmail = '') {
    p.status = 'confirmed';
    // Keep the roster tab in step (Save treats a player missing from only one of its two
    // lists as deleted). Approving someone marked for removal, not yet saved, cancels that.
    [players, originalPlayers, rsvpRoster].forEach(list => {
        const row = list.find(x => x.id === id);
        if (row) row.status = 'confirmed';
    });
    dropStaleReads(payData.logins, loadRosterLogins);
    const login = payData.logins.byPlayer.get(id);
    if (login) Object.assign(login, { status: 'confirmed', status_before_pick: null });
    if (!originalPlayers.some(x => x.id === id)) originalPlayers.push(JSON.parse(JSON.stringify(p)));
    if (!players.some(x => x.id === id)) {
        // Put him back where he was, so the page doesn't think the roster changed
        const order = new Map(originalPlayers.map((x, i) => [x.id, i]));
        const at = players.findIndex(x => (order.has(x.id) ? order.get(x.id) : Infinity) > order.get(id));
        players.splice(at === -1 ? players.length : at, 0, JSON.parse(JSON.stringify(originalPlayers.find(x => x.id === id))));
    }
    // A note to tell him, kept above the list until dismissed (focus goes there: his row's
    // Approve button is gone)
    rsvpJustApproved = rsvpJustApproved.filter(a => a.id !== id).concat([{ id, name: p.name, email, fixEmail }]);
    renderRosterTable();
    renderPotentialUI();
    renderDraftingUI();
    renderRsvpAdmin();
    checkChanges();
    renderApprovedNotes(id);
    window.showToast(`${escHtml(p.name)} is confirmed for the trip.`, 'success');
}

// Spreadsheet-safe CSV: quote everything and stop text cells being read as formulas.
// Numbers (handicaps, counts) can't carry a formula, so they stay plain numbers.
function csvCell(value) {
    if (typeof value === 'number') return `"${value}"`;
    let s = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
}

function exportRsvpCsv() {
    if (rsvpLoadError) return window.showToast(escHtml(rsvpLoadError), 'error');
    const header = ['Name', 'Answer', 'Answered at', 'Sunday round', 'Note', 'Email', 'GHIN', 'Handicap (plus = negative)', 'Roster status', 'Has account', 'Times answered'];
    // What each player has paid toward the trip, once trip payments are set up (a number, in dollars)
    const withPaid = payData.trip.state === 'ok';
    if (withPaid) header.push(`Paid toward trip (${paymentsYear()})`);
    const rows = rsvpEntries().map(e => {
        const p = e.player || {};
        const paid = withPaid ? [e.player && p.id ? paidCentsOf(p.id) / 100 : ''] : [];
        return [
            e.name,
            e.latest ? RSVP_ANSWERS[e.answer] : 'No reply',
            e.latest ? fmtWhenFull(e.latest.created_at) : '',
            e.latest && e.latest.sunday_round && e.answer !== 'out' ? 'Yes' : 'No',
            e.latest ? e.latest.note || '' : '',
            p.email || '',
            p.ghin || '',
            p.handicap === null || p.handicap === undefined || p.handicap === '' ? '' : Number(p.handicap),
            e.player ? (p.status || 'confirmed') : 'not on roster',
            p.user_id ? 'Yes' : 'No',
            answerCount(e),
            ...paid
        ];
    });
    const csv = [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `bbb-${rsvpTripYear()}-rsvps.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// RSVP-by date (trip-config rsvp.lockBy, a day in the trip's time zone), with the counts:
// "RSVPs due Nov 30", then "RSVPs were due Nov 30" once that day is over there
function rsvpDuePillHtml() {
    const cfg = window.BBB || {};
    const by = String((cfg.rsvp && cfg.rsvp.lockBy) || '').trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(by);
    if (!m) return '';
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return '';
    const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const passed = tripToday() > by;
    return `<div class="rsvp-pill rsvp-pill-due${passed ? ' is-past' : ''}">RSVPs ${passed ? 'were due' : 'due'}<b>${escHtml(day)}</b></div>`;
}

// Today as 'YYYY-MM-DD' where the trip is (trip.timeZone, Arizona: UTC-7 all year)
function tripToday() {
    const tz = (window.BBB && window.BBB.trip && window.BBB.trip.timeZone) || 'America/Phoenix';
    try {
        const p = {};
        new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
            .formatToParts(new Date()).forEach(x => { p[x.type] = x.value; });
        return `${p.year}-${p.month}-${p.day}`;
    } catch (e) {
        return new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);
    }
}

// ==========================================
// Payments (payments_2027.sql): trip payments (RSVPs, Paid), Venmo usernames (Confirmed Roster,
// Venmo), and which login is behind each roster name (approving a name somebody picked).
// Until that script has run, its tables and functions aren't there: the new columns say "Being set
// up" and everything else works as it did. Nothing here goes through Save Changes.
// ==========================================
const PAY_SETUP_TEXT = 'Venmo and Paid tracking are being set up.';
const VENMO_RULE = 'A Venmo username is 5 to 30 letters, numbers, hyphens or underscores, like @Jeff-Tarlton.';

// The table or function isn't there yet (the script hasn't run)
function isSetupMissing(error) {
    const text = `${(error && error.code) || ''} ${(error && error.message) || ''}`;
    return /PGRST205|PGRST202|42P01|could not find the (table|function)/i.test(text);
}

function paymentsYear() {
    const cfg = window.BBB || {};
    return Number((cfg.trip && cfg.trip.year) || rsvpTripYear());
}

function loadPaymentExtras() {
    if (!supabaseInstance) return Promise.resolve();
    return Promise.all([loadVenmo(), loadRosterLogins(), loadTripPayments()]);
}

// One load of one part; a newer load of the same part (or a save here, see dropStaleReads) wins over
// a slower older one
async function loadPayPart(part, fetchRows, keep) {
    if (!supabaseInstance) return;
    const job = ++part.job;
    part.reading = true;
    if (part.state !== 'ok') part.state = 'loading';
    let res;
    try {
        res = await fetchRows();
    } catch (e) {
        res = { data: null, error: e };
    }
    if (job !== part.job) return;
    part.reading = false;
    if (!res || res.error || !Array.isArray(res.data)) {
        const error = (res && res.error) || new Error('Nothing came back.');
        part.state = isSetupMissing(error) ? 'missing' : 'error';
        part.error = plainError(error);
    } else {
        part.state = 'ok';
        part.error = '';
        keep(res.data);
    }
}

async function loadTripPayments() {
    await loadPayPart(payData.trip,
        () => supabaseInstance.from('trip_payments').select('id, trip_year, player_id, amount, paid_on, note, created_by, created_at'),
        rows => { payData.trip.rows = rows.slice().sort(byPaidOn); });
    paymentsChanged('trip');
}

async function loadVenmo() {
    await loadPayPart(payData.venmo,
        () => supabaseInstance.from('player_venmo').select('player_id, handle, updated_at, updated_by'),
        rows => { payData.venmo.byPlayer = new Map(rows.map(r => [r.player_id, r])); });
    paymentsChanged('venmo');
}

async function loadRosterLogins() {
    await loadPayPart(payData.logins,
        () => supabaseInstance.rpc('admin_roster_logins'),
        rows => { payData.logins.byPlayer = new Map(rows.map(r => [r.player_id, r])); });
    paymentsChanged('logins');
}

// A save here just changed this part's rows on screen. A read that was already on its way was asked
// before the save, so it would put the old rows back (a new payment vanishing, a deleted one coming
// back): drop it, and if one was running, read again now, so whatever else it was fetching still lands.
function dropStaleReads(part, reload) {
    const wasReading = !!part.reading;
    part.job++;
    part.reading = false;
    if (wasReading) reload();
}

function byPaidOn(a, b) {
    return String(a.paid_on).localeCompare(String(b.paid_on)) || String(a.created_at).localeCompare(String(b.created_at));
}

// Redraw what a part feeds, keeping keyboard focus on the same button if it was on one
function paymentsChanged(part) {
    renderPayNotes();
    if (part === 'venmo') {
        refreshVenmoCells();
        return;
    }
    if (part === 'logins' && players.some(p => p.status === 'potential' && p.user_id)) {
        keepFocusIn(elements.potentialList, renderPotentialUI);
    }
    if (rsvpLoaded && !rsvpLoading) keepFocusIn(document.getElementById('rsvp-admin-tbody'), renderRsvpAdmin);
    if (part === 'trip' && paySheet.playerId) renderPaySheet();
}

function focusKey(el) {
    const attr = ['data-pay', 'data-approve', 'data-release', 'data-approve-pick', 'data-venmo', 'data-pay-delete']
        .find(a => el && el.hasAttribute && el.hasAttribute(a));
    return attr ? `[${attr}="${CSS.escape(el.getAttribute(attr))}"]` : null;
}

function keepFocusIn(container, render) {
    const had = container && container.contains(document.activeElement) ? focusKey(document.activeElement) : null;
    render();
    const again = had && container.querySelector(had);
    if (again) again.focus();
}

// "Being set up" (or what failed, with Retry) above the column it explains
function renderPayNotes() {
    const note = (id, parts, what) => {
        const el = document.getElementById(id);
        if (!el) return;
        const failed = parts.filter(p => p.state === 'error');
        let html = '';
        if (failed.length) html = `<span>Couldn’t load ${what}: ${escHtml(failed[0].error)}</span><button type="button" class="admin-btn secondary" data-retry-pay>Retry</button>`;
        else if (parts.some(p => p.state === 'missing')) html = `<span>${PAY_SETUP_TEXT}</span>`;
        el.classList.toggle('is-error', !!failed.length);
        // A failed load is announced; "being set up" is just there to read
        if (failed.length) el.setAttribute('role', 'alert');
        else el.removeAttribute('role');
        if (el.dataset.html !== html) {
            el.dataset.html = html;
            el.innerHTML = html;
        }
        el.hidden = !html;
    };
    note('roster-pay-note', [payData.venmo], 'Venmo usernames');
    note('rsvp-pay-note', [payData.trip, payData.logins], 'trip payments and logins');
}

function retryPaymentLoads() {
    if (payData.venmo.state === 'error') loadVenmo();
    if (payData.trip.state === 'error') loadTripPayments();
    if (payData.logins.state === 'error') loadRosterLogins();
}

// ---- Money and dates ----

function centsOf(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

// "$800", or "$812.50" when there are cents
function money(cents) {
    const hasCents = cents % 100 !== 0;
    return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: 2 });
}

// 'YYYY-MM-DD' -> "Sep 1, 2026"
function fmtDay(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
    if (!m) return String(ymd || '');
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

// This computer's date, 'YYYY-MM-DD' (what "today" means to the person typing)
function localDate(addDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + addDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function tripPaymentsOf(playerId) {
    const year = paymentsYear();
    return payData.trip.rows.filter(r => r.player_id === playerId && Number(r.trip_year) === year);
}

function paidCentsOf(playerId) {
    return tripPaymentsOf(playerId).reduce((sum, r) => sum + centsOf(r.amount), 0);
}

// trip-config's per-person cost, if it has one
function tripCost() {
    const cost = (window.BBB && window.BBB.trip && window.BBB.trip.cost) || {};
    const n = Number(cost.perPerson);
    return Number.isFinite(n) && n > 0 ? { cents: Math.round(n * 100), approx: !!cost.approx } : null;
}

function findRosterPlayer(id) {
    return rsvpRoster.find(x => x.id === id) || players.find(x => x.id === id) || originalPlayers.find(x => x.id === id) || null;
}

// ---- Who's signed in as each name ----

// admin_roster_logins' row for a linked name, or null (not linked, or the list isn't in)
function loginFor(player) {
    if (!player || !player.id || !player.user_id || payData.logins.state !== 'ok') return null;
    return payData.logins.byPlayer.get(player.id) || null;
}

// Waiting for approval, and the login isn't the email on his roster row: somebody picked this name
// from the roster (or the emails differ). The database only approves it with the login named.
function isHeldPick(player) {
    const login = loginFor(player);
    return !!login && player.status === 'potential' && !login.email_match;
}

// The badge for such a name: "Claimed name" when the database recorded the pick, "Check login" when
// it didn't (e.g. a pick from before payments_2027.sql, or a roster email edited since)
function heldBadgeHtml(player) {
    const login = loginFor(player);
    return `<span class="answer-badge answer-claim">${login && login.status_before_pick ? 'Claimed name' : 'Check login'}</span>`;
}

// "Yes" as before for a confirmed name signed in with his roster email. Otherwise the email he signs in
// with: a name waiting for approval (whose login is it?), or a login that isn't his roster email.
function accountCellHtml(p) {
    const login = loginFor(p);
    if (!login || (login.email_match && p.status !== 'potential')) return 'Yes';
    const warn = login.email_match ? ''
        : `<span class="acct-warn">${String(login.roster_email || '').trim() ? 'Not his roster email' : 'No roster email'}</span>`;
    const email = login.login_email ? emailHtml(login.login_email) : 'A login with no email';
    return `<div class="acct"><span class="acct-email">${email}</span>${warn}</div>`;
}

// New sign-ups list: who's signed in as him, and for a picked name what to check
function loginLineHtml(login) {
    const who = `<b>${login.login_email ? emailHtml(login.login_email) : 'a login with no email'}</b>`;
    if (login.email_match) return `<div class="login-line">Signed in as ${who}.</div>`;
    const roster = String(login.roster_email || '').trim()
        ? `his roster email is ${escHtml(String(login.roster_email).trim())}` : 'his roster row has no email';
    const before = login.status_before_pick === 'confirmed' ? ' Before the pick he was a confirmed player.'
        : login.status_before_pick === 'potential' ? ' He was on this list before the pick.' : '';
    return `<div class="login-line is-warn">Signed in as ${who}, but ${roster}. Check it’s really him.${before}</div>`;
}

// Approve the login behind a picked name, naming it (admin_approve_pick)
async function approvePick(id, btn) {
    const p = findRosterPlayer(id);
    const login = loginFor(p);
    if (!p || !login || !supabaseInstance) return;
    const who = login.login_email || 'a login with no email';
    const roster = String(login.roster_email || '').trim() ? `his roster email is ${String(login.roster_email).trim()}` : 'his roster row has no email';
    const before = login.status_before_pick === 'confirmed' ? ` Before that, ${p.name} was a confirmed player.` : '';
    // The database recorded a pick ("Claimed name"), or it just sees a login that isn't his roster email ("Check login")
    const how = login.status_before_pick ? `That login picked ${p.name} from the roster` : `That login is signed in as ${p.name}`;
    if (!confirm(`Approve ${who} as ${p.name}?\n\n${how}, but ${roster}.${before}\n\n` +
        `Only approve if you know it’s really him: he’ll be on the head count and can use The Bookie as ${p.name}. If it isn’t him, press Cancel, then Not him.`)) return;
    const fromList = !!(elements.potentialList && elements.potentialList.contains(btn));
    btn.disabled = true;
    let res;
    try {
        res = await supabaseInstance.rpc('admin_approve_pick', { p_player: id, p_login_email: login.login_email });
    } catch (e) {
        res = { error: e };
    }
    if (res.error) {
        btn.disabled = false;
        window.showToast('Couldn’t approve: ' + escHtml(plainError(res.error)), 'error');
        // He was unlinked, or a different login has the name now: show who it is now
        if (res.error.code === 'P0002') loadRosterLogins();
        return;
    }
    // His roster email still isn't this login (blank or another address): the note says how to fix that
    const fixEmail = !login.email_match && login.login_email ? login.login_email : '';
    markApproved(id, p, mailableEmail(p.email) || mailableEmail(login.login_email), fixEmail);
    if (fromList) focusPotentialList();
}

// "Not him": unlink the login from the name (admin_release_claim). A held name goes back to how it was.
async function releaseClaim(id, btn) {
    const p = findRosterPlayer(id);
    const login = loginFor(p);
    if (!p || !login || !supabaseInstance) return;
    const who = login.login_email || 'a login with no email';
    const back = login.status_before_pick === 'confirmed' ? `${p.name} goes back to being a confirmed player with no login`
        : `${p.name} stays on the roster with no login`;
    if (!confirm(`Unlink ${who} from ${p.name}?\n\n${back}, so the real ${p.name} can pick his name when he signs in. ` +
        'That login can sign in again and pick a name or join as new.')) return;
    const fromList = !!(elements.potentialList && elements.potentialList.contains(btn));
    btn.disabled = true;
    let res;
    try {
        res = await supabaseInstance.rpc('admin_release_claim', { p_player: id });
    } catch (e) {
        res = { error: e };
    }
    if (res.error) {
        btn.disabled = false;
        window.showToast('Couldn’t unlink: ' + escHtml(plainError(res.error)), 'error');
        if (res.error.code === 'P0002') loadRosterLogins();
        return;
    }
    const status = (res.data && res.data.status) || 'potential';
    // Every copy gets the same values, so Save doesn't count this as an edit
    [rsvpRoster, players, originalPlayers].forEach(list => {
        const row = list.find(x => x.id === id);
        if (row) Object.assign(row, { user_id: null, status });
    });
    dropStaleReads(payData.logins, loadRosterLogins);
    payData.logins.byPlayer.delete(id);
    renderRosterTable();
    renderPotentialUI();
    renderDraftingUI();
    renderRsvpAdmin();
    checkChanges();
    window.showToast(`Unlinked ${escHtml(who)} from ${escHtml(p.name)}. ${escHtml(p.name)} is ${status === 'confirmed' ? 'a confirmed player again' : 'still waiting for approval'}, with no login.`, 'success');
    if (fromList) {
        focusPotentialList();
    } else {
        const row = document.querySelector(`#rsvp-admin-tbody [data-pay="${CSS.escape(id)}"]`);
        const heading = document.querySelector('#tab-rsvps h2');
        const target = row || heading;
        if (target === heading) heading.setAttribute('tabindex', '-1');
        if (target) target.focus();
    }
}

// His card left the New sign-ups list: keep keyboard focus on that tab
function focusPotentialList() {
    const next = (elements.potentialList && elements.potentialList.querySelector('button')) || document.querySelector('#tab-potential h2');
    if (!next) return;
    if (next.tagName === 'H2') next.setAttribute('tabindex', '-1');
    next.focus();
}

// ---- Trip payments: the Paid column and its sheet ----

function paidCellHtml(p, name) {
    if (!p || !p.id) return '<span class="rsvp-muted">—</span>';
    const state = supabaseInstance ? payData.trip.state : 'off';
    if (state === 'missing') return `<span class="rsvp-muted" title="${PAY_SETUP_TEXT}">Being set up</span>`;
    if (state === 'error' || state === 'off') return '<span class="rsvp-muted">—</span>';
    if (state !== 'ok') return '<span class="rsvp-muted">…</span>';
    const rows = tripPaymentsOf(p.id);
    const who = escHtml(name || p.name);
    const id = escHtml(p.id);
    if (!rows.length) return `<button type="button" class="cell-btn is-empty" data-pay="${id}">Add<span class="sr-only"> a trip payment for ${who}</span></button>`;
    const total = rows.reduce((sum, r) => sum + centsOf(r.amount), 0);
    const count = `${rows.length} payment${rows.length === 1 ? '' : 's'}`;
    return `<button type="button" class="cell-btn" data-pay="${id}" title="${count}">${money(total)}<span class="sr-only">: ${who}’s trip payments (${count})</span></button>`;
}

// An email that may wrap: at the @ first, rather than mid-word
function emailHtml(email) {
    return escHtml(email).replace('@', '<wbr>@');
}

// "Paid toward trip": everything recorded for this year, with the counts
function paidPillHtml(pill) {
    if (!supabaseInstance || payData.trip.state !== 'ok') return '';
    const year = paymentsYear();
    const rows = payData.trip.rows.filter(r => Number(r.trip_year) === year);
    const who = new Set(rows.map(r => r.player_id)).size;
    return pill('Paid toward trip', money(rows.reduce((sum, r) => sum + centsOf(r.amount), 0)), who ? `${who} player${who === 1 ? '' : 's'}` : '');
}

// Removing a player who has trip payments: the database refuses it, so say so now
function tripPaymentsBlockRemoval(p) {
    if (!p.id || payData.trip.state !== 'ok') return false;
    const rows = payData.trip.rows.filter(r => r.player_id === p.id);
    if (!rows.length) return false;
    // Which trips they're for, this one first: "$1,600 for 2027, $1,500 for 2026"
    const thisYear = paymentsYear();
    const years = [...new Set(rows.map(r => Number(r.trip_year)))]
        .sort((a, b) => (b === thisYear) - (a === thisYear) || b - a);
    const byYear = years.map(y => `${money(rows.filter(r => Number(r.trip_year) === y)
        .reduce((sum, r) => sum + centsOf(r.amount), 0))} for ${y}`).join(', ');
    const name = p.name || 'This player';
    const onlyThisYear = years.length === 1 && years[0] === thisYear;
    alert(`${name} has trip payments recorded (${byYear}), so he can’t be removed.\n\n` + (onlyThisYear
        ? 'If he’s really off the trip, delete his trip payments first: RSVPs tab, Paid column.'
        : `Payments from other years are the record of those trips. Skipping ${thisYear}? Keep him: his 'Out' RSVP keeps him off the head count.\n\n` +
          'If he’s gone for good, delete his payments first: RSVPs tab, Paid column. His button there lists them, with other years under “Other trips”.'));
    return true;
}

const paySheet = { playerId: null, busy: false };

function openPaySheet(playerId, opener) {
    const p = findRosterPlayer(playerId);
    if (!p || payData.trip.state !== 'ok') return;
    paySheet.playerId = playerId;
    document.getElementById('pay-sheet-title').textContent = p.name || 'Trip payments';
    document.getElementById('pay-sheet-sub').textContent = `Trip payments for BBB ${paymentsYear()}. Each one saves right away.`;
    const date = document.getElementById('pay-date');
    document.getElementById('pay-amount').value = '';
    document.getElementById('pay-note').value = '';
    date.value = localDate();
    date.max = localDate(365);
    setSheetError('pay-error', '');
    document.getElementById('pay-sheet-status').textContent = '';
    renderPaySheet();
    // On a phone, start on the heading so the keyboard doesn't cover the payments list
    const title = document.getElementById('pay-sheet-title');
    title.setAttribute('tabindex', '-1');
    const touch = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    openSheet(document.getElementById('pay-sheet'), opener, touch ? title : document.getElementById('pay-amount'));
}

function renderPaySheet() {
    const id = paySheet.playerId;
    const list = document.getElementById('pay-sheet-list');
    const totalEl = document.getElementById('pay-sheet-total');
    if (!id || !list || !totalEl) return;
    const rows = tripPaymentsOf(id);
    const total = rows.reduce((sum, r) => sum + centsOf(r.amount), 0);
    const cost = tripCost();
    const of = cost ? ` <span>of ${cost.approx ? 'about ' : ''}${money(cost.cents)}</span>` : '';
    totalEl.innerHTML = rows.length ? `Paid ${money(total)}${of}` : `Nothing recorded yet.${cost ? ` <span>The trip is ${cost.approx ? 'about ' : ''}${money(cost.cents)} per person.</span>` : ''}`;
    const sheet = document.getElementById('pay-sheet');
    const had = sheet && sheet.contains(document.activeElement) ? focusKey(document.activeElement) : null;
    const item = (r, trip) => {
        const amount = money(centsOf(r.amount));
        const day = escHtml(fmtDay(r.paid_on));
        const year = trip ? ` for BBB ${escHtml(String(r.trip_year))}` : '';
        return `<li>
            <div class="pay-item">${trip ? `<span class="pay-item-trip">BBB ${escHtml(String(r.trip_year))}</span> ` : ''}<b>${amount}</b> <span class="pay-item-date">· ${day}</span>${r.note ? `<div class="pay-item-note">${escHtml(r.note)}</div>` : ''}</div>
            <button type="button" class="pay-del" data-pay-delete="${escHtml(r.id)}">Delete<span class="sr-only"> the ${amount} payment from ${day}${year}</span></button>
        </li>`;
    };
    list.innerHTML = rows.map(r => item(r, false)).join('');
    list.hidden = !rows.length;
    // Other trip years (a removed player's payments block his removal, so they're listed here to see,
    // and to delete if he's really gone): newest trip first
    const thisYear = paymentsYear();
    const others = payData.trip.rows.filter(r => r.player_id === id && Number(r.trip_year) !== thisYear)
        .sort((a, b) => Number(b.trip_year) - Number(a.trip_year) || byPaidOn(a, b));
    const otherWrap = document.getElementById('pay-sheet-other');
    if (otherWrap) {
        document.getElementById('pay-sheet-other-list').innerHTML = others.map(r => item(r, true)).join('');
        document.getElementById('pay-sheet-other-hint').textContent =
            `Kept as the record of those trips. They don’t count toward ${thisYear}, and he can’t be removed from the roster while any are here.`;
        otherWrap.hidden = !others.length;
    }
    const again = had && sheet.querySelector(had);
    if (again) again.focus();
}

function setSheetError(id, text) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text || '';
    el.hidden = !text;
}

// What the admin typed as an amount: "800", "$1,600", "812.50"
function parseAmount(raw) {
    const s = String(raw || '').trim().replace(/^\$\s*/, '').replace(/,/g, '');
    if (!/^(\d+(\.\d{1,2})?|\.\d{1,2})$/.test(s)) return null;
    return Math.round(Number(s) * 100);
}

async function addTripPayment(e) {
    e.preventDefault();
    if (paySheet.busy || !paySheet.playerId) return;
    const amountEl = document.getElementById('pay-amount');
    const dateEl = document.getElementById('pay-date');
    const noteEl = document.getElementById('pay-note');
    const btn = document.getElementById('pay-add-btn');
    const cents = parseAmount(amountEl.value);
    const fail = (text, el) => { setSheetError('pay-error', text); if (el) el.focus(); };
    if (cents === null) return fail('Enter the amount in dollars, like 800 or 812.50.', amountEl);
    if (cents < 1 || cents > 1000000) return fail('The amount should be between $0.01 and $10,000.', amountEl);
    const day = dateEl.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return fail('Pick the day he paid.', dateEl);
    if (day < '2020-01-01' || day > localDate(365)) return fail('That payment date doesn’t look right.', dateEl);
    const note = noteEl.value.trim();
    if (note.length > 200) return fail('Keep the note to 200 characters.', noteEl);
    setSheetError('pay-error', '');

    const playerId = paySheet.playerId;
    paySheet.busy = true;
    btn.disabled = true;
    btn.textContent = 'Adding…';
    let res;
    try {
        res = await supabaseInstance.rpc('admin_add_trip_payment', {
            p_player: playerId, p_trip_year: paymentsYear(), p_amount: cents / 100, p_paid_on: day, p_note: note || null
        });
    } catch (err) {
        res = { error: err };
    }
    paySheet.busy = false;
    btn.disabled = false;
    btn.textContent = 'Add payment';
    if (res.error || !res.data) {
        const err = res.error || new Error('Nothing came back. Refresh to check whether it saved.');
        fail(isSetupMissing(err) ? PAY_SETUP_TEXT : err.code === '22007' ? 'That payment date doesn’t look right.' : plainError(err), amountEl);
        return;
    }
    dropStaleReads(payData.trip, loadTripPayments);
    payData.trip.rows = payData.trip.rows.filter(r => r.id !== res.data.id).concat([res.data]).sort(byPaidOn);
    const p = findRosterPlayer(playerId);
    const said = `Added ${money(centsOf(res.data.amount))} (${fmtDay(res.data.paid_on)}) for ${(p && p.name) || 'him'}.`;
    if (paySheet.playerId === playerId) {
        amountEl.value = '';
        noteEl.value = '';
        renderPaySheet();
        document.getElementById('pay-sheet-status').textContent = said;
        amountEl.focus();
    }
    if (rsvpLoaded && !rsvpLoading) renderRsvpAdmin();
    window.showToast(escHtml(said), 'success');
}

async function deleteTripPayment(id, btn) {
    const r = payData.trip.rows.find(x => x.id === id);
    if (!r || paySheet.busy) return;
    const p = findRosterPlayer(r.player_id);
    const name = (p && p.name) || 'this player';
    const what = `the ${money(centsOf(r.amount))} payment from ${fmtDay(r.paid_on)}${r.note ? ` (“${r.note}”)` : ''}`;
    const otherTrip = Number(r.trip_year) !== paymentsYear();
    if (!confirm(otherTrip
        ? `Delete ${what} for BBB ${r.trip_year}?\n\nIt’s the record of what ${name} paid for that trip. Once it’s deleted, it’s gone from the site for good.`
        : `Delete ${what}?\n\nIt comes off ${name}’s total, and he won’t see it any more.`)) return;
    paySheet.busy = true;
    btn.disabled = true;
    let res;
    try {
        res = await supabaseInstance.rpc('admin_delete_trip_payment', { p_id: id });
    } catch (err) {
        res = { error: err };
    }
    paySheet.busy = false;
    // Already gone (deleted on another device) is what was wanted
    if (res.error && res.error.code !== 'P0002') {
        btn.disabled = false;
        setSheetError('pay-error', isSetupMissing(res.error) ? PAY_SETUP_TEXT : `Couldn’t delete it: ${plainError(res.error)}`);
        return;
    }
    const deletes = () => [...document.querySelectorAll('#pay-sheet [data-pay-delete]')];
    const at = deletes().indexOf(btn);
    dropStaleReads(payData.trip, loadTripPayments);
    payData.trip.rows = payData.trip.rows.filter(x => x.id !== id);
    setSheetError('pay-error', '');
    renderPaySheet();
    const said = `Deleted ${name}’s ${money(centsOf(r.amount))} payment from ${fmtDay(r.paid_on)}${otherTrip ? ` (BBB ${r.trip_year})` : ''}.`;
    document.getElementById('pay-sheet-status').textContent = said;
    // Focus the delete that took its place (or the one above), else the amount box
    const left = deletes();
    (left[Math.min(at, left.length - 1)] || document.getElementById('pay-amount')).focus();
    if (rsvpLoaded && !rsvpLoading) renderRsvpAdmin();
    window.showToast(escHtml(said), 'success');
}

// ---- Venmo usernames: the roster's Venmo column and its sheet ----

// Same rule as the rest of the site: trims, takes a pasted venmo.com link or a leading @, and
// checks what's left. { handle } (null to remove it) or { error }.
function cleanVenmoInput(raw) {
    let v = String(raw || '').trim();
    if (/venmo\.com\//i.test(v)) v = v.replace(/^(https?:\/\/)?(www\.|account\.)?venmo\.com\/(u\/)?/i, '').replace(/[/?#].*$/, '');
    v = v.replace(/^@/, '');
    if (!v) return { handle: null };
    return /^[a-z0-9_-]{5,30}$/.test(v.toLowerCase()) ? { handle: v } : { error: VENMO_RULE };
}

function venmoCellHtml(p) {
    if (!supabaseInstance) return '<span class="rsvp-muted">—</span>';
    if (!p.id) return '<span class="rsvp-muted">After Save</span>';
    const v = payData.venmo;
    if (v.state === 'missing') return `<span class="rsvp-muted" title="${PAY_SETUP_TEXT}">Being set up</span>`;
    if (v.state === 'error') return '<span class="rsvp-muted">—</span>';
    if (v.state !== 'ok') return '<span class="rsvp-muted">…</span>';
    const row = v.byPlayer.get(p.id);
    const who = escHtml(p.name || 'this player');
    const id = escHtml(p.id);
    return row
        ? `<button type="button" class="cell-btn" data-venmo="${id}" title="@${escHtml(row.handle)}"><span class="venmo-handle">@${escHtml(row.handle)}</span><span class="sr-only">: ${who}’s Venmo username. Change it</span></button>`
        : `<button type="button" class="cell-btn is-empty" data-venmo="${id}">Add<span class="sr-only"> ${who}’s Venmo username</span></button>`;
}

// Only the Venmo cells, so typing elsewhere in the roster isn't interrupted
function refreshVenmoCells() {
    if (!elements.rosterTbody) return;
    elements.rosterTbody.querySelectorAll('td[data-venmo-cell]').forEach(td => {
        const p = players[Number(td.closest('tr').dataset.index)];
        if (!p) return;
        const had = td.contains(document.activeElement);
        td.innerHTML = venmoCellHtml(p);
        const btn = had && td.querySelector('button');
        if (btn) btn.focus();
    });
}

const venmoSheet = { playerId: null, busy: false };

function openVenmoSheet(playerId, opener) {
    const p = players.find(x => x.id === playerId) || findRosterPlayer(playerId);
    if (!p || payData.venmo.state !== 'ok') return;
    venmoSheet.playerId = playerId;
    const row = payData.venmo.byPlayer.get(playerId);
    document.getElementById('venmo-sheet-title').textContent = p.name ? `${p.name}’s Venmo` : 'Venmo';
    const input = document.getElementById('venmo-input');
    input.value = row ? row.handle : '';
    // Who set it and when: him, or an admin
    let meta = 'None saved yet. Players can add their own too.';
    if (row) {
        const by = row.updated_by === playerId ? 'him' : (findRosterPlayer(row.updated_by) || {}).name;
        const when = row.updated_at ? new Date(row.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
        meta = `Saved${when ? ` ${when}` : ''}${by ? ` by ${by}` : ''}.`;
    }
    document.getElementById('venmo-sheet-sub').textContent = meta;
    setSheetError('venmo-error', '');
    updateVenmoCheck();
    openSheet(document.getElementById('venmo-sheet'), opener, input);
}

// "Check @handle on Venmo": his public Venmo page, to see it's the right person
function updateVenmoCheck() {
    const wrap = document.getElementById('venmo-check-wrap');
    const link = document.getElementById('venmo-check');
    const c = cleanVenmoInput(document.getElementById('venmo-input').value);
    if (!c.handle) {
        wrap.hidden = true;
        link.removeAttribute('href');
        return;
    }
    const url = new URL('https://venmo.com/');
    url.pathname = '/u/' + encodeURIComponent(c.handle.toLowerCase());
    link.href = url.href;
    document.getElementById('venmo-check-handle').textContent = '@' + c.handle;
    wrap.hidden = false;
}

async function saveVenmoSheet(e) {
    e.preventDefault();
    if (venmoSheet.busy || !venmoSheet.playerId) return;
    const id = venmoSheet.playerId;
    const p = players.find(x => x.id === id) || findRosterPlayer(id) || {};
    const input = document.getElementById('venmo-input');
    const btn = document.getElementById('venmo-save-btn');
    const c = cleanVenmoInput(input.value);
    if (c.error) {
        setSheetError('venmo-error', c.error);
        input.focus();
        return;
    }
    const current = payData.venmo.byPlayer.get(id);
    if ((current ? current.handle : null) === c.handle) {
        closeSheet();
        return;
    }
    if (!c.handle && !confirm(`Remove ${p.name || 'this player'}’s Venmo username (@${current.handle})?`)) return;
    setSheetError('venmo-error', '');
    venmoSheet.busy = true;
    btn.disabled = true;
    btn.textContent = 'Saving…';
    let res;
    try {
        res = await supabaseInstance.rpc('admin_set_venmo', { p_player: id, p_handle: c.handle });
    } catch (err) {
        res = { error: err };
    }
    venmoSheet.busy = false;
    btn.disabled = false;
    btn.textContent = 'Save';
    if (res.error) {
        setSheetError('venmo-error', isSetupMissing(res.error) ? PAY_SETUP_TEXT : plainError(res.error));
        input.focus();
        return;
    }
    const row = res.data || {};
    dropStaleReads(payData.venmo, loadVenmo);
    if (row.handle) payData.venmo.byPlayer.set(id, row);
    else payData.venmo.byPlayer.delete(id);
    refreshVenmoCells();
    closeSheet();
    window.showToast(row.handle ? `Saved @${escHtml(row.handle)} for ${escHtml(p.name)}.` : `Removed ${escHtml(p.name)}’s Venmo username.`, 'success');
}

// ---- Sheets (dialogs) ----

let sheetOpen = null; // { el, opener, key }

function openSheet(el, opener, focusEl) {
    if (!el) return;
    if (sheetOpen) closeSheet(false);
    sheetOpen = { el, opener, key: opener ? focusKey(opener) : null };
    el.classList.add('open');
    const page = document.querySelector('.admin-container');
    if (page) page.inert = true; // the page behind can't be reached until it closes
    document.documentElement.style.overflow = 'hidden';
    setTimeout(() => { if (sheetOpen && sheetOpen.el === el) (focusEl || el.querySelector('input, button')).focus(); }, 30);
}

function closeSheet(restoreFocus = true) {
    if (!sheetOpen) return;
    const { el, opener, key } = sheetOpen;
    sheetOpen = null;
    el.classList.remove('open');
    if (el.id === 'pay-sheet') paySheet.playerId = null;
    if (el.id === 'venmo-sheet') venmoSheet.playerId = null;
    const page = document.querySelector('.admin-container');
    if (page) page.inert = false;
    document.documentElement.style.overflow = '';
    if (!restoreFocus) return;
    // The button that opened it, or the same button drawn again since
    const target = opener && opener.isConnected ? opener : key ? document.querySelector(key) : null;
    if (target) target.focus();
}

function sheetBusy() {
    return paySheet.busy || venmoSheet.busy;
}

function setupPaymentListeners() {
    document.addEventListener('click', (e) => {
        if (e.target.closest('[data-retry-pay]')) retryPaymentLoads();
    });
    elements.rosterTbody?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-venmo]');
        if (btn) openVenmoSheet(btn.dataset.venmo, btn);
    });
    elements.potentialList?.addEventListener('click', (e) => {
        const approve = e.target.closest('[data-approve-pick]');
        if (approve) approvePick(approve.dataset.approvePick, approve);
        const release = e.target.closest('[data-release]');
        if (release) releaseClaim(release.dataset.release, release);
    });
    ['pay-sheet', 'venmo-sheet'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('click', (e) => {
            // Outside the box, or a Close/Done/Cancel button
            if ((e.target === el || e.target.closest('[data-sheet-close]')) && !sheetBusy()) closeSheet();
        });
    });
    document.getElementById('pay-form')?.addEventListener('submit', addTripPayment);
    // This trip's payments and other trips' (both lists in the sheet)
    document.getElementById('pay-sheet')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-pay-delete]');
        if (btn) deleteTripPayment(btn.dataset.payDelete, btn);
    });
    document.getElementById('venmo-form')?.addEventListener('submit', saveVenmoSheet);
    document.getElementById('venmo-input')?.addEventListener('input', () => {
        updateVenmoCheck();
        setSheetError('venmo-error', '');
    });
    // Escape closes; Tab stays inside the open sheet
    document.addEventListener('keydown', (e) => {
        if (!sheetOpen) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            if (!sheetBusy()) closeSheet();
            return;
        }
        if (e.key !== 'Tab') return;
        const items = [...sheetOpen.el.querySelectorAll('a[href], button:not([disabled]), input:not([disabled])')]
            .filter(x => x.getClientRects().length);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || !sheetOpen.el.contains(document.activeElement))) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !sheetOpen.el.contains(document.activeElement))) {
            e.preventDefault();
            first.focus();
        }
    });
}
