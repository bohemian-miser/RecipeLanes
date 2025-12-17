import 'dotenv/config';
import { db, storage, isFirebaseEnabled } from '../lib/firebase-admin';
import { ai, textModel } from '../lib/genkit';

async function verifyEnvironment() {
  console.log('=== Environment Verification ===');
  console.log(`Firebase Enabled: ${isFirebaseEnabled}`);
  
  if (!isFirebaseEnabled) {
      console.warn('⚠️  Firebase is DISABLED. Using Mock Data Service logic by default.');
      console.warn('   (Set FIREBASE_SERVICE_ACCOUNT_KEY or login with gcloud to enable)');
  }

  // 1. Test Firestore
  if (isFirebaseEnabled) {
      console.log('\n[1] Testing Firestore Connection...');
      try {
          const collections = await db.listCollections();
          console.log(` ✅ Success! Found ${collections.length} collections.`);
      } catch (e: any) {
          console.error(' ❌ Failed:', e.message);
          if (JSON.stringify(e).includes('invalid_grant')) {
              console.error('    -> YOUR CREDENTIALS HAVE EXPIRED. Run: gcloud auth application-default login');
          }
      }
  }

  // 2. Test Storage
  if (isFirebaseEnabled) {
      console.log('\n[2] Testing Storage Connection...');
      try {
          const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
          if (!bucketName) throw new Error('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET is missing');
          
          const [files] = await storage.bucket(bucketName).getFiles({ maxResults: 1 });
          console.log(` ✅ Success! Connected to bucket: ${bucketName}`);
      } catch (e: any) {
          console.error(' ❌ Failed:', e.message);
      }
  }

  // 3. Test Gemini AI
  console.log('\n[3] Testing Gemini AI Connection...');
  try {
      if (!process.env.GEMINI_API_KEY) {
           console.warn(' ⚠️  GEMINI_API_KEY is missing. AI will use Mock or fail.');
      } else {
          const response = await ai.generate({
              model: textModel,
              prompt: 'Hello, world!',
          });
          console.log(` ✅ Success! AI replied: "${response.text?.slice(0, 20)}"...`);
      }
  } catch (e: any) {
      console.error(' ❌ Failed:', e.message);
  }
  
  console.log('\n=== Verification Complete ===');
}

verifyEnvironment();
