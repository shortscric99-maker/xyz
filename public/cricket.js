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
     *   inningsCompleted: boolean,
     *   ballBadge: string
     * }
     */
    processBall: (matchState, event) => {
        let ls = JSON.parse(JSON.stringify(matchState.liveScore || {})); // Deep copy
        if (!ls) ls = {};

        const runs = event.runs || 0;
        const type = event.type || 'legal'; // legal, WD, NB, W, B, LB

        // Ensure fields
        ls.runs = ls.runs || 0;
        ls.wickets = ls.wickets || 0;
        ls.overs = ls.overs || 0;
        ls.recentBalls = ls.recentBalls || [];
        ls.ballsTotal = ls.ballsTotal || 0; // total legal balls bowled in the innings
        ls.bowlerStatsMap = ls.bowlerStatsMap || {}; // per-bowler cumulative stats
        ls.outPlayers = ls.outPlayers || [];

        const currentBowler = ls.bowler || null;

        // Helper: compute current over representation from ballsTotal
        function ballsToOvers(balls) {
            const whole = Math.floor(balls / 6);
            const rem = balls % 6;
            return +(whole + rem * 0.1).toFixed(1); // e.g., 1.2
        }

        // --- 1. Team Score ---
        let totalRuns = runs;
        if (type === 'WD' || type === 'NB') totalRuns += 1;
        ls.runs = (ls.runs || 0) + totalRuns;

        // --- 2. Batter Stats & ball counting ---
        // Wides don't count as legal ball. NB treated as legal ball for counting here (matches earlier behavior).
        let legalBall = (type !== 'WD');

        if (legalBall) {
            ls.ballsTotal = (ls.ballsTotal || 0) + 1;
        }

        // Runs attribution to batter
        if (type === 'legal' || type === 'NB') {
            ls.strikerStats = ls.strikerStats || { runs: 0, balls: 0, fours: 0, sixes: 0 };
            ls.strikerStats.runs = (ls.strikerStats.runs || 0) + runs;
            ls.strikerStats.balls = (ls.strikerStats.balls || 0) + (legalBall ? 1 : 0);
            if (runs === 4) ls.strikerStats.fours = (ls.strikerStats.fours || 0) + 1;
            if (runs === 6) ls.strikerStats.sixes = (ls.strikerStats.sixes || 0) + 1;
        } else if (type !== 'WD') {
            // other legal types (W, B, LB) still count as ball faced for striker in simplified model we used earlier
            if (!ls.strikerStats) ls.strikerStats = { runs: 0, balls: 0, fours: 0, sixes: 0 };
            ls.strikerStats.balls = (ls.strikerStats.balls || 0) + 1;
        }

        // --- 3. Update current bowler's per-player stats ---
        if (currentBowler) {
            if (!ls.bowlerStatsMap[currentBowler]) {
                ls.bowlerStatsMap[currentBowler] = { runs: 0, wickets: 0, balls: 0, overs: 0, maidens: 0 };
            }
            const bstats = ls.bowlerStatsMap[currentBowler];
            // Add runs conceded for legal runs and extras except byes/legbyes (B/LB)
            if (type !== 'B' && type !== 'LB') {
                bstats.runs = (bstats.runs || 0) + totalRuns;
            }
            if (legalBall) {
                bstats.balls = (bstats.balls || 0) + 1;
                // convert to overs (like 1.2) for display convenience
                bstats.overs = ballsToOvers(bstats.balls);
            }
        }

        // --- 4. Wickets ---
        let wicketOccurred = false;
        if (type === 'W') {
            wicketOccurred = true;
            ls.wickets = (ls.wickets || 0) + 1;
            if (currentBowler) {
                ls.bowlerStatsMap[currentBowler].wickets = (ls.bowlerStatsMap[currentBowler].wickets || 0) + 1;
            }
            // push striker to outPlayers (caller may update further with dismissal meta)
            if (ls.striker) ls.outPlayers.push(ls.striker);

            // reset striker stats; caller will set replacement name in app logic
            ls.strikerStats = { runs: 0, balls: 0, fours: 0, sixes: 0 };
        }

        // --- 5. Rotate Strike (Odd Runs for legal/NB) ---
        if ((type === 'legal' || type === 'NB') && (runs % 2 !== 0)) {
            const tempName = ls.striker;
            ls.striker = ls.nonStriker;
            ls.nonStriker = tempName;

            const tempStats = ls.strikerStats;
            ls.strikerStats = ls.nonStrikerStats || { runs: 0, balls: 0, fours: 0, sixes: 0 };
            ls.nonStrikerStats = tempStats || { runs: 0, balls: 0, fours: 0, sixes: 0 };
        }

        // --- 6. Recent Balls String / Badge ---
        let ballStr = runs.toString();
        if (type === 'WD') ballStr = 'WD';
        if (type === 'NB') ballStr = 'NB';
        if (type === 'W') ballStr = 'W';
        if (runs === 4) ballStr = '4';
        if (runs === 6) ballStr = '6';

        ls.recentBalls.push(ballStr);

        // --- 7. Over completion detection ---
        let overCompleted = false;
        // derive partial over as decimal from ballsTotal
        ls.overs = ballsToOvers(ls.ballsTotal || 0);

        if (legalBall) {
            // if ballsTotal % 6 == 0 => over complete
            if ((ls.ballsTotal % 6) === 0) {
                overCompleted = true;

                // Clear recent balls for the new over
                ls.recentBalls = [];

                // For current bowler, their completed overs count is already in bstats.overs. We can update maidens calculation later.
            }
        }

        // --- 8. Innings completion detection ---
        const matchOvers = (matchState && matchState.overs) ? parseInt(matchState.overs, 10) : null;
        let inningsCompleted = false;
        if (matchOvers !== null) {
            const maxBalls = matchOvers * 6;
            if ((ls.ballsTotal || 0) >= maxBalls || (ls.wickets || 0) >= 10) {
                inningsCompleted = true;
            }
        }

        const logEntry = {
            type,
            runs,
            totalRuns,
            overRepresentation: ls.overs,
            ballsTotal: ls.ballsTotal,
            time: (new Date()).toISOString(),
            meta: event.dismissal ? { dismissal: event.dismissal } : {}
        };

        return {
            liveScore: ls,
            logEntry,
            overCompleted,
            wicketOccurred,
            inningsCompleted,
            ballBadge: ballStr
        };
    }
};
