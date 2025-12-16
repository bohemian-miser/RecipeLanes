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

// Enable Firebase if explicit keys exist OR if running in production (assuming ADC)
export const isFirebaseEnabled = !!(serviceAccountKey || process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.NODE_ENV === 'production');

const app = getApps().length > 0 ? getApp() : initializeApp({
  projectId,
  storageBucket,
  ...(credential ? { credential } : {}),
});

const db = getFirestore(app);
const storage = getStorage(app);
const auth = getAuth(app);

export { db, storage, auth };
