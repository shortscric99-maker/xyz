// public/app.js
// Full, self-contained updated file — ready to copy & paste.

'use strict';

// Global State
let currentMatchId = null;
let currentMatchData = null;
let unsubscribeMatch = null;

// --- 1. Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // Set today's date in form
    const dateEl = document.getElementById('match-date');
    if (dateEl) dateEl.valueAsDate = new Date();

    // Auth state (AuthService provided by firebase-service.js)
    AuthService.onStateChanged(user => {
        if (!user) AuthService.signInAnonymously();
        handleRoute(); // Initial Route Check
    });

    // Dismissal mode change listener (safeguard if element exists)
    const dismissalEl = document.getElementById('dismissal-mode');
    if (dismissalEl) {
        dismissalEl.addEventListener('change', (e) => {
            const val = e.target.value;
            if (val === 'catch') document.getElementById('fielder-selection').classList.remove('hidden');
            else document.getElementById('fielder-selection').classList.add('hidden');
        });
    }
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

// --- 3. Toss Logic ---
let tossWinner = null;
let tossDecision = null;

async function setupTossView(matchId) {
    document.getElementById('view-toss').classList.remove('hidden');

    // Fetch one-time data to populate names
    const doc = await db.collection('matches').doc(matchId).get();
    const data = doc.data();

    // Redirect if already live or completed
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

    // Store locally for dropdowns/populate later
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

    // Build playerStats mapping for both teams
    const playerStats = {};
    currentMatchData.teams.teamA.players.forEach(p => {
        playerStats[p] = { runs: 0, balls: 0, fours: 0, sixes: 0, out: false, outInfo: null };
    });
    currentMatchData.teams.teamB.players.forEach(p => {
        if (!playerStats[p]) playerStats[p] = { runs: 0, balls: 0, fours: 0, sixes: 0, out: false, outInfo: null };
    });

    // Prepare bowlers mapping for bowling team
    const bowlers = {};
    currentMatchData.teams[bowlingTeamKey].players.forEach(p => {
        bowlers[p] = { runs: 0, wickets: 0, overs: 0, maidens: 0, ballsInCurrentOver: 0 };
    });

    // Initialize the live score object
    const liveScoreInit = {
        battingTeam: battingTeamKey,
        bowlingTeam: bowlingTeamKey,
        runs: 0, wickets: 0, overs: 0,
        striker: striker,
        nonStriker: nonStriker,
        bowler: bowler,
        recentBalls: [],
        playerStats: playerStats,
        bowlers: bowlers,
        bowlerStats: bowlers[bowler] || { runs: 0, wickets: 0, overs: 0, maidens: 0 },
        history: [],
        lastSnapshot: null,
        innings: 1,
        target: null,
        matchOvers: parseInt(document.getElementById('overs').value || 0),
        matchCompleted: false
    };

    await DataService.updateMatch(currentMatchId, {
        toss: { winner: tossWinner, decision: tossDecision },
        status: 'live',
        liveScore: liveScoreInit
    });

    window.location.hash = `match/${currentMatchId}`;
};

// --- 4. Live Scoring & Rendering ---
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
        renderFullScorecards(match);
        
        // Show controls ONLY if user is creator and match not completed
        const user = AuthService.getCurrentUser();
        if (user && user.uid === match.creatorId && match.status !== 'completed') {
            document.getElementById('scorer-controls').classList.remove('hidden');
        } else {
            document.getElementById('scorer-controls').classList.add('hidden');
        }
    });
}

function renderLiveScore(match) {
    const ls = match.liveScore || {};
    const battingTeamName = match.teams[ls.battingTeam]?.name || '-';
    const bowlingTeamName = match.teams[ls.bowlingTeam]?.name || '-';

    // Main important scorecard (top)
    document.getElementById('live-match-title').innerText = match.title;
    document.getElementById('live-match-venue').innerText = match.venue;
    document.getElementById('batting-team-display').innerText = battingTeamName;
    document.getElementById('bowling-team-display').innerText = bowlingTeamName;
    document.getElementById('score-display').innerText = `${ls.runs || 0}/${ls.wickets || 0}`;
    document.getElementById('overs-display').innerText = `(${ls.overs || 0})`;

    // Current Play (top small cards)
    document.getElementById('striker-name-large').innerText = ls.striker || '-';
    document.getElementById('striker-r').innerText = ls.playerStats?.[ls.striker]?.runs || 0;
    document.getElementById('striker-b').innerText = ls.playerStats?.[ls.striker]?.balls || 0;
    document.getElementById('striker-sr').innerText = (ls.playerStats?.[ls.striker] && ls.playerStats[ls.striker].balls > 0) ? ((ls.playerStats[ls.striker].runs / ls.playerStats[ls.striker].balls) * 100).toFixed(1) : '0.0';

    document.getElementById('nonstriker-name-large').innerText = ls.nonStriker || '-';
    document.getElementById('nonstriker-r').innerText = ls.playerStats?.[ls.nonStriker]?.runs || 0;
    document.getElementById('nonstriker-b').innerText = ls.playerStats?.[ls.nonStriker]?.balls || 0;
    document.getElementById('nonstriker-sr').innerText = (ls.playerStats?.[ls.nonStriker] && ls.playerStats[ls.nonStriker].balls > 0) ? ((ls.playerStats[ls.nonStriker].runs / ls.playerStats[ls.nonStriker].balls) * 100).toFixed(1) : '0.0';

    document.getElementById('current-bowler-name').innerText = ls.bowler || '-';
    const cb = ls.bowlers?.[ls.bowler] || {};
    document.getElementById('current-bowler-overs').innerText = cb.overs || 0;
    document.getElementById('current-bowler-balls').innerText = cb.ballsInCurrentOver || 0;
    document.getElementById('current-bowler-wkts').innerText = cb.wickets || 0;
    document.getElementById('current-bowler-runs').innerText = cb.runs || 0;

    // This over visuals
    const thisOverDiv = document.getElementById('this-over-balls');
    thisOverDiv.innerHTML = (ls.recentBalls || []).slice(-6).map(b => `<span class="ball-badge">${b}</span>`).join(' ');

    // Target & runs/balls remaining (if innings 2)
    const targetBanner = document.getElementById('target-banner');
    if (ls.target) {
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

    // CRR calculation
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

    // Populate batsmen table rows (tabular)
    const batsmenBody = document.getElementById('batsmen-list-table');
    if (batsmenBody) {
        batsmenBody.innerHTML = '';
        const battingPlayers = (match.teams && match.teams[ls.battingTeam] && match.teams[ls.battingTeam].players) || [];
        battingPlayers.forEach(p => {
            const stats = ls.playerStats?.[p] || { runs: 0, balls: 0, fours: 0, sixes: 0, out: false, outInfo: null };
            const isStriker = (ls.striker === p);
            const isNonStriker = (ls.nonStriker === p);
            const status = stats.out ? `OUT (${stats.outInfo?.mode || 'out'})` : (isStriker ? '🔸 Striker' : (isNonStriker ? '⭘ Non-Striker' : 'Not Out / Yet to Bat'));
            const sr = stats.balls > 0 ? ((stats.runs / stats.balls) * 100).toFixed(1) : '0.0';

            const row = document.createElement('div');
            row.className = `table-row player-row ${isStriker || isNonStriker ? 'active' : ''}`;
            row.innerHTML = `<span class="p-name">${p}${isStriker ? ' *' : ''}${isNonStriker ? ' †' : ''}</span>
                             <span>${stats.runs}</span>
                             <span>${stats.balls}</span>
                             <span>${stats.fours}</span>
                             <span>${stats.sixes}</span>
                             <span>${sr} / ${status}</span>`;
            batsmenBody.appendChild(row);
        });
    }

    // Populate bowling table rows (tabular)
    const bowlingBody = document.getElementById('bowling-table-body');
    if (bowlingBody) {
        bowlingBody.innerHTML = '';
        const bowlersObj = ls.bowlers || {};
        Object.keys(bowlersObj).forEach(name => {
            const b = bowlersObj[name];
            const row = document.createElement('div');
            row.className = 'table-row player-row';
            row.innerHTML = `<span class="p-name">${name}${ls.bowler === name ? ' (current)' : ''}</span>
                             <span>${b.overs || 0}</span>
                             <span>${b.ballsInCurrentOver || 0}</span>
                             <span>${b.wickets || 0}</span>
                             <span>${b.maidens || 0}</span>
                             <span>${b.runs || 0}</span>`;
            bowlingBody.appendChild(row);
        });
    }
}

function renderFullScorecards(match) {
    const container = document.getElementById('full-scorecards');
    if (!container) return;
    container.innerHTML = '';

    // Show previous innings summaries if any
    (match.innings || []).forEach((inn, idx) => {
        const card = document.createElement('div');
        card.className = 'innings-card';
        card.innerHTML = `<h4>Innings ${idx+1} - ${inn.battingTeamName} (Score: ${inn.runs}/${inn.wickets} in ${inn.overs})</h4>
                          <div><strong>Batting:</strong> ${renderPlayersInline(inn.playerStats, inn.battingPlayers)}</div>
                          <div style="margin-top:8px;"><strong>Bowling:</strong> ${renderBowlersInline(inn.bowlers)}</div>`;
        container.appendChild(card);
    });

    // Current live innings (or last)
    const ls = match.liveScore || {};
    const currentCard = document.createElement('div');
    currentCard.className = 'innings-card';
    const battingTeamName = match.teams[ls.battingTeam]?.name || '-';
    currentCard.innerHTML = `<h4>Current Innings ${ls.innings || 1} - ${battingTeamName} (Score: ${ls.runs || 0}/${ls.wickets || 0} in ${ls.overs || 0})</h4>
                             <div><strong>Batting:</strong> ${renderPlayersInline(ls.playerStats || {}, match.teams[ls.battingTeam]?.players || [])}</div>
                             <div style="margin-top:8px;"><strong>Bowling:</strong> ${renderBowlersInline(ls.bowlers || {})}</div>`;
    container.appendChild(currentCard);
}

function renderPlayersInline(playerStatsObj, battingPlayers) {
    // show each player with runs (R/B) and status
    const parts = (battingPlayers || []).map(p => {
        const s = playerStatsObj[p] || { runs:0, balls:0, out:false, outInfo:null };
        const status = s.out ? `OUT (${s.outInfo?.mode || 'out'})` : (s.balls > 0 ? 'batted' : 'yet');
        return `${p} ${s.runs}/${s.balls} [${status}]`;
    });
    return parts.join(' • ');
}

function renderBowlersInline(bowlersObj) {
    return Object.keys(bowlersObj || {}).map(name => {
        const b = bowlersObj[name] || {};
        return `${name} ${b.overs || 0}ov ${b.wickets || 0}wkts R:${b.runs || 0}`;
    }).join(' • ');
}

// --- Scoring Actions ---
window.recordScore = async (runs, type = 'legal') => {
    if (!currentMatchData || !currentMatchId) {
        alert("No active match loaded.");
        return;
    }

    // prevent scoring if match completed
    if (currentMatchData.status === 'completed' || (currentMatchData.liveScore && currentMatchData.liveScore.matchCompleted)) {
        return alert("Match already completed. Scoring disabled.");
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

    // Update match with this ball
    await DataService.updateMatch(currentMatchId, updateObj);

      // If over completed -> prompt bowler change
    if (result.overCompleted) {
        // small delay to allow UI update from listener
        setTimeout(() => {
            openChangeBowlerModal(true);
        }, 200);
    }

    // If innings ended after this ball -> handle innings transition
    if (result.inningsEnded) {
        // fetch fresh match doc
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

        // If it was innings 1 -> initialize innings 2 (unless matchCompleted flagged)
        if ((prevLS.innings || 1) === 1 && !result.matchCompleted) {
            const prevRuns = prevLS.runs || 0;
            const target = prevRuns + 1;

            // Swap teams
            const battingTeamKey = prevLS.bowlingTeam;
            const bowlingTeamKey = prevLS.battingTeam;

            // Build fresh playerStats & bowlers for new innings
            const playerStats = {};
            (fullMatch.teams[battingTeamKey].players || []).forEach(p => { playerStats[p] = { runs:0, balls:0, fours:0, sixes:0, out:false, outInfo:null }; });
            (fullMatch.teams[bowlingTeamKey].players || []).forEach(p => { if(!playerStats[p]) playerStats[p] = { runs:0, balls:0, fours:0, sixes:0, out:false, outInfo:null }; });

            const bowlers = {};
            (fullMatch.teams[bowlingTeamKey].players || []).forEach(p => { bowlers[p] = { runs:0, wickets:0, overs:0, maidens:0, ballsInCurrentOver:0 }; });

            // default openers
            const battingPlayers = fullMatch.teams[battingTeamKey].players || [];
            const striker = battingPlayers[0] || 'Striker';
            const nonStriker = battingPlayers[1] || (battingPlayers[0] || 'NonStriker');
            const openingBowler = fullMatch.teams[bowlingTeamKey].players[0] || '';

            const newLS = {
                battingTeam: battingTeamKey,
                bowlingTeam: bowlingTeamKey,
                runs: 0, wickets: 0, overs: 0,
                striker,
                nonStriker,
                bowler: openingBowler,
                recentBalls: [],
                playerStats,
                bowlers,
                history: [],
                lastSnapshot: null,
                innings: 2,
                target: target,
                matchOvers: fullMatch.overs || 0,
                matchCompleted: false
            };

            const inningChangeLog = { type: 'inningsEnd', previousRuns: prevRuns, time: (new Date()).toISOString(), note: `Innings 1 ended. Target ${target}` };

            await DataService.updateMatch(currentMatchId, {
                liveScore: newLS,
                status: 'live',
                history: firebase.firestore.FieldValue.arrayUnion(inningChangeLog)
            });

            alert(`Innings 1 ended. Target for next team: ${target}. Starting innings 2.`);
        } else {
            // innings 2 ended -> finalize match
            const finalLS = prevLS;
            // Determine winner
            let winner = null;
            if (finalLS.target) {
                if (finalLS.runs >= finalLS.target) {
                    winner = fullMatch.teams[finalLS.battingTeam]?.name || null;
                } else {
                    winner = fullMatch.teams[finalLS.bowlingTeam]?.name || null;
                }
            }
            const completeLog = { type: 'matchComplete', winner: winner || 'N/A', time: (new Date()).toISOString() };
            await DataService.updateMatch(currentMatchId, {
                status: 'completed',
                'liveScore.matchCompleted': true,
                history: firebase.firestore.FieldValue.arrayUnion(completeLog)
            });
            alert(`Match completed. Winner: ${winner || 'N/A'}`);
        }
    }
};

// --- Wicket Flow ---
window.openWicketModal = () => {
    if (!currentMatchData) return alert("Match not loaded.");
    const ls = currentMatchData.liveScore || {};
    const battingTeamKey = ls.battingTeam;
    const battingTeam = currentMatchData.teams[battingTeamKey] || {};
    const allPlayers = battingTeam.players || [];

    // Determine players still to bat: exclude striker, nonStriker and those in history as replacements
    const used = new Set();
    if (ls.striker) used.add(ls.striker);
    if (ls.nonStriker) used.add(ls.nonStriker);
    (currentMatchData.history || []).forEach(h => {
        if (h.meta && h.meta.replacement) used.add(h.meta.replacement);
    });

    const remaining = allPlayers.filter(p => !used.has(p));

    // Populate new-batter-select
    const nbSelect = document.getElementById('new-batter-select');
    nbSelect.innerHTML = '';
    remaining.forEach(p => nbSelect.add(new Option(p, p)));
    if (remaining.length === 0) {
        nbSelect.add(new Option("No players left - enter name manually", ""));
    }

    // Populate fielder select with bowling team players
    const bowlingTeamKey = ls.bowlingTeam;
    const bowlingPlayers = currentMatchData.teams[bowlingTeamKey]?.players || [];
    const fielderSelect = document.getElementById('dismissal-fielder');
    fielderSelect.innerHTML = '';
    bowlingPlayers.forEach(p => fielderSelect.add(new Option(p, p)));

    // Reset modal controls
    const dismissalEl = document.getElementById('dismissal-mode');
    if (dismissalEl) dismissalEl.value = 'bowled';
    document.getElementById('fielder-selection').classList.add('hidden');

    // Show modal
    document.getElementById('wicket-modal').classList.remove('hidden');
};

window.closeWicketModal = () => {
    document.getElementById('wicket-modal').classList.add('hidden');
};

window.confirmWicket = async () => {
    const mode = document.getElementById('dismissal-mode').value;
    const fielder = document.getElementById('dismissal-fielder').value;
    const newBatter = document.getElementById('new-batter-select').value;

    if (!newBatter) {
        if (!confirm("You selected no new batsman from list. Proceed with empty name?")) return;
    }

    const ls = currentMatchData.liveScore || {};
    const bowlingTeamKey = ls.bowlingTeam;
    const wicketkeeper = currentMatchData.teams[bowlingTeamKey]?.wk || null;

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

    // Insert new batsman depending on overCompleted
    if (!result.overCompleted) {
        result.liveScore.striker = newBatter || ("Substitute");
        if (!result.liveScore.playerStats[result.liveScore.striker]) {
            result.liveScore.playerStats[result.liveScore.striker] = { runs: 0, balls: 0, fours: 0, sixes: 0, out: false, outInfo: null };
        }
    } else {
        result.liveScore.nonStriker = newBatter || ("Substitute");
        if (!result.liveScore.playerStats[result.liveScore.nonStriker]) {
            result.liveScore.playerStats[result.liveScore.nonStriker] = { runs: 0, balls: 0, fours: 0, sixes: 0, out: false, outInfo: null };
        }
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

    // If innings ended because of this wicket, recordScore flow will handle the innings transition after DB update
};

// --- Change Bowler Modal ---
window.openChangeBowlerModal = (fromOverEnd = false) => {
    if (!currentMatchData) return alert("Match not loaded.");
    const ls = currentMatchData.liveScore || {};
    const bowlingTeamKey = ls.bowlingTeam;
    const bowlingPlayers = currentMatchData.teams[bowlingTeamKey]?.players || [];

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

    // Update liveScore: set new bowler and ensure bowler exists in mapping
    const ls = JSON.parse(JSON.stringify(currentMatchData.liveScore || {}));
    ls.bowler = selected;
    ls.bowlers = ls.bowlers || {};
    if (!ls.bowlers[selected]) ls.bowlers[selected] = { runs: 0, wickets: 0, overs: 0, maidens: 0, ballsInCurrentOver: 0 };

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

// --- Undo functionality ---
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

// --- Share match (copy link / Web Share) ---
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
