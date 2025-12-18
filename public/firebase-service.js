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
    onStateChanged: (cb) => auth.onAuthStateChanged(cb)
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
    }
};
