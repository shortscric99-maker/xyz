const CricketEngine = {
    // Calculates new state based on current state and event
    processBall: (matchState, event) => {
        let { liveScore, history } = matchState;
        
        // Deep copy to avoid direct mutation issues
        let newState = JSON.parse(JSON.stringify(liveScore));
        
        const runs = event.runs || 0; // 0,1,2,3,4,6
        const isWide = event.type === 'WD';
        const isNoBall = event.type === 'NB';
        const isWicket = event.type === 'W';
        const isBye = event.type === 'B' || event.type === 'LB';
        
        // 1. Update Team Score
        let ballRuns = runs;
        if (isWide || isNoBall) ballRuns += 1; // Extra run
        
        newState.runs += ballRuns;

        // 2. Update Balls/Overs
        if (!isWide && !isNoBall) {
            // Valid ball
            let balls = Math.round((newState.overs % 1) * 10);
            balls++;
            if (balls === 6) {
                newState.overs = Math.floor(newState.overs) + 1;
                // Swap strike at end of over
                [newState.striker, newState.nonStriker] = [newState.nonStriker, newState.striker];
            } else {
                newState.overs = Math.floor(newState.overs) + (balls / 10);
            }
        }

        // 3. Wickets
        if (isWicket) {
            newState.wickets += 1;
            // Logic to replace striker would happen in UI prompt, 
            // here we just mark the wicket count
        }

        // 4. Rotate Strike (Runs)
        // If runs are odd, swap (unless it's a boundary 4/6 which are even usually, but handling runnings)
        // Note: Logic simplifies if we assume boundary=4/6 no run, run=1/2/3
        if ((runs % 2 !== 0)) {
             [newState.striker, newState.nonStriker] = [newState.nonStriker, newState.striker];
        }

        // 5. Update History
        const logEntry = {
            ball: newState.overs,
            runs: runs,
            event: event.type || 'legal',
            bowler: newState.bowler,
            striker: newState.striker
        };
        
        return {
            liveScore: newState,
            logEntry: logEntry
        };
    }
};
