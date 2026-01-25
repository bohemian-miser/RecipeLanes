import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, Auth, User, connectAuthEmulator, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, Firestore, connectFirestoreEmulator, doc, setDoc, updateDoc, collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { getStorage, FirebaseStorage, connectStorageEmulator } from 'firebase/storage';
import { getFunctions, Functions, connectFunctionsEmulator } from 'firebase/functions';

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
let db: Firestore;
let storage: FirebaseStorage;
let functions: Functions;
let googleProvider: GoogleAuthProvider;
let isInitialized = false;

if (firebaseConfig.apiKey) {
  // Initialize Firebase (Client)
  app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);
  functions = getFunctions(app, 'us-central1');
  
  if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true') {
      connectAuthEmulator(auth, 'http://127.0.0.1:9099');
      connectFirestoreEmulator(db, 'localhost', 8080);
      connectStorageEmulator(storage, 'localhost', 9199);
      connectFunctionsEmulator(functions, 'localhost', 5001);
  }

  googleProvider = new GoogleAuthProvider();
  isInitialized = true;
   // Expose for E2E testing                                                                                                                                                                                                                           
   if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {                                                                                                                                                                       
       (window as any)._firebaseAuth = auth;
       (window as any)._firebaseDb = db;
       (window as any)._firebaseFirestore = { doc, setDoc, updateDoc, collection, getDocs, query, orderBy, limit };
       (window as any)._signInWithCustomToken = signInWithCustomToken;                                                                                                                                                                                 
   }
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
  
  db = {} as Firestore;
  storage = {} as FirebaseStorage;
  functions = {} as Functions;
  
  googleProvider = {} as GoogleAuthProvider;
}

export { auth, db, storage, functions, googleProvider, isInitialized };
