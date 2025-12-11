import { initializeApp, getApps, getApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

const app = getApps().length > 0 ? getApp() : initializeApp({
  projectId,
  storageBucket,
  ...(serviceAccountKey ? { credential: cert(JSON.parse(serviceAccountKey)) } : {}),
});

const db = getFirestore(app);
const storage = getStorage(app);

export { db, storage };
