import 'dotenv/config';
import { db, storage } from '../lib/firebase-admin';

async function backfillMetadata() {
  console.log('Starting Metadata Backfill...');
  
  const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'recipe-lanes.firebasestorage.app';
  const bucket = storage.bucket(bucketName);

  // 1. Iterate all ingredients
  const ingredientsSnapshot = await db.collection('ingredients').get();
  console.log(`Found ${ingredientsSnapshot.size} ingredients.`);

  let totalUpdated = 0;

  for (const ingDoc of ingredientsSnapshot.docs) {
      const ingredientName = ingDoc.data().name;
      const iconsSnapshot = await ingDoc.ref.collection('icons').get();
      
      for (const iconDoc of iconsSnapshot.docs) {
          const data = iconDoc.data();
          const url = data.url;
          
          if (!url || !url.includes('firebasestorage')) continue;

          try {
              // Extract path
              // URL: https://firebasestorage.googleapis.com/v0/b/[bucket]/o/[path]?alt=media...
              // Path is encoded.
              const matches = url.match(new RegExp('/o/([^?]+)'));
              if (matches && matches[1]) {
                  const filePath = decodeURIComponent(matches[1]);
                  const file = bucket.file(filePath);
                  
                  const [metadata] = await file.getMetadata();
                  const existingCustom = metadata.metadata || {};
                  
                  // Check if needs update
                  if (!existingCustom.lcb || !existingCustom.fullPrompt) {
                      const updateData = {
                          lcb: String(data.popularity_score || 0),
                          impressions: String(data.impressions || 0),
                          rejections: String(data.rejections || 0),
                          fullPrompt: data.fullPrompt || data.imagePrompt || '',
                          visualDescription: data.visualDescription || ingredientName
                      };
                      
                      await file.setMetadata({ metadata: updateData });
                      console.log(`Updated metadata for ${filePath}`);
                      totalUpdated++;
                  }
              }
          } catch (e) {
              console.error(`Failed to update ${url}:`, e);
          }
      }
  }

  console.log(`Backfill Complete. Updated ${totalUpdated} files.`);
}

backfillMetadata();
