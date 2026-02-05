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
            passwordInput: document.getElementById('password')
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
    if (elements.loginBtn) {
        elements.loginBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleLogin();
        });
    }

    if (elements.logoutBtn) {
        elements.logoutBtn.addEventListener('click', handleLogout);
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
                players = data;
            }
        } catch (e) {
            console.error('Roster load failed:', e);
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
    if (!elements.rosterTbody) return;
    elements.rosterTbody.innerHTML = players.map((player, index) => `
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
    if (elements.saveBar) elements.saveBar.style.display = 'flex';
}

function discardChanges() {
    if (confirm('Discard all unsaved changes?')) {
        loadRoster();
        if (elements.saveBar) elements.saveBar.style.display = 'none';
        hasChanges = false;
    }
}

async function saveChanges() {
    alert('Save functionality will be connected once Supabase table is created!');
    if (elements.saveBar) elements.saveBar.style.display = 'none';
    hasChanges = false;
}

// Global initialization
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
