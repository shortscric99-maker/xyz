const CricketEngine = {
    processBall: (matchState, event) => {
        let ls = JSON.parse(JSON.stringify(matchState.liveScore));
        
        const runs = event.runs || 0;
        const type = event.type || 'legal';
        const wDetails = event.wicketDetails || null;

        // 1. Extras
        let totalRuns = runs;
        if (type === 'WD' || type === 'NB') {
            totalRuns += 1;
            ls.extras = (ls.extras || 0) + 1;
        }
        ls.runs += totalRuns;

        // 2. Batter Stats
        if (type !== 'WD') {
            ls.strikerStats.balls += 1;
            ls.bowlerStats.overs += 0.1; // Raw count, formatting happens later
        }

        if (type === 'legal' || type === 'NB') {
            ls.strikerStats.runs += runs;
            if (runs === 4) ls.strikerStats.fours++;
            if (runs === 6) ls.strikerStats.sixes++;
        }

        // 3. Bowler Stats
        if (type !== 'B' && type !== 'LB') {
            ls.bowlerStats.runs += totalRuns;
        }

        // 4. Wicket Handling
        if (type === 'W' && wDetails) {
            ls.wickets++;
            ls.bowlerStats.wickets++;
            
            // Log dismissal
            ls.recentBalls.push("W");

            // Handle who is out
            if (wDetails.whoOut === 'nonStriker' || (wDetails.wicketKind === 'runout' && wDetails.whoOut === 'nonStriker')) {
                // Non striker out
                ls.nonStriker = wDetails.newBatter;
                ls.nonStrikerStats = { runs: 0, balls: 0, fours: 0, sixes: 0 };
            } else {
                // Striker out (Bowled, Caught, etc)
                ls.striker = wDetails.newBatter;
                ls.strikerStats = { runs: 0, balls: 0, fours: 0, sixes: 0 };
            }
        } else {
            // Log regular ball
            let ballStr = runs.toString();
            if (type === 'WD') ballStr = 'WD';
            if (type === 'NB') ballStr = 'NB';
            ls.recentBalls.push(ballStr);
        }

        // 5. Overs Check & Rotation
        // Fix Decimal Math (0.1 + 0.2 = 0.30004)
        let ballsInOver = Math.round((ls.bowlerStats.overs % 1) * 10);
        
        if (ballsInOver >= 6) {
            ls.overs = Math.floor(ls.overs) + 1;
            ls.bowlerStats.overs = Math.floor(ls.bowlerStats.overs) + 1;
            
            // Swap Ends
            [ls.striker, ls.nonStriker] = [ls.nonStriker, ls.striker];
            [ls.strikerStats, ls.nonStrikerStats] = [ls.nonStrikerStats, ls.strikerStats];
        } else {
            // Just update overs display e.g. 1.2
            ls.overs = Math.floor(ls.overs) + (ballsInOver / 10);
        }

        // Rotate Strike on Odd Runs
        if (runs % 2 !== 0) {
            [ls.striker, ls.nonStriker] = [ls.nonStriker, ls.striker];
            [ls.strikerStats, ls.nonStrikerStats] = [ls.nonStrikerStats, ls.strikerStats];
        }

        return { liveScore: ls, logEntry: { ...event, over: ls.overs } };
    }
};
