// public/firebase-service.js
// Initialize Firebase (Replace with your own config)
const firebaseConfig = {
  apiKey: "AIzaSyArSAU4igEY7LKfx-G2kE8kEj9msssK9hs",
  authDomain: "cric-scorer-fc6ab.firebaseapp.com",
  databaseURL: "https://cric-scorer-fc6ab-default-rtdb.firebaseio.com",
  projectId: "cric-scorer-fc6ab",
  storageBucket: "cric-scorer-fc6ab.firebasestorage.app",
  messagingSenderId: "763007551778",
  appId: "1:763007551778:web:c876262a3cff1fee813d7b"
};

const app = firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// Allow offline persistence
db.enablePersistence().catch(err => console.log("Persistence error", err));

const AuthService = {
    signInAnonymously: () => auth.signInAnonymously(),
    getCurrentUser: () => auth.currentUser,
    onStateChanged: (cb) => auth.onAuthStateChanged(cb),
    signInWithEmail: (email, password) => auth.signInWithEmailAndPassword(email, password),
    createUserWithEmail: (email, password) => auth.createUserWithEmailAndPassword(email, password),
    signOut: () => auth.signOut()
};

const DataService = {
    createMatch: async (matchData) => {
        const user = auth.currentUser;
        if (!user) return null;

        const docRef = await db.collection('matches').add({
            ...matchData,
            creatorId: user.uid,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            history: [],
            innings: [],
            status: 'created'
        });
        return docRef.id;
    },

    // Realtime Listener
    subscribeToMatch: (matchId, callback) => {
        return db.collection('matches').doc(matchId)
            .onSnapshot(doc => {
                if (doc.exists) callback({ id: doc.id, ...doc.data() });
            });
    },

    updateMatch: (matchId, data) => {
        return db.collection('matches').doc(matchId).update(data);
    },

    // helper to push to innings array
    pushInningsSummary: (matchId, inningsSummary) => {
        return db.collection('matches').doc(matchId).update({
            innings: firebase.firestore.FieldValue.arrayUnion(inningsSummary)
        });
    },

    // Tournaments
    createTournament: async (tournament) => {
        const user = auth.currentUser;
        if (!user) return null;
        // Most projects require non-anonymous user for creating persistent resources.
        // We still attempt to create; if Firestore rules block it the caller will catch the error.
        const docRef = await db.collection('tournaments').add({
            ...tournament,
            creatorId: user.uid,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        return docRef.id;
    },

    subscribeToTournaments: (userId, callback) => {
        return db.collection('tournaments').where('creatorId', '==', userId)
            .orderBy('createdAt', 'desc')
            .onSnapshot(snap => {
                const arr = [];
                snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
                callback(arr);
            });
    },

    subscribeToTournamentMatches: (tournamentId, callback) => {
        return db.collection('matches').where('tournamentId', '==', tournamentId)
            .orderBy('createdAt', 'desc')
            .onSnapshot(snap => {
                const arr = [];
                snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
                callback(arr);
            });
    }
};
