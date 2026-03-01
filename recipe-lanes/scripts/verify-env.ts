import { isFirebaseEnabled } from '../lib/firebase-admin';

console.log('FIREBASE_AUTH_EMULATOR_HOST:', process.env.FIREBASE_AUTH_EMULATOR_HOST);
console.log('isFirebaseEnabled:', isFirebaseEnabled);
