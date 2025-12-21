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
        // Defensive: get current liveScore (could be undefined for new match)
        let ls = JSON.parse(JSON.stringify(matchState.liveScore || {}));
        const matchOversLimit = (matchState.overs || (matchState.liveScore && matchState.liveScore.matchOvers) || 0);

        const runs = event.runs || 0;
        const type = event.type || 'legal'; // legal, WD, NB, W, B, LB

        // Helper: compute current balls in over (0..5)
        function getBallsFromDecimal(oversDecimal) {
            const whole = Math.floor(oversDecimal);
            const frac = Math.round((oversDecimal - whole) * 10);
            return { whole, balls: frac };
        }

        // Ensure structures exist
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

        // ensure matchOvers set for convenience
        ls.matchOvers = matchOversLimit;

        // Build playerStats for known players if possible
        try {
            const battingPlayers = (matchState.teams && matchState.teams[ls.battingTeam] && matchState.teams[ls.battingTeam].players) || [];
            battingPlayers.forEach(p => {
                if (!ls.playerStats[p]) ls.playerStats[p] = { runs: 0, balls: 0, fours: 0, sixes: 0, out: false, outInfo: null };
            });
            const bowlingPlayers = (matchState.teams && matchState.teams[ls.bowlingTeam] && matchState.teams[ls.bowlingTeam].players) || [];
            bowlingPlayers.forEach(p => {
                if (!ls.bowlers[p]) ls.bowlers[p] = { runs: 0, wickets: 0, overs: 0, maidens: 0, ballsInCurrentOver: 0 };
            });
        } catch (e) {
            // nothing
        }

        // Ensure current bowler entry
        const currentBowler = ls.bowler;
        if (currentBowler && !ls.bowlers[currentBowler]) {
            ls.bowlers[currentBowler] = { runs: 0, wickets: 0, overs: 0, maidens: 0, ballsInCurrentOver: 0 };
        }
        const bowlerStats = currentBowler ? ls.bowlers[currentBowler] : null;

        // Compute current over state
        let { whole: oversWhole, balls: ballsInOver } = getBallsFromDecimal(ls.overs || 0);

        // Team score update
        let totalRuns = runs;
        if (type === 'WD' || type === 'NB') totalRuns += 1;
        ls.runs = (ls.runs || 0) + totalRuns;

        // Determine which delivery types are "legal" for ball counting:
        // As requested: 'legal', 'LB', and importantly 'W' (wicket) count as legal deliveries.
        const isLegalDelivery = (type === 'legal' || type === 'LB' || type === 'W');

        // Batter stats: increment balls faced for legal deliveries only
        if (isLegalDelivery) {
            if (ls.striker) {
                ls.playerStats[ls.striker].balls = (ls.playerStats[ls.striker].balls || 0) + 1;
            }
        }

        // Add runs to striker for delivery types where runs were entered (we credit the striker with the entered runs)
        if (ls.striker && (type === 'legal' || type === 'NB' || type === 'WD' || type === 'B' || type === 'LB' || type === 'W')) {
            // For wickets, runs may be 0 typically; this still credits any extra entered (if any)
            ls.playerStats[ls.striker].runs = (ls.playerStats[ls.striker].runs || 0) + runs;
            if (runs === 4) ls.playerStats[ls.striker].fours = (ls.playerStats[ls.striker].fours || 0) + 1;
            if (runs === 6) ls.playerStats[ls.striker].sixes = (ls.playerStats[ls.striker].sixes || 0) + 1;
        }

        // Bowler stats
        if (bowlerStats) {
            // Bowler is not charged for byes or leg-byes in standard scoring
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
        // Advance balls at match level only for legal deliveries (legal + LB + W)
        if (isLegalDelivery) {
            ballsInOver++;
            if (ballsInOver === 6) {
                oversWhole = oversWhole + 1;
                ballsInOver = 0;
                overCompleted = true;
                ls.overs = oversWhole;
                // swap strike at over end
                const tmp = ls.striker;
                ls.striker = ls.nonStriker;
                ls.nonStriker = tmp;
            } else {
                ls.overs = oversWhole + ballsInOver * 0.1;
                ls.overs = Math.round(ls.overs * 10) / 10;
            }
        }

        // Wickets
        let wicketOccurred = false;
        if (type === 'W') {
            wicketOccurred = true;
            ls.wickets = (ls.wickets || 0) + 1;
            const outPlayer = ls.striker;
            if (outPlayer && ls.playerStats[outPlayer]) {
                ls.playerStats[outPlayer].out = true;
                ls.playerStats[outPlayer].outInfo = event.dismissal || { mode: 'unknown' };
            }
            // Keep striker until caller replaces or innings end
        }

        // Rotate strike for odd runs
        if ((type === 'legal' || type === 'NB' || type === 'WD' || type === 'B' || type === 'LB') && (runs % 2 !== 0)) {
            const tmp = ls.striker;
            ls.striker = ls.nonStriker;
            ls.nonStriker = tmp;
        }

        // Recent balls / badge
        let ballStr = runs.toString();
        if (type === 'WD') ballStr = 'WD';
        if (type === 'NB') ballStr = 'NB';
        if (type === 'W') ballStr = 'W';
        if (runs === 4) ballStr = '4';
        if (runs === 6) ballStr = '6';

        ls.recentBalls = ls.recentBalls || [];
        ls.recentBalls.push(ballStr);
        if (ls.recentBalls.length > 30) ls.recentBalls = ls.recentBalls.slice(-30);

        if (overCompleted) {
            // Reset this-over visuals
            ls.recentBalls = [];
        }

        // Check innings end conditions
        let inningsEnded = false;
        let matchCompleted = false;

        // overs-based (if overs exhausted at over end)
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

        // chase-based check (only meaningful in innings 2)
        const target = (ls.target || (matchState.liveScore && matchState.liveScore.target) || matchState.target) || null;
        if (ls.innings === 2 && target !== null) {
            if (ls.runs >= target) {
                // target achieved -> end innings and match
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

        return {
            liveScore: ls,
            logEntry,
            overCompleted,
            wicketOccurred,
            inningsEnded,
            matchCompleted,
            ballBadge: ballStr
        };
    }
};
