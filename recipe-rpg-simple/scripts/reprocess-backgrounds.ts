import { processIcon } from '../functions/src/image-processing';
import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import { applyIconToNode, clearNodeIcon, getNodeIconId, getNodeIconUrl, hasNodeIcon } from './recipe-lanes/model-utils';

async function reprocessIcons() {
    const args = process.argv.slice(2);
    const stagingIndex = args.indexOf('--staging');
    
    if (stagingIndex !== -1) {
        console.log('✨ Switching to STAGING environment (.env.staging)...');
        dotenv.config({ path: '.env.staging', override: true });
    } else {
        dotenv.config();
    }

    console.log('[DEBUG] Environment State:');
    console.log(`  - Project ID: ${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}`);
    console.log(`  - Service Account Key Present: ${!!process.env.FIREBASE_SERVICE_ACCOUNT_KEY}`);
    console.log(`  - GOOGLE_APPLICATION_CREDENTIALS: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`);
    console.log(`  - Emulator Host: ${process.env.FIRESTORE_EMULATOR_HOST}`);

    // Dynamic import
    const { db, storage } = await import('../lib/firebase-admin');

    const nIndex = args.indexOf('-n');
    let limit = 0;
    if (nIndex !== -1 && args[nIndex + 1]) {
        limit = parseInt(args[nIndex + 1], 10);
    }
    const isDryRun = args.includes('--dry-run');

    console.log(`Starting icon reprocessing... ${limit > 0 ? `(Limit: ${limit} random)` : '(All)'} ${isDryRun ? '(Dry Run)' : ''}`);
    
    // Create debug directory
    const debugDir = path.join(process.cwd(), 'debug', 'reprocess-examples');
    await fs.mkdir(debugDir, { recursive: true });
    console.log(`Saving examples to: ${debugDir}`);

    // 0. Pre-fetch Recipes to build an index (IconID -> RecipeIDs)
    console.log('Fetching recipes to build index...');
    const recipesSnap = await db.collection('recipes').get();
    const iconToRecipesMap = new Map<string, FirebaseFirestore.DocumentSnapshot[]>();
    
    let recipeCount = 0;
    recipesSnap.forEach(doc => {
        const data = doc.data();
        if (data.graph && data.graph.nodes) {
            data.graph.nodes.forEach((node: any) => {
                if (getNodeIconId(node)) {
                    if (!iconToRecipesMap.has(getNodeIconId(node))) {
                        iconToRecipesMap.set(getNodeIconId(node), []);
                    }
                    // Avoid duplicates if multiple nodes use same icon
                    const list = iconToRecipesMap.get(getNodeIconId(node))!;
                    if (!list.find(r => r.id === doc.id)) {
                        list.push(doc);
                    }
                }
            });
        }
        recipeCount++;
    });
    console.log(`Indexed ${recipeCount} recipes. Found references for ${iconToRecipesMap.size} unique icons.`);

    // 1. Get all icons
    const snapshot = await db.collectionGroup('icons').get();
    let docs = snapshot.docs;
    console.log(`Found ${docs.length} total icons.`);

    if (limit > 0) {
        // Shuffle
        for (let i = docs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [docs[i], docs[j]] = [docs[j], docs[i]];
        }
        docs = docs.slice(0, limit);
        console.log(`Selected ${docs.length} random icons.`);
    }

    for (const doc of docs) {
        const data = doc.data();
        const url = data.url;
        
        if (!url) {
            console.log(`Skipping ${doc.id} (no url)`);
            continue;
        }

        // Skip if already processed? Maybe we want to force re-tokenization if the URL is broken.
        // if (data.processed_transparent) { ... }
        
        console.log(`Processing ${doc.id} (${data.ingredient_name || 'unknown'})...`);

        try {
            // 2. Download
            let buffer: Buffer;
            try {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`Fetch failed: ${response.statusText}`);
                const arrayBuffer = await response.arrayBuffer();
                buffer = Buffer.from(arrayBuffer);
            } catch (e) {
                console.error(`Failed to download ${url}:`, e);
                continue;
            }
            
            // Save Original
            await fs.writeFile(path.join(debugDir, `${doc.id}_original.png`), buffer);

            // 3. Process with Shared Logic
            const newBuffer = await processIcon(buffer);

            // Save Processed
            await fs.writeFile(path.join(debugDir, `${doc.id}_processed.png`), newBuffer);

            // 4. Upload & Update
            if (!isDryRun) {
                // Extract path from URL
                const matches = url.match(/\/o\/([^?]+)/);
                if (!matches) {
                    console.warn('Could not parse path from URL', url);
                    continue;
                }
                
                const filePath = decodeURIComponent(matches[1]);
                const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'recipe-lanes.firebasestorage.app';
                const bucket = storage.bucket(bucketName);
                const file = bucket.file(filePath);

                await file.save(newBuffer, {
                    metadata: { 
                        contentType: 'image/png'
                    }
                });
                
                await file.makePublic();
                const newUrl = file.publicUrl();

                // Update Icon Doc
                await doc.ref.update({ 
                    url: newUrl,
                    processed_transparent: true 
                });
                console.log(`Updated Icon ${doc.id}`);

                // Update Recipes
                const recipesToUpdate = iconToRecipesMap.get(doc.id);
                if (recipesToUpdate) {
                    console.log(`Updating ${recipesToUpdate.length} affected recipes...`);
                    for (const recipeDoc of recipesToUpdate) {
                        const recipeData = recipeDoc.data();
                        let changed = false;
                        const newNodes = recipeData.graph.nodes.map((n: any) => {
                            if (n.iconId === doc.id && n.iconUrl !== newUrl) {
                                changed = true;
                                return { ...n, iconUrl: newUrl };
                            }
                            return n;
                        });

                        if (changed) {
                            await recipeDoc.ref.update({ 'graph.nodes': newNodes });
                            console.log(` -> Updated Recipe ${recipeDoc.id}`);
                        }
                    }
                }
            } else {
                console.log(`Done ${doc.id} (Saved local only)`);
            }

        } catch (e) {
            console.error(`Failed to process ${doc.id}:`, e);
        }
    }
    console.log('Reprocessing complete.');
}

// Run
reprocessIcons().catch(console.error);
