// public/app.js — Full updated file

// Global State
let currentMatchId = null;
let currentMatchData = null;
let unsubscribeMatch = null;

// --- 1. Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    const dateEl = document.getElementById('match-date');
    if (dateEl) dateEl.valueAsDate = new Date();

    // Tab defaults
    showTab('live');

    // Safe attach dismissal-mode listener if element exists
    const dismissalEl = document.getElementById('dismissal-mode');
    if (dismissalEl) {
        dismissalEl.addEventListener('change', (e) => {
            const val = e.target.value;
            if (val === 'catch') document.getElementById('fielder-selection').classList.remove('hidden');
            else document.getElementById('fielder-selection').classList.add('hidden');
        });
    }

    AuthService.onStateChanged(user => {
        if (!user) AuthService.signInAnonymously();
        handleRoute();
    });
});

window.addEventListener('hashchange', handleRoute);

// --- Routing & Tabs ---
function handleRoute() {
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

// Simple tab switcher
window.showTab = (tab) => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));

    if (tab === 'live') {
        const tb = document.getElementById('tab-live');
        if (tb) tb.classList.add('active');
        const cont = document.getElementById('tab-live-content');
        if (cont) cont.classList.remove('hidden');
    } else {
        const tb = document.getElementById('tab-scoreboard');
        if (tb) tb.classList.add('active');
        const cont = document.getElementById('tab-scoreboard-content');
        if (cont) cont.classList.remove('hidden');
    }
};

// --- 2. Create Match Logic ---
document.getElementById('btn-create-match').onclick = () => window.location.hash = 'create';

let team1Players = [];
let team2Players = [];

window.parsePlayers = (team) => {
    const raw = document.getElementById(`${team}-players-raw`).value;
    const names = raw.split(/\n|,/).map(n => n.trim()).filter(n => n);

    if (names.length < 2) {
        alert("Please enter at least 2 players");
        return;
    }

    if (team === 'team1') team1Players = names;
    else team2Players = names;

    const capSelect = document.getElementById(`${team}-captain`);
    const wkSelect = document.getElementById(`${team}-wk`);
    capSelect.innerHTML = ''; wkSelect.innerHTML = '';

    names.forEach(name => {
        capSelect.add(new Option(name, name));
        wkSelect.add(new Option(name, name));
    });

    document.getElementById(`${team}-roles`).classList.remove('hidden');
    alert(`Parsed ${names.length} players for Team ${team === 'team1' ? 'A' : 'B'}`);
};

document.getElementById('create-match-form').onsubmit = async (e) => {
    e.preventDefault();
    if(team1Players.length === 0 || team2Players.length === 0) {
        alert("Please confirm players for both teams first.");
        return;
    }

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

// --- 3. Toss Logic ---
let tossWinner = null;
let tossDecision = null;

async function setupTossView(matchId) {
    document.getElementById('view-toss').classList.remove('hidden');

    const doc = await db.collection('matches').doc(matchId).get();
    const data = doc.data();

    if (data.status === 'live' || data.status === 'completed') {
        window.location.hash = `match/${matchId}`;
        return;
    }

    const container = document.getElementById('toss-winner-options');
    container.innerHTML = `
        <button class="toss-btn" onclick="selectTossWinner('teamA', this)">${data.teams.teamA.name}</button>
        <button class="toss-btn" onclick="selectTossWinner('teamB', this)">${data.teams.teamB.name}</button>
    `;

    currentMatchData = data;
}

window.selectTossWinner = (teamKey, btn) => {
    tossWinner = teamKey;
    document.querySelectorAll('#toss-winner-options .toss-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    checkTossReady();
};

window.selectTossDecision = (decision, btn) => {
    tossDecision = decision;
    document.querySelectorAll('#toss-decision-options .toss-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    checkTossReady();
};

function checkTossReady() {
    if (tossWinner && tossDecision) {
        document.getElementById('opener-selection').classList.remove('hidden');
        populateOpenerDropdowns();
        document.getElementById('confirm-toss-btn').disabled = false;
    }
}

function populateOpenerDropdowns() {
    const battingTeamKey = (tossDecision === 'bat') ? tossWinner : (tossWinner === 'teamA' ? 'teamB' : 'teamA');
    const bowlingTeamKey = (battingTeamKey === 'teamA') ? 'teamB' : 'teamA';

    const battingPlayers = currentMatchData.teams[battingTeamKey].players;
    const bowlingPlayers = currentMatchData.teams[bowlingTeamKey].players;

    const sSelect = document.getElementById('select-striker');
    const nsSelect = document.getElementById('select-non-striker');
    const bSelect = document.getElementById('select-bowler');

    sSelect.innerHTML = ''; nsSelect.innerHTML = ''; bSelect.innerHTML = '';

    battingPlayers.forEach(p => {
        sSelect.add(new Option(p, p));
        nsSelect.add(new Option(p, p));
    });
    if(nsSelect.options.length > 1) nsSelect.selectedIndex = 1;

    bowlingPlayers.forEach(p => {
        bSelect.add(new Option(p, p));
    });
}

window.finalizeToss = async () => {
    const striker = document.getElementById('select-striker').value;
    const nonStriker = document.getElementById('select-non-striker').value;
    const bowler = document.getElementById('select-bowler').value;

    const battingTeamKey = (tossDecision === 'bat') ? tossWinner : (tossWinner === 'teamA' ? 'teamB' : 'teamA');
    const bowlingTeamKey = (battingTeamKey === 'teamA') ? 'teamB' : 'teamA';

    // Initialize bowler map
    const bowlingPlayers = currentMatchData.teams[bowlingTeamKey].players || [];
    const bowlerMap = {};
    bowlingPlayers.forEach(p => {
        bowlerMap[p] = { runs: 0, wickets: 0, balls: 0, overs: 0, maidens: 0 };
    });

    const liveScoreInit = {
        battingTeam: battingTeamKey,
        bowlingTeam: bowlingTeamKey,
        runs: 0,
        wickets: 0,
        overs: 0,
        ballsTotal: 0,
        innings: 1,
        striker: striker,
        nonStriker: nonStriker,
        bowler: bowler,
        recentBalls: [],
        strikerStats: { runs: 0, balls: 0, fours: 0, sixes: 0 },
        nonStrikerStats: { runs: 0, balls: 0, fours: 0, sixes: 0 },
        bowlerStatsMap: bowlerMap,
        outPlayers: [],
        history: []
    };

    await DataService.updateMatch(currentMatchId, {
        toss: { winner: tossWinner, decision: tossDecision },
        status: 'live',
        liveScore: liveScoreInit
    });

    window.location.hash = `match/${currentMatchId}`;
};

// ---------- Helpers to build aggregated stats for Scoreboard ----------
function buildPlayerStats(match, teamKey) {
    const players = match.teams[teamKey].players || [];
    const stats = {};
    players.forEach(p => {
        stats[p] = { runs: 0, balls: 0, fours: 0, sixes: 0, dismissal: null, onField: false, faced: false };
    });

    const ls = match.liveScore || {};

    if (ls.striker) { stats[ls.striker] = stats[ls.striker] || {}; stats[ls.striker].onField = true; stats[ls.striker].faced = true; }
    if (ls.nonStriker) { stats[ls.nonStriker] = stats[ls.nonStriker] || {}; stats[ls.nonStriker].onField = true; stats[ls.nonStriker].faced = true; }

    (match.history || []).forEach(entry => {
        const type = entry.type;
        const runs = entry.runs || 0;
        const striker = entry.meta && entry.meta.striker ? entry.meta.striker : null;

        if (striker && stats[striker]) {
            if (type === 'legal' || type === 'NB') {
                stats[striker].runs += runs;
                stats[striker].balls += 1;
                if (runs === 4) stats[striker].fours += 1;
                if (runs === 6) stats[striker].sixes += 1;
                stats[striker].faced = true;
            } else if (type === 'W' || type === 'B' || type === 'LB') {
                stats[striker].balls += 1;
                stats[striker].faced = true;
            }
        }

        if (entry.meta && entry.meta.dismissal && entry.meta.strikerBefore) {
            const outPlayer = entry.meta.strikerBefore;
            if (stats[outPlayer]) {
                stats[outPlayer].dismissal = entry.meta.dismissal;
            } else {
                stats[outPlayer] = { runs: 0, balls: 0, fours: 0, sixes: 0, dismissal: entry.meta.dismissal, onField: false, faced: true };
            }
        }

        if (entry.meta && entry.meta.replacement) {
            const repl = entry.meta.replacement;
            if (!stats[repl]) stats[repl] = { runs: 0, balls: 0, fours: 0, sixes: 0, dismissal: null, onField: false, faced: false };
        }
    });

    if (ls.striker && ls.strikerStats) {
        stats[ls.striker] = stats[ls.striker] || { runs: 0, balls: 0, fours: 0, sixes: 0, dismissal: null, onField: true, faced: true };
        stats[ls.striker].runs = ls.strikerStats.runs || stats[ls.striker].runs;
        stats[ls.striker].balls = ls.strikerStats.balls || stats[ls.striker].balls;
        stats[ls.striker].fours = ls.strikerStats.fours || stats[ls.striker].fours;
        stats[ls.striker].sixes = ls.strikerStats.sixes || stats[ls.striker].sixes;
        stats[ls.striker].onField = true;
    }
    if (ls.nonStriker && ls.nonStrikerStats) {
        stats[ls.nonStriker] = stats[ls.nonStriker] || { runs: 0, balls: 0, fours: 0, sixes: 0, dismissal: null, onField: true, faced: true };
        stats[ls.nonStriker].runs = ls.nonStrikerStats.runs || stats[ls.nonStriker].runs;
        stats[ls.nonStriker].balls = ls.nonStrikerStats.balls || stats[ls.nonStriker].balls;
        stats[ls.nonStriker].fours = ls.nonStrikerStats.fours || stats[ls.nonStriker].fours;
        stats[ls.nonStriker].sixes = ls.nonStrikerStats.sixes || stats[ls.nonStriker].sixes;
        stats[ls.nonStriker].onField = true;
    }

    return stats;
}

function computeExtras(match) {
    const extras = { WD: 0, NB: 0, B: 0, LB: 0 };
    (match.history || []).forEach(h => {
        if (h.type === 'WD') extras.WD += (h.totalRuns || 1);
        if (h.type === 'NB') extras.NB += (h.totalRuns || 1);
        if (h.type === 'B')  extras.B += (h.totalRuns || 0);
        if (h.type === 'LB') extras.LB += (h.totalRuns || 0);
    });
    const total = extras.WD + extras.NB + extras.B + extras.LB;
    return { extras, total };
}

// ---------- Live & Scoreboard renderers ----------
function renderLiveTab(match) {
    const ls = match.liveScore || {};
    const battingTeamName = match.teams[ls.battingTeam]?.name || '';
    document.getElementById('live-match-title').innerText = match.title || '';
    document.getElementById('live-match-venue').innerText = match.venue || '';

    document.getElementById('live-batting-team').innerText = battingTeamName;
    document.getElementById('live-score').innerText = `${(ls.runs || 0)}/${(ls.wickets || 0)} (${ls.overs || 0})`;

    document.getElementById('live-striker-name').innerText = ls.striker || '-';
    document.getElementById('live-striker-stats').innerText = `${ls.strikerStats?.runs || 0} (${ls.strikerStats?.balls || 0})`;

    document.getElementById('live-ns-name').innerText = ls.nonStriker || '-';
    document.getElementById('live-ns-stats').innerText = `${ls.nonStrikerStats?.runs || 0} (${ls.nonStrikerStats?.balls || 0})`;

    const bowler = ls.bowler || '-';
    const bowlerStats = (ls.bowlerStatsMap && ls.bowlerStatsMap[bowler]) || { overs: 0, wickets: 0, runs: 0 };
    document.getElementById('live-bowler-name').innerText = bowler;
    document.getElementById('live-bowler-stats').innerText = `${bowlerStats.overs || 0} ov • ${bowlerStats.wickets || 0} wkts • ${bowlerStats.runs || 0} r`;

    const recentDiv = document.getElementById('live-this-over');
    recentDiv.innerHTML = (ls.recentBalls || []).slice(-6).map(b => `<span class="ball-badge">${b}</span>`).join(' ');
}

function renderScoreboardTab(match) {
    const container = document.getElementById('scoreboard-innings-container');
    container.innerHTML = '';

    const inningsList = [];
    if (match.innings1) inningsList.push({ title: 'Innings 1 (Completed)', data: match.innings1 });
    if (match.liveScore) inningsList.push({ title: `Innings ${match.liveScore.innings || 1}`, data: match.liveScore });

    inningsList.forEach((inn, idx) => {
        const innDiv = document.createElement('div');

        const header = document.createElement('div');
        header.className = 'innings-bar';
        const main = document.createElement('div');
        main.className = 'innings-main';
        const tname = document.createElement('div'); tname.className = 'innings-team';
        tname.innerText = match.teams[inn.data.battingTeam].name;
        const score = document.createElement('div'); score.className = 'innings-score';
        score.innerText = `${inn.data.runs || 0}/${inn.data.wickets || 0} (${inn.data.overs || 0})`;
        main.appendChild(tname);
        main.appendChild(score);
        header.appendChild(main);

        const chev = document.createElement('div'); chev.innerHTML = '▾'; chev.style.opacity = '0.7';
        header.appendChild(chev);

        const body = document.createElement('div');
        body.className = 'innings-body';
        body.style.display = 'none';

        header.onclick = () => {
            body.style.display = (body.style.display === 'none') ? 'block' : 'none';
        };

        const stats = buildPlayerStats(match, inn.data.battingTeam);

        const playersColumn = document.createElement('div');
        playersColumn.className = 'players-column';
        const playersTitle = document.createElement('div'); playersTitle.style.marginBottom = '8px'; playersTitle.innerText = 'Batting — players & stats';
        playersColumn.appendChild(playersTitle);

        const players = match.teams[inn.data.battingTeam].players || [];
        players.forEach(p => {
            const row = document.createElement('div');
            row.className = 'player-stat-row';
            const left = document.createElement('div'); left.className = 'left'; left.innerText = p;
            const right = document.createElement('div'); right.className = 'right';
            const st = stats[p] || { runs: 0, balls: 0, fours: 0, sixes: 0, dismissal: null, onField: false };
            right.innerText = `${st.runs || 0} (${st.balls || 0}) 4s:${st.fours || 0} 6s:${st.sixes || 0}`;
            row.appendChild(left);
            row.appendChild(right);
            if (st.dismissal) {
                const d = document.createElement('div'); d.className = 'dismissal'; d.innerText = `Dismissal: ${st.dismissal.mode || st.dismissal}`;
                row.appendChild(d);
            }
            playersColumn.appendChild(row);
        });

        const extrasSummary = computeExtras(match);
        const extrasDiv = document.createElement('div');
        extrasDiv.className = 'innings-extras';
        extrasDiv.innerText = `Extras: WD ${extrasSummary.extras.WD}, NB ${extrasSummary.extras.NB}, B ${extrasSummary.extras.B}, LB ${extrasSummary.extras.LB} — Total extras: ${extrasSummary.total}`;

        const bowlCol = document.createElement('div');
        bowlCol.className = 'players-column';
        const bowlTitle = document.createElement('div'); bowlTitle.style.marginBottom = '8px'; bowlTitle.innerText = 'Bowling — players & stats';
        bowlCol.appendChild(bowlTitle);

        const bowlingPlayers = match.teams[inn.data.bowlingTeam]?.players || [];
        const bmap = inn.data.bowlerStatsMap || {};
        bowlingPlayers.forEach(p => {
            const row = document.createElement('div'); row.className = 'player-stat-row';
            const left = document.createElement('div'); left.className = 'left'; left.innerText = p;
            const right = document.createElement('div'); right.className = 'right';
            const bs = bmap[p] || { overs: 0, wickets: 0, runs: 0 };
            right.innerText = `${bs.overs || 0} ov • ${bs.wickets || 0} wkts • ${bs.runs || 0} r`;
            row.appendChild(left);
            row.appendChild(right);
            bowlCol.appendChild(row);
        });

        const grid = document.createElement('div');
        grid.className = 'players-grid';
        grid.appendChild(playersColumn);
        grid.appendChild(bowlCol);

        body.appendChild(grid);
        body.appendChild(extrasDiv);

        innDiv.appendChild(header);
        innDiv.appendChild(body);
        container.appendChild(innDiv);
    });
}

// --- 4. Init Match View (subscribe) ---
function initMatchView(matchId) {
    document.getElementById('view-match').classList.remove('hidden');

    if (unsubscribeMatch) unsubscribeMatch();
    unsubscribeMatch = DataService.subscribeToMatch(matchId, (match) => {
        currentMatchData = match;

        if (match.status === 'created') {
            window.location.hash = `toss/${matchId}`;
            return;
        }

        renderLiveTab(match);
        renderScoreboardTab(match);

        const user = AuthService.getCurrentUser();
        if (user && user.uid === match.creatorId) {
            document.getElementById('scorer-controls').classList.remove('hidden');
        } else {
            document.getElementById('scorer-controls').classList.add('hidden');
        }
    });
}

// --- 5. Scoring Actions ---
window.recordScore = async (runs, type = 'legal') => {
    if (!currentMatchData || !currentMatchId) {
        alert("No active match loaded.");
        return;
    }

    // Build event
    const event = { runs, type };

    // Keep snapshot for undo
    const lastSnapshot = currentMatchData.liveScore ? JSON.parse(JSON.stringify(currentMatchData.liveScore)) : null;

    // Process via engine
    const result = CricketEngine.processBall(currentMatchData, event);

     // Attach metadata
    result.logEntry.meta = result.logEntry.meta || {};
    result.logEntry.meta.bowler = (currentMatchData.liveScore && currentMatchData.liveScore.bowler) || null;
    result.logEntry.meta.striker = (currentMatchData.liveScore && currentMatchData.liveScore.striker) || null;

    const updateObj = {
        liveScore: result.liveScore,
        lastSnapshot: lastSnapshot,
        history: firebase.firestore.FieldValue.arrayUnion(result.logEntry)
    };

    await DataService.updateMatch(currentMatchId, updateObj);

    if (result.overCompleted) {
        setTimeout(() => {
            openChangeBowlerModal(true);
        }, 200);
    }

    if (result.inningsCompleted) {
        setTimeout(() => {
            handleInningsEnd();
        }, 300);
    }
};

// ---------- Wicket Flow ----------
window.openWicketModal = () => {
    if (!currentMatchData) return alert("Match not loaded.");
    const ls = currentMatchData.liveScore;
    const battingTeamKey = ls.battingTeam;
    const battingTeam = currentMatchData.teams[battingTeamKey];
    const allPlayers = battingTeam.players || [];

    const used = new Set();
    if (ls.striker) used.add(ls.striker);
    if (ls.nonStriker) used.add(ls.nonStriker);
    (ls.outPlayers || []).forEach(p => used.add(p));
    (currentMatchData.history || []).forEach(h => {
        if (h.meta && h.meta.replacement) used.add(h.meta.replacement);
    });

    const remaining = allPlayers.filter(p => !used.has(p));

    const nbSelect = document.getElementById('new-batter-select');
    nbSelect.innerHTML = '';
    remaining.forEach(p => nbSelect.add(new Option(p, p)));
    if (remaining.length === 0) {
        nbSelect.add(new Option("No players left - enter name manually", ""));
    }

    const bowlingTeamKey = ls.bowlingTeam;
    const bowlingPlayers = currentMatchData.teams[bowlingTeamKey].players || [];
    const fielderSelect = document.getElementById('dismissal-fielder');
    fielderSelect.innerHTML = '';
    bowlingPlayers.forEach(p => fielderSelect.add(new Option(p, p)));

    document.getElementById('dismissal-mode').value = 'bowled';
    document.getElementById('fielder-selection').classList.add('hidden');

    document.getElementById('wicket-modal').classList.remove('hidden');
};

window.closeWicketModal = () => {
    document.getElementById('wicket-modal').classList.add('hidden');
};

window.confirmWicket = async () => {
    const mode = document.getElementById('dismissal-mode').value;
    const fielder = document.getElementById('dismissal-fielder').value;
    const newBatter = document.getElementById('new-batter-select').value;

    const ls = currentMatchData.liveScore;
    const bowlingTeamKey = ls.bowlingTeam;
    const wicketkeeper = currentMatchData.teams[bowlingTeamKey].wk || null;

    let dismissal = { mode };
    if (mode === 'catch') dismissal.fielder = fielder || null;
    if (mode === 'stumping' || mode === 'runout') dismissal.fielder = wicketkeeper || null;
    if (mode === 'bowled' || mode === 'lbw') dismissal.fielder = ls.bowler || null;

    const lastSnapshot = currentMatchData.liveScore ? JSON.parse(JSON.stringify(currentMatchData.liveScore)) : null;

    const result = CricketEngine.processBall(currentMatchData, { runs: 0, type: 'W', dismissal });

    result.logEntry.meta = result.logEntry.meta || {};
    result.logEntry.meta.dismissal = dismissal;
    result.logEntry.meta.replacement = newBatter || null;
    result.logEntry.meta.bowler = ls.bowler;
    result.logEntry.meta.strikerBefore = ls.striker;

    result.liveScore.outPlayers = result.liveScore.outPlayers || [];
    if (ls.striker && !result.liveScore.outPlayers.includes(ls.striker)) {
        result.liveScore.outPlayers.push(ls.striker);
    }

    if (!result.overCompleted) {
        result.liveScore.striker = newBatter || ("Substitute");
        result.liveScore.strikerStats = { runs: 0, balls: 0, fours: 0, sixes: 0 };
    } else {
        result.liveScore.nonStriker = newBatter || ("Substitute");
        result.liveScore.nonStrikerStats = { runs: 0, balls: 0, fours: 0, sixes: 0 };
    }

    await DataService.updateMatch(currentMatchId, {
        liveScore: result.liveScore,
        lastSnapshot: lastSnapshot,
        history: firebase.firestore.FieldValue.arrayUnion(result.logEntry)
    });

    closeWicketModal();

    if (result.overCompleted) {
        setTimeout(() => openChangeBowlerModal(true), 200);
    }

    if (result.inningsCompleted) {
        setTimeout(() => handleInningsEnd(), 300);
    }
};

// ---------- Change Bowler ----------
window.openChangeBowlerModal = (fromOverEnd = false) => {
    if (!currentMatchData) return alert("Match not loaded.");
    const ls = currentMatchData.liveScore;
    const bowlingTeamKey = ls.bowlingTeam;
    const bowlingPlayers = currentMatchData.teams[bowlingTeamKey].players || [];

    const select = document.getElementById('new-bowler-select');
    select.innerHTML = '';

    bowlingPlayers.forEach(p => {
        if (p !== ls.bowler) select.add(new Option(p, p));
    });

    if (select.options.length === 0) select.add(new Option(ls.bowler || 'No bowler', ls.bowler || ''));

    document.getElementById('bowler-modal').classList.remove('hidden');
    document.getElementById('bowler-modal').dataset.auto = fromOverEnd ? '1' : '0';
};

window.closeChangeBowlerModal = () => {
    document.getElementById('bowler-modal').classList.add('hidden');
    document.getElementById('bowler-modal').dataset.auto = '0';
};

window.confirmChangeBowler = async () => {
    const selected = document.getElementById('new-bowler-select').value;
    if (!selected) return alert("Please select a bowler.");

    const lastSnapshot = currentMatchData.liveScore ? JSON.parse(JSON.stringify(currentMatchData.liveScore)) : null;

    const ls = JSON.parse(JSON.stringify(currentMatchData.liveScore));
    ls.bowler = selected;
    if (!ls.bowlerStatsMap) ls.bowlerStatsMap = {};
    if (!ls.bowlerStatsMap[selected]) ls.bowlerStatsMap[selected] = { runs: 0, wickets: 0, balls: 0, overs: 0, maidens: 0 };

    const logEntry = {
        type: 'bowlerChange',
        newBowler: selected,
        time: (new Date()).toISOString()
    };

    await DataService.updateMatch(currentMatchId, {
        liveScore: ls,
        lastSnapshot: lastSnapshot,
        history: firebase.firestore.FieldValue.arrayUnion(logEntry)
    });

    closeChangeBowlerModal();
};

// ---------- Undo ----------
window.undoLastBall = async () => {
    if (!currentMatchData || !currentMatchData.liveScore) return alert("No match loaded.");
    const history = currentMatchData.history || [];
    const lastSnapshot = currentMatchData.lastSnapshot || null;

    if (!lastSnapshot || history.length === 0) {
        return alert("Nothing to undo.");
    }

    const lastLog = history[history.length - 1];

    try {
        await DataService.updateMatch(currentMatchId, {
            liveScore: lastSnapshot,
            history: firebase.firestore.FieldValue.arrayRemove(lastLog),
            lastSnapshot: firebase.firestore.FieldValue.delete()
        });
        alert("Last action undone.");
    } catch (err) {
        console.error("Undo failed", err);
        alert("Undo failed. See console for details.");
    }
};

// ---------- Share ----------
window.shareMatch = () => {
    if (!currentMatchId) return alert("No match to share.");
    const url = window.location.origin + window.location.pathname + `#match/${currentMatchId}`;

    if (navigator.share) {
        navigator.share({
            title: document.getElementById('live-match-title').innerText || 'Match',
            text: 'Live score link',
            url
        }).catch(err => {
            navigator.clipboard?.writeText(url).then(() => alert("Match link copied to clipboard."));
        });
    } else if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(() => {
            alert("Match link copied to clipboard.");
        }).catch(() => {
            prompt("Copy this link:", url);
        });
    } else {
        prompt("Copy this link:", url);
    }
};

// ---------- Innings handling ----------
async function handleInningsEnd() {
    if (!currentMatchData || !currentMatchData.liveScore) return;
    const matchDoc = await db.collection('matches').doc(currentMatchId).get();
    const match = matchDoc.data();

    const ls = match.liveScore;
    const finishedInnings = ls.innings || 1;

    if (finishedInnings === 1) {
        const firstInningsRuns = ls.runs || 0;
        const target = firstInningsRuns + 1;

        const newBattingTeam = ls.bowlingTeam;
        const newBowlingTeam = ls.battingTeam;

        const players = match.teams[newBattingTeam].players || [];
        const striker = players[0] || "Batter1";
        const nonStriker = players[1] || "Batter2";

        const bowlingPlayers = match.teams[newBowlingTeam].players || [];
        const bowlerMap = {};
        bowlingPlayers.forEach(p => {
            bowlerMap[p] = { runs: 0, wickets: 0, balls: 0, overs: 0, maidens: 0 };
        });

        const secondInnings = {
            battingTeam: newBattingTeam,
            bowlingTeam: newBowlingTeam,
            runs: 0,
            wickets: 0,
            overs: 0,
            ballsTotal: 0,
            innings: 2,
            striker,
            nonStriker,
            bowler: bowlingPlayers[0] || null,
            recentBalls: [],
            strikerStats: { runs: 0, balls: 0, fours: 0, sixes: 0 },
            nonStrikerStats: { runs: 0, balls: 0, fours: 0, sixes: 0 },
            bowlerStatsMap: bowlerMap,
            outPlayers: [],
            history: []
        };

        await DataService.updateMatch(currentMatchId, {
            innings1: match.liveScore,
            liveScore: secondInnings,
            target: target,
            status: 'live'
        });

        alert(`First innings complete. Target for second innings: ${target}`);
        setTimeout(() => openChangeBowlerModal(true), 500);
        return;
    }

    if (finishedInnings === 2) {
        const first = match.innings1 || null;
        const second = match.liveScore;
        const target = match.target || (first ? first.runs + 1 : null);

        let resultText = "Match completed.";
        if (target !== null) {
            if (second.runs >= target) {
                const winnerTeamKey = second.battingTeam;
                resultText = `${match.teams[winnerTeamKey].name} won by ${(10 - second.wickets)} wickets`;
            } else {
                const winnerTeamKey = first.battingTeam;
                const diff = (first.runs || 0) - (second.runs || 0);
                resultText = `${match.teams[winnerTeamKey].name} won by ${diff} runs`;
            }
        }

        await DataService.updateMatch(currentMatchId, {
            status: 'completed',
            result: resultText,
            completedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        alert(resultText);
        return;
    }
}

// End of public/app.js
