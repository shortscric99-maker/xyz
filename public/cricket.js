// public/cricket.js
const CricketEngine = {
    /**
     * processBall(matchState, event)
     * event: { runs: number, type: 'legal'|'WD'|'NB'|'W'|'B'|'LB', dismissal?: {mode, fielder} }
     *
     * Returns:
     * {
     *   liveScore: <newLiveScore>,
     *   logEntry: <entry to push to history>,
     *   overCompleted: boolean,
     *   wicketOccurred: boolean,
     *   inningsEnded: boolean,
     *   matchCompleted: boolean,
     *   ballBadge: string
     * }
     */
    processBall: (matchState, event) => {
        // Defensive copy of liveScore
        let ls = JSON.parse(JSON.stringify(matchState.liveScore || {}));
        const matchOversLimit = (matchState.overs || (matchState.liveScore && matchState.liveScore.matchOvers) || 0);

        const runs = Number(event.runs || 0);
        const type = event.type || 'legal'; // legal, WD, NB, W, B, LB

        function getBallsFromDecimal(oversDecimal) {
            const whole = Math.floor(oversDecimal);
            const frac = Math.round((oversDecimal - whole) * 10);
            return { whole, balls: frac };
        }

        // ensure structures
        ls.recentBalls = ls.recentBalls || [];
        ls.playerStats = ls.playerStats || {};
        ls.bowlers = ls.bowlers || {};
        ls.bowler = ls.bowler || ls.currentBowler || null;
        ls.striker = ls.striker || null;
        ls.nonStriker = ls.nonStriker || null;
        ls.overs = ls.overs || 0;
        ls.runs = ls.runs || 0;
        ls.wickets = ls.wickets || 0;
        ls.innings = ls.innings || 1;
        ls.matchOvers = matchOversLimit;

        // Ensure players present in stats
        try {
            const battingPlayers = (matchState.teams && matchState.teams[ls.battingTeam] && matchState.teams[ls.battingTeam].players) || [];
            battingPlayers.forEach(p => {
                if (!ls.playerStats[p]) ls.playerStats[p] = { runs: 0, balls: 0, fours: 0, sixes: 0, out: false, outInfo: null };
            });
            const bowlingPlayers = (matchState.teams && matchState.teams[ls.bowlingTeam] && matchState.teams[ls.bowlingTeam].players) || [];
            bowlingPlayers.forEach(p => {
                if (!ls.bowlers[p]) ls.bowlers[p] = { runs: 0, wickets: 0, overs: 0, maidens: 0, ballsInCurrentOver: 0 };
            });
        } catch (e) {}

        const currentBowler = ls.bowler;
        if (currentBowler && !ls.bowlers[currentBowler]) {
            ls.bowlers[currentBowler] = { runs: 0, wickets: 0, overs: 0, maidens: 0, ballsInCurrentOver: 0 };
        }
        const bowlerStats = currentBowler ? ls.bowlers[currentBowler] : null;

        // parse overs to whole + balls
        let { whole: oversWhole, balls: ballsInOver } = getBallsFromDecimal(ls.overs || 0);

        // compute team runs (note: NB/WD add +1 extra automatically)
        let totalRuns = runs;
        if (type === 'WD' || type === 'NB') totalRuns += 1;
        ls.runs = (ls.runs || 0) + totalRuns;

        // Save pre-delivery striker to correctly mark dismissals
        const preStriker = ls.striker;
        // Identify legal deliveries for ball counting: legal, LB, W (wicket counted as legal)
        const isLegalDelivery = (type === 'legal' || type === 'LB' || type === 'W');

        // Batter balls: only increment on legal deliveries
        if (isLegalDelivery && preStriker) {
            ls.playerStats[preStriker].balls = (ls.playerStats[preStriker].balls || 0) + 1;
        }

        // Credit striker with runs (user wanted extra runs credited to striker)
        if (preStriker && ['legal','NB','WD','B','LB','W'].includes(type)) {
            ls.playerStats[preStriker].runs = (ls.playerStats[preStriker].runs || 0) + runs;
            if (runs === 4) ls.playerStats[preStriker].fours = (ls.playerStats[preStriker].fours || 0) + 1;
            if (runs === 6) ls.playerStats[preStriker].sixes = (ls.playerStats[preStriker].sixes || 0) + 1;
        }

        // Bowler stats
        if (bowlerStats) {
            // Bowler charged with runs except for byes/legbyes (typical scoring)
            if (type !== 'B' && type !== 'LB') {
                bowlerStats.runs = (bowlerStats.runs || 0) + totalRuns;
            }
            // increment bowler's balls only for legal deliveries (legal + LB + W)
            if (isLegalDelivery) {
                bowlerStats.ballsInCurrentOver = (bowlerStats.ballsInCurrentOver || 0) + 1;
                if (bowlerStats.ballsInCurrentOver === 6) {
                    bowlerStats.overs = Math.floor((bowlerStats.overs || 0)) + 1;
                    bowlerStats.ballsInCurrentOver = 0;
                } else {
                    bowlerStats.overs = (bowlerStats.overs || 0) + 0.1;
                    bowlerStats.overs = Math.round(bowlerStats.overs * 10) / 10;
                }
            }
            if (type === 'W') {
                bowlerStats.wickets = (bowlerStats.wickets || 0) + 1;
            }
        }

        let overCompleted = false;
        // Advance match level balls/overs only for legal deliveries (legal + LB + W)
        if (isLegalDelivery) {
            ballsInOver++;
            if (ballsInOver === 6) {
                oversWhole = oversWhole + 1;
                ballsInOver = 0;
                overCompleted = true;
                ls.overs = oversWhole;
            } else {
                ls.overs = oversWhole + ballsInOver * 0.1;
                ls.overs = Math.round(ls.overs * 10) / 10;
            }
        }

        // Wickets: mark the PRE-DELIVERY striker as out
        let wicketOccurred = false;
        if (type === 'W') {
            wicketOccurred = true;
            ls.wickets = (ls.wickets || 0) + 1;
            const outPlayer = preStriker;
            if (outPlayer && ls.playerStats[outPlayer]) {
                ls.playerStats[outPlayer].out = true;
                ls.playerStats[outPlayer].outInfo = event.dismissal || { mode: 'unknown' };
            }
            // Do not change ls.striker here — caller (app.js) will set replacement appropriately
        }

        // Rotate strike for odd runs (when striker credited runs)
        if ((type === 'legal' || type === 'NB' || type === 'WD' || type === 'B' || type === 'LB') && (runs % 2 !== 0)) {
            const tmp = ls.striker;
            ls.striker = ls.nonStriker;
            ls.nonStriker = tmp;
        }

        // Build ball label for visual
        let label = '';
        const extras = ['WD','NB','B','LB'];
        if (extras.includes(type)) {
            label = type + (runs > 0 ? `+${runs}` : '');
        } else if (type === 'W') {
            label = 'W';
            if (runs > 0) label = `W+${runs}`;
        } else {
            label = `${runs}`;
        }

        // Push object to recentBalls so renderer can style properly
        ls.recentBalls = ls.recentBalls || [];
        ls.recentBalls.push({
            type,
            runs,
            label
        });
        if (ls.recentBalls.length > 30) ls.recentBalls = ls.recentBalls.slice(-30);

        if (overCompleted) {
            // Reset this-over visuals (UI will perform actual strike swap logic)
            ls.recentBalls = [];
        }

        // Check innings end conditions
        let inningsEnded = false;
        let matchCompleted = false;

        // overs-based (only at over completion)
        if (overCompleted && (oversWhole >= matchOversLimit) && matchOversLimit > 0) {
            inningsEnded = true;
        }

        // all-out check: innings ends when wickets >= playersCount - 1
        try {
            const playersCount = (matchState.teams && matchState.teams[ls.battingTeam] && matchState.teams[ls.battingTeam].players.length) || 11;
            if (ls.wickets >= Math.max(0, playersCount - 1)) {
                inningsEnded = true;
            }
        } catch (e) {}

        // chase-based check for innings 2
        const target = (ls.target || (matchState.liveScore && matchState.liveScore.target) || matchState.target) || null;
        if (ls.innings === 2 && target !== null) {
            if (ls.runs >= target) {
                inningsEnded = true;
                matchCompleted = true;
            }
        }

        const logEntry = {
            type,
            runs,
            totalRuns,
            over: ls.overs,
            time: (new Date()).toISOString(),
            meta: event.dismissal ? { dismissal: event.dismissal } : {}
        };

        // For backward compatibility, provide ballBadge string (label)
        return {
            liveScore: ls,
            logEntry,
            overCompleted,
            wicketOccurred,
            inningsEnded,
            matchCompleted,
            ballBadge: label
        };
    }
};
