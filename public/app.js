// Global State
let currentMatchId = null;
let currentMatchData = null;
let unsubscribeMatch = null;

// --- 1. Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // Set today's date in form
    const dateEl = document.getElementById('match-date');
    if (dateEl) dateEl.valueAsDate = new Date();
    
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
        bowlerStats: { runs: 0, wickets: 0, overs: 0, maidens: 0 },
        history: [],
        lastSnapshot: null
    };

    await DataService.updateMatch(currentMatchId, {
        toss: { winner: tossWinner, decision: tossDecision },
        status: 'live',
        liveScore: liveScoreInit
    });

    window.location.hash = `match/${currentMatchId}`;
};

// --- 4. Live Scoring Logic (Visual Fixes & Features) ---
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
        } else {
            document.getElementById('scorer-controls').classList.add('hidden');
        }
    });
}

function renderLiveScore(match) {
    const ls = match.liveScore || {};
    const battingTeamName = match.teams[ls.battingTeam].name;
    const bowlingTeamName = match.teams[ls.bowlingTeam].name;

    document.getElementById('live-match-title').innerText = match.title;
    document.getElementById('live-match-venue').innerText = match.venue;
    document.getElementById('batting-team-display').innerText = battingTeamName;
    document.getElementById('bowling-team-display').innerText = bowlingTeamName;
    
    document.getElementById('score-display').innerText = `${ls.runs || 0}/${ls.wickets || 0}`;
    document.getElementById('overs-display').innerText = `(${ls.overs || 0})`;

    // Players
    document.getElementById('striker-name').innerText = (ls.striker || 'Striker') + "*";
    document.getElementById('s-runs').innerText = ls.strikerStats?.runs || 0;
    document.getElementById('s-balls').innerText = ls.strikerStats?.balls || 0;
    document.getElementById('s-4s').innerText = ls.strikerStats?.fours || 0;
    document.getElementById('s-6s').innerText = ls.strikerStats?.sixes || 0;

    document.getElementById('ns-name').innerText = ls.nonStriker || 'Non-Striker';
    document.getElementById('ns-runs').innerText = ls.nonStrikerStats?.runs || 0;
    document.getElementById('ns-balls').innerText = ls.nonStrikerStats?.balls || 0;

    document.getElementById('bowler-name').innerText = ls.bowler || 'Bowler';
    document.getElementById('b-runs').innerText = ls.bowlerStats?.runs || 0;
    document.getElementById('b-wickets').innerText = ls.bowlerStats?.wickets || 0;
    document.getElementById('b-overs').innerText = ls.bowlerStats?.overs || 0;

    // small bowler display
    document.getElementById('bowler-name').innerText = ls.bowler || 'Bowler';
    document.getElementById('b-overs').innerText = ls.bowlerStats?.overs || 0;
    document.getElementById('b-maidens').innerText = ls.bowlerStats?.maidens || 0;
    document.getElementById('b-runs').innerText = ls.bowlerStats?.runs || 0;
    document.getElementById('b-wickets').innerText = ls.bowlerStats?.wickets || 0;

    // Recent Balls
    const recentDiv = document.getElementById('recent-balls');
    recentDiv.innerHTML = (ls.recentBalls || []).slice(-6).map(b => 
        `<span class="ball-badge">${b}</span>`
    ).join(' ');
}

// Scoring Actions (Connected to Buttons)
window.recordScore = async (runs, type = 'legal') => {
    if (!currentMatchData || !currentMatchId) {
        alert("No active match loaded.");
        return;
    }

    // Build event
    const event = { runs, type };

    // Keep snapshot for undo
    const lastSnapshot = currentMatchData.liveScore ? JSON.parse(JSON.stringify(currentMatchData.liveScore)) : null;

    // Process
    const result = CricketEngine.processBall(currentMatchData, event);

    // Attach metadata to log (who bowled etc.)
    result.logEntry.meta = result.logEntry.meta || {};
    result.logEntry.meta.bowler = (currentMatchData.liveScore && currentMatchData.liveScore.bowler) || null;
    result.logEntry.meta.striker = (currentMatchData.liveScore && currentMatchData.liveScore.striker) || null;

    // Prepare update object
    const updateObj = {
        liveScore: result.liveScore,
        lastSnapshot: lastSnapshot,
        history: firebase.firestore.FieldValue.arrayUnion(result.logEntry)
    };

    await DataService.updateMatch(currentMatchId, updateObj);

    // If over completed, prompt to choose next bowler
    if (result.overCompleted) {
        // small delay to allow UI update from listener
        setTimeout(() => {
            openChangeBowlerModal(true);
        }, 200);
    }
};

//
// Wicket Flow: open modal, pick mode, fielder (if needed), choose new batsman from remaining players
//
window.openWicketModal = () => {
    if (!currentMatchData) return alert("Match not loaded.");
    const ls = currentMatchData.liveScore;
    const battingTeamKey = ls.battingTeam;
    const battingTeam = currentMatchData.teams[battingTeamKey];
    const allPlayers = battingTeam.players || [];

    // Determine players still to bat: exclude striker, nonStriker and those already appeared?
    // We'll derive from history: simplest approach - taken players are those that have had stats >0 or are in striker/nonStriker or previously used.
    const used = new Set();
    if (ls.striker) used.add(ls.striker);
    if (ls.nonStriker) used.add(ls.nonStriker);
    // Also collect from history any named replacements (simple heuristic)
    (currentMatchData.history || []).forEach(h => {
        if (h.meta && h.meta.replacement) used.add(h.meta.replacement);
    });

    const remaining = allPlayers.filter(p => !used.has(p));

    // Populate new-batter-select
    const nbSelect = document.getElementById('new-batter-select');
    nbSelect.innerHTML = '';
    remaining.forEach(p => nbSelect.add(new Option(p, p)));
    if (remaining.length === 0) {
        // No remaining in list - allow manual input fallback
        nbSelect.add(new Option("No players left - enter name manually", ""));
    }

    // Populate fielder select with bowling team players
    const bowlingTeamKey = ls.bowlingTeam;
    const bowlingPlayers = currentMatchData.teams[bowlingTeamKey].players || [];
    const fielderSelect = document.getElementById('dismissal-fielder');
    fielderSelect.innerHTML = '';
    bowlingPlayers.forEach(p => fielderSelect.add(new Option(p, p)));

    // Reset modal controls
    document.getElementById('dismissal-mode').value = 'bowled';
    document.getElementById('fielder-selection').classList.add('hidden');

    // Show modal
    document.getElementById('wicket-modal').classList.remove('hidden');
};

window.closeWicketModal = () => {
    document.getElementById('wicket-modal').classList.add('hidden');
};

document.getElementById('dismissal-mode').addEventListener('change', (e) => {
    const val = e.target.value;
    // Only 'catch' needs fielder select. For 'stumping' and 'runout' we set fielder to wicketkeeper automatically when recording.
    if (val === 'catch') document.getElementById('fielder-selection').classList.remove('hidden');
    else document.getElementById('fielder-selection').classList.add('hidden');
});

window.confirmWicket = async () => {
    const mode = document.getElementById('dismissal-mode').value;
    const fielder = document.getElementById('dismissal-fielder').value;
    const newBatter = document.getElementById('new-batter-select').value;

    if (!newBatter) {
        if (!confirm("You selected no new batsman from list. Proceed with empty name?")) return;
    }

    const ls = currentMatchData.liveScore;
    const bowlingTeamKey = ls.bowlingTeam;
    const wicketkeeper = currentMatchData.teams[bowlingTeamKey].wk || null;

    let dismissal = { mode };
    if (mode === 'catch') dismissal.fielder = fielder || null;
    if (mode === 'stumping' || mode === 'runout') dismissal.fielder = wicketkeeper || null;
    if (mode === 'bowled' || mode === 'lbw') dismissal.fielder = ls.bowler || null;

    // Keep snapshot for undo
    const lastSnapshot = currentMatchData.liveScore ? JSON.parse(JSON.stringify(currentMatchData.liveScore)) : null;

    // Process a wicket ball via engine
    const result = CricketEngine.processBall(currentMatchData, { runs: 0, type: 'W', dismissal });

    // Attach dismissal info & replacement info into log
    result.logEntry.meta = result.logEntry.meta || {};
    result.logEntry.meta.dismissal = dismissal;
    result.logEntry.meta.replacement = newBatter || null;
    result.logEntry.meta.bowler = ls.bowler;
    result.logEntry.meta.strikerBefore = ls.striker;

    // Now set new striker/non-striker according to rule:
    // "after wicket new player will be striker except if over had completed."
    if (!result.overCompleted) {
        result.liveScore.striker = newBatter || ("Substitute");
        result.liveScore.strikerStats = { runs: 0, balls: 0, fours: 0, sixes: 0 };
    } else {
        // Over completed: keep the swap that happened in engine. New batter will be inserted as non-striker so that behavior matches "except if over completed"
        result.liveScore.nonStriker = newBatter || ("Substitute");
        result.liveScore.nonStrikerStats = { runs: 0, balls: 0, fours: 0, sixes: 0 };
    }

    // Update match with lastSnapshot for undo and push logEntry
    await DataService.updateMatch(currentMatchId, {
        liveScore: result.liveScore,
        lastSnapshot: lastSnapshot,
        history: firebase.firestore.FieldValue.arrayUnion(result.logEntry)
    });

    closeWicketModal();

    // If over completed, prompt for new bowler
    if (result.overCompleted) {
        setTimeout(() => openChangeBowlerModal(true), 200);
    }
};

//
// Change Bowler Modal
//
window.openChangeBowlerModal = (fromOverEnd = false) => {
    if (!currentMatchData) return alert("Match not loaded.");
    const ls = currentMatchData.liveScore;
    const bowlingTeamKey = ls.bowlingTeam;
    const bowlingPlayers = currentMatchData.teams[bowlingTeamKey].players || [];

    const select = document.getElementById('new-bowler-select');
    select.innerHTML = '';

    bowlingPlayers.forEach(p => {
        // allow any player as bowler (simple; you may exclude current bowler)
        if (p !== ls.bowler) select.add(new Option(p, p));
    });

    // If no option (all are same), still add current bowler as fallback
    if (select.options.length === 0) select.add(new Option(ls.bowler || 'No bowler', ls.bowler || ''));

    document.getElementById('bowler-modal').classList.remove('hidden');

    // store a flag whether this change is automatic after over end
    document.getElementById('bowler-modal').dataset.auto = fromOverEnd ? '1' : '0';
};

window.closeChangeBowlerModal = () => {
    document.getElementById('bowler-modal').classList.add('hidden');
    document.getElementById('bowler-modal').dataset.auto = '0';
};

window.confirmChangeBowler = async () => {
    const selected = document.getElementById('new-bowler-select').value;
    if (!selected) return alert("Please select a bowler.");

    // Keep snapshot for undo (so bowler change can be reverted with undo of last ball)
    const lastSnapshot = currentMatchData.liveScore ? JSON.parse(JSON.stringify(currentMatchData.liveScore)) : null;

    // Update liveScore: set new bowler and reset bowlerStats (or keep previous values if you prefer)
    const ls = JSON.parse(JSON.stringify(currentMatchData.liveScore));
    ls.bowler = selected;
    ls.bowlerStats = ls.bowlerStats || { runs: 0, wickets: 0, overs: 0, maidens: 0 };

    // Push a log entry to history to indicate bowler change (helpful for undo)
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

//
// Undo functionality
//
window.undoLastBall = async () => {
    if (!currentMatchData || !currentMatchData.liveScore) return alert("No match loaded.");
    const history = currentMatchData.history || [];
    const lastSnapshot = currentMatchData.lastSnapshot || null;

    if (!lastSnapshot || history.length === 0) {
        return alert("Nothing to undo.");
    }

     // Get last log entry
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

//
// Share match (copy link / Web Share)
//
window.shareMatch = () => {
    if (!currentMatchId) return alert("No match to share.");
    const url = window.location.origin + window.location.pathname + `#match/${currentMatchId}`;

    // Try Web Share API first
    if (navigator.share) {
        navigator.share({
            title: document.getElementById('live-match-title').innerText || 'Match',
            text: 'Live score link',
            url
        }).catch(err => {
            // fallback to clipboard
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
