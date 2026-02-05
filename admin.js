// Supabase Configuration - USER NEEDS TO FILL THESE IN
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_KEY = 'YOUR_SUPABASE_ANON_KEY';

// Initialize Supabase Client
let supabaseInstance = null;
try {
    if (typeof supabase !== 'undefined' && SUPABASE_URL !== 'YOUR_SUPABASE_URL') {
        supabaseInstance = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    }
} catch (e) {
    console.error('Supabase initialization failed:', e);
}

// DOM Elements
const authScreen = document.getElementById('login-screen');
const dashboard = document.getElementById('dashboard');
const rosterTbody = document.getElementById('roster-tbody');
const saveBar = document.getElementById('save-bar');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const loginError = document.getElementById('login-error');

// State
let players = [];
let hasChanges = false;

// Initial Load
document.addEventListener('DOMContentLoaded', () => {
    checkInitialAuth();
    setupEventListeners();
});

async function checkInitialAuth() {
    if (!supabaseInstance) {
        console.warn('Supabase not configured. Showing demo mode.');
        return;
    }

    const { data: { session } } = await supabaseInstance.auth.getSession();
    if (session) {
        showDashboard();
    }
}

function setupEventListeners() {
    loginBtn.addEventListener('click', handleLogin);
    logoutBtn.addEventListener('click', handleLogout);

    // Tab switching
    document.querySelectorAll('.sidebar-item').forEach(item => {
        item.addEventListener('click', () => {
            document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            // Tab logic would go here
        });
    });
}

async function handleLogin() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    if (!supabaseInstance) {
        // DEMO BYPASS: If no Supabase, allow 'admin'/'admin' for preview
        if (email === 'admin' && password === 'admin') {
            showDashboard();
            return;
        }
        alert('Supabase not configured. Use admin/admin for demo.');
        return;
    }

    const { error } = await supabaseInstance.auth.signInWithPassword({ email, password });

    if (error) {
        loginError.textContent = error.message;
        loginError.style.display = 'block';
    } else {
        showDashboard();
    }
}

async function handleLogout() {
    if (supabaseInstance) {
        await supabaseInstance.auth.signOut();
    }
    location.reload();
}

function showDashboard() {
    authScreen.style.display = 'none';
    dashboard.classList.add('active');
    logoutBtn.style.display = 'block';
    loadRoster();
}

async function loadRoster() {
    // Try to load from Supabase
    if (supabaseInstance) {
        const { data, error } = await supabaseInstance
            .from('players')
            .select('*')
            .order('name');

        if (!error && data) {
            players = data;
        }
    } else {
        // Fallback to demo data
        players = [
            { name: "Colby Gibson", ghin: "2360395", handicap: 5.0, status: "confirmed" },
            { name: "Westin Tucker", ghin: "Missing", handicap: 5.6, status: "confirmed" },
            { name: "Jeff Tarlton", ghin: "2360395", handicap: 9.0, status: "confirmed" }
        ];
    }

    renderRosterTable();
}

function renderRosterTable() {
    rosterTbody.innerHTML = players.map((player, index) => `
        <tr>
            <td><input type="text" class="edit-input" value="${player.name}" onchange="markDirty()"></td>
            <td><input type="text" class="edit-input" value="${player.ghin || ''}" onchange="markDirty()"></td>
            <td><input type="number" step="0.1" class="edit-input" value="${player.handicap || 0}" onchange="markDirty()"></td>
            <td><span class="status-badge status-confirmed">Confirmed</span></td>
            <td>
                <button class="admin-btn secondary" style="width: auto; padding: 5px 10px; margin: 0;">Remove</button>
            </td>
        </tr>
    `).join('');
}

function markDirty() {
    hasChanges = true;
    saveBar.style.display = 'flex';
}

function discardChanges() {
    if (confirm('Discard all unsaved changes?')) {
        loadRoster();
        saveBar.style.display = 'none';
        hasChanges = false;
    }
}

async function saveChanges() {
    // This will implement the batch update to Supabase
    alert('Save functionality will be connected once Supabase table is created!');
    saveBar.style.display = 'none';
    hasChanges = false;
}
