// Initialize Firebase (Replace with your own config)
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "...",
  appId: "..."
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
