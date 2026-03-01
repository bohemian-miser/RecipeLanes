/*
 * Copyright (C) 2026 Bohemian Miser <https://substack.com/@bohemianmiser>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

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