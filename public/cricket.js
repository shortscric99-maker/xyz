const CricketEngine = {
    processBall: (matchState, event) => {
        let ls = JSON.parse(JSON.stringify(matchState.liveScore)); // Deep copy
        
        const runs = event.runs || 0;
        const type = event.type || 'legal'; // legal, WD, NB, W, B, LB
        
        // --- 1. Team Score ---
        let totalRuns = runs;
        if (type === 'WD' || type === 'NB') totalRuns += 1;
        ls.runs += totalRuns;

        // --- 2. Batter Stats ---
        // Wides don't count as balls faced. No Balls count as balls faced but runs go to bat if hit?
        // Simplified: Wides = 0 balls, Legal/NB/W = 1 ball
        if (type !== 'WD') {
            ls.strikerStats.balls += 1;
        }

        // Runs attribution
        if (type === 'legal' || type === 'NB') {
            ls.strikerStats.runs += runs;
            if (runs === 4) ls.strikerStats.fours++;
            if (runs === 6) ls.strikerStats.sixes++;
        }
        // Byes/Legbyes don't add to batter runs

        // --- 3. Bowler Stats ---
        // Bowler concedes runs (except byes/legbyes)
        if (type !== 'B' && type !== 'LB') {
            ls.bowlerStats.runs += totalRuns;
        }
        
        // Legal balls count for over
        if (type !== 'WD' && type !== 'NB') {
            // Add 0.1 to over count (decimal math logic needed)
            let balls = Math.round((ls.bowlerStats.overs % 1) * 10);
            balls++;
            if (balls === 6) {
                ls.bowlerStats.overs = Math.floor(ls.bowlerStats.overs) + 1;
                ls.overs = Math.floor(ls.overs) + 1;
                // Swap Ends at over end
                [ls.striker, ls.nonStriker] = [ls.nonStriker, ls.striker];
                [ls.strikerStats, ls.nonStrikerStats] = [ls.nonStrikerStats, ls.strikerStats];
            } else {
                ls.bowlerStats.overs += 0.1;
                ls.overs += 0.1;
            }
        }

        // --- 4. Wickets ---
        if (type === 'W') {
            ls.wickets++;
            ls.bowlerStats.wickets++;
            // Reset stats for new batter would happen here in full version
            // For now, we just reset the striker name in UI via prompt or next logic
            ls.strikerStats = { runs: 0, balls: 0, fours: 0, sixes: 0 }; 
        }

        // --- 5. Rotate Strike (Odd Runs) ---
        if (runs % 2 !== 0) {
            [ls.striker, ls.nonStriker] = [ls.nonStriker, ls.striker];
            [ls.strikerStats, ls.nonStrikerStats] = [ls.nonStrikerStats, ls.strikerStats];
        }

        // --- 6. Recent Balls String ---
        let ballStr = runs.toString();
        if (type === 'WD') ballStr = 'WD';
        if (type === 'NB') ballStr = 'NB';
        if (type === 'W') ballStr = 'W';
        if (runs === 4) ballStr = '4';
        if (runs === 6) ballStr = '6';

        ls.recentBalls.push(ballStr);

        return {
            liveScore: ls,
            logEntry: { ...event, over: ls.overs }
        };
    }
};
