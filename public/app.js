// public/app.js
// Fully updated / completed application logic (ready to paste)

/// Global State
let currentMatchId = null;
let currentMatchData = null;
let unsubscribeMatch = null;

/// Local temporary holders
let team1Players = [], team2Players = [];
let tossWinner = null, tossDecision = null, currentMatchDataLocal = null;
let startInningsPendingPayload = null; // holds data when waiting for opener selection

/// Extra modal state
let extraModalPendingType = null;

/// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    const dateEl = document.getElementById('match-date');
    if (dateEl) dateEl.valueAsDate = new Date();

    AuthService.onStateChanged(user => {
        if (!user) AuthService.signInAnonymously();
        handleRoute();
    });

    // wire up dismissal-mode change for wicket modal (if element exists)
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
        initMatchView(currentMatchId, false);
    } else if (hash.startsWith('watch/')) {
        // viewer-only route (shared link)
        currentMatchId = hash.split('/')[1];
        initMatchView(currentMatchId, true);
    }
}

/// ---------------- small helpers ----------------
function currentUserIsCreator() {
    const user = AuthService.getCurrentUser();
    return user && currentMatchData && (user.uid === currentMatchData.creatorId);
}

/// ---------------- UI helpers (to replace alert()) ----------------
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
        setTimeout(() => {
            if (node.parentElement) container.removeChild(node);
        }, 300);
    }, timeout);
}

/// ---------------- Create match logic ----------------
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

/// ---------------- Toss logic ----------------
async function setupTossView(matchId){
    document.getElementById('view-toss').classList.remove('hidden');
    const doc = await db.collection('matches').doc(matchId).get();
    const data = doc.data();
    if (data.status === 'live' || data.status === 'completed') { window.location.hash = `match/${matchId}`; return; }
    const container = document.getElementById('toss-winner-options');
    container.innerHTML = `<button class="toss-btn" onclick="selectTossWinner('teamA', this)">${data.teams.teamA.name}</button>
                           <button class="toss-btn" onclick="selectTossWinner('teamB', this)">${data.teams.teamB.name}</button>`;
    currentMatchDataLocal = data;
    currentMatchData = data; // convenience
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

/// ---------------- Live scoring ----------------
function initMatchView(matchId, viewOnly = false){
    document.getElementById('view-match').classList.remove('hidden');
    if (unsubscribeMatch) unsubscribeMatch();
    unsubscribeMatch = DataService.subscribeToMatch(matchId, (match) => {
        currentMatchData = match;
        if (match.status === 'created' && !viewOnly) { window.location.hash = `toss/${matchId}`; return; }
        renderLiveScore(match);
        renderFullScorecards(match);
        const user = AuthService.getCurrentUser();
        if (!viewOnly && user && user.uid === match.creatorId && match.status !== 'completed') {
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

    // This over visuals: show recentBalls (current over). recentBalls items are objects {type,runs,label}
    const thisOverDiv = document.getElementById('this-over-balls');
    const ballsArr = ls.recentBalls || [];
    thisOverDiv.innerHTML = ballsArr.slice(-6).map(b => {
        if (!b) return '';
        // backward-compatible: if b is string, render fallback
        if (typeof b === 'string') return `<span class="ball-badge">${b}</span>`;
        const classes = ['ball-badge'];
        if (b.type === 'legal' && b.runs === 4) classes.push('boundary-4');
        if (b.type === 'legal' && b.runs === 6) classes.push('boundary-6');
        if (['WD','NB','B','LB'].includes(b.type)) classes.push('extra-badge');
        if (b.type === 'W') classes.push('wicket-badge');
        const cls = classes.join(' ');
        return `<span class="${cls}">${b.label}</span>`;
    }).join(' ');

    // Target & runs/balls remaining (if innings 2)
    const targetBanner = document.getElementById('target-banner');
    const targetLine1 = document.getElementById('target-banner-line1');
    const targetLine2 = document.getElementById('target-banner-line2');

    // If match completed -> show winner + margin in the banner
    if (match.status === 'completed' || ls.matchCompleted) {
        let bannerText1 = '';
        let bannerText2 = '';

        const battingPlayersList = (match.teams && match.teams[ls.battingTeam] && match.teams[ls.battingTeam].players) || [];
        const playersCount = battingPlayersList.length || 11;

        if (ls.target) {
            if (ls.runs >= ls.target) {
                const winnerName = match.teams[ls.battingTeam]?.name || 'Batting Team';
                const wicketsRemaining = Math.max(0, playersCount - (ls.wickets || 0));
                bannerText1 = `${winnerName} won`;
                bannerText2 = `by ${wicketsRemaining} wicket${wicketsRemaining !== 1 ? 's' : ''}`;
            } else {
                const winnerName = match.teams[ls.bowlingTeam]?.name || 'Bowling Team';
                const runsMargin = Math.max(0, (ls.target || 0) - (ls.runs || 0) - 1);
                bannerText1 = `${winnerName} won`;
                bannerText2 = `by ${runsMargin} run${runsMargin !== 1 ? 's' : ''}`;
            }
        } else {
            bannerText1 = `Match completed`;
            bannerText2 = '';
        }

        targetLine1.innerText = bannerText1;
        targetLine2.innerText = bannerText2;
        targetBanner.classList.remove('hidden');

    } else if (ls.target) {
        // live target display (updates as match processes)
        const oversLimit = (ls.matchOvers || match.overs || 0);
        const oversWhole = Math.floor(ls.overs || 0);
        const ballsInOver = Math.round(((ls.overs || 0) - oversWhole) * 10);
        const ballsBowled = oversWhole * 6 + ballsInOver;
        const ballsRemaining = Math.max(0, oversLimit * 6 - ballsBowled);

        const runsRequired = Math.max(0, (ls.target || 0) - (ls.runs || 0));
        document.getElementById('target-score').innerText = ls.target;
        document.getElementById('runs-required').innerText = runsRequired;
        document.getElementById('balls-remaining').innerText = ballsRemaining;
        targetLine1.innerText = `Target: ${ls.target}`;
        targetLine2.innerText = `Need: ${runsRequired} runs from ${ballsRemaining} balls`;
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

/// ---------------- Full scorecards ----------------
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

function getExtrasSummary(playerStats) {
    // Simplified: return 0 extras, can be enhanced to count WD/NB/B/LB across history.
    return { text: '0 (no breakdown available)' };
}

/// ---------------- Scoring Actions ----------------
/// Unified processor that updates DB and returns engine result (or null on failure)
async function processEvent(event) {
    if (!currentMatchData || !currentMatchId) { showToast("No active match loaded.", 'error'); return null; }

    // Block scoring when match is in innings break
    if (currentMatchData.status === 'innings_break') {
        showToast("Innings is between break. Start next innings to continue scoring.", 'info');
        return null;
    }

    // Permissions: only the original creator may score (viewer-only links are read-only)
    const user = AuthService.getCurrentUser();
    if (!user || user.uid !== currentMatchData.creatorId) {
        showToast("You don't have permission to score this match.", 'error');
        return null;
    }

    // prevent scoring if match completed
    if (currentMatchData.status === 'completed' || (currentMatchData.liveScore && currentMatchData.liveScore.matchCompleted)) {
        showToast("Match already completed. Scoring disabled.", 'info');
        return null;
    }

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

    // ---------- INNINGS END HANDLING (restores missing flow) ----------
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

        // If it was innings 1 -> prepare to start innings 2
        if ((prevLS.innings || 1) === 1 && !result.matchCompleted) {
            const prevRuns = prevLS.runs || 0;
            const target = prevRuns + 1;

            // Swap teams for next innings
            const battingTeamKey = prevLS.bowlingTeam; // batting team for next innings
            const bowlingTeamKey = prevLS.battingTeam; // bowling team for next innings

            // Build starter payload and show modal to choose openers & bowler
            startInningsPendingPayload = {
                fullMatch,
                battingTeamKey,
                bowlingTeamKey,
                target,
                prevRuns
            };

            // set match into 'innings_break' to block scoring until new innings started
            await DataService.updateMatch(currentMatchId, {
                status: 'innings_break',
                history: firebase.firestore.FieldValue.arrayUnion({ type: 'inningsEnd', previousRuns: prevRuns, time: (new Date()).toISOString(), note: `Innings ${inningsSummary.innings} ended. Target ${target}` })
            });

            // open modal client-side (use freshest data)
            openStartInningsModal(startInningsPendingPayload);
            showToast(`Innings ${inningsSummary.innings} ended. Target for next team: ${target}. Choose openers.`, 'info');
        } else {
            // innings 2 ended or match completed -> finalize match
            const finalLS = prevLS;
            // Determine winner
            let winner = null;
            let completeNote = '';
            if (finalLS.target) {
                const battingPlayersList = (fullMatch.teams && fullMatch.teams[finalLS.battingTeam] && fullMatch.teams[finalLS.battingTeam].players) || [];
                const playersCount = battingPlayersList.length || 11;
                if (finalLS.runs >= finalLS.target) {
                    winner = fullMatch.teams[finalLS.battingTeam]?.name || null;
                    const wicketsRemaining = Math.max(0, playersCount - (finalLS.wickets || 0));
                    completeNote = `${winner} won by ${wicketsRemaining} wicket${wicketsRemaining !== 1 ? 's' : ''}`;
                } else {
                    winner = fullMatch.teams[finalLS.bowlingTeam]?.name || null;
                    const runsMargin = Math.max(0, (finalLS.target || 0) - (finalLS.runs || 0) - 1);
                    completeNote = `${winner} won by ${runsMargin} run${runsMargin !== 1 ? 's' : ''}`;
                }
            } else {
                completeNote = 'Match completed.';
            }
            const completeLog = { type: 'matchComplete', winner: winner || 'N/A', note: completeNote, time: (new Date()).toISOString() };
            await DataService.updateMatch(currentMatchId, {
                status: 'completed',
                'liveScore.matchCompleted': true,
                history: firebase.firestore.FieldValue.arrayUnion(completeLog)
            });
            showToast(completeNote, 'success');
        }
    } // end inningsEnded handling

    // Return engine result
    return result;
}

/// Public entrypoint for scoring buttons. For extras, open extra modal first.
window.recordScore = async (runs, type = 'legal') => {
    const extraTypes = ['WD','NB','B','LB'];
    if (extraTypes.includes(type)) {
        openExtraModal(type);
        return;
    }

    // normal legal (or wicket) flow
    const result = await processEvent({ runs, type });
    if (!result) return;

    // If over completed and NOT ending innings and NOT a wicket on that ball -> swap striker/non-striker in DB
    if (result.overCompleted && !result.inningsEnded && !result.wicketOccurred) {
        // fetch freshest doc and swap
        const doc = await db.collection('matches').doc(currentMatchId).get();
        const fresh = { id: doc.id, ...doc.data() };
        const freshLS = fresh.liveScore || {};
        const tmp = freshLS.striker;
        freshLS.striker = freshLS.nonStriker;
        freshLS.nonStriker = tmp;
        await DataService.updateMatch(currentMatchId, { liveScore: freshLS });
        // then prompt bowler change
        setTimeout(() => openChangeBowlerModal(true), 200);
    } else {
        if (result.overCompleted && !result.inningsEnded) {
            // wicket-case handled elsewhere; still prompt bowler change
            setTimeout(() => openChangeBowlerModal(true), 200);
        }
    }
};

/// ---------------- Extra modal flow ----------------
function openExtraModal(type) {
    extraModalPendingType = type;
    const title = document.getElementById('extra-modal-title');
    const note = document.getElementById('extra-modal-note');
    const input = document.getElementById('extra-run-input');

    title.innerText = `Extra: ${type}`;
    note.innerText = `Enter runs (these will be credited to striker) for ${type}. For NB/Wide, 1 extra will be added automatically in addition to runs entered.`;
    input.value = '0';
    document.getElementById('extra-modal').classList.remove('hidden');
}

function cancelExtraModal() {
    extraModalPendingType = null;
    document.getElementById('extra-modal').classList.add('hidden');
    showToast('Extra cancelled', 'info');
}

async function confirmExtraModal() {
    const input = document.getElementById('extra-run-input');
    const val = parseInt(input.value || '0', 10);
    const type = extraModalPendingType || 'WD';
    extraModalPendingType = null;
    document.getElementById('extra-modal').classList.add('hidden');

    // call processor
    const result = await processEvent({ runs: val, type: type });
    if (!result) return;

    // If overCompleted and NOT wicket -> swap striker/non-striker
    if (result.overCompleted && !result.inningsEnded && !result.wicketOccurred) {
        const doc = await db.collection('matches').doc(currentMatchId).get();
        const fresh = { id: doc.id, ...doc.data() };
        const freshLS = fresh.liveScore || {};
        const tmp = freshLS.striker;
        freshLS.striker = freshLS.nonStriker;
        freshLS.nonStriker = tmp;
        await DataService.updateMatch(currentMatchId, { liveScore: freshLS });
        setTimeout(() => openChangeBowlerModal(true), 200);
    } else if (result.overCompleted && result.wicketOccurred) {
        setTimeout(() => openChangeBowlerModal(true), 200);
    }
}

/// ---------------- Wicket flow ----------------
window.openWicketModal = () => {
    if (!currentMatchData) { showToast("Match not loaded.", 'error'); return; }
    const ls = currentMatchData.liveScore;
    if (!ls) { showToast("Live score not available.", 'error'); return; }
    const battingTeamKey = ls.battingTeam;
    const battingTeam = currentMatchData.teams[battingTeamKey];
    const allPlayers = battingTeam.players || [];

    // Determine used players (those who are out OR currently at crease)
    const used = new Set();
    Object.entries(ls.playerStats || {}).forEach(([p, st]) => {
        if (st && st.out) used.add(p);
    });
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
        nbSelect.disabled = true;
        nbSelect.add(new Option("No players left", ""));
        document.getElementById('wicket-info-note').innerText = 'No replacement available — this wicket may end the innings.';
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
    // Permission guard
    const user = AuthService.getCurrentUser();
    if (!user || !currentMatchData || user.uid !== currentMatchData.creatorId) {
        showToast("You don't have permission to score this match.", 'error');
        return;
    }

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

    // Call central processor and get result
    const result = await processEvent({ runs: 0, type: 'W', dismissal });
    if (!result) return;

    // If replacement provided, set it in DB appropriately.
    if (newBatter) {
        // fetch freshest doc
        const doc = await db.collection('matches').doc(currentMatchId).get();
        const fresh = { id: doc.id, ...doc.data() };
        const freshLS = fresh.liveScore || {};

        // If innings ended, don't assign replacement
        if (result.inningsEnded) {
            // nothing to set
        } else {
            // If wicket was on last ball of over -> new batsman should be non-striker at start of next over
            if (result.overCompleted) {
                const prevNonStriker = freshLS.nonStriker;
                freshLS.striker = prevNonStriker; // who will face first ball next over
                freshLS.nonStriker = newBatter;
                if (!freshLS.playerStats[newBatter]) freshLS.playerStats[newBatter] = { runs:0,balls:0,fours:0,sixes:0,out:false,outInfo:null };
            } else {
                // normal case: replace the out striker
                if (freshLS.striker && freshLS.playerStats && freshLS.playerStats[freshLS.striker] && freshLS.playerStats[freshLS.striker].out) {
                    freshLS.striker = newBatter;
                    if (!freshLS.playerStats[newBatter]) freshLS.playerStats[newBatter] = { runs:0,balls:0,fours:0,sixes:0,out:false,outInfo:null };
                } else {
                    freshLS.nonStriker = newBatter;
                    if (!freshLS.playerStats[newBatter]) freshLS.playerStats[newBatter] = { runs:0,balls:0,fours:0,sixes:0,out:false,outInfo:null };
                }
            }
            await DataService.updateMatch(currentMatchId, { liveScore: freshLS });
        }
    }

    closeWicketModal();

    // Prompt bowler change on over end (if not innings end)
    if (result.overCompleted && !result.inningsEnded) setTimeout(() => openChangeBowlerModal(true), 200);
    if (result.inningsEnded) showToast('Innings ended.', 'info');
};
/// ---------------- Bowler change ----------------
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
    // Permission guard
    const user = AuthService.getCurrentUser();
    if (!user || !currentMatchData || user.uid !== currentMatchData.creatorId) {
        showToast("You don't have permission to score this match.", 'error');
        return;
    }

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

/// ---------------- Undo ----------------
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

/// ---------------- Share (viewer-only) ----------------
window.shareMatch = () => {
    if (!currentMatchId) { showToast("No match to share.", 'error'); return; }
    // viewer-only link (watch) — this link is intended only for viewing; scoring controls will be hidden
    const url = window.location.origin + window.location.pathname + `#watch/${currentMatchId}`;
    if (navigator.share) {
        navigator.share({ title: document.getElementById('live-match-title').innerText || 'Match', text: 'Live score (viewer link)', url })
            .catch(err => { navigator.clipboard?.writeText(url).then(()=>showToast("Viewer link copied to clipboard.", 'success')); });
    } else if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(()=>{ showToast("Viewer link copied to clipboard.", 'success'); }).catch(()=>{ prompt("Copy this viewer link:", url); });
    } else { prompt("Copy this viewer link:", url); }
};

/// ---------------- START INNINGS modal flow ----------------
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
