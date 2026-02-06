// Supabase Configuration
const SUPABASE_URL = 'https://gxpwgrdyizruzfczzqwn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uo20KpEYmGXAIB9JGL1CnQ_wIxT8GX4';

let supabaseInstance = null;
let currentRoundId = null;
let currentCourse = null;
let selectedPlayers = [];

let currentUserPlayer = null;
let activeRound = null;

// Initialize
async function init() {
    try {
        if (typeof supabase !== 'undefined') {
            supabaseInstance = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
            const { data: { session } } = await supabaseInstance.auth.getSession();
            if (!session) {
                window.location.href = 'index.html';
                return;
            }

            // Link logged in user to player record
            const { data: userData } = await supabaseInstance
                .from('players')
                .select('*')
                .eq('email', session.user.email)
                .single();

            if (userData) {
                currentUserPlayer = userData;
            }
        }

        await loadInitialData();
        setupEventListeners();
    } catch (e) {
        console.error('Initialization failed:', e);
    }
}

async function loadInitialData() {
    // 1. Load Courses
    const { data: courses } = await supabaseInstance
        .from('courses')
        .select('*');

    const courseSelect = document.getElementById('course-select');
    if (courses) {
        courses.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.name;
            opt.dataset.pars = JSON.stringify(Array.from({ length: 18 }, (_, i) => c[`h${i + 1}_par`]));
            courseSelect.appendChild(opt);
        });
    }

    // 2. Load Confirmed Players
    const { data: players } = await supabaseInstance
        .from('players')
        .select('*')
        .eq('status', 'confirmed') // Only confirmed players
        .order('name');

    const playerContainer = document.getElementById('player-checkboxes');
    playerContainer.innerHTML = '';
    if (players) {
        players.forEach(p => {
            const isSelf = currentUserPlayer && p.id === currentUserPlayer.id;
            const div = document.createElement('div');
            div.innerHTML = `
                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; ${isSelf ? 'color: var(--accent-emerald); font-weight: 700;' : ''}">
                    <input type="checkbox" value="${p.id}" class="player-check" 
                        data-name="${p.name}" ${isSelf ? 'checked' : ''}>
                    ${p.name} ${isSelf ? '(You)' : ''}
                </label>
            `;
            playerContainer.appendChild(div);
        });
    }

    // 3. Check for Active Rounds
    const { data: activeRounds } = await supabaseInstance
        .from('rounds')
        .select('*, courses(*)')
        .eq('status', 'active')
        .order('date', { ascending: false })
        .limit(1);

    if (activeRounds && activeRounds.length > 0) {
        activeRound = activeRounds[0];
        const section = document.getElementById('active-rounds-section');
        section.querySelector('p').textContent = `Round active at ${activeRound.courses.name}. Started on ${activeRound.date}.`;
        section.style.display = 'block';
    }
}

function setupEventListeners() {
    document.getElementById('start-scoring-btn').addEventListener('click', () => startRound(false));
    document.getElementById('join-round-btn').addEventListener('click', () => startRound(true));
    document.getElementById('back-to-setup').addEventListener('click', () => {
        document.getElementById('setup-screen').style.display = 'block';
        document.getElementById('scoring-screen').style.display = 'none';
    });
    document.getElementById('finish-round-btn').addEventListener('click', finalizeRound);
}

async function startRound(joining = false) {
    let courseId, courseName, coursePars;

    if (joining && activeRound) {
        courseId = activeRound.course_id;
        courseName = activeRound.courses.name;
        coursePars = JSON.parse(JSON.stringify(Array.from({ length: 18 }, (_, i) => activeRound.courses[`h${i + 1}_par`])));
        currentRoundId = activeRound.id;
    } else {
        courseId = document.getElementById('course-select').value;
        if (!courseId) {
            alert('Please select a course.');
            return;
        }
        const courseOpt = document.querySelector(`#course-select option[value="${courseId}"]`);
        courseName = courseOpt.textContent;
        coursePars = JSON.parse(courseOpt.dataset.pars);

        // Create New Round
        const { data: roundData, error: roundError } = await supabaseInstance
            .from('rounds')
            .insert([{ course_id: courseId, status: 'active' }])
            .select();

        if (roundError) {
            alert('Error creating round: ' + roundError.message);
            return;
        }
        currentRoundId = roundData[0].id;
    }

    currentCourse = { id: courseId, name: courseName, pars: coursePars };

    const playerChecks = document.querySelectorAll('.player-check:checked');
    if (playerChecks.length === 0) {
        alert('Please select at least one player.');
        return;
    }

    selectedPlayers = Array.from(playerChecks).map(chk => ({
        id: chk.value,
        name: chk.dataset.name
    }));

    // Fetch existing scores for this round to see who is already tracking
    const { data: existingScores } = await supabaseInstance
        .from('scores')
        .select('*')
        .eq('round_id', currentRoundId);

    const scoreInserts = [];

    for (const player of selectedPlayers) {
        const existing = existingScores ? existingScores.find(s => s.player_id === player.id) : null;

        if (existing) {
            player.scoreId = existing.id;
            player.scores = Array.from({ length: 18 }, (_, i) => existing[`h${i + 1}`]);
        } else {
            // New score record for this player
            scoreInserts.push({
                round_id: currentRoundId,
                player_id: player.id,
                total_score: 0,
                total_to_par: 0
            });
        }
    }

    if (scoreInserts.length > 0) {
        const { data: newScores, error: scoreError } = await supabaseInstance
            .from('scores')
            .insert(scoreInserts)
            .select();

        if (scoreError) {
            alert('Error creating scores: ' + scoreError.message);
            return;
        }

        newScores.forEach(ns => {
            const player = selectedPlayers.find(p => p.id === ns.player_id);
            player.scoreId = ns.id;
            player.scores = Array(18).fill(null);
        });
    }

    renderScorecard();
    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('scoring-screen').style.display = 'block';
    document.getElementById('active-course-name').textContent = currentCourse.name;
}

function renderScorecard() {
    const table = document.getElementById('scorecard-table');

    let html = `
        <thead>
            <tr>
                <th style="text-align: left;">Hole</th>
                ${Array.from({ length: 18 }, (_, i) => `<th>${i + 1}</th>`).join('')}
                <th>Total</th>
                <th>+/-</th>
            </tr>
            <tr class="par-row">
                <td style="text-align: left;">Par</td>
                ${currentCourse.pars.map(p => `<td>${p || '-'}</td>`).join('')}
                <td>${currentCourse.pars.reduce((a, b) => a + (b || 0), 0)}</td>
                <td>-</td>
            </tr>
        </thead>
        <tbody>
    `;

    selectedPlayers.forEach(player => {
        const total = player.scores.reduce((a, b) => a + (b || 0), 0);
        let toPar = 0;
        player.scores.forEach((s, i) => {
            if (s !== null && currentCourse.pars[i]) {
                toPar += (s - currentCourse.pars[i]);
            }
        });
        const toParText = toPar === 0 ? 'E' : (toPar > 0 ? `+${toPar}` : toPar);
        const toParColor = toPar < 0 ? 'var(--accent-emerald)' : (toPar > 0 ? '#ff4d4d' : 'white');

        html += `
            <tr class="player-row">
                <td style="text-align: left; font-weight: 700;">${player.name}</td>
                ${Array.from({ length: 18 }, (_, i) => `
                    <td>
                        <input type="number" class="score-input" 
                            data-player-id="${player.id}" 
                            data-hole="${i + 1}" 
                            value="${player.scores[i] || ''}"
                            onchange="updateScore('${player.id}', ${i + 1}, this.value)">
                    </td>
                `).join('')}
                <td id="total-${player.id}">${total}</td>
                <td id="topar-${player.id}" style="color: ${toParColor}">${toParText}</td>
            </tr>
        `;
    });

    html += `</tbody>`;
    table.innerHTML = html;
}

async function updateScore(playerId, hole, val) {
    const player = selectedPlayers.find(p => p.id === playerId);
    const scoreVal = val === '' ? null : parseInt(val);
    player.scores[hole - 1] = scoreVal;

    // Calculate totals
    const total = player.scores.reduce((a, b) => a + (b || 0), 0);
    let toPar = 0;
    player.scores.forEach((s, i) => {
        if (s !== null && currentCourse.pars[i]) {
            toPar += (s - currentCourse.pars[i]);
        }
    });

    // Update UI
    document.getElementById(`total-${playerId}`).textContent = total;
    const toParEl = document.getElementById(`topar-${playerId}`);
    toParEl.textContent = toPar === 0 ? 'E' : (toPar > 0 ? `+${toPar}` : toPar);
    toParEl.style.color = toPar < 0 ? 'var(--accent-emerald)' : (toPar > 0 ? '#ff4d4d' : 'white');

    // Update Supabase
    const updateData = {};
    updateData[`h${hole}`] = scoreVal;
    updateData.total_score = total;
    updateData.total_to_par = toPar;

    const { error } = await supabaseInstance
        .from('scores')
        .update(updateData)
        .eq('id', player.scoreId);

    if (error) console.error('Save failed:', error);
}

async function finalizeRound() {
    if (!confirm('Are you sure you want to finalize this round? This will mark it as completed.')) return;

    const { error } = await supabaseInstance
        .from('rounds')
        .update({ status: 'completed' })
        .eq('id', currentRoundId);

    if (error) {
        alert('Error finalizing: ' + error.message);
    } else {
        alert('Round finalized! Redirecting...');
        window.location.href = 'index.html';
    }
}

// Global exposure for onchange
window.updateScore = updateScore;

init();
