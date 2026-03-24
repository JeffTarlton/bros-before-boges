// Supabase Configuration
const SUPABASE_URL = 'https://gxpwgrdyizruzfczzqwn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uo20KpEYmGXAIB9JGL1CnQ_wIxT8GX4';

let supabaseInstance = null;
let currentRoundId = null;
let currentCourse = null;
let selectedPlayers = [];
let allConfirmedPlayers = [];
let currentRoundMatchups = [];
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

    const { data: players } = await supabaseInstance
        .from('players')
        .select('*')
        .eq('status', 'confirmed')
        .order('team_id', { ascending: true })
        .order('name');

    if (players) {
        allConfirmedPlayers = players;
        await renderPlayerSelectionUI(document.getElementById('round-number-select').value);
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

        // Auto-resume logic
        const savedRoundId = localStorage.getItem('bbb_active_round_id');
        const savedPlayerIds = JSON.parse(localStorage.getItem('bbb_tracked_players') || '[]');

        if (savedRoundId === activeRound.id && savedPlayerIds.length > 0) {
            const checkboxes = document.querySelectorAll('.player-check');
            let checkedAny = false;
            checkboxes.forEach(cb => {
                if (savedPlayerIds.includes(cb.value)) {
                    cb.checked = true;
                    checkedAny = true;
                } else {
                    cb.checked = false;
                }
            });

            if (checkedAny) {
                console.log("Auto-resuming active round session.");
                startRound(true);
            }
        }
    }
}

function setupEventListeners() {
    document.getElementById('round-number-select').addEventListener('change', (e) => {
        renderPlayerSelectionUI(e.target.value);
    });

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
        if (swipeDist > swipeThreshold && currentHole > 1) {
            currentHole--;
            renderHoleView();
        }
    }
}

async function renderPlayerSelectionUI(roundNumStr) {
    const container = document.getElementById('player-selection-container');
    if (!container) return;
    
    container.innerHTML = '<div style="color: var(--text-muted); font-size: 0.9rem;">Loading groupings...</div>';
    
    const renderIndividualCheckboxes = () => {
        container.style = "display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin-top: 10px;";
        container.innerHTML = '';
        let currentTeam = null;
        allConfirmedPlayers.forEach(p => {
            if (p.team_id !== currentTeam) {
                currentTeam = p.team_id;
                const teamHeader = document.createElement('div');
                teamHeader.style = "grid-column: 1 / -1; margin-top: 15px; font-weight: 800; color: var(--accent-gold); font-size: 0.8rem; text-transform: uppercase; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 5px;";
                teamHeader.textContent = currentTeam ? `Team ${currentTeam}` : 'No Team Assigned';
                container.appendChild(teamHeader);
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
            container.appendChild(div);
        });
    };

    const roundNum = parseInt(roundNumStr);
    
    try {
        const { data: matchups } = await supabaseInstance
            .from('matchups')
            .select('*')
            .eq('round_number', roundNum);
            
        if (!matchups || matchups.length === 0) {
            renderIndividualCheckboxes();
            return;
        }

        // Render Matchup Cards
        container.style = "display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 15px; margin-top: 10px;";
        container.innerHTML = '';

        matchups.forEach((match, index) => {
            const getPlayerInfo = id => allConfirmedPlayers.find(pl => pl.id === id);

            const p1t1 = getPlayerInfo(match.t1_player1_id);
            const p2t1 = getPlayerInfo(match.t1_player2_id);
            const p1t2 = getPlayerInfo(match.t2_player1_id);
            const p2t2 = getPlayerInfo(match.t2_player2_id);

            const t1names = p2t1 ? `${p1t1.name.split(' ')[0]} & ${p2t1.name.split(' ')[0]}` : (p1t1 ? p1t1.name.split(' ')[0] : 'TBD');
            const t2names = p2t2 ? `${p1t2.name.split(' ')[0]} & ${p2t2.name.split(' ')[0]}` : (p1t2 ? p1t2.name.split(' ')[0] : 'TBD');

            const isMyMatch = currentUserPlayer && (
                match.t1_player1_id === currentUserPlayer.id || match.t1_player2_id === currentUserPlayer.id ||
                match.t2_player1_id === currentUserPlayer.id || match.t2_player2_id === currentUserPlayer.id
            );

            const card = document.createElement('div');
            card.className = `matchup-select-card ${isMyMatch ? 'selected' : ''}`;

            // Function to generate the injected hidden checkbox markup safely mapping startRound dependencies
            const createHiddenCb = (pNumObj) => {
                if (!pNumObj) return '';
                return `<input type="checkbox" class="player-check" value="${pNumObj.id}" data-name="${pNumObj.name}" data-team="${pNumObj.team_id}" ${isMyMatch ? 'checked' : ''}>`;
            };

            card.innerHTML = `
                <h4 style="margin: 0 0 10px 0; color: var(--accent-gold); font-size: 0.9rem; text-transform: uppercase; letter-spacing: 1px;">Match ${index + 1}</h4>
                <div style="font-size: 0.95rem; font-weight: 600; color: white;">Team 1: ${t1names}</div>
                <div style="font-size: 0.8rem; color: var(--text-muted); margin: 5px 0;">VS</div>
                <div style="font-size: 0.95rem; font-weight: 600; color: white;">Team 2: ${t2names}</div>
                
                <div style="display: none;" class="hidden-player-checks">
                    ${createHiddenCb(p1t1)}
                    ${createHiddenCb(p2t1)}
                    ${createHiddenCb(p1t2)}
                    ${createHiddenCb(p2t2)}
                </div>
            `;

            card.addEventListener('click', () => {
                // Deselect all
                document.querySelectorAll('.matchup-select-card').forEach(c => {
                    c.classList.remove('selected');
                    c.querySelectorAll('.player-check').forEach(cb => cb.checked = false);
                });
                
                // Select clicked
                card.classList.add('selected');
                card.querySelectorAll('.player-check').forEach(cb => cb.checked = true);
            });

            container.appendChild(card);
        });

    } catch (e) {
        console.error("Matchup fetch error:", e);
        renderIndividualCheckboxes();
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

    // Load Round 2 Matchups for Scramble/Alt-Shot Auto-Copy logic
    const roundNumber = activeRound ? activeRound.round_number : parseInt(document.getElementById('round-number-select').value);
    if (roundNumber === 2) {
        const { data: mData } = await supabaseInstance
            .from('matchups')
            .select('*')
            .eq('round_number', 2);
        currentRoundMatchups = mData || [];
    }

    currentHole = 1;
    renderHoleView();
    renderScorecard(); // populate the hidden scorecard
    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('scoring-screen').style.display = 'block';
    document.getElementById('active-course-name').textContent = currentCourse.name;

    // Cache the active tracking session
    localStorage.setItem('bbb_active_round_id', currentRoundId);
    localStorage.setItem('bbb_tracked_players', JSON.stringify(selectedPlayers.map(p => p.id)));
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
        if (isRound2 && currentRoundMatchups.length > 0) {
            const match = currentRoundMatchups.find(m => 
                m.t1_player1_id === player.id || m.t1_player2_id === player.id || 
                m.t2_player1_id === player.id || m.t2_player2_id === player.id
            );
            if (match) {
                let companionId = null;
                if (match.t1_player1_id === player.id) companionId = match.t1_player2_id;
                else if (match.t1_player2_id === player.id) companionId = match.t1_player1_id;
                else if (match.t2_player1_id === player.id) companionId = match.t2_player2_id;
                else if (match.t2_player2_id === player.id) companionId = match.t2_player1_id;
                
                if (companionId) companion = selectedPlayers.find(p => p.id === companionId);
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
    if (isRound2 && currentRoundMatchups.length > 0) {
        const match = currentRoundMatchups.find(m => 
            m.t1_player1_id === playerId || m.t1_player2_id === playerId || 
            m.t2_player1_id === playerId || m.t2_player2_id === playerId
        );
        if (match) {
            let companionId = null;
            if (match.t1_player1_id === playerId) companionId = match.t1_player2_id;
            else if (match.t1_player2_id === playerId) companionId = match.t1_player1_id;
            else if (match.t2_player1_id === playerId) companionId = match.t2_player2_id;
            else if (match.t2_player2_id === playerId) companionId = match.t2_player1_id;

            if (companionId) {
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
            .select('id, round_number, course_id, courses(*)')
            .eq('status', 'active');

        if (roundError) throw roundError;

        if (!activeRounds || activeRounds.length === 0) {
            container.innerHTML = '<p style="color: var(--text-muted);">No active rounds found for leaderboard.</p>';
            return;
        }

        const activeRoundIds = activeRounds.map(r => r.id);
        const roundNumber = activeRounds[0].round_number;
        const isMatchPlayRound = roundNumber === 1 || roundNumber === 2 || roundNumber === 3;
        const currentCourseData = activeRounds[0].courses;

        // Fetch ALL score data for these active rounds
        const { data: scoresData, error } = await supabaseInstance
            .from('scores')
            .select(`
                *,
                players ( name, team_id )
            `)
            .in('round_id', activeRoundIds);

        if (error) throw error;

        // Fetch custom matchups
        const { data: retrievedMatchups } = await supabaseInstance
            .from('matchups')
            .select('*')
            .in('round_number', activeRounds.map(r => r.round_number));

        if (!scoresData || scoresData.length === 0) {
            container.innerHTML = '<p style="color: var(--text-muted);">No scores recorded yet.</p>';
            return;
        }

        let isMatchPlayDisplay = isMatchPlayRound && retrievedMatchups && retrievedMatchups.length > 0;
        let rightColumnHeader = isMatchPlayDisplay ? 'Match Status' : (roundNumber === 1 ? 'Points' : 'To Par');

        let tableHTML = `
            <table class="tracker-table" style="width: 100%; margin: 0 auto; text-align: left;">
                <thead>
                    <tr>
                        <th style="padding: 10px;">Pos</th>
                        <th style="padding: 10px;">Player</th>
                        <th style="padding: 10px; text-align: right;">${rightColumnHeader}</th>
                    </tr>
                </thead>
                <tbody>
        `;

        if (isMatchPlayRound && retrievedMatchups && retrievedMatchups.length > 0) {
            // MATCH PLAY VIEW FOR ALL 3 ROUNDS
            retrievedMatchups.forEach((match, index) => {
                const sT1P1 = scoresData.find(d => d.player_id === match.t1_player1_id);
                const sT1P2 = scoresData.find(d => d.player_id === match.t1_player2_id);
                const sT2P1 = scoresData.find(d => d.player_id === match.t2_player1_id);
                const sT2P2 = scoresData.find(d => d.player_id === match.t2_player2_id);

                let status1 = 'AS';
                let statusColor1 = 'var(--text-muted)';
                let status2 = 'AS';
                let statusColor2 = 'var(--text-muted)';
                let isPaired = sT1P1 && sT1P2;

                if (roundNumber === 1) {
                    // Round 1: Modified Stableford Quota
                    // Compare total points
                    const calcPoints = (scoreObj) => {
                        if (!scoreObj) return 0;
                        let pts = 0;
                        for (let i = 1; i <= 18; i++) {
                            const holeScore = scoreObj[`h${i}`];
                            const par = currentCourseData[`h${i}_par`] || 4;
                            if (holeScore) {
                                const diff = holeScore - par;
                                if (diff <= -2) pts += 5;       // Eagle
                                else if (diff === -1) pts += 3; // Birdie
                                else if (diff === 0) pts += 2;  // Par
                                else if (diff === 1) pts += 1;  // Bogey
                            }
                        }
                        return pts;
                    };
                    const t1Total = calcPoints(sT1P1) + calcPoints(sT1P2);
                    const t2Total = calcPoints(sT2P1) + calcPoints(sT2P2);

                    if (t1Total > t2Total) {
                        const diff = t1Total - t2Total;
                        status1 = `${diff} UP`; statusColor1 = 'var(--accent-emerald)';
                        status2 = `${diff} DN`; statusColor2 = '#ef4444';
                    } else if (t2Total > t1Total) {
                        const diff = t2Total - t1Total;
                        status2 = `${diff} UP`; statusColor2 = 'var(--accent-emerald)';
                        status1 = `${diff} DN`; statusColor1 = '#ef4444';
                    }
                } 
                else if (roundNumber === 2) {
                    // Round 2: Split Decision (Front 9 Scramble, Back 9 Alt Shot)
                    const t1obj = sT1P1 || sT1P2;
                    const t2obj = sT2P1 || sT2P2;
                    let t1Strokes = 0; let t2Strokes = 0;
                    
                    if (t1obj || t2obj) {
                        // Check if they are on back 9
                        let isOnBack9 = false;
                        for(let i=10; i<=18; i++) {
                            if ((t1obj && t1obj[`h${i}`]) || (t2obj && t2obj[`h${i}`])) {
                                isOnBack9 = true;
                                break;
                            }
                        }

                        let startHole = isOnBack9 ? 10 : 1;
                        let endHole = isOnBack9 ? 18 : 9;

                        for (let i = startHole; i <= endHole; i++) {
                            if (t1obj && t1obj[`h${i}`]) t1Strokes += t1obj[`h${i}`];
                            if (t2obj && t2obj[`h${i}`]) t2Strokes += t2obj[`h${i}`];
                        }

                        if (t1Strokes < t2Strokes) {
                            const diff = t2Strokes - t1Strokes;
                            status1 = `${diff} UP`; statusColor1 = 'var(--accent-emerald)';
                            status2 = `${diff} DN`; statusColor2 = '#ef4444';
                        } else if (t2Strokes < t1Strokes) {
                            const diff = t1Strokes - t2Strokes;
                            status2 = `${diff} UP`; statusColor2 = 'var(--accent-emerald)';
                            status1 = `${diff} DN`; statusColor1 = '#ef4444';
                        }
                    }
                }
                else if (roundNumber === 3) {
                    // Round 3: Singles Match Play
                    const t1obj = sT1P1;
                    const t2obj = sT2P1;
                    let t1HolesWon = 0;
                    let t2HolesWon = 0;
                    isPaired = false;

                    for (let i = 1; i <= 18; i++) {
                        const h1 = t1obj ? t1obj[`h${i}`] : null;
                        const h2 = t2obj ? t2obj[`h${i}`] : null;
                        if (h1 && h2) {
                            if (h1 < h2) t1HolesWon++;
                            else if (h2 < h1) t2HolesWon++;
                        } else if (h1) {
                            t1HolesWon++;
                        } else if (h2) {
                            t2HolesWon++;
                        }
                    }

                    if (t1HolesWon > t2HolesWon) {
                        const diff = t1HolesWon - t2HolesWon;
                        status1 = `${diff} UP`; statusColor1 = 'var(--accent-emerald)';
                        status2 = `${diff} DN`; statusColor2 = '#ef4444';
                    } else if (t2HolesWon > t1HolesWon) {
                        const diff = t2HolesWon - t1HolesWon;
                        status2 = `${diff} UP`; statusColor2 = 'var(--accent-emerald)';
                        status1 = `${diff} DN`; statusColor1 = '#ef4444';
                    }
                }

                const formatName = (p1, p2) => {
                    if (p1 && p2) return `${p1.players.name.split(' ')[0]} & ${p2.players.name.split(' ')[0]}`;
                    if (p1) return p1.players.name;
                    return 'Player';
                };

                const t1Name = formatName(sT1P1, sT1P2);
                const t2Name = formatName(sT2P1, sT2P2);

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
            // FALLBACK INDIVIDUAL VIEWS (If Matchups are not set up yet)
            const playerScores = {};
            scoresData.forEach(score => {
                const playerName = score.players.name;
                const teamId = score.players.team_id;
                
                if (!playerScores[playerName]) {
                    playerScores[playerName] = { name: playerName, team_id: teamId, value: 0 };
                }

                if (roundNumber === 1) {
                    // Quota Points
                    for (let i = 1; i <= 18; i++) {
                        const holeScore = score[`h${i}`];
                        const par = currentCourseData[`h${i}_par`] || 4;
                        if (holeScore) {
                            const diff = holeScore - par;
                            if (diff <= -2) playerScores[playerName].value += 5;
                            else if (diff === -1) playerScores[playerName].value += 3;
                            else if (diff === 0) playerScores[playerName].value += 2;
                            else if (diff === 1) playerScores[playerName].value += 1;
                        }
                    }
                } else {
                    // Stroke Play Total To Par
                    playerScores[playerName].value += parseInt(score.total_to_par || 0);
                }
            });

            // Sort: Round 1 (Desc: Highest Points wins), Others (Asc: Lowest To Par wins)
            const sortedPlayers = Object.values(playerScores).sort((a, b) => {
                return roundNumber === 1 ? b.value - a.value : a.value - b.value;
            });

            sortedPlayers.forEach((player, index) => {
                let rightColStr = '';
                let rightColColor = 'inherit';

                if (roundNumber === 1) {
                    rightColStr = `${player.value} pts`;
                    rightColColor = 'var(--accent-gold)';
                } else {
                    rightColStr = player.value === 0 ? 'E' : (player.value > 0 ? `+${player.value}` : player.value);
                    rightColColor = player.value < 0 ? 'var(--accent-emerald)' : (player.value > 0 ? '#ef4444' : 'inherit');
                }

                let teamIcon = player.team_id === 1 ? '🔵' : (player.team_id === 2 ? '🔴' : '⚪');

                tableHTML += `
                    <tr>
                        <td style="padding: 12px; font-weight: bold;">${index + 1}</td>
                        <td style="padding: 12px;">${teamIcon} ${player.name}</td>
                        <td style="padding: 12px; font-weight: 900; text-align: right; color: ${rightColColor};">${rightColStr}</td>
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
        localStorage.removeItem('bbb_active_round_id');
        localStorage.removeItem('bbb_tracked_players');
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
