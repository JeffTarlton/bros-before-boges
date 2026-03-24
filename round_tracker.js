// Supabase Configuration
const SUPABASE_URL = 'https://gxpwgrdyizruzfczzqwn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uo20KpEYmGXAIB9JGL1CnQ_wIxT8GX4';

let supabaseInstance = null;
let currentRoundId = null;
let currentCourse = null;
let selectedPlayers = [];
let pairings = [];
let currentHole = 1;

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
    // Clear existing options except the default one (if any, though we're rebuilding)
    courseSelect.innerHTML = '<option value="">-- Choose a Course --</option>';

    if (courses) {
        courses.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.name;
            opt.dataset.pars = JSON.stringify(Array.from({ length: 18 }, (_, i) => c[`h${i + 1}_par`]));
            courseSelect.appendChild(opt);
        });
    }

    // 2. Load Confirmed Players & Group by Team
    const { data: players } = await supabaseInstance
        .from('players')
        .select('*')
        .eq('status', 'confirmed')
        .order('team_id', { ascending: true })
        .order('name');

    const playerContainer = document.getElementById('player-checkboxes');
    playerContainer.innerHTML = '';
    if (players) {
        let currentTeam = null;
        players.forEach(p => {
            if (p.team_id !== currentTeam) {
                currentTeam = p.team_id;
                const teamHeader = document.createElement('div');
                teamHeader.style = "grid-column: 1 / -1; margin-top: 15px; font-weight: 800; color: var(--accent-gold); font-size: 0.8rem; text-transform: uppercase; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 5px;";
                teamHeader.textContent = currentTeam ? `Team ${currentTeam}` : 'No Team Assigned';
                playerContainer.appendChild(teamHeader);
            }

            const isSelf = currentUserPlayer && p.id === currentUserPlayer.id;
            const div = document.createElement('div');
            div.innerHTML = `
                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; ${isSelf ? 'color: var(--accent-emerald); font-weight: 700;' : ''}">
                    <input type="checkbox" value="${p.id}" class="player-check" 
                        data-name="${p.name}" data-team="${p.team_id || ''}" ${isSelf ? 'checked' : ''}>
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
        document.getElementById('full-scorecard-modal').style.display = 'none';
    });
    document.getElementById('finish-round-btn').addEventListener('click', finalizeRound);

    document.getElementById('prev-hole-btn').addEventListener('click', () => {
        if (currentHole > 1) {
            currentHole--;
            renderHoleView();
        }
    });

    document.getElementById('next-hole-btn').addEventListener('click', () => {
        if (currentHole < 18) {
            currentHole++;
            renderHoleView();
        }
    });

    document.getElementById('view-full-scorecard-btn').addEventListener('click', () => {
        renderScorecard();
        document.getElementById('full-scorecard-modal').style.display = 'block';
    });

    document.getElementById('close-leaderboard-btn').addEventListener('click', () => {
        document.getElementById('leaderboard-modal').style.display = 'none';
    });

    // Mobile Bottom Nav Event Listeners
    const navButtons = document.querySelectorAll('.tracker-bottom-nav button');
    
    function setActiveNav(btnId) {
        navButtons.forEach(btn => btn.classList.remove('active'));
        if (btnId) document.getElementById(btnId).classList.add('active');
    }

    document.getElementById('nav-scoring-btn').addEventListener('click', () => {
        setActiveNav('nav-scoring-btn');
        document.getElementById('full-scorecard-modal').style.display = 'none';
        document.getElementById('leaderboard-modal').style.display = 'none';
    });

    document.getElementById('nav-scorecard-btn').addEventListener('click', () => {
        setActiveNav('nav-scorecard-btn');
        renderScorecard();
        document.getElementById('full-scorecard-modal').style.display = 'block';
    });

    document.getElementById('nav-leaderboard-btn').addEventListener('click', () => {
        setActiveNav('nav-leaderboard-btn');
        document.getElementById('leaderboard-modal').style.display = 'block';
        renderLeaderboardModal();
    });

    document.getElementById('nav-finish-btn').addEventListener('click', () => {
        finalizeRound();
    });

    // When closing modals from the "X" button, reset bottom nav to Scoring
    document.getElementById('close-scorecard-btn').addEventListener('click', () => {
        document.getElementById('full-scorecard-modal').style.display = 'none';
        setActiveNav('nav-scoring-btn');
    });

    document.getElementById('close-leaderboard-btn').addEventListener('click', () => {
        document.getElementById('leaderboard-modal').style.display = 'none';
        setActiveNav('nav-scoring-btn');
    });

    // Swipe-to-change holes logic
    let touchStartX = 0;
    let touchEndX = 0;
    const swipeThreshold = 50; // minimum pixels to be considered a swipe
    const scoringContainer = document.getElementById('hole-scoring-container');

    scoringContainer.addEventListener('touchstart', e => {
        touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    scoringContainer.addEventListener('touchend', e => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
    }, { passive: true });

    function handleSwipe() {
        const swipeDist = touchEndX - touchStartX;
        
        // Swipe Left -> Next Hole
        if (swipeDist < -swipeThreshold && currentHole < 18) {
            currentHole++;
            renderHoleView();
        }
        // Swipe Right -> Prev Hole
        if (swipeDist > swipeThreshold && currentHole > 1) {
            currentHole--;
            renderHoleView();
        }
    }
}

async function startRound(joining = false) {
    let courseId, courseName, coursePars;

    if (joining && activeRound) {
        courseId = activeRound.course_id;
        courseName = activeRound.courses.name;
        coursePars = JSON.parse(JSON.stringify(Array.from({ length: 18 }, (_, i) => activeRound.courses[`h${i + 1}_par`])));
        currentRoundId = activeRound.id;
    } else {
        const roundNumber = document.getElementById('round-number-select').value;
        courseId = document.getElementById('course-select').value;
        if (!courseId) {
            alert('Please select a course.');
            return;
        }
        const courseOpt = document.querySelector(`#course-select option[value="${courseId}"]`);
        courseName = courseOpt.textContent;
        coursePars = JSON.parse(courseOpt.dataset.pars);

        // Create New Round with round_number
        const { data: roundData, error: roundError } = await supabaseInstance
            .from('rounds')
            .insert([{ course_id: courseId, status: 'active', round_number: parseInt(roundNumber) }])
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
        name: chk.dataset.name,
        team_id: chk.dataset.team
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

    // Load Round 2 Pairings if applicable
    const roundNumber = activeRound ? activeRound.round_number : parseInt(document.getElementById('round-number-select').value);
    if (roundNumber === 2) {
        const { data: pairData } = await supabaseInstance
            .from('pairings')
            .select('*');
        pairings = pairData || [];
    }

    currentHole = 1;
    renderHoleView();
    renderScorecard(); // populate the hidden scorecard
    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('scoring-screen').style.display = 'block';
    document.getElementById('active-course-name').textContent = currentCourse.name;
}

function renderHoleView() {
    const holePar = currentCourse.pars[currentHole - 1] || 4; // default to 4

    document.getElementById('current-hole-display').textContent = `Hole ${currentHole}`;
    document.getElementById('current-par-display').textContent = `Par ${holePar}`;

    document.getElementById('prev-hole-btn').disabled = currentHole === 1;
    document.getElementById('next-hole-btn').disabled = currentHole === 18;

    const container = document.getElementById('hole-scoring-container');
    const isRound2 = (activeRound && activeRound.round_number === 2) || (document.getElementById('round-number-select') && document.getElementById('round-number-select').value == 2);

    let html = '';
    const processedPlayerIds = new Set();

    selectedPlayers.forEach(player => {
        if (processedPlayerIds.has(player.id)) return;

        let companion = null;
        if (isRound2) {
            const pair = pairings.find(p => p.player1_id === player.id || p.player2_id === player.id);
            if (pair) {
                const companionId = pair.player1_id === player.id ? pair.player2_id : pair.player1_id;
                companion = selectedPlayers.find(p => p.id === companionId);
            }
        }

        const renderPlayerCard = (p, isCompanion = false) => {
            const currentScore = p.scores[currentHole - 1];
            const displayScore = currentScore === null ? '-' : currentScore;
            
            let toPar = 0;
            p.scores.forEach((s, i) => {
                if (s !== null && currentCourse.pars[i]) {
                    toPar += (s - currentCourse.pars[i]);
                }
            });
            const toParText = toPar === 0 ? 'E' : (toPar > 0 ? `+${toPar}` : toPar);
            const toParColor = toPar < 0 ? 'var(--accent-emerald)' : (toPar > 0 ? '#ff4d4d' : 'var(--text-muted)');

            return `
                <div class="player-score-card ${isCompanion ? 'companion-card' : ''}" style="${isCompanion ? 'border-top: none; border-top-left-radius: 0; border-top-right-radius: 0; background: rgba(255,255,255,0.02); margin-top: -10px;' : ''}">
                    <div class="player-score-info">
                        <h4>${p.name}</h4>
                        <p>Total: <span style="color: ${toParColor}; font-weight: bold;">${toParText}</span>
                         ${p.team_id ? ` | Team ${p.team_id}` : ''}
                         ${isCompanion ? ' (Pair)' : ''}</p>
                    </div>
                    <div class="score-controls">
                        <button class="score-btn minus" onclick="adjustScore('${p.id}', -1)">−</button>
                        <div id="score-display-${p.id}" class="current-score-display">${displayScore}</div>
                        <button class="score-btn plus" onclick="adjustScore('${p.id}', 1)">+</button>
                    </div>
                </div>
            `;
        };

        html += renderPlayerCard(player);
        processedPlayerIds.add(player.id);
        
        if (companion) {
            html += renderPlayerCard(companion, true);
            processedPlayerIds.add(companion.id);
        }
    });

    container.innerHTML = html;
}

function renderScorecard() {
    const table = document.getElementById('scorecard-table');
    const isRound2 = (activeRound && activeRound.round_number === 2) || (document.getElementById('round-number-select') && document.getElementById('round-number-select').value == 2);

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

    const processedPlayerIds = new Set();

    selectedPlayers.forEach(player => {
        if (processedPlayerIds.has(player.id)) return;

        let companion = null;
        if (isRound2) {
            const pair = pairings.find(p => p.player1_id === player.id || p.player2_id === player.id);
            if (pair) {
                const companionId = pair.player1_id === player.id ? pair.player2_id : pair.player1_id;
                companion = selectedPlayers.find(p => p.id === companionId);
            }
        }

        const renderRow = (p, isCompanion = false) => {
            const total = p.scores.reduce((a, b) => a + (b || 0), 0);
            let toPar = 0;
            p.scores.forEach((s, i) => {
                if (s !== null && currentCourse.pars[i]) {
                    toPar += (s - currentCourse.pars[i]);
                }
            });
            let toParText = toPar === 0 ? 'E' : (toPar > 0 ? `+${toPar}` : toPar);
            let toParColor = toPar < 0 ? 'var(--accent-emerald)' : (toPar > 0 ? '#ff4d4d' : 'white');

            // Override for Match Play
            if (isRound2 && companion) {
                let compToPar = 0;
                companion.scores.forEach((s, i) => {
                    if (s !== null && currentCourse.pars[i]) {
                        compToPar += (s - currentCourse.pars[i]);
                    }
                });

                if (toPar < compToPar) {
                    toParText = `${compToPar - toPar} UP`;
                    toParColor = 'var(--accent-emerald)';
                } else if (toPar > compToPar) {
                    toParText = `${toPar - compToPar} DN`;
                    toParColor = '#ff4d4d';
                } else {
                    toParText = 'AS';
                    toParColor = 'var(--text-muted)';
                }
            }

            return `
                <tr class="player-row ${isCompanion ? 'companion-row' : ''}" style="${isCompanion ? 'border-top: none;' : ''}">
                    <td style="text-align: left; font-weight: 700; ${isCompanion ? 'padding-left: 25px;' : ''}">
                        ${p.name}
                        ${p.team_id ? `<br><small style="color: var(--accent-gold); font-size: 0.75rem;">TEAM ${p.team_id}</small>` : ''}
                        ${isCompanion ? '<br><small style="color: var(--text-muted); font-size: 0.65rem;">PAIR PARTNER</small>' : ''}
                    </td>
                    ${Array.from({ length: 18 }, (_, i) => {
                        const score = p.scores[i];
                        const par = currentCourse.pars[i];
                        let pgaClass = '';
                        
                        if (score !== null && score !== undefined && par) {
                            const diff = score - par;
                            if (diff <= -2) pgaClass = 'pga-score score-eagle';
                            else if (diff === -1) pgaClass = 'pga-score score-birdie';
                            else if (diff === 0) pgaClass = 'pga-score score-par';
                            else if (diff === 1) pgaClass = 'pga-score score-bogey';
                            else if (diff >= 2) pgaClass = 'pga-score score-double';
                        }
                        
                        return `
                        <td>
                            <div style="display: flex; justify-content: center; align-items: center;">
                                <div class="${pgaClass}">
                                    <input type="number" class="score-input" 
                                        style="background: transparent; border: none; padding: 0; margin: 0; width: 30px; ${pgaClass ? 'color: inherit;' : ''}"
                                        data-player-id="${p.id}" 
                                        data-hole="${i + 1}" 
                                        value="${score || ''}"
                                        onchange="updateScore('${p.id}', ${i + 1}, this.value)">
                                </div>
                            </div>
                        </td>
                    `}).join('')}
                    <td id="total-${p.id}">${total}</td>
                    <td id="topar-${p.id}" style="color: ${toParColor}">${toParText}</td>
                </tr>
            `;
        };

        html += renderRow(player);
        processedPlayerIds.add(player.id);

        if (companion) {
            html += renderRow(companion, true);
            processedPlayerIds.add(companion.id);
        }
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

    // Update UI (Full Scorecard elements)
    const totalEl = document.getElementById(`total-${playerId}`);
    if (totalEl) totalEl.textContent = total;
    const toParEl = document.getElementById(`topar-${playerId}`);
    if (toParEl) {
        toParEl.textContent = toPar === 0 ? 'E' : (toPar > 0 ? `+${toPar}` : toPar);
        toParEl.style.color = toPar < 0 ? 'var(--accent-emerald)' : (toPar > 0 ? '#ff4d4d' : 'white');
    }

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

    // If Round 2 and paired, update the companion as well
    const isRound2 = (activeRound && activeRound.round_number === 2) || (document.getElementById('round-number-select') && document.getElementById('round-number-select').value == 2);
    if (isRound2) {
        const pair = pairings.find(p => p.player1_id === playerId || p.player2_id === playerId);
        if (pair) {
            const companionId = pair.player1_id === playerId ? pair.player2_id : pair.player1_id;
            const companion = selectedPlayers.find(p => p.id === companionId);
            if (companion && companion.scores[hole - 1] !== scoreVal) {
                companion.scores[hole - 1] = scoreVal;
                const compInput = document.querySelector(`.score-input[data-player-id="${companionId}"][data-hole="${hole}"]`);
                if (compInput) compInput.value = val;
                updateScore(companionId, hole, val);
            }
        }
    }
}

// ==========================================
// Leaderboard Modal Rendering Logic
// ==========================================
async function renderLeaderboardModal() {
    const container = document.getElementById('dynamic-leaderboard-container');
    container.innerHTML = 'Loading latest rankings...';
    try {
        // First, find all active rounds
        const { data: activeRounds, error: roundError } = await supabaseInstance
            .from('rounds')
            .select('id, round_number')
            .eq('status', 'active');

        if (roundError) throw roundError;

        if (!activeRounds || activeRounds.length === 0) {
            container.innerHTML = '<p style="color: var(--text-muted);">No active rounds found for leaderboard.</p>';
            return;
        }

        const activeRoundIds = activeRounds.map(r => r.id);
        const isMatchPlayRound = activeRounds.some(r => r.round_number === 2 || r.round_number === 3);

        // Fetch scores for those active rounds, joined with player info
        const { data, error } = await supabaseInstance
            .from('scores')
            .select(`
                total_score,
                total_to_par,
                round_id,
                player_id,
                players ( name, team_id )
            `)
            .in('round_id', activeRoundIds);

        if (error) throw error;

        // Fetch custom matchups
        const { data: retrievedMatchups } = await supabaseInstance
            .from('matchups')
            .select('*')
            .in('round_number', activeRounds.map(r => r.round_number));

        if (!data || data.length === 0) {
            container.innerHTML = '<p style="color: var(--text-muted);">No scores recorded yet.</p>';
            return;
        }

        let tableHTML = `
            <table class="tracker-table" style="width: 100%; margin: 0 auto; text-align: left;">
                <thead>
                    <tr>
                        <th style="padding: 10px;">Pos</th>
                        <th style="padding: 10px;">Player</th>
                        <th style="padding: 10px; text-align: right;">${isMatchPlayRound ? 'Match Status' : 'To Par'}</th>
                    </tr>
                </thead>
                <tbody>
        `;

        if (isMatchPlayRound && retrievedMatchups && retrievedMatchups.length > 0) {
            // MATCH PLAY VIEW
            // Group players by matchup
            retrievedMatchups.forEach((match, index) => {
                // Team 1 players
                const t1p1 = data.find(d => d.player_id === match.t1_player1_id);
                const t1p2 = data.find(d => d.player_id === match.t1_player2_id);
                // Team 2 players
                const t2p1 = data.find(d => d.player_id === match.t2_player1_id);
                const t2p2 = data.find(d => d.player_id === match.t2_player2_id);
                
                // For singles, p2 might be undefined. That's fine.
                const t1Score = (t1p1 ? parseInt(t1p1.total_to_par || 0) : 0) + (t1p2 ? parseInt(t1p2.total_to_par || 0) : 0);
                const t2Score = (t2p1 ? parseInt(t2p1.total_to_par || 0) : 0) + (t2p2 ? parseInt(t2p2.total_to_par || 0) : 0);
                
                // Note: For Scramble/Alt-Shot the players in the pair enter the *exact same score* in the UI, 
                // so simply summing their to_par values doubles the actual score difference.
                // We divide by 2 if it's a paired event to get the true team-to-par to compare.
                const isPaired = t1p1 && t1p2;
                const toPar1 = isPaired ? t1Score / 2 : t1Score;
                const toPar2 = (t2p1 && t2p2) ? t2Score / 2 : t2Score;

                let status1 = 'AS';
                let statusColor1 = 'var(--text-muted)';
                let status2 = 'AS';
                let statusColor2 = 'var(--text-muted)';

                if (toPar1 < toPar2) {
                    const diff = toPar2 - toPar1;
                    status1 = `${diff} UP`;
                    statusColor1 = 'var(--accent-emerald)';
                    status2 = `${diff} DN`;
                    statusColor2 = '#ef4444';
                } else if (toPar2 < toPar1) {
                    const diff = toPar1 - toPar2;
                    status2 = `${diff} UP`;
                    statusColor2 = 'var(--accent-emerald)';
                    status1 = `${diff} DN`;
                    statusColor1 = '#ef4444';
                }

                const t1Name = isPaired ? `${t1p1.players.name.split(' ')[0]} & ${t1p2.players.name.split(' ')[0]}` : (t1p1 ? t1p1.players.name : 'T1 Player');
                const t2Name = (t2p1 && t2p2) ? `${t2p1.players.name.split(' ')[0]} & ${t2p2.players.name.split(' ')[0]}` : (t2p1 ? t2p1.players.name : 'T2 Player');

                tableHTML += `
                    <tr style="border-top: 2px solid rgba(255,255,255,0.1);">
                        <td rowspan="2" style="padding: 12px; font-weight: bold; color: var(--text-muted);">Match ${index+1}</td>
                        <td style="padding: 12px;">🔵 ${t1Name}</td>
                        <td style="padding: 12px; font-weight: 900; text-align: right; color: ${statusColor1};">${status1}</td>
                    </tr>
                    <tr>
                        <td style="padding: 12px; border-top: none;">🔴 ${t2Name}</td>
                        <td style="padding: 12px; border-top: none; font-weight: 900; text-align: right; color: ${statusColor2};">${status2}</td>
                    </tr>
                `;
            });
        } else {
            // STROKE PLAY VIEW (Default)
            // Aggregate scores dynamically across anyone currently playing
            const playerScores = {};

            data.forEach(score => {
                const playerName = score.players.name;
                const teamId = score.players.team_id;
                const toPar = parseInt(score.total_to_par || 0);

                if (!playerScores[playerName]) {
                    playerScores[playerName] = {
                        name: playerName,
                        team_id: teamId,
                        total_to_par: 0
                    };
                }
                playerScores[playerName].total_to_par += toPar;
            });

            const sortedPlayers = Object.values(playerScores).sort((a, b) => a.total_to_par - b.total_to_par);

            sortedPlayers.forEach((player, index) => {
                let toParStr = player.total_to_par === 0 ? 'E' : (player.total_to_par > 0 ? `+${player.total_to_par}` : player.total_to_par);
                let toParColor = player.total_to_par < 0 ? 'var(--accent-emerald)' : (player.total_to_par > 0 ? '#ef4444' : 'inherit');
                let teamIcon = player.team_id === 1 ? '🔵' : (player.team_id === 2 ? '🔴' : '⚪');

                tableHTML += `
                    <tr>
                        <td style="padding: 12px; font-weight: bold;">${index + 1}</td>
                        <td style="padding: 12px;">${teamIcon} ${player.name}</td>
                        <td style="padding: 12px; font-weight: 900; text-align: right; color: ${toParColor};">${toParStr}</td>
                    </tr>
                `;
            });
        }

        tableHTML += `</tbody></table>`;
        container.innerHTML = tableHTML;

    } catch (err) {
        console.error("Error fetching leaderboard data:", err);
        container.innerHTML = '<p style="color: #ef4444;">Failed to load leaderboard. Please try again.</p>';
    }
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

window.adjustScore = function(playerId, delta) {
    const player = selectedPlayers.find(p => p.id === playerId);
    const holeIndex = currentHole - 1;
    let currentVal = player.scores[holeIndex];
    
    const holePar = currentCourse.pars[holeIndex] || 4;
    
    if (currentVal === null) {
        // Default to par + delta
        currentVal = holePar + delta;
    } else {
        currentVal += delta;
    }
    
    if (currentVal < 1) currentVal = 1;

    updateScore(playerId, currentHole, currentVal);
    
    document.getElementById(`score-display-${playerId}`).textContent = currentVal;
    renderHoleView();
    // Update the scorecard dynamically in case the modal is opened
    renderScorecard();
};

// Global exposure for onchange
window.updateScore = updateScore;

init();
