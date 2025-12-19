// public/cricket.js
const CricketEngine = {
    /**
     * processBall(matchState, event)
     * event: { runs: number, type: 'legal'|'WD'|'NB'|'W'|'B'|'LB', dismissal?: {mode, fielder}, metadata?: {} }
     *
     * Returns:
     * {
     *   liveScore: <newLiveScore>,
     *   logEntry: <entry to push to history>,
     *   overCompleted: boolean,
     *   wicketOccurred: boolean,
     *   inningsEnded: boolean,
     *   ballBadge: string
     * }
     */
    processBall: (matchState, event) => {
        // Deep copy to avoid mutating incoming object
        let ls = JSON.parse(JSON.stringify(matchState.liveScore || {}));
        const matchOversLimit = matchState.overs || 0;

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

        // If no bowler object exists for current bowler, ensure it exists
        if (ls.bowler && !ls.bowlers[ls.bowler]) {
            ls.bowlers[ls.bowler] = { runs: 0, wickets: 0, overs: 0, maidens: 0, ballsInCurrentOver: 0 };
        }

        // Make sure all batting team players have a stats object if available in matchState
        try {
            const battingPlayers = (matchState.teams && matchState.teams[ls.battingTeam] && matchState.teams[ls.battingTeam].players) || [];
            battingPlayers.forEach(p => {
                if (!ls.playerStats[p]) ls.playerStats[p] = { runs: 0, balls: 0, fours: 0, sixes: 0, out: false, outInfo: null };
            });

            // Also ensure bowlers map for bowling team
            const bowlingPlayers = (matchState.teams && matchState.teams[ls.bowlingTeam] && matchState.teams[ls.bowlingTeam].players) || [];
            bowlingPlayers.forEach(p => {
                if (!ls.bowlers[p]) ls.bowlers[p] = { runs: 0, wickets: 0, overs: 0, maidens: 0, ballsInCurrentOver: 0 };
            });
        } catch (e) {
            // ignore if structure missing
        }

        // Get current bowler stats reference
        const currentBowler = ls.bowler;
        const bowlerStats = currentBowler ? ls.bowlers[currentBowler] : null;

        // Compute current over state
        let { whole: oversWhole, balls: ballsInOver } = getBallsFromDecimal(ls.overs || 0);

        // --- 1. Team Score ---
        let totalRuns = runs;
        if (type === 'WD' || type === 'NB') totalRuns += 1;
        ls.runs = (ls.runs || 0) + totalRuns;

        // --- 2. Batter Stats ---
        // Wides don't count as balls faced.
        if (type !== 'WD') {
            // Increment ball faced for striker for legal, NB, W, B, LB
            if (ls.striker) {
                ls.playerStats[ls.striker].balls = (ls.playerStats[ls.striker].balls || 0) + 1;
            }
        }

        // Runs attribution to batter
        if (type === 'legal' || type === 'NB') {
            if (ls.striker) {
                ls.playerStats[ls.striker].runs = (ls.playerStats[ls.striker].runs || 0) + runs;
                if (runs === 4) ls.playerStats[ls.striker].fours = (ls.playerStats[ls.striker].fours || 0) + 1;
                if (runs === 6) ls.playerStats[ls.striker].sixes = (ls.playerStats[ls.striker].sixes || 0) + 1;
            }
        }

        // --- 3. Bowler Stats ---
        if (bowlerStats) {
            // Bowler concedes runs (except pure byes/legbyes: type B or LB do not count as bowler runs)
            if (type !== 'B' && type !== 'LB') {
                bowlerStats.runs = (bowlerStats.runs || 0) + totalRuns;
            }

            // If it's a legal ball (treat NB as legal here in terms of ball count)
            if (type !== 'WD') {
                bowlerStats.ballsInCurrentOver = (bowlerStats.ballsInCurrentOver || 0) + 1;
                // We also update aggregate overs representation similarly to match-level
                if (bowlerStats.ballsInCurrentOver === 6) {
                    bowlerStats.overs = Math.floor((bowlerStats.overs || 0)) + 1;
                    bowlerStats.ballsInCurrentOver = 0;
                } else {
                    // add 0.1 for display like 0.1 .. 0.5
                    bowlerStats.overs = (bowlerStats.overs || 0) + 0.1;
                    // avoid floating accumulation error by rounding to 1 decimal
                    bowlerStats.overs = Math.round(bowlerStats.overs * 10) / 10;
                }
            }

            // If wicket, increment bowler wicket counter
            if (type === 'W') {
                bowlerStats.wickets = (bowlerStats.wickets || 0) + 1;
            }
        }

        let overCompleted = false;
        // Legal balls count for over (we treat NB as counting as ball here)
        if (type !== 'WD') {
            ballsInOver++;
            if (ballsInOver === 6) {
                // Over complete
                oversWhole = oversWhole + 1;
                ballsInOver = 0;
                overCompleted = true;

                // increment bowler overs at match level already handled; ensure match-level bowler overs consistent
                if (bowlerStats) {
                    // bowlerStats.overs increment handled above; ensure integer if ended
                    // reset ballsInCurrentOver already handled above
                }

                // Represent match-level overs as whole number
                ls.overs = oversWhole;

                // Swap striker/non-striker at over end
                const tempName = ls.striker;
                ls.striker = ls.nonStriker;
                ls.nonStriker = tempName;
            } else {
                // partial over -> represent as decimal 0.1 .. 0.5
                ls.overs = oversWhole + ballsInOver * 0.1;
                // round to 1 decimal
                ls.overs = Math.round(ls.overs * 10) / 10;
            }
        }

        // --- 4. Wickets ---
        let wicketOccurred = false;
        if (type === 'W') {
            wicketOccurred = true;
            ls.wickets = (ls.wickets || 0) + 1;

            // increment bowler wicket handled above
            // Mark striker as out in playerStats
            const outPlayer = ls.striker;
            if (outPlayer && ls.playerStats[outPlayer]) {
                ls.playerStats[outPlayer].out = true;
                ls.playerStats[outPlayer].outInfo = event.dismissal || { mode: 'unknown' };
            }

            // Reset striker placeholder (new batter to be inserted by caller)
            ls.strikerStats = { runs: 0, balls: 0, fours: 0, sixes: 0 }; // backward compat
            // keep ls.striker value for log; caller should replace with new batter
        }

        // --- 5. Rotate Strike (Odd Runs for legal/NB) ---
        if ((type === 'legal' || type === 'NB') && (runs % 2 !== 0)) {
            const tempName = ls.striker;
            ls.striker = ls.nonStriker;
            ls.nonStriker = tempName;
        }

        // --- 6. Recent Balls String / Badge ---
        let ballStr = runs.toString();
        if (type === 'WD') ballStr = 'WD';
        if (type === 'NB') ballStr = 'NB';
        if (type === 'W') ballStr = 'W';
        if (runs === 4) ballStr = '4';
        if (runs === 6) ballStr = '6';

        ls.recentBalls = ls.recentBalls || [];
        ls.recentBalls.push(ballStr);
        // keep last 30 for safety
        if (ls.recentBalls.length > 30) ls.recentBalls = ls.recentBalls.slice(-30);

        // Reset this-over badges if over completed
        if (overCompleted) {
            ls.recentBalls = [];
        }

        // --- 7. Check innings end by overs or all out ---
        let inningsEnded = false;
        // Overs-based
        if (overCompleted && (oversWhole >= matchOversLimit) && matchOversLimit > 0) {
            inningsEnded = true;
        }

        // All-out: wickets equal players - 1
        try {
            const playersCount = (matchState.teams && matchState.teams[ls.battingTeam] && matchState.teams[ls.battingTeam].players.length) || 11;
            if (ls.wickets >= Math.max(0, playersCount - 1)) inningsEnded = true;
        } catch (e) {
            // ignore
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
            ballBadge: ballStr
        };
    }
};
