import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, Auth, User } from 'firebase/auth';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let app: FirebaseApp | undefined;
let auth: Auth;
let googleProvider: GoogleAuthProvider;
let isInitialized = false;

if (firebaseConfig.apiKey) {
  // Initialize Firebase (Client)
  app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  auth = getAuth(app);
  googleProvider = new GoogleAuthProvider();
  isInitialized = true;
} else {
  console.warn('Firebase Client SDK missing API Key (likely during build). Using mock auth.');
  // Mock Auth for Build Time
  auth = {
    app: { name: 'mock', options: {} } as FirebaseApp,
    config: {},
    onAuthStateChanged: (cb: (user: User | null) => void) => {
        // Immediately resolve to null user during build/mock
        cb(null);
        return () => {};
    },
    currentUser: null,
  } as unknown as Auth;
  
  googleProvider = {} as GoogleAuthProvider;
}

export { auth, googleProvider, isInitialized };
