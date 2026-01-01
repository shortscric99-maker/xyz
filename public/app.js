// public/app.js
// Fully merged — complete application logic (landing/login, tournaments, full scoring flow).
// Ready to copy-paste into your project (replaces previous public/app.js).

/* GLOBAL STATE */
let currentMatchId = null;
let currentMatchData = null;
let unsubscribeMatch = null;
let unsubscribeTournaments = null;
let unsubscribeTournamentMatches = null;

let team1Players = [], team2Players = [];
let tossWinner = null, tossDecision = null, currentMatchDataLocal = null;
let startInningsPendingPayload = null; // holds data when waiting for opener selection

let tournamentsList = []; // cached tournaments for current user
let extraModalPendingType = null;

/* INITIALIZATION */
document.addEventListener('DOMContentLoaded', () => {
    const dateEl = document.getElementById('match-date');
    if (dateEl) dateEl.valueAsDate = new Date();

    // Landing buttons
    const guestBtn = document.getElementById('btn-guest-continue');
    if (guestBtn) guestBtn.onclick = async () => {
        try {
            await AuthService.signInAnonymously();
            window.location.hash = 'dashboard';
        } catch (err) {
            console.error(err);
            showToast('Guest sign-in failed', 'error');
        }
    };

    const loginOpenBtn = document.getElementById('btn-login-open');
    if (loginOpenBtn) loginOpenBtn.onclick = () => { window.location.hash = 'login'; };

    // Login handlers
    const backBtn = document.getElementById('btn-back-to-landing');
    if (backBtn) backBtn.onclick = () => { window.location.hash = ''; };

    const createAccBtn = document.getElementById('btn-create-account');
    if (createAccBtn) createAccBtn.onclick = async () => {
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        if (!email || !password) { showToast('Enter email & password', 'error'); return; }
        try {
            await AuthService.createUserWithEmail(email, password);
            showToast('Account created & signed in', 'success');
            window.location.hash = 'dashboard';
        } catch (err) {
            console.error(err);
            showToast('Account creation failed: ' + (err.message || err), 'error');
        }
    };

    const loginForm = document.getElementById('login-form');
    if (loginForm) loginForm.onsubmit = async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        if (!email || !password) { showToast('Enter email & password', 'error'); return; }
        try {
            await AuthService.signInWithEmail(email, password);
            showToast('Signed in', 'success');
            window.location.hash = 'dashboard';
        } catch (err) {
            console.error(err);
            showToast('Sign in failed: ' + (err.message || err), 'error');
        }
    };

    // Dismissal change wiring
    const dismissalModeEl = document.getElementById('dismissal-mode');
    if (dismissalModeEl) {
        dismissalModeEl.addEventListener('change', (e) => {
            const val = e.target.value;
            if (val === 'catch') document.getElementById('fielder-selection').classList.remove('hidden');
            else document.getElementById('fielder-selection').classList.add('hidden');
        });
    }

    // match creation: show/hide tournament select when toggle checked
    const tournamentToggle = document.getElementById('assign-to-tournament-toggle');
    const tournamentSelectRow = document.getElementById('tournament-select-row');
    if (tournamentToggle && tournamentSelectRow) {
        tournamentToggle.addEventListener('change', (e) => {
            if (e.target.checked) tournamentSelectRow.classList.remove('hidden');
            else tournamentSelectRow.classList.add('hidden');
        });
    }

    // tournaments link
    const tlink = document.getElementById('nav-tournaments');
    if (tlink) tlink.addEventListener('click', (ev) => { ev.preventDefault(); window.location.hash = 'tournaments'; });

    // footer nav highlight wiring
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Auth state
    AuthService.onStateChanged(user => {
        renderUserArea(user);
        if (user) attachTournamentSubscription(user.uid);
        handleRoute();
    });

    // create match button wiring
    document.getElementById('btn-create-match')?.addEventListener('click', () => window.location.hash = 'create');

    // Hash change routing
    window.addEventListener('hashchange', handleRoute);

    // Initial route
    handleRoute();
});

/* ROUTER */
function handleRoute(){
    const hash = window.location.hash.slice(1);
    document.querySelectorAll('.view').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));

    if (!hash) {
        document.getElementById('view-landing').classList.remove('hidden');
    } else if (hash === 'login') {
        document.getElementById('view-login').classList.remove('hidden');
    } else if (hash === 'dashboard' || hash === 'home') {
        document.getElementById('view-dashboard').classList.remove('hidden');
        loadRecentMatches();
        activateNav('home');
    } else if (hash === 'create') {
        document.getElementById('view-create').classList.remove('hidden');
        populateTournamentSelect();
        activateNav('home');
    } else if (hash.startsWith('toss/')) {
        currentMatchId = hash.split('/')[1];
        setupTossView(currentMatchId);
        activateNav('home');
    } else if (hash.startsWith('match/')) {
        currentMatchId = hash.split('/')[1];
        initMatchView(currentMatchId, false);
        activateNav('home');
    } else if (hash.startsWith('watch/')) {
        currentMatchId = hash.split('/')[1];
        initMatchView(currentMatchId, true);
        activateNav('home');
    } else if (hash === 'tournaments') {
        document.getElementById('view-tournaments').classList.remove('hidden');
        renderTournamentsList();
        activateNav('tournaments');
    } else if (hash.startsWith('tournament/')) {
        const tid = hash.split('/')[1];
        document.getElementById('view-tournaments').classList.remove('hidden');
        renderTournamentMatches(tid);
        activateNav('tournaments');
    } else if (hash === 'profile') {
        renderProfileView();
        activateNav('profile');
    } else {
        document.getElementById('view-landing').classList.remove('hidden');
    }
}

function activateNav(tab) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    if (tab === 'home') document.getElementById('nav-home')?.classList.add('active');
    else if (tab === 'tournaments') document.getElementById('nav-tournaments')?.classList.add('active');
    else if (tab === 'profile') document.getElementById('nav-profile')?.classList.add('active');
}

/* UI HELPERS */
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

/* AUTH / USER AREA */
function renderUserArea(user) {
    const ua = document.getElementById('connection-status');
    const footerUser = document.getElementById('view-profile-placeholder');
    if (ua) {
        ua.innerHTML = '';
        if (!user) ua.innerText = '';
        else ua.innerText = user.email || 'Guest';
    }
}

/* TOURNAMENT SUBSCRIPTION & UI */
function attachTournamentSubscription(userId) {
    if (unsubscribeTournaments) unsubscribeTournaments();
    unsubscribeTournaments = DataService.subscribeToTournaments(userId, (arr) => {
        tournamentsList = arr;
        populateTournamentSelect();
        if (window.location.hash.slice(1) === 'tournaments') renderTournamentsList();
    });
}

function populateTournamentSelect() {
    const sel = document.getElementById('match-tournament-select');
    if (!sel) return;
    sel.innerHTML = `<option value="">-- None --</option>`;
    (tournamentsList || []).forEach(t => sel.add(new Option(t.name, t.id)));
}

function openCreateTournamentModal() {
    const user = AuthService.getCurrentUser();
    if (!user) { showToast('Sign in to create tournaments', 'error'); return; }
    document.getElementById('create-tournament-modal').classList.remove('hidden');
}
function closeCreateTournamentModal() { document.getElementById('create-tournament-modal').classList.add('hidden'); }

async function confirmCreateTournament() {
    const name = document.getElementById('tournament-name-input').value.trim();
    if (!name) { showToast('Enter tournament name', 'error'); return; }
    try {
        const id = await DataService.createTournament({ name });
        if (!id) {
            showToast('Tournament creation failed — sign in required or permission denied.', 'error');
            return;
        }
        showToast('Tournament created', 'success');
        document.getElementById('tournament-name-input').value = '';
        document.getElementById('create-tournament-modal').classList.add('hidden');
        window.location.hash = `tournament/${id}`;
    } catch (err) {
        console.error('createTournament failed', err);
        showToast('Failed to create tournament: ' + (err.message || err), 'error');
    }
}

/* RECENT MATCHES FOR DASHBOARD */
async function loadRecentMatches() {
    const container = document.getElementById('recent-matches-list');
    container.innerHTML = '<div class="muted">Loading...</div>';
    try {
        const snap = await db.collection('matches').orderBy('createdAt', 'desc').limit(10).get();
        container.innerHTML = '';
        snap.forEach(doc => {
            const m = { id: doc.id, ...doc.data() };
            const node = document.createElement('div');
            node.className = 'team-card';
            node.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center">
                                <div>
                                  <div style="font-weight:800">${m.title}</div>
                                  <div class="sub-text">${m.venue} • ${m.date || ''}</div>
                                </div>
                                <div style="display:flex;gap:8px">
                                  <button class="secondary-btn" onclick="window.location.hash='match/${m.id}'">Open</button>
                                  <button class="secondary-btn" onclick="window.location.hash='watch/${m.id}'">Share (view)</button>
                                </div>
                              </div>`;
            container.appendChild(node);
        });
    } catch (err) {
        console.error(err);
        container.innerHTML = '<div class="muted">Failed to load matches</div>';
    }
}

/* CREATE MATCH FLOW */
window.parsePlayers = (team) => {
    const raw = document.getElementById(`${team}-players-raw`).value;
    const names = raw.split(/\n|,/).map(n => n.trim()).filter(n => n);
    if (names.length < 2) { showToast("Please enter at least 2 players", 'error'); return; }

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

    const assignToTournament = document.getElementById('assign-to-tournament-toggle')?.checked;
    const selectedTournament = assignToTournament ? (document.getElementById('match-tournament-select')?.value || null) : null;

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
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        tournamentId: selectedTournament || null
    };

    const id = await DataService.createMatch(matchData);
    if (id) {
        showToast('Match created', 'success');
        window.location.hash = `toss/${id}`;
    } else {
        showToast('Failed to create match. Sign in required.', 'error');
    }
};

/* TOSS LOGIC */
async function setupTossView(matchId){
    document.getElementById('view-toss').classList.remove('hidden');
    const doc = await db.collection('matches').doc(matchId).get();
    const data = doc.data();
    if (data.status === 'live' || data.status === 'completed') { window.location.hash = `match/${matchId}`; return; }
    const container = document.getElementById('toss-winner-options');
    container.innerHTML = `<button class="toss-btn" onclick="selectTossWinner('teamA', this)">${data.teams.teamA.name}</button>
                           <button class="toss-btn" onclick="selectTossWinner('teamB', this)">${data.teams.teamB.name}</button>`;
    currentMatchDataLocal = data;
    currentMatchData = data;
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

    const playerStats = {};
    currentMatchData.teams.teamA.players.forEach(p => { playerStats[p] = { runs:0, balls:0, fours:0, sixes:0, out:false, outInfo:null }; });
    currentMatchData.teams.teamB.players.forEach(p => { if(!playerStats[p]) playerStats[p] = { runs:0, balls:0, fours:0, sixes:0, out:false, outInfo:null }; });

    const bowlers = {};
    currentMatchData.teams[bowlingTeamKey].players.forEach(p => { bowlers[p] = { runs:0, wickets:0, overs:0, maidens:0, ballsInCurrentOver:0 }; });

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

/* PROCESS EVENT & INNINGS-END HANDLING */
async function processEvent(event) {
    if (!currentMatchData || !currentMatchId) { showToast("No active match loaded.", 'error'); return null; }

    // Block scoring during innings break
    if (currentMatchData.status === 'innings_break') {
        showToast("Innings break — start next innings to continue scoring.", 'info');
        return null;
    }

    // Permission check
    const user = AuthService.getCurrentUser();
    if (!user || user.uid !== currentMatchData.creatorId) {
        showToast("You don't have permission to score this match.", 'error');
        return null;
    }

    if (currentMatchData.status === 'completed' || (currentMatchData.liveScore && currentMatchData.liveScore.matchCompleted)) {
        showToast("Match already completed. Scoring disabled.", 'info');
        return null;
    }

    const lastSnapshot = currentMatchData.liveScore ? JSON.parse(JSON.stringify(currentMatchData.liveScore)) : null;

    const result = CricketEngine.processBall(currentMatchData, event);

   // Normalize recentBalls to objects (compat)
    if (result.liveScore && Array.isArray(result.liveScore.recentBalls)) {
        result.liveScore.recentBalls = result.liveScore.recentBalls.map(b => {
            if (typeof b === 'string') {
                if (b === 'WD' || b === 'NB' || b === 'W' || b === 'B' || b === 'LB') {
                    return { type: b, runs: 0, label: b };
                }
                if (b === '4') return { type: 'legal', runs: 4, label: '4' };
                if (b === '6') return { type: 'legal', runs: 6, label: '6' };
                const n = parseInt(b,10);
                if (!isNaN(n)) return { type: 'legal', runs: n, label: `${n}` };
                return { type: 'legal', runs: 0, label: b };
            }
            return b;
        });
    }

    result.logEntry.meta = result.logEntry.meta || {};
    result.logEntry.meta.bowler = (currentMatchData.liveScore && currentMatchData.liveScore.bowler) || null;
    result.logEntry.meta.striker = (currentMatchData.liveScore && currentMatchData.liveScore.striker) || null;

    const updateObj = {
        liveScore: result.liveScore,
        lastSnapshot: lastSnapshot,
        history: firebase.firestore.FieldValue.arrayUnion(result.logEntry)
    };

    await DataService.updateMatch(currentMatchId, updateObj);

    // INNINGS-END HANDLING
    if (result.inningsEnded) {
        const doc = await db.collection('matches').doc(currentMatchId).get();
        const fullMatch = { id: doc.id, ...doc.data() };
        const prevLS = fullMatch.liveScore || {};

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

        if ((prevLS.innings || 1) === 1 && !result.matchCompleted) {
            const prevRuns = prevLS.runs || 0;
            const target = prevRuns + 1;
            const battingTeamKey = prevLS.bowlingTeam;
            const bowlingTeamKey = prevLS.battingTeam;

            startInningsPendingPayload = { fullMatch, battingTeamKey, bowlingTeamKey, target, prevRuns };

            await DataService.updateMatch(currentMatchId, {
                status: 'innings_break',
                history: firebase.firestore.FieldValue.arrayUnion({ type: 'inningsEnd', previousRuns: prevRuns, time: (new Date()).toISOString(), note: `Innings ${inningsSummary.innings} ended. Target ${target}` })
            });

            openStartInningsModal(startInningsPendingPayload);
            showToast(`Innings ${inningsSummary.innings} ended. Target for next team: ${target}. Choose openers.`, 'info');

        } else {
            const finalLS = prevLS;
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
    }

    return result;
}

/* RECORD SCORE ENTRY */
window.recordScore = async (runs, type = 'legal') => {
    const extraTypes = ['WD','NB','B','LB'];
    if (extraTypes.includes(type)) {
        openExtraModal(type);
        return;
    }

    const result = await processEvent({ runs, type });
    if (!result) return;

    if (result.overCompleted && !result.inningsEnded && !result.wicketOccurred) {
        const doc = await db.collection('matches').doc(currentMatchId).get();
        const fresh = { id: doc.id, ...doc.data() };
        const freshLS = fresh.liveScore || {};
        const tmp = freshLS.striker;
        freshLS.striker = freshLS.nonStriker;
        freshLS.nonStriker = tmp;
        await DataService.updateMatch(currentMatchId, { liveScore: freshLS });
        setTimeout(() => openChangeBowlerModal(true), 200);
    } else {
        if (result.overCompleted && !result.inningsEnded) {
            setTimeout(() => openChangeBowlerModal(true), 200);
        }
    }
};

/* EXTRA MODAL */
function openExtraModal(type) {
    extraModalPendingType = type;
    const title = document.getElementById('extra-modal-title');
    const note = document.getElementById('extra-modal-note');
    const input = document.getElementById('extra-run-input');

    title.innerText = `Extra: ${type}`;
    note.innerText = `Enter runs (these will be credited to striker). For NB/Wide, 1 extra will be added automatically in addition to runs entered.`;
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

    const result = await processEvent({ runs: val, type: type });
    if (!result) return;

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

/* WICKET FLOW */
window.openWicketModal = () => {
    if (!currentMatchData) { showToast("Match not loaded.", 'error'); return; }
    const ls = currentMatchData.liveScore;
    if (!ls) { showToast("Live score not available.", 'error'); return; }
    const battingTeamKey = ls.battingTeam;
    const battingTeam = currentMatchData.teams[battingTeamKey];
    const allPlayers = battingTeam.players || [];

    // used players = those out OR currently at crease
    const used = new Set();
    Object.entries(ls.playerStats || {}).forEach(([p, st]) => { if (st && st.out) used.add(p); });
    if (ls.striker) used.add(ls.striker);
    if (ls.nonStriker) used.add(ls.nonStriker);

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

    const result = await processEvent({ runs: 0, type: 'W', dismissal });
    if (!result) return;

    if (newBatter) {
        const doc = await db.collection('matches').doc(currentMatchId).get();
        const fresh = { id: doc.id, ...doc.data() };
        const freshLS = fresh.liveScore || {};

        if (!result.inningsEnded) {
            if (result.overCompleted) {
                const prevNonStriker = freshLS.nonStriker;
                freshLS.striker = prevNonStriker;
                freshLS.nonStriker = newBatter;
                if (!freshLS.playerStats[newBatter]) freshLS.playerStats[newBatter] = { runs:0,balls:0,fours:0,sixes:0,out:false,outInfo:null };
            } else {
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

    if (result.overCompleted && !result.inningsEnded) setTimeout(() => openChangeBowlerModal(true), 200);
    if (result.inningsEnded) showToast('Innings ended.', 'info');
};

/* BOWLER CHANGE */
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

/* UNDO */
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

/* SHARE (viewer-only link) */
window.shareMatch = () => {
    if (!currentMatchId) { showToast("No match to share.", 'error'); return; }
    const url = window.location.origin + window.location.pathname + `#watch/${currentMatchId}`;
    if (navigator.share) {
        navigator.share({ title: document.getElementById('live-match-title').innerText || 'Match', text: 'Live score (viewer link)', url })
            .catch(err => { navigator.clipboard?.writeText(url).then(()=>showToast("Viewer link copied to clipboard.", 'success')); });
    } else if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(()=>{ showToast("Viewer link copied to clipboard.", 'success'); }).catch(()=>{ prompt("Copy this viewer link:", url); });
    } else { prompt("Copy this viewer link:", url); }
};

/* START INNINGS MODAL */
function openStartInningsModal(payload) {
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

/* RENDER LIVE SCORE */
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

    // top section
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

    // This over visuals
    const thisOverDiv = document.getElementById('this-over-balls');
    const ballsArr = ls.recentBalls || [];
    thisOverDiv.innerHTML = ballsArr.slice(-6).map(b => {
        if (!b) return '';
        if (typeof b === 'string') return `<span class="ball-badge">${b}</span>`;
        const classes = ['ball-badge'];
        if (b.type === 'legal' && b.runs === 4) classes.push('boundary-4');
        if (b.type === 'legal' && b.runs === 6) classes.push('boundary-6');
        if (['WD','NB','B','LB'].includes(b.type)) classes.push('extra-badge');
        if (b.type === 'W') classes.push('wicket-badge');
        return `<span class="${classes.join(' ')}">${b.label}</span>`;
    }).join(' ');

    // Target banner & dynamic runs/balls remaining
    const targetBanner = document.getElementById('target-banner');
    const targetLine1 = document.getElementById('target-banner-line1');
    const targetLine2 = document.getElementById('target-banner-line2');

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

/* FULL SCORECARDS */
function renderFullScorecards(match) {
    const container = document.getElementById('full-scorecards');
    container.innerHTML = '';

    (match.innings || []).forEach((inn, idx) => {
        container.appendChild(createProfessionalInningsTable(inn, idx + 1));
    });

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

    const extras = getExtrasSummary(inn.playerStats);
    const extrasRow = document.createElement('tr');
    extrasRow.innerHTML =
        `<td colspan="2" class="extras-label">Extras</td>
         <td colspan="5" class="extras-val">${extras.text}</td>`;
    batTbody.appendChild(extrasRow);

    const totalRow = document.createElement('tr');
    totalRow.className = 'total-row';
    totalRow.innerHTML =
        `<td colspan="2">TOTAL</td>
         <td colspan="5" class="total-val">${inn.runs || 0} / ${inn.wickets || 0} in ${inn.overs} overs</td>`;
    batTbody.appendChild(totalRow);

    wrap.appendChild(batTable);

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
    return { text: '0 (no breakdown available)' };
}

/* TOURNAMENT UI */
function renderTournamentsList() {
    const list = document.getElementById('tournaments-list');
    list.innerHTML = '';
    (tournamentsList || []).forEach(t => {
        const node = document.createElement('div');
        node.className = 'tournament-card';
        node.innerHTML = `<div><strong>${t.name}</strong><div class="muted">Created: ${t.createdAt ? new Date(t.createdAt.seconds*1000).toLocaleString() : '-'}</div></div>
                          <div><button class="secondary-btn" onclick="viewTournament('${t.id}')">View</button></div>`;
        list.appendChild(node);
    });
}

function viewTournament(tid) {
    window.location.hash = `tournament/${tid}`;
}

function renderTournamentMatches(tid) {
    const matchesContainer = document.getElementById('tournament-matches');
    matchesContainer.innerHTML = `<div class="muted">Loading matches for tournament...</div>`;

    if (unsubscribeTournamentMatches) unsubscribeTournamentMatches();
    unsubscribeTournamentMatches = DataService.subscribeToTournamentMatches(tid, (matches) => {
        matchesContainer.innerHTML = '';
        if (!matches || matches.length === 0) {
            matchesContainer.innerHTML = `<div class="muted">No matches yet in this tournament.</div>`;
            return;
        }
        matches.forEach(m => {
            const div = document.createElement('div');
            div.className = 'team-card';
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.style.alignItems = 'center';
            div.innerHTML = `<div>
                                <div style="font-weight:800">${m.title}</div>
                                <div class="sub-text">${m.venue} • ${m.date || ''}</div>
                             </div>
                             <div style="display:flex;gap:8px">
                                <button class="secondary-btn" onclick="window.location.hash='match/${m.id}'">Open</button>
                                <button class="secondary-btn" onclick="window.location.hash='watch/${m.id}'">Share (view)</button>
                             </div>`;
            matchesContainer.appendChild(div);
        });
    });
}

/* PROFILE VIEW */
function renderProfileView() {
    // create profile view if missing
    let profileView = document.getElementById('view-profile');
    if (!profileView) {
        profileView = document.createElement('section');
        profileView.id = 'view-profile';
        profileView.className = 'view';
        profileView.innerHTML = `<div class="profile-card">
            <h3>Profile</h3>
            <div id="profile-rows"></div>
            <div style="margin-top:12px">
                <button class="primary-btn" id="btn-change-password">Change Password</button>
                <button class="secondary-btn" id="btn-signout">Sign Out</button>
            </div>
        </div>`;
        document.getElementById('main-container').appendChild(profileView);

        document.getElementById('btn-change-password').onclick = async () => {
            const newPass = prompt('Enter new password (min 6 chars):');
            if (!newPass) return;
            try {
                const user = AuthService.getCurrentUser();
                if (!user) { showToast('Not signed in', 'error'); return; }
                await user.updatePassword(newPass);
                showToast('Password changed', 'success');
            } catch (err) {
                console.error(err);
                showToast('Password change failed: ' + (err.message || err), 'error');
            }
        };
        document.getElementById('btn-signout').onclick = async () => {
            try {
                await AuthService.signOut();
                showToast('Signed out', 'info');
                window.location.hash = '';
            } catch (err) {
                console.error(err);
                showToast('Sign out failed', 'error');
            }
        };
    }

    const user = AuthService.getCurrentUser();
    const rows = document.getElementById('profile-rows');
    if (user) {
        rows.innerHTML = `<div class="profile-row"><div>Email</div><div>${user.email || 'Anonymous'}</div></div>
                          <div class="profile-row"><div>UID</div><div>${user.uid}</div></div>`;
    } else {
        rows.innerHTML = `<div class="muted">No user signed in.</div>`;
    }

    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    profileView.classList.remove('hidden');
}

/* NAV helper */
window.navigateTab = (tab) => {
    if (tab === 'dashboard') window.location.hash = 'dashboard';
    else if (tab === 'tournaments') window.location.hash = 'tournaments';
    else if (tab === 'profile') window.location.hash = 'profile';
};

/* Expose tournament modal handlers globally (index.html uses them) */
window.openCreateTournamentModal = openCreateTournamentModal;
window.closeCreateTournamentModal = closeCreateTournamentModal;
window.confirmCreateTournament = confirmCreateTournament;

/* END OF FILE */
