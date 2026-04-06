import * as admin from 'firebase-admin';

export const PROJECT_ID = 'recipe-lanes-staging';

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require('../../staging-service-account.json')),
    projectId: PROJECT_ID,
  });
}

export const db = admin.firestore();
