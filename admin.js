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
            discardBtn: document.getElementById('discard-btn')
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
            document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
        });
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
    checkChanges();
}

function renderRosterTable() {
    if (!elements.rosterTbody) return;

    if (players.length === 0) {
        elements.rosterTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: rgba(255,255,255,0.3); padding: 50px;">No players found. Click "+ Add Player" to start.</td></tr>`;
        return;
    }

    elements.rosterTbody.innerHTML = players.map((player, index) => `
        <tr data-index="${index}">
            <td><input type="text" class="edit-input" data-field="name" value="${player.name || ''}" placeholder="Name"></td>
            <td><input type="text" class="edit-input" data-field="ghin" value="${player.ghin || ''}" placeholder="GHIN"></td>
            <td><input type="number" step="0.1" class="edit-input" data-field="handicap" value="${player.handicap !== null ? player.handicap : 0}" placeholder="HCP"></td>
            <td><span class="status-badge status-confirmed">${player.status || 'confirmed'}</span></td>
            <td>
                <button class="remove-player-btn admin-btn secondary" style="width: auto; padding: 5px 10px; margin: 0;">Remove</button>
            </td>
        </tr>
    `).join('');
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
        checkChanges();
    }
}

function checkChanges() {
    // Compare players to originalPlayers
    const current = JSON.stringify(players);
    const original = JSON.stringify(originalPlayers);

    hasChanges = current !== original;

    if (elements.saveBar) {
        elements.saveBar.style.display = hasChanges ? 'flex' : 'none';
    }
}

function discardChanges() {
    if (confirm('Discard all unsaved changes?')) {
        players = JSON.parse(JSON.stringify(originalPlayers));
        renderRosterTable();
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

        alert('Changes saved successfully! 🎉');
        loadRoster(); // Refresh original state
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
