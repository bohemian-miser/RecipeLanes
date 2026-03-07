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


import { generateIconData } from './icon-generator';
import { DB_COLLECTION_QUEUE, DB_COLLECTION_RECIPES } from "../../lib/config";
import { getDataService } from '../../lib/data-service';
import { db } from '../../lib/firebase-admin';
import { calculateWilsonLCB } from '../../lib/utils';

// --- Helper Functions ---
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import {  FieldValue } from "firebase-admin/firestore";



// const db = getFirestore();

export const processIconTask = onTaskDispatched({
    retryConfig: {
        maxAttempts: 5,
        minBackoffSeconds: 60,
    },
    rateLimits: {
        maxConcurrentDispatches: 1,
        maxDispatchesPerSecond: 1,
    },
    memory: "1GiB",
    timeoutSeconds: 300, // 5 minutes sufficient for one icon
}, async (req) => {
    await processIconTaskHandler(req.data);
});

export const processIconTaskHandler = async (data: { ingredientName: string }) => {
    const { ingredientName } = data;
    console.log(`[Task-${ingredientName}] 🚀 Started`);

    if (!ingredientName) {
        console.error("No ingredientName provided");
        return;
    }

    const docRef = db.collection(DB_COLLECTION_QUEUE).doc(ingredientName);

    try {
        // 1. Immediately set to processing (No transaction needed since it's onCreated)
        console.log(`[Queue-${ingredientName}] Started`);
        await docRef.update({
            status: "processing",
            updated_at: FieldValue.serverTimestamp(),
        });

        // 2. Generate the icon (This takes time, clients might still be adding recipes to the queue doc)
        const { iconData } = await generateIconData(ingredientName);

        // 3. Publish & Assign (Transaction)
        console.log(`[Queue-${ingredientName}] Publishing to Firestore...`);
        let ingredientDocId;
        const dataService = getDataService();

        // Find or Create Ingredient Group.
        const match = await dataService.getIngredientByName(ingredientName);
        if (match) {
            ingredientDocId = match.id;
        } else {
            ingredientDocId = await dataService.createIngredient(ingredientName);
        }
        await db.runTransaction(async (transaction) => {
            // Read the queue doc to get the ABSOLUTE LATEST list of recipe IDs
            const queueDoc = await transaction.get(docRef);
            if (!queueDoc.exists) {
                console.log(`[Queue-${ingredientName}] Queue doc missing, aborting recipe update.`);
                return; 
            }
            const latestRecipeIds: string[] = queueDoc.data()?.recipes || [];
            console.log(`[Queue-${ingredientName}] in transaction Publishing to Firestore...`);
            
            // Set initial impressions based on how many recipes we're updating now
            const initialImpressions = latestRecipeIds.length;
            const initialScore = calculateWilsonLCB(initialImpressions, 0);
            
            const iconDataWithStats = {
                ...iconData,
                impressions: initialImpressions,
                score: initialScore
            };

            const ingredientData = await dataService.imagineIngredientWithIcon(ingredientDocId, ingredientName, iconDataWithStats, transaction);

            console.log(`[Queue-${ingredientName}] ✅ Success. Icon ID: ${iconData.id}`);

            const recipeDataObj: Record<string, any> = {};
            for (const rId of latestRecipeIds) {
                const data = await dataService.imagineRecipeWithIcon(rId, ingredientName, iconDataWithStats, transaction);
                recipeDataObj[rId] = data;
            }

            // END READS.

            // if it gets a bad read/write, it will throw.
            //start emulator and dev:emulator make some slow stuff and try to find where the bad read/write is.

            console.log(`[Queue-${ingredientName}] Committing to recipes...`);
            await dataService.setIngredientWithIcon(ingredientData, transaction);

            // Update all linked recipes using the atomic helper
            console.log(`[Queue-${ingredientName}] Updating ${latestRecipeIds.length} recipes...`);

            for (const rId of latestRecipeIds) {
                await dataService.setRecipeWithIcon(recipeDataObj[rId], transaction);
            }

            // Delete the queue item
            transaction.delete(docRef);
            console.log(`[Queue-${ingredientName}] Successfully updated ${latestRecipeIds.length} recipes and deleted queue item.`);
        });

    } catch (error: any) {
        console.error(`[Queue-${ingredientName}] 💥 Failed:`, error);
        
        // Handle Permanent vs Transient
        // Quota errors (429) or 5xx -> Throw to retry
        const isTransient = error.code === 429 || error.status === 429 || error.code === 503 || error.status === 503 || error.message?.includes('quota');
        
        if (isTransient) {
            await docRef.update({ status: 'retrying', last_error: error.message }).catch(() => {});
            throw error; // Trigger Cloud Task Retry
        }
        
        // Permanent Error (Policy, 400, etc)
        await docRef.update({ 
            status: 'failed', 
            error: error.message,
            updated_at: FieldValue.serverTimestamp()
        }).catch(() => {});
        
        // Propagate failure to recipes so UI shows Red X
        // We need to read recipes again or assume we have them?
        // Better to read again to be safe.
        const qDoc = await docRef.get();
        const recipes = qDoc.data()?.recipes || [];
        const dataService = getDataService();
        
        for (const rId of recipes) {
            await dataService.failRecipeIcon(rId, ingredientName, error.message);
        }
        
        // Return success to ACK the task and stop retries
        return; 
    }
};
