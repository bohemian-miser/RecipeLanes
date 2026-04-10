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
import { getAIService } from '../../lib/ai-service';
import { db } from '../../lib/firebase-admin';
import { withSearchTerms } from '../../lib/recipe-lanes/model-utils';
// import { calculateWilsonLCB } from '../../lib/utils';

// --- Helper Functions ---
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import {  FieldValue } from "firebase-admin/firestore";



// const db = getFirestore();

export * as vectorSearch from './vector-search';

export const processIconTask = onTaskDispatched({
    serviceAccount: `icon-processor@${process.env.GCLOUD_PROJECT}.iam.gserviceaccount.com`,
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
        // 1. Check doc exists (may have been cleared by admin) before proceeding
        const existing = await docRef.get();
        if (!existing.exists) {
            console.log(`[Task-${ingredientName}] Queue doc not found — task was cleared, skipping.`);
            return;
        }

        console.log(`[Queue-${ingredientName}] Started`);
        await docRef.update({
            status: "processing",
            updated_at: FieldValue.serverTimestamp(),
        });

        // 2. Generate the icon (This takes time, clients might still be adding recipes to the queue doc)
        const icon = await generateIconData(ingredientName);

        // 3. Publish & Assign (Transaction)
        console.log(`[Queue-${ingredientName}] Publishing to Firestore...`);
        let ingredientDocId;
        let rawHydeQueries: string[] = [];
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
            const queueDocData = queueDoc.data();
            const latestRecipeIds: string[] = queueDocData?.recipes || [];
            console.log(`[Queue-${ingredientName}] in transaction Publishing to Firestore...`);

            rawHydeQueries = queueDocData?.hydeQueries || [];
            const iconWithTerms = withSearchTerms(icon, rawHydeQueries);

            console.log(`[Queue-${ingredientName}] ✅ Success. Icon ID: ${icon.id}`);

            const recipeDataObj: Record<string, any> = {};
            for (const rId of latestRecipeIds) {
                const data = await dataService.imagineRecipeWithIcon(rId, ingredientName, iconWithTerms, transaction);
                recipeDataObj[rId] = data;
            }

            // End READS. Now commit all changes together.

            console.log(`[Queue-${ingredientName}] Committing to recipes...`);
            
            // We let the writeIconToIndex handle setting the actual icon data now,
            // so we don't strictly need imagineIngredientWithIcon anymore for the DB update
            // However, we'll keep the call structure if it's used elsewhere or does side-effects.
            const ingredientData = await dataService.imagineIngredientWithIcon(ingredientDocId, ingredientName, iconWithTerms, transaction);
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

        // Record one impression per recipe this icon was shown in (non-fatal)
        dataService.recordImpression(icon.id, ingredientDocId).catch(e =>
            console.warn(`[Queue-${ingredientName}] recordImpression failed (non-fatal):`, e)
        );

    } catch (error: any) {
        console.error(`[Queue-${ingredientName}] 💥 Failed:`, error);
        
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
