import { processIcon } from '../functions/src/image-processing';
import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import { applyIconToNode, clearNodeIcon, getNodeIconId, getNodeIconUrl, hasNodeIcon } from '../lib/recipe-lanes/model-utils';

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
    const metadataOnly = args.includes('--metadata-only');

    console.log(`Starting icon reprocessing... ${limit > 0 ? `(Limit: ${limit} random)` : '(All)'} ${isDryRun ? '(Dry Run)' : ''} ${metadataOnly ? '(Metadata Only)' : ''}`);
    
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
                const nid = getNodeIconId(node) || '';
                if (nid) {
                    if (!iconToRecipesMap.has(nid)) {
                        iconToRecipesMap.set(nid, []);
                    }
                    // Avoid duplicates if multiple nodes use same icon
                    const list = iconToRecipesMap.get(nid)!;
                    if (!list.find(r => r.id === doc.id)) {
                        list.push(doc);
                    }
                }
            });
        }
        recipeCount++;
    });
    console.log(`Indexed ${recipeCount} recipes. Found references for ${iconToRecipesMap.size} unique icons.`);

    // 1. Get all ingredients
    const snapshot = await db.collection('ingredients_new').get();
    let allIcons: { id: string, data: any, ref: any, index: number, ingredient: string}[] = [];
    
    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.icons && Array.isArray(data.icons)) {
            data.icons.forEach((icon: any, idx: number) => {
                // console.log('Icon Data:', icon.metadata);
                if (!icon.metadata) {
                    console.log(`Found icon ${icon.id} in ingredient ${doc.id}`);
                    console.log('  - NO Existing Metadata:');
                    allIcons.push({ 
                        id: icon.id, // The Icon ID
                        data: icon,  // The Icon Data
                        ref: doc.ref, // The Ingredient Doc Ref
                        index: idx,   // Index in array
                        ingredient: doc.id // The Ingredient ID
                    });
                }
            });
        }
    });

    console.log(`Found ${allIcons.length} total icons.`);

    if (limit > 0) {
        // Shuffle
        for (let i = allIcons.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [allIcons[i], allIcons[j]] = [allIcons[j], allIcons[i]];
        }
        allIcons = allIcons.slice(0, limit);
        console.log(`Selected ${allIcons.length} random icons.`);
    }

    for (const item of allIcons) {
        const { id, data: iconData, ref, index, ingredient } = item;
        const url = iconData.url;
        
        if (!url) {
            console.log(`Skipping ${id} (no url)`);
            continue;
        }

        console.log(`Processing ${id} (${ingredient ||'unknown'})...`);

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
            
            // Save Original (Optional in metadata mode? No, good for debugging)
            if (!metadataOnly) await fs.writeFile(path.join(debugDir, `${id}_original.png`), buffer);

            // 3. Process with Shared Logic
            // If metadataOnly, we still run processIcon to get the metadata!
            // But we might skip the expensive background removal if processIcon allows?
            // processIcon does both. It's fast enough locally.
            const {buffer:newBuffer, metadata} = await processIcon(buffer);

            // Save Processed
            if (!metadataOnly) await fs.writeFile(path.join(debugDir, `${id}_processed.png`), newBuffer);

            // 4. Upload & Update
            if (!isDryRun) {
                let newUrl = url;

                if (!metadataOnly) {
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
                    newUrl = file.publicUrl();
                }

                // Update Icon Doc (Ingredient Array)
                // We need to fetch fresh doc to avoid overwrite race conditions if possible,
                // but for a script it's usually sequential.
                const freshDoc = await ref.get();
                const freshData = freshDoc.data();
                const icons = freshData.icons || [];
                
                // Find index again just in case
                const freshIndex = icons.findIndex((i: any) => i.id === id);
                if (freshIndex !== -1) {
                    const updatedIcon = { 
                        ...icons[freshIndex],
                        metadata: metadata 
                    };
                    if (!metadataOnly) {
                        updatedIcon.url = newUrl;
                        updatedIcon.processed_transparent = true;
                    }
                    
                    icons[freshIndex] = updatedIcon;
                    await ref.update({ icons });
                    console.log(`Updated Icon ${id} in Ingredient ${freshDoc.id}`);
                }

                // Update Recipes
                const recipesToUpdate = iconToRecipesMap.get(id);
                if (recipesToUpdate) {
                    console.log(`Updating ${recipesToUpdate.length} affected recipes...`);
                    for (const recipeDoc of recipesToUpdate) {
                        // Refetch recipe to get latest state
                        const currentRecipe = await recipeDoc.ref.get();
                        const recipeData = currentRecipe.data();
                        
                        if (!recipeData || !recipeData.graph || !recipeData.graph.nodes) continue;

                        let changed = false;
                        const newNodes = recipeData.graph.nodes.map((n: any) => {
                            const nid = getNodeIconId(n);
                            if (nid === id) {
                                // Apply update using helper
                                applyIconToNode(n, { iconId: id, iconUrl: newUrl, metadata });
                                changed = true;
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
                console.log(`Done ${id} (Saved local only / Dry Run)`);
                console.log('Metadata:', metadata);
            }

        } catch (e) {
            console.error(`Failed to process ${id}:`, e);
        }
    }
    console.log('Reprocessing complete.');
}

// Run
reprocessIcons().catch(console.error);
