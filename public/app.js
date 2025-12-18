let currentMatchId = null;
let currentMatchData = null;
let unsubscribeMatch = null;

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    AuthService.onStateChanged(user => {
        if (!user) AuthService.signInAnonymously();
        handleRoute();
    });
});

window.addEventListener('hashchange', handleRoute);

function handleRoute() {
    const hash = window.location.hash.slice(1);
    document.querySelectorAll('.view').forEach(el => el.classList.remove('active', 'hidden'));
    document.querySelectorAll('.view').forEach(el => el.classList.add('hidden'));

    if (!hash) {
        showView('view-dashboard');
    } else if (hash === 'create') {
        showView('view-create');
    } else if (hash.startsWith('match/')) {
        currentMatchId = hash.split('/')[1];
        loadMatch(currentMatchId);
        showView('view-match');
    }
}

function showView(id) {
    const el = document.getElementById(id);
    el.classList.remove('hidden');
    el.classList.add('active');
}

// --- Dashboard & Creation ---
document.getElementById('btn-create-match').onclick = () => window.location.hash = 'create';

document.getElementById('create-match-form').onsubmit = async (e) => {
    e.preventDefault();
    const title = document.getElementById('match-title').value;
    const team1 = document.getElementById('team1-name').value;
    const team2 = document.getElementById('team2-name').value;
    const overs = parseInt(document.getElementById('overs').value);

    // Initial Empty State
    const matchData = {
        title,
        teams: {
            teamA: { name: team1, players: [] },
            teamB: { name: team2, players: [] }
        },
        liveScore: {
            battingTeam: 'teamA',
            runs: 0, wickets: 0, overs: 0,
            recentBalls: []
        }
    };

    const id = await DataService.createMatch(matchData);
    window.location.hash = `match/${id}`;
};

// --- Live Match Logic ---
function loadMatch(id) {
    if (unsubscribeMatch) unsubscribeMatch();

    unsubscribeMatch = DataService.subscribeToMatch(id, (match) => {
        currentMatchData = match;
        renderMatchHeader(match);
        renderScoreboard(match.liveScore);
        
        // Check permissions
        const user = AuthService.getCurrentUser();
        const isCreator = user && user.uid === match.creatorId;
        
        const controls = document.getElementById('scorer-controls');
        if (isCreator && match.status !== 'completed') {
            controls.classList.remove('hidden');
        } else {
            controls.classList.add('hidden');
        }
    });
}

function renderScoreboard(score) {
    document.getElementById('score-display').innerText = `${score.runs}/${score.wickets}`;
    document.getElementById('overs-display').innerText = `(${score.overs})`;
    
    // Calculate CRR
    const totalBalls = Math.floor(score.overs) * 6 + (score.overs % 1 * 10);
    const crr = totalBalls > 0 ? (score.runs / (totalBalls/6)).toFixed(2) : '0.00';
    document.getElementById('crr').innerText = crr;
    
    // Render Recent Balls (Last 6 from history ideally, simplifying here)
    const recentDiv = document.getElementById('recent-balls');
    recentDiv.innerHTML = (score.recentBalls || []).slice(-6).map(b => 
        `<span class="ball-badge">${b}</span>`
    ).join('');
}

// --- Scoring Actions ---
document.querySelectorAll('.run-btn').forEach(btn => {
    btn.onclick = () => recordBall(parseInt(btn.dataset.run), 'legal');
});
document.querySelectorAll('.extra-btn').forEach(btn => {
    btn.onclick = () => recordBall(1, btn.dataset.type); // Simplify: 1 run for extra
});

async function recordBall(runs, type) {
    if (!currentMatchData) return;

    // 1. Calculate new state locally
    const result = CricketEngine.processBall(currentMatchData, { runs, type });
    
    // 2. Prepare Display String for Recent Balls (e.g. "4", "W", "1wd")
    let displayBall = runs.toString();
    if (type === 'WD') displayBall = 'WD';
    if (type === 'W') displayBall = 'W';
    
    const newRecent = [...(currentMatchData.liveScore.recentBalls || []), displayBall];

    // 3. Update Firebase
    // We add the logEntry to history array and update liveScore
    await DataService.updateMatch(currentMatchId, {
        liveScore: { ...result.liveScore, recentBalls: newRecent },
        history: firebase.firestore.FieldValue.arrayUnion(result.logEntry)
    });
}

window.shareMatch = () => {
    navigator.share({
        title: currentMatchData.title,
        text: `Watch live: ${currentMatchData.teams.teamA.name} vs ${currentMatchData.teams.teamB.name}`,
        url: window.location.href
    }).catch(console.error);
};
