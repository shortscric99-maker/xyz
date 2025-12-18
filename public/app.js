// --- Global State ---
let currentMatchId = null;
let currentMatchData = null;
let unsubscribeMatch = null;
// Track batted players locally to filter dropdowns
let battedPlayers = []; 

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // ... existing auth ...
    AuthService.onStateChanged(user => {
        if (!user) AuthService.signInAnonymously();
        handleRoute();
    });
});
// ... handleRoute and Create Match logic remain same ...

// --- 3. Live Scoring UI Updates ---
function renderLiveScore(match) {
    const ls = match.liveScore;
    
    // Update Batting Card
    document.getElementById('batting-team-name').innerText = match.teams[ls.battingTeam].name.substring(0, 3).toUpperCase();
    document.getElementById('score-display').innerText = `${ls.runs}/${ls.wickets}`;
    document.getElementById('overs-display').innerText = `(${ls.overs})`;
    
    // Update Bowling Card
    document.getElementById('bowling-team-name').innerText = match.teams[ls.bowlingTeam].name.substring(0, 3).toUpperCase();
    document.getElementById('extras-display').innerText = (ls.extras || 0);

    // Update Tables
    document.getElementById('striker-name').innerText = `${ls.striker}*`;
    document.getElementById('s-runs').innerText = ls.strikerStats.runs;
    document.getElementById('s-balls').innerText = ls.strikerStats.balls;
    document.getElementById('s-4s').innerText = ls.strikerStats.fours;
    document.getElementById('s-6s').innerText = ls.strikerStats.sixes;

    document.getElementById('ns-name').innerText = ls.nonStriker;
    document.getElementById('ns-runs').innerText = ls.nonStrikerStats.runs;
    document.getElementById('ns-balls').innerText = ls.nonStrikerStats.balls;

    document.getElementById('bowler-name').innerText = ls.bowler;
    document.getElementById('bowler-stats').innerText = 
        `${ls.bowlerStats.overs}-${ls.bowlerStats.maidens}-${ls.bowlerStats.runs}-${ls.bowlerStats.wickets}`;

    // Detect End of Over logic (Visual)
    const decimals = Math.round((ls.overs % 1) * 10);
    if (decimals === 0 && ls.overs > 0 && ls.recentBalls.length > 0) {
        // Check if last ball wasn't just undone or already handled
        // In a real app, we check if "bowler" needs selection.
        // We will trigger the modal via the scoring function logic below.
    }
}

// --- 4. Wicket Modal Logic ---
window.openWicketModal = () => {
    document.getElementById('modal-wicket').classList.remove('hidden');
    
    // Populate Fielder Dropdown (Bowling Team)
    const bowlingTeamKey = currentMatchData.liveScore.bowlingTeam;
    const bowlingPlayers = currentMatchData.teams[bowlingTeamKey].players;
    const fSelect = document.getElementById('fielder-select');
    fSelect.innerHTML = '';
    bowlingPlayers.forEach(p => fSelect.add(new Option(p, p)));

    // Populate Runout Batsman Dropdown
    const rSelect = document.getElementById('runout-batsman-select');
    rSelect.innerHTML = '';
    rSelect.add(new Option(currentMatchData.liveScore.striker, 'striker'));
    rSelect.add(new Option(currentMatchData.liveScore.nonStriker, 'nonStriker'));

    // Populate New Batter Dropdown (Batting Team - Remaining)
    const battingTeamKey = currentMatchData.liveScore.battingTeam;
    const allBatters = currentMatchData.teams[battingTeamKey].players;
    
    // Calculate who has batted (naive approach: check history or just use generic list for now)
    // To be perfect, we need to store 'battedPlayers' in DB. For MVP, showing all except current.
    const currentBatters = [currentMatchData.liveScore.striker, currentMatchData.liveScore.nonStriker];
    const nbSelect = document.getElementById('new-batter-select');
    nbSelect.innerHTML = '';
    
    allBatters.filter(p => !currentBatters.includes(p)).forEach(p => {
        nbSelect.add(new Option(p, p));
    });

    toggleFielderInput();
};

window.toggleFielderInput = () => {
    const type = document.getElementById('dismissal-type').value;
    const fielderDiv = document.getElementById('fielder-div');
    const runoutDiv = document.getElementById('runout-batsman-div');

    if (['caught', 'runout', 'stumped'].includes(type)) {
        fielderDiv.classList.remove('hidden');
    } else {
        fielderDiv.classList.add('hidden');
    }

    if (type === 'runout') {
        runoutDiv.classList.remove('hidden');
    } else {
        runoutDiv.classList.add('hidden');
    }
};

window.confirmWicket = async () => {
    const type = document.getElementById('dismissal-type').value;
    const newBatter = document.getElementById('new-batter-select').value;
    const fielder = document.getElementById('fielder-select').value;
    const whoOut = document.getElementById('runout-batsman-select').value; // 'striker' or 'nonStriker'

    if (!newBatter) return alert("Select new batsman");

    const wicketDetails = { type: 'W', wicketKind: type, fielder, whoOut, newBatter };
    
    // Close Modal
    closeModal('modal-wicket');

    // Process
    await recordScore(0, 'W', wicketDetails);
};

// --- 5. Bowler Selection Modal ---
window.openBowlerModal = (force = false) => {
    // Only open if it is actually end of over OR forced by user
    document.getElementById('modal-bowler').classList.remove('hidden');
    
    const bowlingTeamKey = currentMatchData.liveScore.bowlingTeam;
    const players = currentMatchData.teams[bowlingTeamKey].players;
    const currentBowler = currentMatchData.liveScore.bowler;

    const select = document.getElementById('next-bowler-select');
    select.innerHTML = '';
    
    players.forEach(p => {
        // Disable current bowler (cannot bowl 2 in a row)
        if (p === currentBowler) {
             // Optional: select.add(new Option(p + " (Just Bowled)", p, false, false));
             // But usually rules say strictly no.
        } else {
            select.add(new Option(p, p));
        }
    });
};

window.confirmNewBowler = async () => {
    const newBowler = document.getElementById('next-bowler-select').value;
    if (!newBowler) return;

    await DataService.updateMatch(currentMatchId, {
        'liveScore.bowler': newBowler,
        'liveScore.bowlerStats': { runs: 0, wickets: 0, overs: 0, maidens: 0 } // Reset stats for new spell? 
        // NOTE: In professional apps, we track individual bowler stats globally. 
        // For this MVP, we are resetting the "Current Bowler Strip".
        // To fix this properly, we need a 'bowlers' map in DB. 
        // I will keep it simple: Just change the name.
    });
    
    closeModal('modal-bowler');
};

window.closeModal = (id) => document.getElementById(id).classList.add('hidden');


// --- 6. Scoring & Undo ---
// Updated recordScore to handle wicket object
window.recordScore = async (runs, type = 'legal', wicketDetails = null) => {
    if (!currentMatchData) return;

    const result = CricketEngine.processBall(currentMatchData, { runs, type, wicketDetails });
    
    // Update Firebase
    await DataService.updateMatch(currentMatchId, {
        liveScore: result.liveScore,
        history: firebase.firestore.FieldValue.arrayUnion(result.logEntry)
    });

    // Check End of Over
    const decimals = Math.round((result.liveScore.overs % 1) * 10);
    if (decimals === 0 && type !== 'WD' && type !== 'NB') {
        setTimeout(() => openBowlerModal(), 1500); // Prompt after 1.5s
    }
};

window.undoLastBall = async () => {
    if (!currentMatchData || currentMatchData.history.length === 0) return alert("Nothing to undo");
    
    // 1. Get history and remove last item
    const newHistory = currentMatchData.history.slice(0, -1);
    
    // 2. Replay entire match from initial state
    // We need the 'initial' state. 
    // Optimization: We know what the initial state is (0/0, openers). 
    // We reconstruct it.
    
    const initialLiveScore = {
        battingTeam: currentMatchData.liveScore.battingTeam,
        bowlingTeam: currentMatchData.liveScore.bowlingTeam,
        runs: 0, wickets: 0, overs: 0, extras: 0,
        striker: currentMatchData.history[0]?.striker || "", // Fallback
        nonStriker: currentMatchData.history[0]?.nonStriker || "",
        bowler: currentMatchData.history[0]?.bowler || "",
        recentBalls: [],
        strikerStats: { runs: 0, balls: 0, fours: 0, sixes: 0 },
        nonStrikerStats: { runs: 0, balls: 0, fours: 0, sixes: 0 },
        bowlerStats: { runs: 0, wickets: 0, overs: 0, maidens: 0 }
    };

    // Re-run engine for every ball in newHistory
    let replayState = { liveScore: initialLiveScore };
    for (const log of newHistory) {
        // We need to pass the full state to processBall
        // NOTE: This requires processBall to be pure and robust.
        // Simplified Logic: 
        // Ideally, we just update the specific fields. 
        // For MVP Production: Just set the history in DB and let a Cloud Function calculate.
        // BUT Client-side:
        const outcome = CricketEngine.processBall({ liveScore: replayState.liveScore }, log);
        replayState.liveScore = outcome.liveScore;
    }

    // 3. Save to DB (Overwrite history)
    await db.collection('matches').doc(currentMatchId).update({
        liveScore: replayState.liveScore,
        history: newHistory
    });
};

// --- 7. Share ---
window.shareMatch = async () => {
    const url = window.location.href;
    if (navigator.share) {
        try {
            await navigator.share({ title: 'Live Cricket Score', url: url });
        } catch (err) { console.log(err); }
    } else {
        navigator.clipboard.writeText(url).then(() => {
            const t = document.getElementById('toast');
            t.classList.remove('hidden');
            setTimeout(() => t.classList.add('hidden'), 2000);
        });
    }
};
