// Supabase Configuration from main app
const SUPABASE_URL = 'https://gxpwgrdyizruzfczzqwn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uo20KpEYmGXAIB9JGL1CnQ_wIxT8GX4';
let supabaseClient = null; // Initialized inside initBookie after CDN loads

// State
let currentUser = null;
let dbPlayers = [];
let allWagers = [];
let authMode = 'login'; // 'login' or 'register'

// DOM Elements
const authWall = document.getElementById('auth-wall');
const dashboard = document.getElementById('bookie-dashboard');
const currentUserNameEl = document.getElementById('current-user-name');
const modal = document.getElementById('bookie-modal');
const modalClose = document.getElementById('bookie-modal-close');
const authForm = document.getElementById('auth-form');
const createWagerForm = document.getElementById('create-wager-form');
const modalTitle = document.getElementById('modal-title');

// Auth Form Elements
const wallLoginBtn = document.getElementById('wall-login-btn');
const wallRegisterBtn = document.getElementById('wall-register-btn');
const navLoginBtn = document.getElementById('bookie-login-btn');
const toggleAuthModeBtn = document.getElementById('toggle-auth-mode');
const registerFields = document.getElementById('register-fields');
const authNameInput = document.getElementById('auth-name');
const authEmailInput = document.getElementById('auth-email');
const authPasswordInput = document.getElementById('auth-password');
const authSubmitBtn = document.getElementById('auth-submit-btn');
const authErrorEl = document.getElementById('auth-error');

// Wager Form Elements
const openWagerBtn = document.getElementById('create-wager-btn');
const wagerTypeSelect = document.getElementById('wager-type');
const h2hTargetContainer = document.getElementById('h2h-target-container');
const wagerTargetSelect = document.getElementById('wager-target');
const wagerDescInput = document.getElementById('wager-desc');
const wagerAmtInput = document.getElementById('wager-amt');

// Containers
const wagersContainer = document.getElementById('wagers-container');
const ledgerContainer = document.getElementById('ledger-container');
const ryderBluePts = document.getElementById('ryder-blue-pts');
const ryderRedPts = document.getElementById('ryder-red-pts');
const filterBtns = document.querySelectorAll('.bookie-nav button');

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
    console.log('The Bookie initialized. Supabase client ready.');

    setupEventListeners();
    await checkUserSession();
    if (currentUser) {
        await fetchBaseData();
        renderDashboard();
    }
}

function setupEventListeners() {
    // Modal controls
    modalClose.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    // Auth flows
    wallLoginBtn.addEventListener('click', () => openAuthModal('login'));
    navLoginBtn.addEventListener('click', () => {
        if (currentUser) {
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

    authForm.addEventListener('submit', handleAuthSubmit);

    // Wager flows
    openWagerBtn.addEventListener('click', openWagerModal);
    wagerTypeSelect.addEventListener('change', (e) => {
        h2hTargetContainer.style.display = e.target.value === 'h2h' ? 'block' : 'none';
        if (e.target.value === 'h2h') wagerTargetSelect.required = true;
        else wagerTargetSelect.required = false;
    });
    createWagerForm.addEventListener('submit', handleCreateWager);

    // Filters
    filterBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            filterBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            renderWagers(e.target.dataset.filter);
        });
    });
}

// ==========================================
// Auth Logic
// ==========================================
async function checkUserSession() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    
    if (session) {
        // Find them in our players table
        const { data: player } = await supabaseClient
            .from('players')
            .select('*')
            .eq('user_id', session.user.id)
            .single();

        if (player) {
            currentUser = player;
            showDashboard();
        } else {
            console.warn("Auth user has no matching player profile.");
            showWall();
        }
    } else {
        showWall();
    }

    supabaseClient.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') {
            currentUser = null;
            showWall();
        }
    });
}

function showWall() {
    authWall.style.display = 'block';
    dashboard.style.display = 'none';
    navLoginBtn.textContent = 'Login / Register';
}

function showDashboard() {
    authWall.style.display = 'none';
    dashboard.style.display = 'block';
    currentUserNameEl.textContent = currentUser.name;
    navLoginBtn.textContent = 'Log Out';
}

function openAuthModal(mode) {
    authMode = mode;
    authErrorEl.style.display = 'none';
    authForm.reset();
    
    authForm.style.display = 'block';
    createWagerForm.style.display = 'none';

    if (mode === 'register') {
        modalTitle.textContent = 'Create Betting Account';
        registerFields.style.display = 'block';
        authSubmitBtn.textContent = 'Sign Up';
        toggleAuthModeBtn.textContent = 'Already have an account? Log in here.';
        authNameInput.required = true;
    } else {
        modalTitle.textContent = 'Log In to The Bookie';
        registerFields.style.display = 'none';
        authSubmitBtn.textContent = 'Log In';
        toggleAuthModeBtn.textContent = 'Need an account? Sign up here.';
        authNameInput.required = false;
    }
    
    modal.classList.add('active');
}

async function handleAuthSubmit(e) {
    e.preventDefault();
    authErrorEl.style.display = 'none';
    authSubmitBtn.disabled = true;
    authSubmitBtn.textContent = 'Processing...';

    const email = authEmailInput.value;
    const password = authPasswordInput.value;
    const name = authNameInput.value;

    try {
        if (authMode === 'register') {
            // 1. Double check the name matches someone on the roster
            // (We usually don't want randos signing up, just guys actually going)
            const { data: rosterMatch } = await supabaseClient
                .from('players')
                .select('id, name, user_id')
                .ilike('name', name)
                .single();

            if (!rosterMatch) {
                throw new Error(`Could not find "${name}" on the trip roster. Please use your exact roster name.`);
            }

            if (rosterMatch.user_id) {
                throw new Error(`An account already exists for ${name}. Try logging in instead.`);
            }

            // 2. Register them with Supabase Auth
            const { data: authData, error: regError } = await supabaseClient.auth.signUp({
                email: email,
                password: password,
            });

            if (regError) throw regError;

            // 3. Link their newly created Auth User ID to their Player record
            if (authData.user) {
                const { error: linkError } = await supabaseClient
                    .from('players')
                    .update({ user_id: authData.user.id })
                    .eq('id', rosterMatch.id);
                
                if (linkError) throw linkError;
            }

            alert("Account created successfully! You are now logged in.");

        } else {
            // Login flow
            const { error: loginError } = await supabaseClient.auth.signInWithPassword({
                email: email,
                password: password,
            });

            if (loginError) throw loginError;
        }

        closeModal();
        await checkUserSession(); // This will fetch current user and reload board
        if (currentUser) {
            await fetchBaseData();
            renderDashboard();
        }

    } catch (err) {
        authErrorEl.textContent = err.message;
        authErrorEl.style.display = 'block';
    } finally {
        authSubmitBtn.disabled = false;
        authSubmitBtn.textContent = authMode === 'register' ? 'Sign Up' : 'Log In';
    }
}

async function handleLogout() {
    await supabaseClient.auth.signOut();
}

// ==========================================
// Data & Rendering
// ==========================================
async function fetchBaseData() {
    // Get all drafted players to populate dropdowns
    const { data: players } = await supabaseClient
        .from('players')
        .select('id, name, team_id')
        .order('name');
    
    if (players) dbPlayers = players;

    // Fetch wagers (We'll implement the actual wagers table later, this avoids breaking if the table doesn't exist yet)
    try {
        const { data: wagers, error } = await supabaseClient
            .from('wagers')
            .select(`
                *,
                creator:creator_id(name)
            `)
            .order('created_at', { ascending: false });
        
        if (!error && wagers) {
            allWagers = wagers;
        }
    } catch (e) {
        console.warn("Wagers table likely not created yet.", e);
    }
}

function renderDashboard() {
    renderRyderCupMainEvent();
    renderWagers('all');
    renderLedger();
}

function renderRyderCupMainEvent() {
    // This replicates the Ryder Cup score fetch from script.js
    // For now we will mock it or leave it as 0
    ryderBluePts.textContent = '0';
    ryderRedPts.textContent = '0';
}

function renderWagers(filter) {
    if (allWagers.length === 0) {
        wagersContainer.innerHTML = `
            <div style="text-align: center; padding: 40px; background: rgba(255,255,255,0.02); border-radius: 12px; border: 1px dashed rgba(255,255,255,0.1);">
                <p style="color: var(--text-muted); margin-bottom: 15px;">No active wagers found for this filter.</p>
                <button class="btn" style="border: 1px solid var(--accent-emerald); color: var(--accent-emerald);" onclick="openWagerModal()">Be the first to bet</button>
            </div>
        `;
        return;
    }

    wagersContainer.innerHTML = allWagers.map(wager => {
        const isCreator = currentUser && wager.creator_id === currentUser.id;
        const isTarget = currentUser && wager.target_id === currentUser.id;
        const isParticipant = currentUser && wager.participants && wager.participants.includes(currentUser.id);
        const participantsCount = wager.participants ? wager.participants.length : 0;
        
        const canDelete = isCreator && (
            (wager.type === 'h2h' && wager.status === 'proposed') ||
            (wager.type === 'pool' && participantsCount <= 1)
        );

        let statusBadge = '';
        if (wager.status === 'open') statusBadge = `<span style="background: rgba(16, 185, 129, 0.2); color: var(--accent-emerald); padding: 4px 8px; border-radius: 4px; font-size: 0.8rem;">Open</span>`;
        if (wager.status === 'proposed') statusBadge = `<span style="background: rgba(251, 191, 36, 0.2); color: var(--accent-gold); padding: 4px 8px; border-radius: 4px; font-size: 0.8rem;">Proposed</span>`;
        if (wager.status === 'active') statusBadge = `<span style="background: rgba(59, 130, 246, 0.2); color: #60a5fa; padding: 4px 8px; border-radius: 4px; font-size: 0.8rem;">Active</span>`;
        if (wager.status === 'settled') statusBadge = `<span style="background: rgba(255, 255, 255, 0.1); color: var(--text-muted); padding: 4px 8px; border-radius: 4px; font-size: 0.8rem;">Settled</span>`;
        
        let deleteBtnHtml = '';
        if (canDelete) {
            deleteBtnHtml = `<div style="margin-top: 8px;"><button style="background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; cursor: pointer; transition: all 0.2s;" onclick="window.deleteWager('${wager.id}')"><i class="fas fa-trash" style="margin-right: 4px;"></i>Delete</button></div>`;
        }

        let actionHtml = '';
        if (wager.status === 'open' && !isParticipant) {
            actionHtml = `<button class="btn" style="width: 100%; margin-top: 15px; padding: 10px;" onclick="window.joinWager('${wager.id}')">Join Bet ($${wager.amount})</button>`;
        } else if (wager.status === 'proposed' && isTarget) {
            actionHtml = `<button class="btn" style="width: 100%; margin-top: 15px; padding: 10px;" onclick="window.acceptWager('${wager.id}')">Accept Challenge</button>`;
        } else if (isParticipant || isCreator) {
            actionHtml = `<div style="margin-top: 15px; text-align: center; color: var(--text-muted); font-size: 0.9rem;">You are in this bet</div>`;
        }
        
        const typeLabel = wager.type === 'h2h' ? 'Head-to-Head' : 'Pool';
        const targetLabel = wager.target ? `<div style="font-size: 0.85rem; color: var(--accent-gold); margin-bottom: 10px;">Challenging: ${wager.target.name}</div>` : '';
        const potSize = participantsCount * wager.amount;

        let resultsHtml = '';
        if (wager.status === 'settled' && wager.winner_id) {
            const losers = wager.participants.filter(id => id !== wager.winner_id);
            const loserNames = losers.map(id => getPlayerName(id)).join(', ');
            const totalWon = losers.length * wager.amount;
            
            resultsHtml = `
                <div style="margin-top: 15px; padding: 15px; background: rgba(16, 185, 129, 0.1); border-radius: 8px; border: 1px solid rgba(16, 185, 129, 0.2);">
                    <div style="color: var(--accent-emerald); font-weight: 700; margin-bottom: 5px;"><i class="fas fa-trophy"></i> Won by ${wager.winner.name}</div>
                    <div style="font-size: 0.85rem; color: var(--text-muted);">${loserNames || 'Nobody'} each owe $${wager.amount} to ${wager.winner.name}</div>
                </div>
            `;
        }

        return `
            <div class="glass-panel" style="margin-bottom: 20px; padding: 20px; border-left: 4px solid ${wager.type === 'h2h' ? 'var(--accent-gold)' : 'var(--accent-emerald)'};">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
                    <div>
                        <div style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 5px;">${wager.creator ? wager.creator.name : 'Unknown'} • ${typeLabel}</div>
                        <h4 style="font-size: 1.1rem; margin-bottom: 5px;">${wager.description}</h4>
                        ${targetLabel}
                    </div>
                    <div style="text-align: right;">
                        <div>${statusBadge}</div>
                        ${deleteBtnHtml}
                    </div>
                </div>
                
                <div style="display: flex; gap: 15px; margin-top: 15px; padding-top: 15px; border-top: 1px solid var(--glass-border);">
                    <div>
                        <div style="font-size: 0.8rem; color: var(--text-muted);">Buy-In</div>
                        <div style="font-weight: 700;">$${wager.amount}</div>
                    </div>
                    <div>
                        <div style="font-size: 0.8rem; color: var(--text-muted);">Pot</div>
                        <div style="font-weight: 700; color: var(--accent-emerald);">$${potSize}</div>
                    </div>
                    <div>
                        <div style="font-size: 0.8rem; color: var(--text-muted);">In</div>
                        <div style="font-weight: 700;">${participantsCount} <i class="fas fa-users" style="font-size: 0.8rem;"></i></div>
                    </div>
                </div>
                ${actionHtml}
                ${resultsHtml}
            </div>
        `;
    }).join('');
}

// Temporary action handlers for Phase 2
window.joinWager = function(id) {
    alert("Joining pools is coming in the next Phase update!");
};

window.acceptWager = function(id) {
    alert("Accepting challenges is coming in the next Phase update!");
};

window.deleteWager = async function(id) {
    if (!confirm("Are you sure you want to delete this wager?")) return;
    
    try {
        const { error } = await supabaseClient
            .from('wagers')
            .delete()
            .eq('id', id);
            
        if (error) throw error;
        
        await fetchBaseData();
        renderDashboard();
    } catch (err) {
        alert("Error deleting wager: " + err.message);
    }
};

function renderLedger() {
    const balances = {}; 
    
    dbPlayers.forEach(p => { balances[p.id] = 0; });

    allWagers.forEach(wager => {
        if (wager.status === 'settled' && wager.winner_id && wager.participants) {
            const losers = wager.participants.filter(id => id !== wager.winner_id);
            const wAmount = wager.amount;
            
            losers.forEach(loserId => {
                balances[loserId] = (balances[loserId] || 0) - wAmount;
                balances[wager.winner_id] = (balances[wager.winner_id] || 0) + wAmount;
            });
        }
    });

    const sortedBalances = Object.keys(balances)
        .map(id => ({ id, name: getPlayerName(id), balance: balances[id] }))
        .sort((a, b) => b.balance - a.balance);

    let ledgerHtml = '';
    sortedBalances.forEach(b => {
        if (b.balance !== 0 || b.id === currentUser.id) {
            const color = b.balance > 0 ? 'var(--accent-emerald)' : (b.balance < 0 ? '#ef4444' : 'var(--text-muted)');
            const sign = b.balance > 0 ? '+' : '';
            ledgerHtml += `
                <div style="display: flex; justify-content: space-between; padding: 12px 10px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <span style="font-weight: ${b.id === currentUser.id ? '700' : 'normal'}">${b.name} ${b.id === currentUser.id ? '(You)' : ''}</span>
                    <span style="color: ${color}; font-weight: 700;">${sign}$${b.balance}</span>
                </div>
            `;
        }
    });

    if (!ledgerHtml) {
         ledgerHtml = `<div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 15px; text-align: center;">No settled bets yet</div>`;
    }

    ledgerContainer.innerHTML = ledgerHtml;
}

function getPlayerName(id) {
    const p = dbPlayers.find(player => player.id === id);
    return p ? p.name : 'Unknown';
}

// ==========================================
// Creating Wagers
// ==========================================
function openWagerModal() {
    if (!currentUser) return;
    
    authForm.style.display = 'none';
    createWagerForm.style.display = 'block';
    createWagerForm.reset();
    modalTitle.textContent = 'Propose a Wager';

    wagerTargetSelect.innerHTML = '<option value="">Select an opponent...</option>';
    dbPlayers.forEach(p => {
        if (p.id !== currentUser.id && p.team_id !== null) {
            wagerTargetSelect.innerHTML += `<option value="${p.id}">${p.name}</option>`;
        }
    });

    h2hTargetContainer.style.display = 'none';
    modal.classList.add('active');
}

function closeModal() {
    modal.classList.remove('active');
}

async function handleCreateWager(e) {
    e.preventDefault();
    if (!currentUser) return;

    const type = wagerTypeSelect.value;
    const amount = wagerAmtInput.value;
    const desc = wagerDescInput.value;
    const targetId = wagerTargetSelect.value; // May be empty if pool

    const newWager = {
        creator_id: currentUser.id,
        type: type,
        amount: parseInt(amount),
        description: desc,
        status: type === 'h2h' ? 'proposed' : 'open',
        participants: [currentUser.id]
    };

    if (type === 'h2h') {
        newWager.target_id = targetId; // Requires DB update later to support this explicitly
    }

    try {
        const { error } = await supabaseClient.from('wagers').insert([newWager]);
        if (error) throw error;
        
        closeModal();
        await fetchBaseData();
        renderDashboard();
    } catch (err) {
        alert("Error proposing bet: Make sure the 'wagers' table is created in Supabase first!\n\n" + err.message);
    }
}

// Kickoff — handles both early and late script execution
console.log('The Bookie JS loaded. readyState:', document.readyState);
if (document.readyState === 'complete') {
    // Page already fully loaded (common with defer scripts on GitHub Pages)
    initBookie();
} else {
    window.addEventListener('load', initBookie);
}
