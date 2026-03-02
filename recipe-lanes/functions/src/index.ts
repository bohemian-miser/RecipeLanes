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


import { generateAndStoreIcon, generateIconData } from './icon-generator';
import {  DB_COLLECTION_QUEUE } from '../../lib/config';
import { getDataService } from '../../lib/data-service';
import { db } from '../../lib/firebase-admin';

// --- Helper Functions ---
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import {  FieldValue } from "firebase-admin/firestore";

// const db = getFirestore();

export const processIconQueue = onDocumentCreated({ 
    document: `${DB_COLLECTION_QUEUE}/{ingredientName}`, 
    timeoutSeconds: 600, 
    memory: "1GiB",
    maxInstances: 10
}, async (event) => {
    if (!event.data) return;
    
    const ingredientName = event.params.ingredientName;
    const docRef = event.data.ref;

    try {
        // 1. Immediately set to processing (No transaction needed since it's onCreated)
        console.log(`[Queue-${ingredientName}] Started`);
        await docRef.update({ status: 'processing' });

        // 2. Generate the icon (This takes time, clients might still be adding recipes to the queue doc)
        // const iconResult = await generateAndStoreIcon({ ingredientName });
        const { iconData } = await generateIconData(ingredientName);
        
        // sleep for 1 min when testing race conditions.
        // await new Promise(resolve => setTimeout(resolve, 30000));
        console.log(`[Queue-${ingredientName}] Publishing to Firestore...`);
        await db.runTransaction(async (t) => {
            // Find or Create Ingredient Group
            const dataService = getDataService();
            let ingredientDocId;
            const match = await dataService.getIngredientByName(ingredientName);
            
            if (match) {
                ingredientDocId = match.id;
            } else {
                ingredientDocId = await dataService.createIngredient(ingredientName);
            }
    
            console.log(`[Queue-${ingredientName}] in transaction Publishing to Firestore...`);
            const result = await dataService.publishIcon(ingredientDocId, ingredientName, iconData);
        
            console.log(`[Queue-${ingredientName}] ✅ Success. Icon ID: ${result.iconId}`);
            const iconResult =  {
                ...result,
                prompt: iconData.fullPrompt,
                lcb: iconData.score
            };
            console.log(`[Queue-${ingredientName}] Committing to recipes...`);

            // 3. Final Transaction: Update recipes and delete queue
            // Read the queue doc to get the ABSOLUTE LATEST list of recipe IDs
            const queueDoc = await t.get(docRef);
            if (!queueDoc.exists) return; 

            const latestRecipeIds: string[] = queueDoc.data()?.recipes || [];

            // Update all linked recipes using the atomic helper
            console.log(`[Queue-${ingredientName}] Updating ${latestRecipeIds.length} recipes...`);
            // const dataService = getDataService();
            
            for (const rId of latestRecipeIds) {
                await dataService.assignIconToRecipe(rId, ingredientName, iconResult);
            }

            // Delete the queue item
            t.delete(docRef);
            console.log(`[Queue-${ingredientName}] Successfully updated ${latestRecipeIds.length} recipes and deleted queue item.`);
        });

    } catch (e: any) {
        console.error(`[Queue-${ingredientName}] Failed:`, e);
        // Best-effort status update on failure
        await docRef.update({ 
            status: 'failed', 
            error: e.message, 
            updated_at: FieldValue.serverTimestamp() 
        }).catch(() => {});
    }
});
