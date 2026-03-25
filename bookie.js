// Supabase Configuration from main app
const SUPABASE_URL = 'https://gxpwgrdyizruzfczzqwn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uo20KpEYmGXAIB9JGL1CnQ_wIxT8GX4';
let supabaseClient = null; // Initialized inside initBookie after CDN loads

// State
let currentUser = null;
let dbPlayers = [];
let allWagers = [];
let allComments = [];
let authMode = 'login'; // 'login' or 'register'

// DOM Elements
const authWall = document.getElementById('auth-wall');
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
const wagerOddsInput = document.getElementById('wager-odds');
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
        wagersContainer.innerHTML = getSkeletonHtml();
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
        if(window.updateOddsPreview) window.updateOddsPreview();
    });

    window.updateOddsPreview = function() {
        const previewEl = document.getElementById('odds-preview-text');
        if(!previewEl) return;
        
        const amountVal = parseFloat(wagerAmtInput.value);
        const oddsVal = parseInt(wagerOddsInput.value);
        
        if (isNaN(amountVal) || amountVal <= 0 || isNaN(oddsVal) || wagerTypeSelect.value !== 'h2h') {
            previewEl.style.display = 'none';
            return;
        }
        
        let toWin = 0;
        let targetRisks = 0;
        
        if (oddsVal > 0) {
            toWin = (amountVal * oddsVal) / 100;
            targetRisks = toWin;
        } else if (oddsVal < 0) {
            toWin = (amountVal * 100) / Math.abs(oddsVal);
            targetRisks = toWin;
        } else {
            toWin = amountVal;
            targetRisks = amountVal;
        }
        
        previewEl.style.display = 'block';
        previewEl.innerHTML = `
            <strong>You risk $${amountVal.toFixed(2)}</strong> to win $${toWin.toFixed(2)}.<br>
            <strong>Opponent risks $${targetRisks.toFixed(2)}</strong> to win your $${amountVal.toFixed(2)}.
        `;
    };

    wagerAmtInput.addEventListener('input', window.updateOddsPreview);
    wagerOddsInput.addEventListener('input', window.updateOddsPreview);

    // Settle Wager
    settleWagerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const wagerId = document.getElementById('settle-wager-id').value;
        const selectedInputs = document.querySelectorAll('input[name="settle-winner"]:checked');
        
        if (selectedInputs.length === 0) {
            showToast("Please select at least one winner.", "error");
            return;
        }
        
        const winnerIds = Array.from(selectedInputs).map(input => input.value);
        
        const wager = allWagers.find(w => w.id === wagerId);
        let finalWinnerIds = winnerIds;
        let primaryWinnerId = winnerIds[0];
        
        if (winnerIds.includes('takers')) {
            finalWinnerIds = wager.participants.filter(pid => pid !== wager.creator_id);
            primaryWinnerId = finalWinnerIds[0] || wager.creator_id; 
            if(finalWinnerIds.length === 0) {
                finalWinnerIds = [wager.creator_id]; 
                primaryWinnerId = wager.creator_id;
            }
        }
        
        try {
            const { error } = await supabaseClient
                .from('wagers')
                .update({ status: 'settled', winner_id: primaryWinnerId, winner_ids: finalWinnerIds })
                .eq('id', wagerId);
                
            if (error) throw error;
            
            closeModal();
            await fetchBaseData();
            renderDashboard();
            updateNotificationBadges();
            showToast("Wager settled successfully! Ledger updated.", "success");
        } catch (err) {
            showToast("Error settling wager: " + err.message, "error");
        }
    });

    // Alternative Settle Actions
    const settlePushBtn = document.getElementById('settle-push-btn');
    const settleCancelBtn = document.getElementById('settle-cancel-btn');

    if (settlePushBtn) settlePushBtn.addEventListener('click', () => handleAlternativeSettle('push'));
    if (settleCancelBtn) settleCancelBtn.addEventListener('click', () => handleAlternativeSettle('canceled'));

    async function handleAlternativeSettle(statusType) {
        const wagerId = document.getElementById('settle-wager-id').value;
        if (!confirm(`Are you sure you want to ${statusType === 'push' ? 'declare a Push (Tie)' : 'Cancel'} this bet? No money will exchange hands.`)) return;
        
        try {
            const { error } = await supabaseClient
                .from('wagers')
                .update({ status: statusType })
                .eq('id', wagerId);
                
            if (error) throw error;
            
            closeModal();
            await fetchBaseData();
            renderDashboard();
            updateNotificationBadges();
            showToast(`Wager ${statusType === 'push' ? 'pushed' : 'canceled'} successfully.`, "success");
        } catch (err) {
            showToast(`Error updating wager: ` + err.message, "error");
        }
    }

    // Auto-Settle
    window.handleAutoSettle = async function(wager) {
        if (!confirm("This will fetch the latest scores from the active round and automatically pick a winner based on To-Par Net Score. Are you sure?")) return;
        
        try {
            // 1. Get the active round
            const { data: activeRounds, error: rErr } = await supabaseClient
                .from('rounds')
                .select('id')
                .eq('status', 'active')
                .limit(1);
                
            if (rErr || !activeRounds || activeRounds.length === 0) {
                showToast("No active round found on the tracker.", "error");
                return;
            }
            
            const roundId = activeRounds[0].id;
            
            // 2. Get scores for the creator and target
            const { data: scores, error: sErr } = await supabaseClient
                .from('scores')
                .select('player_id, total_to_par')
                .eq('round_id', roundId)
                .in('player_id', [wager.creator_id, wager.target_id]);
                
            if (sErr) throw sErr;
            
            if (!scores || scores.length < 2) {
                showToast("Both players must have started scoring in the active round.", "error");
                return;
            }
            
            const cScore = scores.find(s => s.player_id === wager.creator_id).total_to_par;
            const tScore = scores.find(s => s.player_id === wager.target_id).total_to_par;
            
            let winnerId = null;
            let isPush = false;
            
            if (cScore < tScore) {
                winnerId = wager.creator_id;
            } else if (tScore < cScore) {
                winnerId = wager.target_id;
            } else {
                isPush = true;
            }
            
            // 3. Update wager
            const updateData = isPush ? { status: 'push' } : { status: 'settled', winner_id: winnerId, winner_ids: [winnerId] };
            
            const { error: wErr } = await supabaseClient
                .from('wagers')
                .update(updateData)
                .eq('id', wager.id);
                
            if (wErr) throw wErr;
            
            closeModal();
            await fetchBaseData();
            renderDashboard();
            updateNotificationBadges();
            
            if (isPush) {
                showToast("It's a tie! Wager pushed.", "success");
            } else {
                const winnerName = getPlayerName(winnerId);
                showToast(`Settled! ${winnerName} won with a better to-par score.`, "success");
            }
            
        } catch(e) {
            showToast("Error auto-settling: " + e.message, "error");
        }
    };

    // Create Wager Form
    createWagerForm.addEventListener('submit', handleCreateWager);

    // Filters
    const filterBtns = document.querySelectorAll('.bookie-nav button');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            filterBtns.forEach(b => b.classList.remove('active'));
            const targetBtn = e.target.closest('button');
            targetBtn.classList.add('active');
            
            // Sync with bottom nav
            const filter = targetBtn.dataset.filter;
            document.querySelectorAll('.bottom-nav-btn').forEach(b => b.classList.remove('active'));
            const botBtn = document.querySelector(`.bottom-nav-btn[data-filter="${filter}"]`);
            if(botBtn) botBtn.classList.add('active');
            
            renderWagers(filter);
        });
    });

    // Mobile Bottom Nav Filters
    const botBtns = document.querySelectorAll('.bottom-nav-btn[data-filter]');
    botBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            botBtns.forEach(b => b.classList.remove('active'));
            const targetBtn = e.target.closest('button');
            targetBtn.classList.add('active');
            
            // Sync with top nav
            const filter = targetBtn.dataset.filter;
            filterBtns.forEach(b => b.classList.remove('active'));
            const topBtn = document.querySelector(`.bookie-nav button[data-filter="${filter}"]`);
            if(topBtn) topBtn.classList.add('active');
            
            renderWagers(filter);
        });
    });

    // Mobile FAB
    const fabBtn = document.getElementById('fab-create-wager-btn');
    if(fabBtn) fabBtn.addEventListener('click', openWagerModal);

    setupMobileGestures();
}

function setupMobileGestures() {
    let startY = 0;
    let currentY = 0;
    let isRefreshing = false;
    
    // Add PTR indicator to DOM
    let ptrIndicator = document.createElement('div');
    ptrIndicator.className = 'ptr-indicator';
    // Requires FontAwesome spin animation which is native fa-spin usually, but we'll use standard inline rotating
    ptrIndicator.innerHTML = '<i class="fas fa-sync-alt fa-spin"></i> Fetching latest...';
    
    // Insert before wagers container
    const dashboardGrid = document.querySelector('.bookie-grid > div:first-child');
    if(dashboardGrid) dashboardGrid.insertBefore(ptrIndicator, wagersContainer);

    dashboard.addEventListener('touchstart', (e) => {
        if(window.scrollY === 0) startY = e.touches[0].clientY;
    }, {passive: true});

    dashboard.addEventListener('touchmove', (e) => {
        if(window.scrollY === 0 && startY > 0 && !isRefreshing) {
            currentY = e.touches[0].clientY;
            if(currentY - startY > 80) {
                ptrIndicator.classList.add('active');
            }
        }
    }, {passive: true});

    dashboard.addEventListener('touchend', async (e) => {
        if(ptrIndicator.classList.contains('active') && !isRefreshing) {
            isRefreshing = true;
            if(navigator.vibrate) navigator.vibrate(50);
            await fetchBaseData();
            renderDashboard();
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

    // Delegate swipe actions on wager cards
    let touchStartX = 0;
    let touchEndX = 0;
    let activeCard = null;

    wagersContainer.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
        activeCard = e.target.closest('.glass-panel[id^="wager-card-"]');
    }, {passive: true});

    wagersContainer.addEventListener('touchend', (e) => {
        if(!activeCard) return;
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe(activeCard);
    }, {passive: true});

    function handleSwipe(cardElement) {
        const threshold = 100; // minimum distance for a swipe in px
        
        if (touchEndX < touchStartX - threshold) {
            // Swipe Left -> Accept / Join
            const acceptBtn = cardElement.querySelector('.accept-btn, .join-btn');
            if(acceptBtn) acceptBtn.click();
        }
        
        if (touchEndX > touchStartX + threshold) {
            // Swipe Right -> Delete
            const deleteBtn = cardElement.querySelector('.delete-btn');
            if(deleteBtn) deleteBtn.click();
        }
    }
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
    settleWagerForm.style.display = 'none'; // Ensure settle form is hidden

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

            showToast("Account created successfully! You are now logged in.", "success");

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
            wagersContainer.innerHTML = getSkeletonHtml();
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
                creator:creator_id(name),
                target:target_id(name),
                winner:winner_id(name)
            `)
            .order('created_at', { ascending: false });
        
        if (!error && wagers) {
            allWagers = wagers;
        }
    } catch (e) {
        console.warn("Wagers table likely not created yet.", e);
    }

    // Fetch comments
    try {
        const { data: comments, error } = await supabaseClient
            .from('wager_comments')
            .select(`
                *,
                player:player_id (name)
            `);
        if (!error && comments) {
            allComments = comments;
        }
    } catch (e) {
        console.warn("wager_comments table likely not created yet.", e);
    }
}

function renderDashboard() {
    renderRyderCupMainEvent();
    renderWagers('all');
    renderLedger();
    updateNotificationBadges();
}

function updateNotificationBadges() {
    if (!currentUser) return;
    
    const pendingChallenges = allWagers.filter(w => w.status === 'proposed' && w.target_id === currentUser.id);
    const hasPending = pendingChallenges.length > 0;
    
    const h2hBtns = document.querySelectorAll('button[data-filter="h2h"]');
    const meBtns = document.querySelectorAll('button[data-filter="me"]');
    
    [...h2hBtns, ...meBtns].forEach(btn => {
        const hasDot = !!btn.querySelector('.notif-dot');
        if (hasPending && !hasDot) {
            btn.innerHTML += '<span class="notif-dot" style="display:inline-block; width:8px; height:8px; background:#ef4444; border-radius:50%; margin-left:6px; vertical-align:middle; box-shadow: 0 0 5px rgba(239, 68, 68, 0.8);"></span>';
        } else if (!hasPending && hasDot) {
            btn.querySelector('.notif-dot').remove();
        }
    });
}

async function renderRyderCupMainEvent() {
    if (!supabaseClient) return;
    try {
        const { data, error } = await supabaseClient
            .from('ryder_cup_scores')
            .select('*')
            .eq('id', 1)
            .single();

        if (error && error.code !== 'PGRST116') throw error;

        let bluePoints = 0;
        let redPoints = 0;

        if (data) {
            bluePoints = data.blue_score;
            redPoints = data.red_score;
        }

        if (ryderBluePts) ryderBluePts.textContent = bluePoints;
        if (ryderRedPts) ryderRedPts.textContent = redPoints;
    } catch (err) {
        console.error('Error fetching global Ryder Cup scores for Bookie:', err);
    }
}

function renderWagers(filter) {
    let displayWagers = allWagers;
    
    // The Ryder Cup card logic could overlap, but for now filtering specifically to standard wagers
    if (filter === 'pools') {
        displayWagers = allWagers.filter(w => w.type === 'pool');
    } else if (filter === 'h2h') {
        displayWagers = allWagers.filter(w => w.type === 'h2h');
    } else if (filter === 'me') {
        displayWagers = allWagers.filter(w => {
            if (!currentUser) return false;
            return w.creator_id === currentUser.id || (w.target_id && w.target_id === currentUser.id) || (w.participants && w.participants.includes(currentUser.id));
        });
    } else if (filter === 'ryder') {
        // Just hide custom wagers when Ryder Cup is selected
        displayWagers = [];
    }

    if (displayWagers.length === 0) {
        wagersContainer.innerHTML = `
            <div style="text-align: center; padding: 40px; background: rgba(255,255,255,0.02); border-radius: 12px; border: 1px dashed rgba(255,255,255,0.1);">
                <p style="color: var(--text-muted); margin-bottom: 15px;">No active wagers found for this filter.</p>
                <button class="btn" style="border: 1px solid var(--accent-emerald); color: var(--accent-emerald);" onclick="openWagerModal()">Be the first to bet</button>
            </div>
        `;
        return;
    }

    wagersContainer.innerHTML = displayWagers.map(wager => {
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
        if (wager.status === 'push') statusBadge = `<span style="background: rgba(251, 191, 36, 0.1); color: var(--accent-gold); padding: 4px 8px; border-radius: 4px; font-size: 0.8rem;">Pushed (Tie)</span>`;
        if (wager.status === 'canceled') statusBadge = `<span style="background: rgba(239, 68, 68, 0.1); color: #ef4444; padding: 4px 8px; border-radius: 4px; font-size: 0.8rem;">Canceled</span>`;
        
        let deleteBtnHtml = '';
        if (canDelete) {
            deleteBtnHtml = `<div style="margin-top: 8px;"><button class="delete-btn" style="background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; cursor: pointer; transition: all 0.2s;" onclick="window.deleteWager('${wager.id}')"><i class="fas fa-trash" style="margin-right: 4px;"></i>Delete</button></div>`;
        }

        let actionHtml = '';
        if (wager.status === 'open' && !isParticipant) {
            const btnText = wager.type === 'prop' ? 'Take this Action' : 'Join Bet';
            actionHtml = `<button class="btn join-btn" style="width: 100%; margin-top: 15px; padding: 10px;" onclick="window.joinWager('${wager.id}')">${btnText} ($${wager.amount})</button>`;
        } else if (wager.status === 'proposed' && isTarget) {
            actionHtml = `<button class="btn accept-btn" style="width: 100%; margin-top: 15px; padding: 10px;" onclick="window.acceptWager('${wager.id}')">Accept Challenge</button>`;
        } else if (wager.status === 'active' && (isParticipant || isCreator)) {
            actionHtml = `
                <div style="margin-top: 15px;">
                    <button class="btn" style="width: 100%; padding: 10px; background: rgba(16, 185, 129, 0.1); color: var(--accent-emerald); border: 1px solid var(--accent-emerald);" onclick="window.openSettleModal('${wager.id}')">
                        <i class="fas fa-handshake" style="margin-right: 8px;"></i> Settle Bet
                    </button>
                </div>
            `;
        } else if (isParticipant || isCreator) {
            actionHtml = `<div style="margin-top: 15px; text-align: center; color: var(--text-muted); font-size: 0.9rem;">You are in this bet</div>`;
        }
        
        const typeLabel = wager.type === 'h2h' ? 'Head-to-Head' : (wager.type === 'prop' ? 'Prop Bet' : 'Pool');
        const targetLabel = wager.target ? `<div style="font-size: 0.85rem; color: var(--accent-gold); margin-bottom: 10px;">Challenging: ${wager.target.name}</div>` : '';
        const potSize = participantsCount * wager.amount;

        let resultsHtml = '';
        if (wager.status === 'settled' && wager.winner_id) {
            if (wager.type === 'prop') {
                 const isCreatorWinner = wager.winner_ids && wager.winner_ids.includes(wager.creator_id);
                 const text = isCreatorWinner ? `${wager.creator.name} won` : `The Takers won`;
                 resultsHtml = `
                    <div style="margin-top: 15px; padding: 15px; background: rgba(16, 185, 129, 0.1); border-radius: 8px; border: 1px solid rgba(16, 185, 129, 0.2);">
                        <div style="color: var(--accent-emerald); font-weight: 700; margin-bottom: 5px;"><i class="fas fa-trophy"></i> ${text}</div>
                        <div style="font-size: 0.85rem; color: var(--text-muted);">Payouts distributed natively.</div>
                    </div>
                `;
            } else {
                const winnerIds = wager.winner_ids && wager.winner_ids.length > 0 ? wager.winner_ids : [wager.winner_id];
                const losers = wager.participants.filter(id => !winnerIds.includes(id));
                const loserNames = losers.map(id => getPlayerName(id)).join(', ');
                const winnerNames = winnerIds.map(id => getPlayerName(id)).join(' & ');
                
                resultsHtml = `
                    <div style="margin-top: 15px; padding: 15px; background: rgba(16, 185, 129, 0.1); border-radius: 8px; border: 1px solid rgba(16, 185, 129, 0.2);">
                        <div style="color: var(--accent-emerald); font-weight: 700; margin-bottom: 5px;"><i class="fas fa-trophy"></i> Won by ${winnerNames}</div>
                        <div style="font-size: 0.85rem; color: var(--text-muted);">${loserNames || 'Nobody'} ${wager.type === 'h2h' ? 'owes the winner.' : 'paid into the pot.'}</div>
                    </div>
                `;
            }
        } else if (wager.status === 'push') {
            resultsHtml = `
                <div style="margin-top: 15px; padding: 15px; background: rgba(251, 191, 36, 0.1); border-radius: 8px; border: 1px solid rgba(251, 191, 36, 0.2);">
                    <div style="color: var(--accent-gold); font-weight: 700; margin-bottom: 5px;"><i class="fas fa-handshake"></i> Push (Tie)</div>
                    <div style="font-size: 0.85rem; color: var(--text-muted);">All bets refunded. No blood drawn.</div>
                </div>
            `;
        } else if (wager.status === 'canceled') {
            resultsHtml = `
                <div style="margin-top: 15px; padding: 15px; background: rgba(239, 68, 68, 0.05); border-radius: 8px; border: 1px solid rgba(239, 68, 68, 0.1);">
                    <div style="color: #ef4444; font-weight: 700; margin-bottom: 5px;"><i class="fas fa-ban"></i> Bet Canceled</div>
                    <div style="font-size: 0.85rem; color: var(--text-muted);">This wager was called off.</div>
                </div>
            `;
        }

        let cardClass = 'glass-panel';
        let cardStyle = `margin-bottom: 20px; padding: 20px; border-left: 4px solid ${wager.type === 'h2h' ? 'var(--accent-gold)' : 'var(--accent-emerald)'}; position: relative;`;
        if (wager.status === 'proposed' && isTarget) {
            cardStyle = `margin-bottom: 20px; padding: 20px; border: 1px solid #ef4444; border-left: 4px solid #ef4444; box-shadow: 0 0 20px rgba(239, 68, 68, 0.3); position: relative;`;
        }

        const comments = allComments.filter(c => c.wager_id === wager.id).sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
        const commentsHtml = comments.length > 0 ? comments.map(c => `
            <div style="margin-bottom: 8px; font-size: 0.85rem; line-height: 1.3;">
                <strong style="color: var(--accent-gold);">${c.player ? c.player.name : 'Unknown'}:</strong> 
                <span style="color: var(--text-muted);">${c.message}</span>
            </div>
        `).join('') : '<div style="color: var(--text-muted); font-size: 0.8rem; text-align: center; font-style: italic;">It\'s quiet... too quiet.</div>';

        const trashTalkHtml = `
            <div class="trash-talk-section" style="margin-top: 15px; border-top: 1px solid rgba(255, 255, 255, 0.05); padding-top: 15px;">
                <button class="btn" style="width: 100%; padding: 8px; background: rgba(255,255,255,0.02); color: var(--text-muted); font-size: 0.85rem; border: 1px dashed rgba(255,255,255,0.1);" onclick="const el = document.getElementById('comments-${wager.id}'); el.style.display = el.style.display === 'none' ? 'block' : 'none'">
                   💬 Trash Talk (${comments.length})
                </button>
                <div id="comments-${wager.id}" style="display: none; margin-top: 15px;">
                    <div style="max-height: 150px; overflow-y: auto; margin-bottom: 10px; padding-right: 5px;">
                        ${commentsHtml}
                    </div>
                    ${currentUser ? `
                    <div style="display: flex; gap: 8px;">
                        <input type="text" id="comment-input-${wager.id}" placeholder="Talk smack..." style="flex: 1; background: rgba(0,0,0,0.2); border: 1px solid var(--glass-border); border-radius: 8px; padding: 8px 12px; color: white; font-size: 0.85rem;">
                        <button class="btn" style="padding: 8px 15px; background: var(--accent-gold); color: #000; font-weight: bold; border: none; border-radius: 8px;" onclick="window.postComment('${wager.id}')">Post</button>
                    </div>` : ''}
                </div>
            </div>
        `;

        return `
            <div class="${cardClass}" id="wager-card-${wager.id}" style="${cardStyle}">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
                    <div>
                        <div style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 5px;">${wager.creator ? wager.creator.name : 'Unknown'} • ${typeLabel}</div>
                        <h4 style="font-size: 1.1rem; margin-bottom: 5px;">${wager.description}</h4>
                        ${targetLabel}
                    </div>
                    <div style="text-align: right;">
                        <div style="display: flex; gap: 8px; justify-content: flex-end; align-items: center;">
                            ${(wager.type === 'h2h' && wager.odds && wager.odds !== 100) ? `<span style="background: rgba(251, 191, 36, 0.1); color: var(--accent-gold); padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; border: 1px solid rgba(251, 191, 36, 0.3);"><i class="fas fa-chart-line"></i> ${wager.odds > 0 ? '+'+wager.odds : wager.odds}</span>` : ''}
                            ${statusBadge}
                        </div>
                        ${deleteBtnHtml}
                    </div>
                </div>
                
                <div class="wager-quick-stats">
                    <div class="stat-pill">
                        <span style="color:var(--text-muted)">Buy-In:</span> 
                        <span style="font-weight:700">$${wager.amount}</span>
                    </div>
                    <div class="stat-pill" style="color: var(--accent-emerald)">
                        <span style="color:var(--text-muted)">Pot:</span> 
                        <span style="font-weight:700">$${potSize}</span>
                    </div>
                    <div class="stat-pill">
                        <span style="font-weight:700">${participantsCount}</span> 
                        <i class="fas fa-users" style="font-size: 0.8rem; color: var(--text-muted)"></i>
                    </div>
                </div>
                ${actionHtml}
                ${resultsHtml}
                ${trashTalkHtml}
            </div>
        `;
    }).join('');
}

// Phase 2 Action Handlers
window.joinWager = async function(id) {
    if (!currentUser) return;
    try {
        const wager = allWagers.find(w => w.id === id);
        if (!wager) return;
        
        const currentParticipants = wager.participants || [];
        if (currentParticipants.includes(currentUser.id)) return;
        
        currentParticipants.push(currentUser.id);

        const { error } = await supabaseClient
            .from('wagers')
            .update({ participants: currentParticipants })
            .eq('id', id);

        if (error) throw error;
        
        await fetchBaseData();
        renderDashboard();
        updateNotificationBadges();
        showToast("You've joined the pool!", "success");
    } catch (err) {
        showToast("Error joining: " + err.message, "error");
    }
};

window.acceptWager = async function(id) {
    if (!currentUser) return;
    try {
        const wager = allWagers.find(w => w.id === id);
        if (!wager) return;
        
        const currentParticipants = wager.participants || [];
        if (!currentParticipants.includes(currentUser.id)) {
            currentParticipants.push(currentUser.id);
        }

        const { error } = await supabaseClient
            .from('wagers')
            .update({ status: 'active', participants: currentParticipants })
            .eq('id', id);

        if (error) throw error;
        
        const card = document.getElementById(`wager-card-${id}`);
        if(card) {
            card.classList.add('success-pop');
            setTimeout(async () => {
                await fetchBaseData();
                renderDashboard();
                updateNotificationBadges();
                showToast("Challenge Accepted! The bet is now active.", "success");
            }, 500);
        } else {
            await fetchBaseData();
            renderDashboard();
            updateNotificationBadges();
            showToast("Challenge Accepted! The bet is now active.", "success");
        }
    } catch (err) {
        showToast("Error accepting challenge: " + err.message, "error");
    }
};
window.openSettleModal = function(id) {
    const wager = allWagers.find(w => w.id === id);
    if (!wager) return;

    authForm.style.display = 'none';
    createWagerForm.style.display = 'none';
    settleWagerForm.style.display = 'block';
    
    modalTitle.textContent = 'Settle Wager';
    document.getElementById('settle-wager-id').value = id;
    
    // Auto-Settle toggle
    const autoBtn = document.getElementById('settle-auto-btn');
    if (autoBtn) {
        if (wager.type === 'h2h') {
            autoBtn.style.display = 'block';
            autoBtn.onclick = () => window.handleAutoSettle(wager);
        } else {
            autoBtn.style.display = 'none';
        }
    }
    
    const container = document.getElementById('settle-wager-winners-container');
    container.innerHTML = '';
    
    if (wager.type === 'pool') {
        container.innerHTML = `<p style="color: var(--text-muted); font-size: 0.8rem; margin-bottom: 10px;">Select all winners (Pot splits evenly):</p>`;
        wager.participants.forEach(pid => {
            container.innerHTML += `
                <label style="display: flex; align-items: center; gap: 10px; padding: 8px 0; cursor: pointer; color: white;">
                    <input type="checkbox" name="settle-winner" value="${pid}" style="width: 18px; height: 18px;">
                    ${getPlayerName(pid)}
                </label>
            `;
        });
    } else if (wager.type === 'prop') {
        container.innerHTML = `<p style="color: var(--text-muted); font-size: 0.8rem; margin-bottom: 10px;">Who won the prop bet?</p>`;
        const creatorId = wager.creator_id;
        container.innerHTML += `
            <label style="display: flex; align-items: center; gap: 10px; padding: 8px 0; cursor: pointer; color: white;">
                <input type="radio" name="settle-winner" value="${creatorId}" style="width: 18px; height: 18px;">
                The Creator (${getPlayerName(creatorId)})
            </label>
            <label style="display: flex; align-items: center; gap: 10px; padding: 8px 0; cursor: pointer; color: white;">
                <input type="radio" name="settle-winner" value="takers" style="width: 18px; height: 18px;">
                The Takers (Condition Failed)
            </label>
        `;
    } else {
        wager.participants.forEach(pid => {
            container.innerHTML += `
                <label style="display: flex; align-items: center; gap: 10px; padding: 8px 0; cursor: pointer; color: white;">
                    <input type="radio" name="settle-winner" value="${pid}" style="width: 18px; height: 18px;">
                    ${getPlayerName(pid)}
                </label>
            `;
        });
    }

    modal.classList.add('active');
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
        showToast("Wager deleted successfully.", "success");
    } catch (err) {
        showToast("Error deleting wager: " + err.message, "error");
    }
};

window.postComment = async function(wagerId) {
    if (!currentUser) return;
    const inputField = document.getElementById(`comment-input-${wagerId}`);
    const message = inputField.value.trim();
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
        
        await fetchBaseData();
        renderDashboard();
        
        // Ensure comments section stays open after reload
        const el = document.getElementById(`comments-${wagerId}`);
        if(el) el.style.display = 'block';
        
    } catch (err) {
        showToast("Error posting comment: " + err.message, "error");
        inputField.disabled = false;
    }
};

function renderLedger() {
    const balances = {}; 
    
    dbPlayers.forEach(p => { balances[p.id] = 0; });

    allWagers.forEach(wager => {
        if (wager.status === 'settled' && wager.winner_id && wager.participants) {
            const winnerIds = wager.winner_ids && wager.winner_ids.length > 0 ? wager.winner_ids : [wager.winner_id];
            const losers = wager.participants.filter(id => !winnerIds.includes(id));
            const winners = wager.participants.filter(id => winnerIds.includes(id));
            const wAmount = wager.amount;
            
            if (wager.type === 'h2h' && wager.target_id) {
                // H2H Odds Math
                const odds = wager.odds || 100;
                const isPositive = odds > 0;
                const multiplier = Math.abs(odds) / 100;
                
                const t_win = isPositive ? Math.round(wAmount * multiplier) : wAmount;
                const c_win = isPositive ? wAmount : Math.round(wAmount * multiplier);
                
                if (wager.winner_id === wager.target_id) {
                    balances[wager.target_id] = (balances[wager.target_id] || 0) + t_win;
                    balances[wager.creator_id] = (balances[wager.creator_id] || 0) - t_win;
                } else if (wager.winner_id === wager.creator_id) {
                    balances[wager.creator_id] = (balances[wager.creator_id] || 0) + c_win;
                    balances[wager.target_id] = (balances[wager.target_id] || 0) - c_win;
                }
            } else if (wager.type === 'prop') {
                const isCreatorWinner = winnerIds.includes(wager.creator_id);
                const takers = wager.participants.filter(pid => pid !== wager.creator_id);
                
                if (isCreatorWinner) {
                    balances[wager.creator_id] = (balances[wager.creator_id] || 0) + (wAmount * takers.length);
                    takers.forEach(tid => {
                        balances[tid] = (balances[tid] || 0) - wAmount;
                    });
                } else {
                    balances[wager.creator_id] = (balances[wager.creator_id] || 0) - (wAmount * takers.length);
                    takers.forEach(tid => {
                        balances[tid] = (balances[tid] || 0) + wAmount;
                    });
                }
            } else {
                // Return pool logic handling split pots
                const totalPot = wAmount * wager.participants.length;
                const potPerWinner = winners.length > 0 ? (totalPot / winners.length) : 0;
                
                // Debit everyone their buy-in
                wager.participants.forEach(pid => {
                    balances[pid] = (balances[pid] || 0) - wAmount;
                });
                
                // Credit winners their share of the pot
                winners.forEach(winnerId => {
                    balances[winnerId] = (balances[winnerId] || 0) + potPerWinner;
                });
            }
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

    let maxBal = 0;
    let minBal = 0;
    let maxPlayers = [];
    let minPlayers = [];
    
    sortedBalances.forEach(b => {
        if (b.balance > maxBal) { maxBal = b.balance; maxPlayers = [b.name]; }
        else if (b.balance === maxBal && maxBal > 0) { maxPlayers.push(b.name); }
        
        if (b.balance < minBal) { minBal = b.balance; minPlayers = [b.name]; }
        else if (b.balance === minBal && minBal < 0) { minPlayers.push(b.name); }
    });

    const scoreboardEl = document.getElementById('big-winner-board');
    if (scoreboardEl) {
        if (maxBal > 0 || minBal < 0) {
            scoreboardEl.style.display = 'flex';
            scoreboardEl.style.justifyContent = 'space-between';
            scoreboardEl.innerHTML = `
                <div style="text-align: center; flex: 1; border-right: 1px solid rgba(255,255,255,0.1);">
                    <div style="font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px;">🏆 Big Winner</div>
                    <div style="font-size: 1.2rem; font-weight: bold; color: var(--accent-emerald); margin-top: 5px;">+$${maxBal}</div>
                    <div style="font-size: 0.9rem; margin-top: 2px;">${maxPlayers.length ? maxPlayers.join(', ') : '-'}</div>
                </div>
                <div style="text-align: center; flex: 1;">
                    <div style="font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px;">💀 Big Loser</div>
                    <div style="font-size: 1.2rem; font-weight: bold; color: #ef4444; margin-top: 5px;">-$${Math.abs(minBal)}</div>
                    <div style="font-size: 0.9rem; margin-top: 2px;">${minPlayers.length ? minPlayers.join(', ') : '-'}</div>
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
    settleWagerForm.style.display = 'none'; // Ensure settle form is hidden
    createWagerForm.reset();
    if (wagerOddsInput) wagerOddsInput.value = '100'; // Default even odds
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
    const targetId = type === 'h2h' ? wagerTargetSelect.value : null;
    
    const oddsStr = wagerOddsInput ? wagerOddsInput.value : '100';
    const parsedOdds = parseInt(oddsStr, 10);
    const odds = (type === 'h2h' && !isNaN(parsedOdds)) ? parsedOdds : 100;

    const newWager = {
        creator_id: currentUser.id,
        target_id: targetId,
        type: type,
        amount: parseInt(amount),
        description: desc,
        status: type === 'h2h' ? 'proposed' : 'open',
        participants: [currentUser.id],
        odds: odds
    };

    try {
        const { error } = await supabaseClient.from('wagers').insert([newWager]);
        if (error) throw error;
        
        closeModal();
        wagersContainer.innerHTML = getSkeletonHtml();
        await fetchBaseData();
        renderDashboard();
        showToast("Your wager has been proposed!", "success");
    } catch (err) {
        showToast("Error proposing bet: " + err.message, "error");
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

window.showToast = function(message, type = 'success') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const icon = type === 'success' ? '<i class="fas fa-check-circle" style="color: var(--accent-emerald);"></i>' : '<i class="fas fa-exclamation-circle" style="color: #ef4444;"></i>';
    toast.innerHTML = `${icon} <span>${message}</span>`;
    
    container.appendChild(toast);
    
    if(navigator.vibrate) {
        navigator.vibrate(type === 'success' ? 50 : [50, 100, 50]);
    }
    
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
};

// Kickoff — handles both early and late script execution
console.log('The Bookie JS loaded. readyState:', document.readyState);
if (document.readyState === 'complete') {
    // Page already fully loaded (common with defer scripts on GitHub Pages)
    initBookie();
} else {
    window.addEventListener('load', initBookie);
}
