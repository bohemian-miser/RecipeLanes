import { initializeApp, getApps, getApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getAuth } from 'firebase-admin/auth';

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

// Force the Environment Variable BEFORE initialization (Restored support for NEXT_PUBLIC_USE_FIREBASE_EMULATOR)
if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true') {
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  if (!process.env.FIRESTORE_EMULATOR_HOST) process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  if (!process.env.FIREBASE_STORAGE_EMULATOR_HOST) process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199';
  console.log("🔥 Admin SDK switching to Emulator mode via Env Vars");
}

export { db, storage, auth };
