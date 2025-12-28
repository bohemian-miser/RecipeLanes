import { initializeApp, getApps, getApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getAuth, connectAuthEmulator, signInWithCustomToken } from 'firebase-admin/auth';

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

let credential;
if (serviceAccountKey) {
  try {
    credential = cert(JSON.parse(serviceAccountKey));
  } catch (e) {
    console.warn('Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY, falling back to default credentials:', e);
  }
}

// 1. Force Admin SDK to talk to the Emulator
if (process.env.STORAGE_EMULATOR_HOST) {
    process.env.FIREBASE_STORAGE_EMULATOR_HOST = process.env.STORAGE_EMULATOR_HOST;
}
if (process.env.FIRESTORE_EMULATOR_HOST) {
    process.env.FIREBASE_FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;
}
if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
}

// Enable Firebase if explicit keys exist, OR if running in production, OR if Project ID is present (ADC), OR if Emulators are active
export const isFirebaseEnabled = !!(serviceAccountKey || process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.NODE_ENV === 'production' || projectId || process.env.FIREBASE_AUTH_EMULATOR_HOST);

const app = getApps().length > 0 ? getApp() : initializeApp({
  projectId,
  storageBucket,
  ...(credential ? { credential } : {}),
});

// 1. Initialize App
const db = getFirestore(app);
const storage = getStorage(app);
const auth = getAuth(app);


// import * as admin from 'firebase-admin';

// 1. Force the Environment Variable BEFORE initialization
// The Admin SDK looks for this variable internally.
if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true') {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'; // Optional: if you use Firestore
  console.log("🔥 Admin SDK switching to Emulator mode via Env Vars");
}


// // 2. Connect to Emulators (Crucial Step!)
// // We check a specific env var or NODE_ENV
// if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true') {
//   // Note: 'localhost' usually works, but '127.0.0.1' is safer for node/browser consistency
//   connectAuthEmulator(auth, "http://127.0.0.1:9099");
//   console.log("🔥 Connected to Auth Emulator");
// }

// 3. Expose Helper for Playwright (The "Backdoor")
if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
  (window as any)._firebaseTestHelp = { 
    auth, 
    signInWithCustomToken 
  };
  console.log('🧪 Firebase testing helpers exposed on window._firebaseTestHelp');
}
;
export { db, storage, auth };
