// public/app.js
// Global State
let currentMatchId = null;
let currentMatchData = null;
let unsubscribeMatch = null;

// Local temporary holders
let team1Players = [], team2Players = [];
let tossWinner = null, tossDecision = null, currentMatchDataLocal = null;
let startInningsPendingPayload = null; // holds data when waiting for opener selection

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    const dateEl = document.getElementById('match-date');
    if (dateEl) dateEl.valueAsDate = new Date();

    AuthService.onStateChanged(user => {
        if (!user) AuthService.signInAnonymously();
        handleRoute();
    });

    // wire up small helpers
    const dismissalModeEl = document.getElementById('dismissal-mode');
    if (dismissalModeEl) {
        dismissalModeEl.addEventListener('change', (e) => {
            const val = e.target.value;
            if (val === 'catch') document.getElementById('fielder-selection').classList.remove('hidden');
            else document.getElementById('fielder-selection').classList.add('hidden');
        });
    }
});
window.addEventListener('hashchange', handleRoute);

function handleRoute(){
    const hash = window.location.hash.slice(1);
    document.querySelectorAll('.view').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));

    if (!hash) {
        document.getElementById('view-dashboard').classList.remove('hidden');
    } else if (hash === 'create') {
        document.getElementById('view-create').classList.remove('hidden');
    } else if (hash.startsWith('toss/')) {
        currentMatchId = hash.split('/')[1];
        setupTossView(currentMatchId);
    } else if (hash.startsWith('match/')) {
        currentMatchId = hash.split('/')[1];
        initMatchView(currentMatchId);
    }
}

// ---------------- UI helpers (to replace alert()) ----------------
function showToast(msg, type = 'info', timeout = 3500) {
    const container = document.getElementById('toast-container');
    if (!container) { console.log('TOAST:', msg); return; }
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.innerText = msg;
    container.appendChild(node);
    setTimeout(() => {
        node.style.transition = 'transform 0.25s, opacity 0.25s';
        node.style.opacity = '0';
        node.style.transform = 'translateX(20px)';
        setTimeout(() => container.removeChild(node), 300);
    }, timeout);
}

// ---------------- Create match logic ----------------
document.getElementById('btn-create-match').onclick = () => window.location.hash = 'create';

window.parsePlayers = (team) => {
    const raw = document.getElementById(`${team}-players-raw`).value;
    const names = raw.split(/\n|,/).map(n => n.trim()).filter(n => n);
    if (names.length < 2) { showToast("Please enter at least 2 players", 'error'); return; }

    // Enforce equal players constraint: if other team already parsed, require equal length
    if (team === 'team1' && team2Players.length > 0 && names.length !== team2Players.length) {
        showToast("Both teams must have the same number of players. Please match player counts.", 'error');
        return;
    }
    if (team === 'team2' && team1Players.length > 0 && names.length !== team1Players.length) {
        showToast("Both teams must have the same number of players. Please match player counts.", 'error');
        return;
    }

    if (team === 'team1') team1Players = names; else team2Players = names;

    const capSelect = document.getElementById(`${team}-captain`);
    const wkSelect = document.getElementById(`${team}-wk`);
    capSelect.innerHTML = ''; wkSelect.innerHTML = '';
    names.forEach(name => { capSelect.add(new Option(name, name)); wkSelect.add(new Option(name, name)); });
    document.getElementById(`${team}-roles`).classList.remove('hidden');
    showToast(`Parsed ${names.length} players for ${team === 'team1' ? 'Team A' : 'Team B'}`, 'success');
};

document.getElementById('create-match-form').onsubmit = async (e) => {
    e.preventDefault();
    if(team1Players.length === 0 || team2Players.length === 0) { showToast("Please confirm players for both teams first.", 'error'); return; }
    if (team1Players.length !== team2Players.length) { showToast("Teams must have equal number of players.", 'error'); return; }

    const matchData = {
        title: document.getElementById('match-title').value,
        venue: document.getElementById('venue').value,
        date: document.getElementById('match-date').value,
        overs: parseInt(document.getElementById('overs').value),
        teams: {
            teamA: {
                name: document.getElementById('team1-name').value,
                players: team1Players,
                captain: document.getElementById('team1-captain').value,
                wk: document.getElementById('team1-wk').value
            },
            teamB: {
                name: document.getElementById('team2-name').value,
                players: team2Players,
                captain: document.getElementById('team2-captain').value,
                wk: document.getElementById('team2-wk').value
            }
        },
        status: 'created',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    const id = await DataService.createMatch(matchData);
    window.location.hash = `toss/${id}`;
};

// ---------------- Toss logic ----------------
async function setupTossView(matchId){
    document.getElementById('view-toss').classList.remove('hidden');
    const doc = await db.collection('matches').doc(matchId).get();
    const data = doc.data();
    if (data.status === 'live' || data.status === 'completed') { window.location.hash = `match/${matchId}`; return; }
    const container = document.getElementById('toss-winner-options');
    container.innerHTML = `<button class="toss-btn" onclick="selectTossWinner('teamA', this)">${data.teams.teamA.name}</button>
                           <button class="toss-btn" onclick="selectTossWinner('teamB', this)">${data.teams.teamB.name}</button>`;
    currentMatchDataLocal = data;
    currentMatchData = data; // keep for convenience
}

window.selectTossWinner = (teamKey, btn) => {
    tossWinner = teamKey; document.querySelectorAll('#toss-winner-options .toss-btn').forEach(b => b.classList.remove('selected')); btn.classList.add('selected'); checkTossReady();
};
window.selectTossDecision = (decision, btn) => {
    tossDecision = decision; document.querySelectorAll('#toss-decision-options .toss-btn').forEach(b => b.classList.remove('selected')); btn.classList.add('selected'); checkTossReady();
};
function checkTossReady(){ if (tossWinner && tossDecision) { document.getElementById('opener-selection').classList.remove('hidden'); populateOpenerDropdowns(); document.getElementById('confirm-toss-btn').disabled = false; } }
function populateOpenerDropdowns() {
    if (!currentMatchDataLocal) return;
    const battingTeamKey = (tossDecision === 'bat') ? tossWinner : (tossWinner === 'teamA' ? 'teamB' : 'teamA');
    const bowlingTeamKey = (battingTeamKey === 'teamA') ? 'teamB' : 'teamA';
    const battingPlayers = currentMatchDataLocal.teams[battingTeamKey].players;
    const bowlingPlayers = currentMatchDataLocal.teams[bowlingTeamKey].players;
    const sSelect = document.getElementById('select-striker');
    const nsSelect = document.getElementById('select-non-striker');
    const bSelect = document.getElementById('select-bowler');
    sSelect.innerHTML = ''; nsSelect.innerHTML = ''; bSelect.innerHTML = '';
    battingPlayers.forEach(p => { sSelect.add(new Option(p, p)); nsSelect.add(new Option(p, p)); });
    if (nsSelect.options.length > 1) nsSelect.selectedIndex = 1;
    bowlingPlayers.forEach(p => bSelect.add(new Option(p, p)));
}

window.finalizeToss = async () => {
    const striker = document.getElementById('select-striker').value;
    const nonStriker = document.getElementById('select-non-striker').value;
    const bowler = document.getElementById('select-bowler').value;
    const battingTeamKey = (tossDecision === 'bat') ? tossWinner : (tossWinner === 'teamA' ? 'teamB' : 'teamA');
    const bowlingTeamKey = (battingTeamKey === 'teamA') ? 'teamB' : 'teamA';

    // Build playerStats
    const playerStats = {};
    currentMatchData.teams.teamA.players.forEach(p => { playerStats[p] = { runs:0, balls:0, fours:0, sixes:0, out:false, outInfo:null }; });
    currentMatchData.teams.teamB.players.forEach(p => { if(!playerStats[p]) playerStats[p] = { runs:0, balls:0, fours:0, sixes:0, out:false, outInfo:null }; });

    // bowlers map
    const bowlers = {};
    currentMatchData.teams[bowlingTeamKey].players.forEach(p => { bowlers[p] = { runs:0, wickets:0, overs:0, maidens:0, ballsInCurrentOver:0 }; });

    // Initialize liveScore
    const liveScoreInit = {
        battingTeam: battingTeamKey,
        bowlingTeam: bowlingTeamKey,
        runs: 0, wickets: 0, overs: 0,
        striker: striker, nonStriker: nonStriker, bowler: bowler,
        recentBalls: [], playerStats: playerStats, bowlers: bowlers,
        history: [], lastSnapshot: null,
        innings: 1, matchOvers: parseInt(document.getElementById('overs').value || 0), target: null, matchCompleted: false
    };

    await DataService.updateMatch(currentMatchId, {
        toss: { winner: tossWinner, decision: tossDecision },
        status: 'live',
        liveScore: liveScoreInit
    });

    window.location.hash = `match/${currentMatchId}`;
};

// ---------------- Live scoring ----------------
function initMatchView(matchId){
    document.getElementById('view-match').classList.remove('hidden');
    if (unsubscribeMatch) unsubscribeMatch();
    unsubscribeMatch = DataService.subscribeToMatch(matchId, (match) => {
        currentMatchData = match;
        if (match.status === 'created') { window.location.hash = `toss/${matchId}`; return; }
        renderLiveScore(match);
        renderFullScorecards(match);
        const user = AuthService.getCurrentUser();
        if (user && user.uid === match.creatorId && match.status !== 'completed') {
            document.getElementById('scorer-controls').classList.remove('hidden');
        } else {
            document.getElementById('scorer-controls').classList.add('hidden');
        }
    });
}

function renderLiveScore(match){
    const ls = match.liveScore || {};
    const battingTeamName = match.teams[ls.battingTeam]?.name || '-';
    const bowlingTeamName = match.teams[ls.bowlingTeam]?.name || '-';

    document.getElementById('live-match-title').innerText = match.title;
    document.getElementById('live-match-venue').innerText = match.venue;
    document.getElementById('batting-team-display').innerText = battingTeamName;
    document.getElementById('bowling-team-display').innerText = bowlingTeamName;

    document.getElementById('score-display').innerText = `${ls.runs || 0}/${ls.wickets || 0}`;
    document.getElementById('overs-display').innerText = `(${ls.overs || 0})`;

    // Current Play (top section)
    document.getElementById('striker-name-large').innerText = ls.striker || '-';
    document.getElementById('striker-r').innerText = ls.playerStats?.[ls.striker]?.runs || 0;
    document.getElementById('striker-b').innerText = ls.playerStats?.[ls.striker]?.balls || 0;
    document.getElementById('striker-sr').innerText = (ls.playerStats?.[ls.striker] && ls.playerStats[ls.striker].balls > 0) ? ((ls.playerStats[ls.striker].runs / ls.playerStats[ls.striker].balls)*100).toFixed(1) : '0.0';

    document.getElementById('nonstriker-name-large').innerText = ls.nonStriker || '-';
    document.getElementById('nonstriker-r').innerText = ls.playerStats?.[ls.nonStriker]?.runs || 0;
    document.getElementById('nonstriker-b').innerText = ls.playerStats?.[ls.nonStriker]?.balls || 0;
    document.getElementById('nonstriker-sr').innerText = (ls.playerStats?.[ls.nonStriker] && ls.playerStats[ls.nonStriker].balls > 0) ? ((ls.playerStats[ls.nonStriker].runs / ls.playerStats[ls.nonStriker].balls)*100).toFixed(1) : '0.0';

    document.getElementById('current-bowler-name').innerText = ls.bowler || '-';
    const cb = ls.bowlers?.[ls.bowler] || {};
    document.getElementById('current-bowler-overs').innerText = cb.overs || 0;
    document.getElementById('current-bowler-balls').innerText = cb.ballsInCurrentOver || 0;
    document.getElementById('current-bowler-wkts').innerText = cb.wickets || 0;
    document.getElementById('current-bowler-runs').innerText = cb.runs || 0;

    // This over visuals: show recentBalls (current over) - most recent first
    const thisOverDiv = document.getElementById('this-over-balls');
    thisOverDiv.innerHTML = (ls.recentBalls || []).slice(-6).map(b => `<span class="ball-badge">${b}</span>`).join(' ');

    // Target & runs/balls remaining (if innings 2)
    const targetBanner = document.getElementById('target-banner');
    if (ls.target) {
        // compute balls remaining
        const oversLimit = (ls.matchOvers || match.overs || 0);
        const oversWhole = Math.floor(ls.overs || 0);
        const ballsInOver = Math.round(((ls.overs || 0) - oversWhole) * 10);
        const ballsBowled = oversWhole * 6 + ballsInOver;
        const ballsRemaining = Math.max(0, oversLimit * 6 - ballsBowled);

        const runsRequired = Math.max(0, (ls.target || 0) - (ls.runs || 0));
        document.getElementById('target-score').innerText = ls.target;
        document.getElementById('runs-required').innerText = runsRequired;
        document.getElementById('balls-remaining').innerText = ballsRemaining;
        targetBanner.classList.remove('hidden');
    } else {
        targetBanner.classList.add('hidden');
    }

    // CRR
    const oversDecimal = ls.overs || 0;
    const whole = Math.floor(oversDecimal);
    const balls = Math.round((oversDecimal - whole) * 10);
    const playedBalls = whole * 6 + balls;
    const crr = playedBalls > 0 ? ((ls.runs || 0) * 6 / playedBalls).toFixed(2) : '0.00';
    document.getElementById('crr').innerText = crr;

    // small bowler display
    document.getElementById('bowler-name').innerText = ls.bowler || 'Bowler';
    document.getElementById('b-overs').innerText = cb.overs || 0;
    document.getElementById('b-maidens').innerText = cb.maidens || 0;
    document.getElementById('b-runs').innerText = cb.runs || 0;
    document.getElementById('b-wickets').innerText = cb.wickets || 0;
}

// ---------------- Full scorecards (no change) ----------------
function renderFullScorecards(match) {
    const container = document.getElementById('full-scorecards');
    container.innerHTML = '';

    // Show previous innings summaries (if any)
    (match.innings || []).forEach((inn, idx) => {
        container.appendChild(createProfessionalInningsTable(inn, idx + 1));
    });

    // Show current live innings (even if completed)
    const ls = match.liveScore || {};
    const liveInningsObj = {
        innings: ls.innings || (match.innings?.length || 0) + 1,
        battingTeamKey: ls.battingTeam,
        battingTeamName: match.teams?.[ls.battingTeam]?.name || '-',
        runs: ls.runs || 0,
        wickets: ls.wickets || 0,
        overs: ls.overs || 0,
        battingPlayers: match.teams?.[ls.battingTeam]?.players || [],
        playerStats: ls.playerStats || {},
        bowlers: ls.bowlers || {}
    };
    container.appendChild(createProfessionalInningsTable(liveInningsObj, liveInningsObj.innings, true));
}

function createProfessionalInningsTable(inn, inningsNum, live = false) {
    const wrap = document.createElement('div');
    wrap.className = 'innings-card pro-innings';
    const heading = document.createElement('h4');
    heading.innerText = `${live ? 'Current ' : ''}Innings ${inningsNum} - ${inn.battingTeamName || '-'} (Score: ${inn.runs}/${inn.wickets} in ${inn.overs})`;
    wrap.appendChild(heading);

    // Batting table
    const batTable = document.createElement('table');
    batTable.className = 'proscore-table bat-table';
    const batThead = document.createElement('thead');
    batThead.innerHTML = `
        <tr>
            <th>Batsman</th>
            <th>Dismissal</th>
            <th>R</th>
            <th>B</th>
            <th>4s</th>
            <th>6s</th>
            <th>SR</th>
        </tr>`;
    batTable.appendChild(batThead);
    const batTbody = document.createElement('tbody');

    (inn.battingPlayers || []).forEach(player => {
        const stats = inn.playerStats?.[player] || {runs:0,balls:0,fours:0,sixes:0,out:false,outInfo:null};
        const tr = document.createElement('tr');
        // Dismissal status/caption
        let dism = stats.out
            ? getProfessionalDismissal(stats.outInfo, player)
            : stats.balls > 0
                ? 'not out'
                : 'did not bat';

        tr.innerHTML = `
            <td class="name">${player}</td>
            <td class="dismissal">${dism}</td>
            <td>${stats.runs || 0}</td>
            <td>${stats.balls || 0}</td>
            <td>${stats.fours || 0}</td>
            <td>${stats.sixes || 0}</td>
            <td>${stats.balls > 0 ? ((stats.runs / stats.balls)*100).toFixed(1) : '0.0'}</td>
        `;
        batTbody.appendChild(tr);
    });
    batTable.appendChild(batTbody);

    // Batting extras/total row
    const extras = getExtrasSummary(inn.playerStats);
    const extrasRow = document.createElement('tr');
    extrasRow.innerHTML =
        `<td colspan="2" class="extras-label">Extras</td>
         <td colspan="5" class="extras-val">${extras.text}</td>`;
    batTbody.appendChild(extrasRow);

    // Totals row
    const totalRow = document.createElement('tr');
    totalRow.className = 'total-row';
    totalRow.innerHTML =
        `<td colspan="2">TOTAL</td>
         <td colspan="5" class="total-val">${inn.runs || 0} / ${inn.wickets || 0} in ${inn.overs} overs</td>`;
    batTbody.appendChild(totalRow);

    wrap.appendChild(batTable);

    // Bowling table
    const bowlTable = document.createElement('table');
    bowlTable.className = 'proscore-table bowl-table';
    const bowlThead = document.createElement('thead');
    bowlThead.innerHTML = `
        <tr>
            <th>Bowler</th>
            <th>O</th>
            <th>M</th>
            <th>R</th>
            <th>W</th>
        </tr>
    `;
    bowlTable.appendChild(bowlThead);
    const bowlTbody = document.createElement('tbody');
    Object.entries(inn.bowlers || {}).forEach(([bowler, bstat]) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="name">${bowler}</td>
            <td>${bstat.overs || 0}</td>
            <td>${bstat.maidens || 0}</td>
            <td>${bstat.runs || 0}</td>
            <td>${bstat.wickets || 0}</td>
        `;
        bowlTbody.appendChild(tr);
    });
    bowlTable.appendChild(bowlTbody);
    wrap.appendChild(bowlTable);

    return wrap;
}

// Helper for professional dismissal info
function getProfessionalDismissal(outInfo, batsman) {
    if (!outInfo || !outInfo.mode) return 'OUT';
    switch (outInfo.mode) {
        case 'bowled':
            return 'bowled ' + (outInfo.fielder || '');
        case 'catch':
            return 'c ' + (outInfo.fielder || '') + ' b ' + (outInfo.bowler || '');
        case 'lbw':
            return 'lbw b ' + (outInfo.fielder || '');
        case 'runout':
            return 'run out ' + (outInfo.fielder || '');
        case 'stumping':
            return 'stumped ' + (outInfo.fielder || '');
        default:
            return outInfo.mode;
    }
}

// (Optional) Helper: summarise extras (simplified for this base logic)
function getExtrasSummary(playerStats) {
    return { text: '0 (no breakdown available)' };
}

// ---------------- Scoring Actions ----------------
window.recordScore = async (runs, type = 'legal') => {
    if (!currentMatchData || !currentMatchId) { showToast("No active match loaded.", 'error'); return; }

    // prevent scoring if match completed
    if (currentMatchData.status === 'completed' || (currentMatchData.liveScore && currentMatchData.liveScore.matchCompleted)) {
        return showToast("Match already completed. Scoring disabled.", 'info');
    }

    // Build event
    const event = { runs, type };

    // Keep snapshot for undo
    const lastSnapshot = currentMatchData.liveScore ? JSON.parse(JSON.stringify(currentMatchData.liveScore)) : null;

    // Process via engine
    const result = CricketEngine.processBall(currentMatchData, event);

    // Add metadata
    result.logEntry.meta = result.logEntry.meta || {};
    result.logEntry.meta.bowler = (currentMatchData.liveScore && currentMatchData.liveScore.bowler) || null;
    result.logEntry.meta.striker = (currentMatchData.liveScore && currentMatchData.liveScore.striker) || null;

    // Update liveScore and history
    const updateObj = {
        liveScore: result.liveScore,
        lastSnapshot: lastSnapshot,
        history: firebase.firestore.FieldValue.arrayUnion(result.logEntry)
    };

    await DataService.updateMatch(currentMatchId, updateObj);

    // If over completed and NOT ending innings -> prompt bowler change
    if (result.overCompleted && !result.inningsEnded) {
        setTimeout(() => openChangeBowlerModal(true), 200);
    }

    // Handle innings end / match complete
    if (result.inningsEnded) {
        // fetch freshest match doc
        const doc = await db.collection('matches').doc(currentMatchId).get();
        const fullMatch = { id: doc.id, ...doc.data() };
        const prevLS = fullMatch.liveScore || {};

        // Save summary of completed innings into innings array
        const inningsSummary = {
            innings: prevLS.innings || 1,
            battingTeamKey: prevLS.battingTeam,
            battingTeamName: fullMatch.teams[prevLS.battingTeam]?.name || '',
            runs: prevLS.runs || 0,
            wickets: prevLS.wickets || 0,
            overs: prevLS.overs || 0,
            battingPlayers: fullMatch.teams[prevLS.battingTeam]?.players || [],
            playerStats: prevLS.playerStats || {},
            bowlers: prevLS.bowlers || {}
        };

        await DataService.pushInningsSummary(currentMatchId, inningsSummary);

        // If it was innings 1 -> start innings 2 (but ask for openers/bowler first)
        if ((prevLS.innings || 1) === 1 && !result.matchCompleted) {
            const prevRuns = prevLS.runs || 0;
            const target = prevRuns + 1;

            // Swap teams
            const battingTeamKey = prevLS.bowlingTeam; // team that will bat now
            const bowlingTeamKey = prevLS.battingTeam; // will bowl now

            // Build starter payload and show modal to choose openers & bowler
            startInningsPendingPayload = {
                fullMatch,
                battingTeamKey,
                bowlingTeamKey,
                target,
                prevRuns
            };

            // open modal and populate selects
            openStartInningsModal(startInningsPendingPayload);
        } else {
            // innings 2 ended or match completed
            const finalLS = prevLS;
            // Determine winner
            let winner = null;
            if (finalLS.target) {
                if (finalLS.runs >= finalLS.target) {
                    // chasing team achieved target => batting team won
                    winner = fullMatch.teams[finalLS.battingTeam]?.name || null;
                } else {
                    winner = fullMatch.teams[finalLS.bowlingTeam]?.name || null;
                }
            } else {
                winner = null;
            }
            const completeLog = { type: 'matchComplete', winner: winner || 'N/A', time: (new Date()).toISOString() };
            await DataService.updateMatch(currentMatchId, {
                status: 'completed',
                'liveScore.matchCompleted': true,
                history: firebase.firestore.FieldValue.arrayUnion(completeLog)
            });
            showToast(`Match completed. Winner: ${winner || 'N/A'}`, 'success');
        }
    }
};

// ---------------- Wicket flow ----------------
window.openWicketModal = () => {
    if (!currentMatchData) { showToast("Match not loaded.", 'error'); return; }
    const ls = currentMatchData.liveScore;
    if (!ls) { showToast("Live score not available.", 'error'); return; }
    const battingTeamKey = ls.battingTeam;
    const battingTeam = currentMatchData.teams[battingTeamKey];
    const allPlayers = battingTeam.players || [];

    // Determine used players (those who already batted or currently at crease)
    const used = new Set();
    if (ls.striker) used.add(ls.striker);
    if (ls.nonStriker) used.add(ls.nonStriker);
    (currentMatchData.history || []).forEach(h => { if (h.meta && h.meta.replacement) used.add(h.meta.replacement); });

    const remaining = allPlayers.filter(p => !used.has(p));

    const nbSelect = document.getElementById('new-batter-select');
    nbSelect.innerHTML = '';
    if (remaining.length > 0) {
        remaining.forEach(p => nbSelect.add(new Option(p,p)));
        nbSelect.disabled = false;
        document.getElementById('wicket-info-note').innerText = '';
    } else {
        // No replacements left -> innings will end if this wicket falls
        nbSelect.disabled = true;
        nbSelect.add(new Option("No players left", ""));
        document.getElementById('wicket-info-note').innerText = 'No replacement available — this wicket will likely end the innings.';
    }

    const bowlingTeamKey = ls.bowlingTeam;
    const bowlingPlayers = currentMatchData.teams[bowlingTeamKey].players || [];
    const fielderSelect = document.getElementById('dismissal-fielder');
    fielderSelect.innerHTML = '';
    bowlingPlayers.forEach(p => fielderSelect.add(new Option(p,p)));

    document.getElementById('dismissal-mode').value = 'bowled';
    document.getElementById('fielder-selection').classList.add('hidden');

    document.getElementById('wicket-modal').classList.remove('hidden');
};
window.closeWicketModal = () => document.getElementById('wicket-modal').classList.add('hidden');

window.confirmWicket = async () => {
    const mode = document.getElementById('dismissal-mode').value;
    const fielder = document.getElementById('dismissal-fielder').value;
    const nbSelect = document.getElementById('new-batter-select');
    const newBatter = nbSelect.disabled ? null : nbSelect.value;

    const ls = currentMatchData.liveScore;
    const bowlingTeamKey = ls.bowlingTeam;
    const wicketkeeper = currentMatchData.teams[bowlingTeamKey].wk || null;

    let dismissal = { mode };
    if (mode === 'catch') dismissal.fielder = fielder || null;
    if (mode === 'stumping' || mode === 'runout') dismissal.fielder = wicketkeeper || null;
    if (mode === 'bowled' || mode === 'lbw') dismissal.fielder = ls.bowler || null;

    const lastSnapshot = currentMatchData.liveScore ? JSON.parse(JSON.stringify(currentMatchData.liveScore)) : null;

    // Process wicket event
    const result = CricketEngine.processBall(currentMatchData, { runs: 0, type: 'W', dismissal });

    result.logEntry.meta = result.logEntry.meta || {};
    result.logEntry.meta.dismissal = dismissal;
    // Do NOT support manual substitute names. Only allow selection from remaining (handled above).
    if (newBatter) {
        result.logEntry.meta.replacement = newBatter;
    }
    result.logEntry.meta.bowler = ls.bowler;
    result.logEntry.meta.strikerBefore = ls.striker;

    // If a newBatter present, set them as striker/non-striker depending on overCompleted
    if (newBatter) {
        if (!result.overCompleted) {
            result.liveScore.striker = newBatter;
            if (!result.liveScore.playerStats[result.liveScore.striker]) result.liveScore.playerStats[result.liveScore.striker] = { runs:0,balls:0,fours:0,sixes:0,out:false,outInfo:null };
        } else {
            result.liveScore.nonStriker = newBatter;
            if (!result.liveScore.playerStats[result.liveScore.nonStriker]) result.liveScore.playerStats[result.liveScore.nonStriker] = { runs:0,balls:0,fours:0,sixes:0,out:false,outInfo:null };
        }
    } else {
        // No replacement available -> leave striker as-is (now marked out). The innings-end logic will detect all-out.
    }

    await DataService.updateMatch(currentMatchId, {
        liveScore: result.liveScore,
        lastSnapshot: lastSnapshot,
        history: firebase.firestore.FieldValue.arrayUnion(result.logEntry)
    });

    closeWicketModal();

    if (result.overCompleted && !result.inningsEnded) setTimeout(() => openChangeBowlerModal(true), 200);
    if (result.inningsEnded) {
        // handled in recordScore chain after DB update; but provide immediate feedback here
        showToast('Innings ended.', 'info');
        setTimeout(() => { /* handled in recordScore */ }, 250);
    }
};

// ---------------- Bowler change ----------------
window.openChangeBowlerModal = (fromOverEnd = false) => {
    if (!currentMatchData) { showToast("Match not loaded.", 'error'); return; }
    const ls = currentMatchData.liveScore;
    if (!ls) { showToast("Live score not available.", 'error'); return; }
    const bowlingTeamKey = ls.bowlingTeam;
    const bowlingPlayers = currentMatchData.teams[bowlingTeamKey].players || [];

    const select = document.getElementById('new-bowler-select');
    select.innerHTML = '';
    bowlingPlayers.forEach(p => { if (p !== ls.bowler) select.add(new Option(p,p)); });
    if (select.options.length === 0) select.add(new Option(ls.bowler || 'No bowler', ls.bowler || ''));

    document.getElementById('bowler-modal').classList.remove('hidden');
    document.getElementById('bowler-modal').dataset.auto = fromOverEnd ? '1' : '0';
};
window.closeChangeBowlerModal = () => { document.getElementById('bowler-modal').classList.add('hidden'); document.getElementById('bowler-modal').dataset.auto = '0'; };

window.confirmChangeBowler = async () => {
    const selected = document.getElementById('new-bowler-select').value;
    if (!selected) { showToast("Please select a bowler.", 'error'); return; }
    const lastSnapshot = currentMatchData.liveScore ? JSON.parse(JSON.stringify(currentMatchData.liveScore)) : null;

    const ls = JSON.parse(JSON.stringify(currentMatchData.liveScore));
    ls.bowler = selected;
    ls.bowlers = ls.bowlers || {};
    if (!ls.bowlers[selected]) ls.bowlers[selected] = { runs:0,wickets:0,overs:0,maidens:0,ballsInCurrentOver:0 };

    const logEntry = { type: 'bowlerChange', newBowler: selected, time: (new Date()).toISOString() };

    await DataService.updateMatch(currentMatchId, {
        liveScore: ls,
        lastSnapshot: lastSnapshot,
        history: firebase.firestore.FieldValue.arrayUnion(logEntry)
    });

    closeChangeBowlerModal();
};

// ---------------- Undo ----------------
window.undoLastBall = async () => {
    if (!currentMatchData || !currentMatchData.liveScore) { showToast("No match loaded.", 'error'); return; }
    const history = currentMatchData.history || [];
    const lastSnapshot = currentMatchData.lastSnapshot || null;
    if (!lastSnapshot || history.length === 0) { showToast("Nothing to undo.", 'info'); return; }

    const lastLog = history[history.length - 1];
    try {
        await DataService.updateMatch(currentMatchId, {
            liveScore: lastSnapshot,
            history: firebase.firestore.FieldValue.arrayRemove(lastLog),
            lastSnapshot: firebase.firestore.FieldValue.delete()
        });
        showToast("Last action undone.", 'success');
    } catch (err) {
        console.error("Undo failed", err);
        showToast("Undo failed. See console for details.", 'error');
    }
};

// ---------------- Share ----------------
window.shareMatch = () => {
    if (!currentMatchId) { showToast("No match to share.", 'error'); return; }
    const url = window.location.origin + window.location.pathname + `#match/${currentMatchId}`;
    if (navigator.share) {
        navigator.share({ title: document.getElementById('live-match-title').innerText || 'Match', text: 'Live score link', url })
            .catch(err => { navigator.clipboard?.writeText(url).then(()=>showToast("Match link copied to clipboard.", 'success')); });
    } else if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(()=>{ showToast("Match link copied to clipboard.", 'success'); }).catch(()=>{ prompt("Copy this link:", url); });
    } else { prompt("Copy this link:", url); }
};

// ---------------- START INNINGS modal flow ----------------
function openStartInningsModal(payload) {
    // payload: { fullMatch, battingTeamKey, bowlingTeamKey, target, prevRuns }
    const modal = document.getElementById('start-innings-modal');
    if (!modal) return;

    const note = document.getElementById('start-innings-note');
    note.innerText = `Innings ended. Target for next team: ${payload.target}. Choose openers & opening bowler.`;

    const sSelect = document.getElementById('start-striker-select');
    const nsSelect = document.getElementById('start-nonstriker-select');
    const bSelect = document.getElementById('start-bowler-select');

    sSelect.innerHTML = ''; nsSelect.innerHTML = ''; bSelect.innerHTML = '';

    const battingPlayers = payload.fullMatch.teams[payload.battingTeamKey].players || [];
    const bowlingPlayers = payload.fullMatch.teams[payload.bowlingTeamKey].players || [];

    battingPlayers.forEach(p => { sSelect.add(new Option(p,p)); nsSelect.add(new Option(p,p)); });
    if (nsSelect.options.length > 1) nsSelect.selectedIndex = 1;
    bowlingPlayers.forEach(p => bSelect.add(new Option(p,p)));

    modal.classList.remove('hidden');
}

window.cancelStartInnings = () => {
    startInningsPendingPayload = null;
    document.getElementById('start-innings-modal').classList.add('hidden');
    showToast("Innings start cancelled.", 'info');
};

window.confirmStartInnings = async () => {
    if (!startInningsPendingPayload) { showToast("No innings pending.", 'error'); return; }
    const { fullMatch, battingTeamKey, bowlingTeamKey, target } = startInningsPendingPayload;
    const striker = document.getElementById('start-striker-select').value;
    const nonStriker = document.getElementById('start-nonstriker-select').value;
    const bowler = document.getElementById('start-bowler-select').value;

    // Build fresh playerStats & bowlers for new innings
    const playerStats = {};
    (fullMatch.teams[battingTeamKey].players || []).forEach(p => { playerStats[p] = { runs:0, balls:0, fours:0, sixes:0, out:false, outInfo:null }; });
    (fullMatch.teams[bowlingTeamKey].players || []).forEach(p => { if(!playerStats[p]) playerStats[p] = { runs:0, balls:0, fours:0, sixes:0, out:false, outInfo:null }; });

    const bowlers = {};
    (fullMatch.teams[bowlingTeamKey].players || []).forEach(p => { bowlers[p] = { runs:0, wickets:0, overs:0, maidens:0, ballsInCurrentOver:0 }; });

    const newLS = {
        battingTeam: battingTeamKey,
        bowlingTeam: bowlingTeamKey,
        runs: 0, wickets: 0, overs: 0,
        striker: striker, nonStriker: nonStriker, bowler: bowler,
        recentBalls: [], playerStats, bowlers,
        history: [], lastSnapshot: null, innings: 2,
        target: target, matchOvers: fullMatch.overs || 0, matchCompleted: false
    };

    const inningChangeLog = { type: 'inningsStart', time: (new Date()).toISOString(), note: `Innings 2 started. Target ${target}` };

    await DataService.updateMatch(currentMatchId, {
        liveScore: newLS,
        status: 'live',
        history: firebase.firestore.FieldValue.arrayUnion(inningChangeLog)
    });

    startInningsPendingPayload = null;
    document.getElementById('start-innings-modal').classList.add('hidden');
    showToast(`Innings 2 started. Target: ${target}`, 'success');
};
