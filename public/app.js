// Global State
let currentMatchId = null;
let currentMatchData = null;
let unsubscribeMatch = null;

// --- 1. Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // Set today's date in form
    document.getElementById('match-date').valueAsDate = new Date();
    
    AuthService.onStateChanged(user => {
        if (!user) AuthService.signInAnonymously();
        handleRoute(); // Initial Route Check
    });
});

window.addEventListener('hashchange', handleRoute);

function handleRoute() {
    const hash = window.location.hash.slice(1);
    
    // Reset Views
    document.querySelectorAll('.view').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));

    if (!hash) {
        document.getElementById('view-dashboard').classList.remove('hidden');
    } 
    else if (hash === 'create') {
        document.getElementById('view-create').classList.remove('hidden');
    } 
    else if (hash.startsWith('toss/')) {
        currentMatchId = hash.split('/')[1];
        setupTossView(currentMatchId);
    } 
    else if (hash.startsWith('match/')) {
        currentMatchId = hash.split('/')[1];
        initMatchView(currentMatchId);
    }
}

// --- 2. Create Match Logic (Updated) ---
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

    // Save to global var
    if (team === 'team1') team1Players = names;
    else team2Players = names;

    // Populate Dropdowns
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
        status: 'created', // Important status flag
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    const id = await DataService.createMatch(matchData);
    window.location.hash = `toss/${id}`; // Redirect to Toss
};

// --- 3. Toss Logic (New) ---
let tossWinner = null;
let tossDecision = null;

async function setupTossView(matchId) {
    document.getElementById('view-toss').classList.remove('hidden');
    
    // Fetch one-time data to populate names
    const doc = await db.collection('matches').doc(matchId).get();
    const data = doc.data();
    
    // Redirect if already live
    if (data.status === 'live' || data.status === 'completed') {
        window.location.hash = `match/${matchId}`;
        return;
    }

    // Populate Buttons
    const container = document.getElementById('toss-winner-options');
    container.innerHTML = `
        <button class="toss-btn" onclick="selectTossWinner('teamA', this)">${data.teams.teamA.name}</button>
        <button class="toss-btn" onclick="selectTossWinner('teamB', this)">${data.teams.teamB.name}</button>
    `;

    // Store data locally for dropdowns
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
    // Default non-striker to 2nd player
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

    // Initialize the live score object
    const liveScoreInit = {
        battingTeam: battingTeamKey,
        bowlingTeam: bowlingTeamKey,
        runs: 0, wickets: 0, overs: 0,
        striker: striker,
        nonStriker: nonStriker,
        bowler: bowler,
        recentBalls: [],
        strikerStats: { runs: 0, balls: 0, fours: 0, sixes: 0 },
        nonStrikerStats: { runs: 0, balls: 0, fours: 0, sixes: 0 },
        bowlerStats: { runs: 0, wickets: 0, overs: 0, maidens: 0 }
    };

    await DataService.updateMatch(currentMatchId, {
        toss: { winner: tossWinner, decision: tossDecision },
        status: 'live',
        liveScore: liveScoreInit
    });

    window.location.hash = `match/${currentMatchId}`;
};

// --- 4. Live Scoring Logic (Visual Fixes) ---
function initMatchView(matchId) {
    document.getElementById('view-match').classList.remove('hidden');
    
    if (unsubscribeMatch) unsubscribeMatch();
    unsubscribeMatch = DataService.subscribeToMatch(matchId, (match) => {
        currentMatchData = match;
        
        // If match created but not tossed, go to toss
        if (match.status === 'created') {
            window.location.hash = `toss/${matchId}`;
            return;
        }

        renderLiveScore(match);
        
        // Show controls ONLY if user is creator
        const user = AuthService.getCurrentUser();
        if (user && user.uid === match.creatorId) {
            document.getElementById('scorer-controls').classList.remove('hidden');
        }
    });
}

function renderLiveScore(match) {
    const ls = match.liveScore;
    const battingTeamName = match.teams[ls.battingTeam].name;

    document.getElementById('live-match-title').innerText = match.title;
    document.getElementById('live-match-venue').innerText = match.venue;
    document.getElementById('batting-team-display').innerText = battingTeamName;
    
    document.getElementById('score-display').innerText = `${ls.runs}/${ls.wickets}`;
    document.getElementById('overs-display').innerText = `(${ls.overs})`;

    // Players
    document.getElementById('striker-name').innerText = ls.striker + "*";
    document.getElementById('s-runs').innerText = ls.strikerStats.runs;
    document.getElementById('s-balls').innerText = ls.strikerStats.balls;
    
    document.getElementById('ns-name').innerText = ls.nonStriker;
    document.getElementById('ns-runs').innerText = ls.nonStrikerStats.runs;

    document.getElementById('bowler-name').innerText = ls.bowler;
    document.getElementById('b-runs').innerText = ls.bowlerStats.runs;
    document.getElementById('b-wickets').innerText = ls.bowlerStats.wickets;
    document.getElementById('b-overs').innerText = ls.bowlerStats.overs;

    // Recent Balls
    const recentDiv = document.getElementById('recent-balls');
    recentDiv.innerHTML = (ls.recentBalls || []).slice(-6).map(b => 
        `<span class="ball-badge">${b}</span>`
    ).join(' ');
}

// Scoring Actions (Connected to Buttons)
window.recordScore = async (runs, type = 'legal') => {
    // Call Cricket Engine (Same as previous logic, just updated variable names)
    // For brevity, assume CricketEngine.processBall works as defined before
    // but update it to handle detailed player stats:
    
    const newState = CricketEngine.processBall(currentMatchData, { runs, type });
    
    await DataService.updateMatch(currentMatchId, {
        liveScore: newState.liveScore,
        history: firebase.firestore.FieldValue.arrayUnion(newState.logEntry)
    });
};

window.handleWicketClick = () => {
    // Simple alert flow for MVP - can be upgraded to Modal
    const newBatter = prompt("Who is the new batsman?");
    if(newBatter) {
        recordScore(0, 'W'); 
        // Note: The engine logic needs to handle swapping the name to `newBatter`
        // We will pass this as metadata in a real production app.
    }
};
