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
     *   ballBadge: string
     * }
     */
    processBall: (matchState, event) => {
        let ls = JSON.parse(JSON.stringify(matchState.liveScore)); // Deep copy

        const runs = event.runs || 0;
        const type = event.type || 'legal'; // legal, WD, NB, W, B, LB

        // Helper: compute current balls in over (0..5)
        function getBallsFromDecimal(oversDecimal) {
            const whole = Math.floor(oversDecimal);
            const frac = Math.round((oversDecimal - whole) * 10);
            return { whole, balls: frac };
        }

        let { whole: oversWhole, balls: ballsInOver } = getBallsFromDecimal(ls.overs || 0);

        // --- 1. Team Score ---
        let totalRuns = runs;
        if (type === 'WD' || type === 'NB') totalRuns += 1;
        ls.runs = (ls.runs || 0) + totalRuns;

        // --- 2. Batter Stats ---
        // Wides don't count as balls faced. No Balls treated as legal for runs attribution here.
        if (type !== 'WD') {
            // Increment ball faced for striker for legal, NB, W, B, LB (simplified)
            ls.strikerStats.balls = (ls.strikerStats.balls || 0) + 1;
        }

        // Runs attribution to batter
        if (type === 'legal' || type === 'NB') {
            ls.strikerStats.runs = (ls.strikerStats.runs || 0) + runs;
            if (runs === 4) ls.strikerStats.fours = (ls.strikerStats.fours || 0) + 1;
            if (runs === 6) ls.strikerStats.sixes = (ls.strikerStats.sixes || 0) + 1;
        }

        // --- 3. Bowler Stats ---
        // Bowler concedes runs (except pure byes/legbyes)
        if (type !== 'B' && type !== 'LB') {
            ls.bowlerStats.runs = (ls.bowlerStats.runs || 0) + totalRuns;
        }

        let overCompleted = false;
        // Legal balls count for over (we treat NB as counting as ball here as per simplified rule above)
        if (type !== 'WD') {
            ballsInOver++;
            if (ballsInOver === 6) {
                // Over complete
                oversWhole = oversWhole + 1;
                ballsInOver = 0;
                overCompleted = true;

                // increment bowler overs as whole
                ls.bowlerStats.overs = Math.floor((ls.bowlerStats.overs || 0)) + 1;
                ls.overs = oversWhole; // whole number for completed overs

                // Swap strike at over end
                const tempName = ls.striker;
                ls.striker = ls.nonStriker;
                ls.nonStriker = tempName;

                const tempStats = ls.strikerStats;
                ls.strikerStats = ls.nonStrikerStats;
                ls.nonStrikerStats = tempStats;
            } else {
                // partial over -> represent as decimal 0.1 .. 0.5
                ls.bowlerStats.overs = (ls.bowlerStats.overs || 0) + 0.1;
                ls.overs = oversWhole + ballsInOver * 0.1;
            }
        }

        // --- 4. Wickets ---
        let wicketOccurred = false;
        if (type === 'W') {
            wicketOccurred = true;
            ls.wickets = (ls.wickets || 0) + 1;
            ls.bowlerStats.wickets = (ls.bowlerStats.wickets || 0) + 1;

            // Reset striker's personal stats (new batter will be set by caller)
            ls.strikerStats = { runs: 0, balls: 0, fours: 0, sixes: 0 };
        }

        // --- 5. Rotate Strike (Odd Runs for legal/NB) ---
        if ((type === 'legal' || type === 'NB') && (runs % 2 !== 0)) {
            const tempName = ls.striker;
            ls.striker = ls.nonStriker;
            ls.nonStriker = tempName;

            const tempStats = ls.strikerStats;
            ls.strikerStats = ls.nonStrikerStats;
            ls.nonStrikerStats = tempStats;
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
            ballBadge: ballStr
        };
    }
};
