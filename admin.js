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

// Toast Notification System
window.showToast = function(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <div style="font-size: 1.2rem;">${type === 'success' ? '✅' : '⚠️'}</div>
        <div>${message}</div>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
};

// DOM Elements Registry
let elements = {};

// State
let players = [];
let originalPlayers = []; // To track changes and allow discard
let matchups = [];
let originalMatchups = [];
let currentMatchupRound = 1;
let hasChanges = false;

// Initial Load
function init() {
    console.log('Admin Dashboard initializing...');
    try {
        elements = {
            authScreen: document.getElementById('login-screen'),
            dashboard: document.getElementById('dashboard'),
            rosterTbody: document.getElementById('roster-tbody'),
            saveBar: document.getElementById('save-bar'),
            loginBtn: document.getElementById('login-btn'),
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
            matchupsList: document.getElementById('matchups-list'),
            addMatchupBtn: document.getElementById('add-matchup-btn'),
            potentialList: document.getElementById('potential-list'),
            newPotentialName: document.getElementById('new-potential-name'),
            addPotentialBtn: document.getElementById('add-potential-btn')
        };

        checkInitialAuth();
        setupEventListeners();
        console.log('Admin Dashboard ready.');
    } catch (err) {
        console.error('Admin Dashboard failed to initialize.', err);
    }
}

async function checkInitialAuth() {
    if (!supabaseInstance) {
        console.warn('Supabase not configured. Showing demo mode.');
        return;
    }

    try {
        const { data: { session } } = await supabaseInstance.auth.getSession();
        if (session) {
            await verifyAdminAndShowDashboard(session.user.email);
        }
    } catch (e) {
        console.error('Auth check failed:', e);
    }
}

async function verifyAdminAndShowDashboard(email) {
    try {
        const { data: player, error } = await supabaseInstance
            .from('players')
            .select('is_admin')
            .ilike('email', email)
            .single();

        if (error || !player || !player.is_admin) {
            alert("Access Denied: You do not have administrator privileges.");
            await supabaseInstance.auth.signOut();
            // Stay on login screen
        } else {
            showDashboard();
        }
    } catch (e) {
        console.error("Admin verification failed:", e);
        if (elements.loginError) {
            elements.loginError.textContent = "Error verifying admin privileges.";
            elements.loginError.style.display = 'block';
        }
    }
}

function setupEventListeners() {
    // Login Handling
    if (elements.loginBtn) {
        elements.loginBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleLogin();
        });
    }

    if (elements.logoutBtn) {
        elements.logoutBtn.addEventListener('click', handleLogout);
    }

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
            if (e.target.classList.contains('remove-player-btn')) {
                const index = e.target.closest('tr').dataset.index;
                removePlayer(index);
            }
        });
    }

    // Tab switching
    document.querySelectorAll('.sidebar-item').forEach(item => {
        item.addEventListener('click', () => {
            const tab = item.dataset.tab;
            document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');

            item.classList.add('active');
            const targetTab = document.getElementById(`tab-${tab}`);
            if (targetTab) targetTab.style.display = 'block';

            if (tab === 'drafting') renderDraftingUI();
            if (tab === 'matchups') renderMatchupsUI();
            if (tab === 'scores') renderScoresUI();
            if (tab === 'score-entry') renderScoreEntryUI();
            if (tab === 'potential') renderPotentialUI();
        });
    });

    if (elements.autoDraftBtn) {
        elements.autoDraftBtn.addEventListener('click', autoDraft);
    }


    if (elements.addMatchupBtn) {
        elements.addMatchupBtn.addEventListener('click', addMatchup);
    }

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

async function handleLogin() {
    console.log('Login attempt...');
    const email = elements.emailInput ? elements.emailInput.value : '';
    const password = elements.passwordInput ? elements.passwordInput.value : '';

    if (!supabaseInstance) {
        // DEMO BYPASS
        if (email === 'admin' && password === 'admin') {
            console.log('Demo login successful.');
            showDashboard();
            return;
        }
        alert('Supabase not configured. Use admin/admin for demo.');
        return;
    }

    try {
        const { error } = await supabaseInstance.auth.signInWithPassword({ email, password });
        if (error) {
            if (elements.loginError) {
                elements.loginError.textContent = error.message;
                elements.loginError.style.display = 'block';
            }
        } else {
            await verifyAdminAndShowDashboard(email);
        }
    } catch (err) {
        console.error('Login error:', err);
        if (elements.loginError) {
            elements.loginError.textContent = 'An unexpected error occurred.';
            elements.loginError.style.display = 'block';
        }
    }
}
async function handleLogout() {
    if (supabaseInstance) {
        await supabaseInstance.auth.signOut();
    }
    location.reload();
}

function showDashboard() {
    if (elements.authScreen) elements.authScreen.style.display = 'none';
    if (elements.dashboard) elements.dashboard.classList.add('active');
    if (elements.logoutBtn) elements.logoutBtn.style.display = 'block';
    loadRoster();
    loadMatchups();
}

async function loadRoster() {
    if (supabaseInstance) {
        try {
            const { data, error } = await supabaseInstance
                .from('players')
                .select('*')
                .order('name');

            if (!error && data) {
                players = JSON.parse(JSON.stringify(data)); // Deep copy
                originalPlayers = JSON.parse(JSON.stringify(data));
            }
        } catch (e) {
            console.error('Roster load failed:', e);
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
    }
    renderRosterTable();
    renderDraftingUI();
    renderMatchupsUI();
    renderPotentialUI();
    checkChanges();
}

async function loadMatchups() {
    if (supabaseInstance) {
        try {
            const { data, error } = await supabaseInstance
                .from('matchups')
                .select('*');

            if (!error && data) {
                matchups = JSON.parse(JSON.stringify(data));
                originalMatchups = JSON.parse(JSON.stringify(data));
            }
        } catch (e) {
            console.error('Matchups load failed:', e);
        }
    }
    renderMatchupsUI();
    checkChanges();
}



function renderRosterTable() {
    if (!elements.rosterTbody) return;

    const confirmedPlayers = players.filter(p => p.status !== 'potential');

    if (confirmedPlayers.length === 0) {
        elements.rosterTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: rgba(255,255,255,0.3); padding: 50px;">No confirmed players found.</td></tr>`;
        return;
    }

    elements.rosterTbody.innerHTML = confirmedPlayers.map((player) => {
        // Find actual index in main array
        const realIndex = players.indexOf(player);
        return `
        <tr data-index="${realIndex}">
            <td data-label="Name"><input type="text" class="edit-input" data-field="name" value="${player.name || ''}" placeholder="Name"></td>
            <td data-label="Email"><input type="email" class="edit-input" data-field="email" value="${player.email || ''}" placeholder="Email"></td>
            <td data-label="GHIN"><input type="text" class="edit-input" data-field="ghin" value="${player.ghin || ''}" placeholder="GHIN"></td>
            <td data-label="Handicap"><input type="number" step="0.1" class="edit-input" data-field="handicap" value="${player.handicap !== null ? player.handicap : 0}" placeholder="HCP"></td>
            <td data-label="Status"><span class="status-badge status-confirmed">${player.status || 'confirmed'}</span></td>
            <td data-label="Actions">
                <button class="remove-player-btn admin-btn secondary" style="width: auto; padding: 5px 10px; margin: 0;">Remove</button>
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
        const { data, error } = await supabaseInstance
            .from('players')
            .insert([newPlayer])
            .select();

        if (error) {
            errEl.textContent = 'Error saving: ' + error.message;
            errEl.style.display = 'block';
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Player';
            return;
        }

        closeAddPlayerModal();
        // Refresh the live roster from DB
        await loadRoster();
    } else {
        // Demo mode — add to local state only
        players.push(newPlayer);
        closeAddPlayerModal();
        renderRosterTable();
        checkChanges();
    }
}

function removePlayer(index) {
    if (confirm(`Remove ${players[index].name || 'this player'}?`)) {
        players.splice(index, 1);
        renderRosterTable();
        renderPotentialUI(); // Just in case
        checkChanges();
    }
}

function checkChanges() {
    const current = JSON.stringify({ players, matchups });
    const original = JSON.stringify({ players: originalPlayers, matchups: originalMatchups });

    hasChanges = current !== original;

    if (elements.saveBar) {
        elements.saveBar.style.display = hasChanges ? 'flex' : 'none';
    }
}

function renderDraftingUI() {
    if (!elements.team1List || !elements.team2List) return;

    elements.team1List.innerHTML = '';
    elements.team2List.innerHTML = '';

    const draftablePlayers = players.filter(p => p.status !== 'potential');

    const renderPlayerItem = (p, currentTeam) => {
        const div = document.createElement('div');
        div.style = "display: flex; justify-content: space-between; align-items: center; padding: 10px 15px; background: rgba(255,255,255,0.05); border-radius: 8px; border: 1px solid rgba(255,255,255,0.1);";
        div.innerHTML = `
            <div>
                <div style="font-weight: 600; font-size: 0.9rem;">${p.name || 'Unnamed'}</div>
                <div style="font-size: 0.75rem; color: var(--admin-accent);">HCP: ${p.handicap !== null ? p.handicap : 'N/A'}</div>
            </div>
            <div style="display: flex; gap: 5px;">
                ${currentTeam !== 1 ? `<button class="admin-btn" style="width: auto; padding: 4px 8px; font-size: 0.7rem; margin: 0;" onclick="moveToTeam('${p.name}', 1)">To T1</button>` : ''}
                ${currentTeam !== 2 ? `<button class="admin-btn" style="width: auto; padding: 4px 8px; font-size: 0.7rem; margin: 0; background: #ef4444;" onclick="moveToTeam('${p.name}', 2)">To T2</button>` : ''}
                ${currentTeam !== null ? `<button class="admin-btn secondary" style="width: auto; padding: 4px 8px; font-size: 0.7rem; margin: 0;" onclick="moveToTeam('${p.name}', null)">Clear</button>` : ''}
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
window.filterMatchupRound = (roundNum) => {
    currentMatchupRound = roundNum;
    document.querySelectorAll('#tab-matchups .filter-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.textContent.replace('Round ','')) === roundNum);
    });
    renderMatchupsUI();
};

function renderMatchupsUI() {
    if (!elements.matchupsList) return;
    elements.matchupsList.innerHTML = '';

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

    const getOptions = (teamId, currentVal) => {
        return players.filter(p => p.team_id === teamId).map(p => {
            const pId = p.id || p.name;
            const isAssigned = assignedInRound.has(pId);
            const isCurrent = (pId === currentVal);
            if (!isAssigned || isCurrent) {
                return `<option value="${pId}" ${isCurrent ? 'selected' : ''}>${p.name}</option>`;
            }
            return '';
        }).join('');
    };

    roundMatchups.forEach((match, index) => {
        const globalIndex = matchups.indexOf(match);
        const div = document.createElement('div');
        div.className = 'glass-panel';
        div.style = "padding: 20px; border-color: rgba(255,255,255,0.05);";

        const isSingles = currentMatchupRound === 3;
        
        div.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px;">
                <h4 style="color: var(--admin-accent);">Match ${index + 1}</h4>
                <button class="admin-btn secondary" style="width: auto; padding: 4px 8px; font-size: 0.7rem; margin: 0;" onclick="removeMatchup(${globalIndex})">Remove</button>
            </div>
            
            <div style="margin-bottom: 15px;">
                <div style="font-size: 0.8rem; font-weight: bold; color: var(--accent-emerald); margin-bottom: 5px;">Team 1</div>
                <select class="admin-input" style="padding: 6px; font-size: 0.85rem;" onchange="updateMatchupTeam(${globalIndex}, 't1_player1_id', this.value)">
                    <option value="">Select T1 Player 1</option>
                    ${getOptions(1, match.t1_player1_id)}
                </select>
                ${!isSingles ? `
                <select class="admin-input" style="padding: 6px; font-size: 0.85rem; margin-top: 5px;" onchange="updateMatchupTeam(${globalIndex}, 't1_player2_id', this.value)">
                    <option value="">Select T1 Player 2</option>
                    ${getOptions(1, match.t1_player2_id)}
                </select>` : ''}
            </div>

            <div>
                <div style="font-size: 0.8rem; font-weight: bold; color: #ef4444; margin-bottom: 5px;">Team 2</div>
                <select class="admin-input" style="padding: 6px; font-size: 0.85rem;" onchange="updateMatchupTeam(${globalIndex}, 't2_player1_id', this.value)">
                    <option value="">Select T2 Player 1</option>
                    ${getOptions(2, match.t2_player1_id)}
                </select>
                ${!isSingles ? `
                <select class="admin-input" style="padding: 6px; font-size: 0.85rem; margin-top: 5px;" onchange="updateMatchupTeam(${globalIndex}, 't2_player2_id', this.value)">
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
}

function addMatchup() {
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
    matchups[index][field] = value;
    checkChanges();
};

// New Potential Players Logic
function renderPotentialUI() {
    if (!elements.potentialList) return;
    elements.potentialList.innerHTML = '';

    const potentialPlayers = players.filter(p => p.status === 'potential');

    if (potentialPlayers.length === 0) {
        elements.potentialList.innerHTML = '<p style="text-align: center; color: var(--text-muted);">No potential players added yet.</p>';
        return;
    }

    potentialPlayers.forEach((p) => {
        const realIndex = players.indexOf(p);
        const div = document.createElement('div');
        div.className = 'glass-panel';
        div.style = "padding: 15px; display: flex; justify-content: space-between; align-items: center;";
        div.innerHTML = `
            <span style="font-weight: 600;">${p.name}</span>
                <div style="display: flex; gap: 10px;">
                    <button class="admin-btn" style="width: auto; padding: 5px 15px; margin: 0; font-size: 0.8rem;" onclick="promotePlayer(${realIndex})">Promote</button>
                    <button class="admin-btn secondary" style="width: auto; padding: 5px 15px; margin: 0; font-size: 0.8rem;" onclick="removePlayer(${realIndex})">Remove</button>
                </div>
        `;
        elements.potentialList.appendChild(div);
    });
}

function addPotentialPlayer() {
    const name = elements.newPotentialName.value.trim();
    if (!name) return;

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
        players[index].status = 'confirmed';
        renderRosterTable();
        renderPotentialUI();
        renderDraftingUI();
        checkChanges();
    }
};

function discardChanges() {
    if (confirm('Discard all unsaved changes?')) {
        players = JSON.parse(JSON.stringify(originalPlayers));
        matchups = JSON.parse(JSON.stringify(originalMatchups));
        renderRosterTable();
        renderDraftingUI();
        renderMatchupsUI();
        renderPotentialUI();
        checkChanges();
    }
}

async function saveChanges() {
    if (!supabaseInstance) {
        alert('Saving is disabled in demo mode.');
        return;
    }

    try {
        console.log('Saving changes to Supabase...');

        // 1. Find deleted players
        const originalIds = originalPlayers.map(p => p.id).filter(id => id);
        const currentIds = players.map(p => p.id).filter(id => id);
        const deletedIds = originalIds.filter(id => !currentIds.includes(id));

        // 2. Perform Deletions
        if (deletedIds.length > 0) {
            const { error: delError } = await supabaseInstance
                .from('players')
                .delete()
                .in('id', deletedIds);

            if (delError) throw delError;
        }

        // 3. Perform Upserts (Insert new or Update existing)
        const { data, error: upsertError } = await supabaseInstance
            .from('players')
            .upsert(players, { onConflict: 'id' });

        if (upsertError) throw upsertError;

        // 4. Update Matchups
        const refreshedPlayers = (await supabaseInstance.from('players').select('id, name')).data;
        const matchupsToSave = matchups.map(m => {
            const t1p1 = refreshedPlayers.find(rp => rp.id === m.t1_player1_id || rp.name === m.t1_player1_id);
            const t1p2 = refreshedPlayers.find(rp => rp.id === m.t1_player2_id || rp.name === m.t1_player2_id);
            const t2p1 = refreshedPlayers.find(rp => rp.id === m.t2_player1_id || rp.name === m.t2_player1_id);
            const t2p2 = refreshedPlayers.find(rp => rp.id === m.t2_player2_id || rp.name === m.t2_player2_id);
            return {
                round_number: m.round_number,
                t1_player1_id: t1p1 ? t1p1.id : null,
                t1_player2_id: t1p2 ? t1p2.id : null,
                t2_player1_id: t2p1 ? t2p1.id : null,
                t2_player2_id: t2p2 ? t2p2.id : null
            };
        }).filter(m => m.t1_player1_id && m.t2_player1_id);

        await supabaseInstance.from('matchups').delete().neq('id', '00000000-0000-0000-0000-000000000000');

        if (matchupsToSave.length > 0) {
            const { error: matchError } = await supabaseInstance
                .from('matchups')
                .insert(matchupsToSave);
            if (matchError) throw matchError;
        }

        window.showToast('Changes saved successfully! 🎉', 'success');
        loadRoster();
    } catch (err) {
        console.error('Save failed:', err);
        window.showToast('Error saving changes: ' + err.message, 'error');
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
let scoreEntryRound = 1;
let scoreEntryData = {}; // { round_number: [ {player_id, name, team_id, total_score, to_par} ] }

async function renderScoreEntryUI() {
    if (!supabaseInstance) return;
    const tbody = document.getElementById('score-entry-tbody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: rgba(255,255,255,0.3); padding: 30px;">Loading...</td></tr>';

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
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #ef4444; padding: 30px;">Error loading data.</td></tr>';
    }
}

function renderScoreEntryTable() {
    const tbody = document.getElementById('score-entry-tbody');
    if (!tbody || !scoreEntryData.players) return;

    const playersList = scoreEntryData.players;
    const lookup = scoreEntryData.scoreLookup || {};

    if (playersList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: rgba(255,255,255,0.3); padding: 50px;">No confirmed players found.</td></tr>';
        return;
    }

    tbody.innerHTML = playersList.map(p => {
        const key = `${p.id}_${scoreEntryRound}`;
        const existing = lookup[key] || {};
        const teamLabel = p.team_id === 1 ? '<span style="color: #60a5fa; font-weight: 700;">Blue</span>'
                        : p.team_id === 2 ? '<span style="color: #fca5a5; font-weight: 700;">Red</span>'
                        : '<span style="color: var(--text-muted);">—</span>';

        let holesHtml = '';
        for (let i = 1; i <= 18; i++) {
            const hVal = existing[`h${i}`] !== null && existing[`h${i}`] !== undefined ? existing[`h${i}`] : '';
            holesHtml += `
                <td data-label="H${i}" style="padding: 6px;">
                    <input type="number" class="edit-input score-hole-input" 
                           data-player="${p.id}" data-hole="${i}" 
                           value="${hVal}" 
                           style="width: 50px; text-align: center; padding: 8px 4px;">
                </td>
            `;
        }

        return `
        <tr data-player-id="${p.id}">
            <td data-label="Player" style="font-weight: 600; white-space: nowrap; position: sticky; left: 0; background: rgba(30, 41, 59, 0.95); z-index: 1;">${p.name}</td>
            <td data-label="Team">${teamLabel}</td>
            ${holesHtml}
            <td data-label="Total Score">
                <input type="number" class="edit-input score-total-input" data-player="${p.id}" 
                       value="${existing.total_score !== null && existing.total_score !== undefined ? existing.total_score : ''}" 
                       placeholder="TOT" style="width: 80px; text-align: center; font-weight: 800; background: rgba(0,0,0,0.3);">
            </td>
            <td data-label="To Par">
                <input type="number" class="edit-input score-topar-input" data-player="${p.id}" 
                       value="${existing.to_par !== null && existing.to_par !== undefined ? existing.to_par : ''}" 
                       placeholder="+/-" style="width: 80px; text-align: center;">
            </td>
        </tr>
        `;
    }).join('');

    // Attach auto-sum listeners
    const holeInputs = document.querySelectorAll('.score-hole-input');
    holeInputs.forEach(input => {
        input.addEventListener('input', (e) => {
            const pid = e.target.dataset.player;
            let sum = 0;
            let hasAny = false;
            document.querySelectorAll(`.score-hole-input[data-player="${pid}"]`).forEach(inp => {
                const val = parseInt(inp.value);
                if (!isNaN(val)) {
                    sum += val;
                    hasAny = true;
                }
            });
            const totInput = document.querySelector(`.score-total-input[data-player="${pid}"]`);
            if (totInput) {
                totInput.value = hasAny ? sum : '';
            }
        });
    });
}

// Round tab switching
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        const roundTabs = document.querySelectorAll('.score-round-tab');
        roundTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                roundTabs.forEach(t => {
                    t.classList.remove('active');
                    t.classList.add('secondary');
                });
                tab.classList.add('active');
                tab.classList.remove('secondary');
                scoreEntryRound = parseInt(tab.dataset.round);
                renderScoreEntryTable();
            });
        });

        // Save scores button
        const saveBtn = document.getElementById('save-score-entry-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', saveScoreEntries);
        }
    }, 500);
});

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
            window.showToast('No scores to save. Enter at least one score.', 'error');
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
        window.showToast('Error saving scores: ' + err.message, 'error');
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
                    window.showToast('Error saving scores: ' + err.message, 'error');
                    saveScoresBtn.textContent = 'Save Scores';
                    saveScoresBtn.style.opacity = '1';
                }
            });
        }
    }, 500);
});
