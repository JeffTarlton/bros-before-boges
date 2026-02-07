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

// DOM Elements Registry
let elements = {};

// State
let players = [];
let originalPlayers = []; // To track changes and allow discard
let pairings = [];
let originalPairings = [];
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
            pairingsList: document.getElementById('pairings-list'),
            addPairingBtn: document.getElementById('add-pairing-btn'),
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
            showDashboard();
        }
    } catch (e) {
        console.error('Auth check failed:', e);
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
            if (tab === 'pairings') renderPairingsUI();
            if (tab === 'potential') renderPotentialUI();
        });
    });

    if (elements.autoDraftBtn) {
        elements.autoDraftBtn.addEventListener('click', autoDraft);
    }

    if (elements.addPairingBtn) {
        elements.addPairingBtn.addEventListener('click', addPairing);
    }

    if (elements.addPotentialBtn) {
        elements.addPotentialBtn.addEventListener('click', addPotentialPlayer);
    }
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
            showDashboard();
        }
    } catch (e) {
        console.error('Login error:', e);
        alert('An unexpected error occurred during login.');
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
    loadPairings();
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
    renderPairingsUI();
    renderPotentialUI();
    checkChanges();
}

async function loadPairings() {
    if (supabaseInstance) {
        try {
            const { data, error } = await supabaseInstance
                .from('pairings')
                .select('*');

            if (!error && data) {
                pairings = JSON.parse(JSON.stringify(data));
                originalPairings = JSON.parse(JSON.stringify(data));
            }
        } catch (e) {
            console.error('Pairings load failed:', e);
        }
    }
    renderPairingsUI();
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
            <td><input type="text" class="edit-input" data-field="name" value="${player.name || ''}" placeholder="Name"></td>
            <td><input type="text" class="edit-input" data-field="ghin" value="${player.ghin || ''}" placeholder="GHIN"></td>
            <td><input type="number" step="0.1" class="edit-input" data-field="handicap" value="${player.handicap !== null ? player.handicap : 0}" placeholder="HCP"></td>
            <td><span class="status-badge status-confirmed">${player.status || 'confirmed'}</span></td>
            <td>
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
    const newPlayer = {
        name: "",
        ghin: "",
        handicap: 0,
        status: "confirmed"
    };
    players.push(newPlayer);
    renderRosterTable();
    checkChanges();
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
    const current = JSON.stringify({ players, pairings });
    const original = JSON.stringify({ players: originalPlayers, pairings: originalPairings });

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
    alert('Auto-draft complete! Inspect the teams and click "Save Changes" to commit.');
}

function renderPairingsUI() {
    if (!elements.pairingsList) return;

    elements.pairingsList.innerHTML = '';

    if (players.length === 0) {
        elements.pairingsList.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 40px;">Load players first to create pairings.</p>';
        return;
    }

    pairings.forEach((pair, index) => {
        const div = document.createElement('div');
        div.className = 'glass-panel';
        div.style = "padding: 20px; border-color: rgba(255,255,255,0.05);";

        const player1 = players.find(p => p.id === pair.player1_id) || players.find(p => p.name === pair.player1_name);
        const player2 = players.find(p => p.id === pair.player2_id) || players.find(p => p.name === pair.player2_name);

        div.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px;">
                <h4 style="color: var(--admin-accent);">Pair ${index + 1}</h4>
                <button class="admin-btn secondary" style="width: auto; padding: 4px 8px; font-size: 0.7rem; margin: 0;" onclick="removePairing(${index})">Remove</button>
            </div>
            <div style="display: flex; flex-direction: column; gap: 10px;">
                <select class="admin-input" style="padding: 8px; font-size: 0.9rem;" onchange="updatePairing(${index}, 'player1_id', this.value)">
                    <option value="">Select Player 1</option>
                    ${players.map(p => `<option value="${p.id || p.name}" ${(p.id === pair.player1_id || p.name === pair.player1_name) ? 'selected' : ''}>${p.name} (Team ${p.team_id || '?'})</option>`).join('')}
                </select>
                <select class="admin-input" style="padding: 8px; font-size: 0.9rem;" onchange="updatePairing(${index}, 'player2_id', this.value)">
                    <option value="">Select Player 2</option>
                    ${players.map(p => `<option value="${p.id || p.name}" ${(p.id === pair.player2_id || p.name === pair.player2_name) ? 'selected' : ''}>${p.name} (Team ${p.team_id || '?'})</option>`).join('')}
                </select>
            </div>
        `;
        elements.pairingsList.appendChild(div);
    });

    if (pairings.length === 0) {
        elements.pairingsList.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 40px;">No pairings defined. Click "+ Create Pair" to start.</p>';
    }
}

function addPairing() {
    pairings.push({ player1_id: null, player2_id: null, team_id: null });
    renderPairingsUI();
    checkChanges();
}

window.removePairing = (index) => {
    pairings.splice(index, 1);
    renderPairingsUI();
    checkChanges();
};

window.updatePairing = (index, field, value) => {
    pairings[index][field] = value;

    // Auto-detect team if possible
    const player = players.find(p => p.id === value || p.name === value);
    if (player && player.team_id) {
        pairings[index].team_id = player.team_id;
    }

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
        pairings = JSON.parse(JSON.stringify(originalPairings));
        renderRosterTable();
        renderDraftingUI();
        renderPairingsUI();
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

        // 4. Update Pairings
        const refreshedPlayers = (await supabaseInstance.from('players').select('id, name')).data;
        const pairingsToSave = pairings.map(p => {
            const p1 = refreshedPlayers.find(rp => rp.id === p.player1_id || rp.name === p.player1_id);
            const p2 = refreshedPlayers.find(rp => rp.id === p.player2_id || rp.name === p.player2_id);
            return {
                player1_id: p1 ? p1.id : null,
                player2_id: p2 ? p2.id : null,
                team_id: p.team_id
            };
        }).filter(p => p.player1_id && p.player2_id);

        await supabaseInstance.from('pairings').delete().neq('id', '00000000-0000-0000-0000-000000000000');

        if (pairingsToSave.length > 0) {
            const { error: pairError } = await supabaseInstance
                .from('pairings')
                .insert(pairingsToSave);
            if (pairError) throw pairError;
        }

        alert('Changes saved successfully! 🎉');
        loadRoster();
        loadPairings();
    } catch (err) {
        console.error('Save failed:', err);
        alert('Error saving changes: ' + err.message);
    }
}

// Global initialization
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
