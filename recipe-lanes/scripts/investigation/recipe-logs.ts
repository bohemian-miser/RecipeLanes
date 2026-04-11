
import './setup-env';
import { db } from '../../lib/firebase-admin';
import { standardizeIngredientName } from '../../lib/utils';
import { DB_COLLECTION_INGREDIENTS, DB_COLLECTION_QUEUE, DB_COLLECTION_RECIPES } from '../../lib/config';

async function investigate(recipeId: string) {
    console.log(`\n=== 🕵️ RECIPE FORENSICS: ${recipeId} ===`);

    try {
        const recipeDoc = await db.collection(DB_COLLECTION_RECIPES).doc(recipeId).get();
        if (!recipeDoc.exists) {
            console.error('❌ Recipe not found.');
            return;
        }

        const recipe = recipeDoc.data()!;
        const nodes = recipe.graph?.nodes || [];

        console.log(`Title: ${recipe.title}`);
        console.log(`Created: ${recipe.created_at?.toDate?.().toISOString()}`);
        console.log(`Updated: ${recipe.updated_at?.toDate?.().toISOString()}`);

        console.log(`\n--- NODE TIMELINE ANALYSIS ---`);
        for (const [idx, node] of nodes.entries()) {
            const name = node.text || node.visualDescription || 'Untitled';
            const stdName = standardizeIngredientName(name);
            const status = node.status || 'OK';
            const iconId = node.iconShortlist?.[node.shortlistIndex || 0]?.icon?.id;
            
            let logMark = '✅';
            if (status === 'pending') logMark = '⏳';
            if (status === 'failed') logMark = '❌';
            if (name.includes('/')) logMark = '🚨 BUG? (Slash detected)';

            console.log(`${idx.toString().padStart(2, ' ')}: ${logMark} [${name}] -> ${status} (Icon: ${iconId || 'None'})`);

            if (name.includes('/')) {
                console.log(`   ⚠️ CRITICAL: Name contains a slash! This will crash Firestore document lookups.`);
            }
        }

        console.log(`\n--- RECENT GCP LOGS (App Hosting / Cloud Run) ---`);
        try {
            const { execSync } = require('child_process');
            // Fetching real logs from gcloud
            const logCmd = `gcloud logging read "resource.type=(cloud_run_revision OR cloud_function) AND severity>=WARNING" --project=recipe-lanes-staging --limit=5 --format="table(timestamp, severity, textPayload, jsonPayload.message)"`;
            const logs = execSync(logCmd, { encoding: 'utf-8' });
            console.log(logs);
        } catch (e: any) {
            console.log("Could not fetch GCP logs locally (requires gcloud auth):", e.message);
        }

        console.log(`\n--- QUEUE STATUS ---`);
        for (const node of nodes) {
            if (node.status === 'pending' || node.text.includes('/')) {
                const stdName = standardizeIngredientName(node.text);
                const safeId = stdName.replace(/\//g, '_');
                const qDoc = await db.collection(DB_COLLECTION_QUEUE).doc(safeId).get();
                if (qDoc.exists) {
                    console.log(`[${stdName}] is in queue with status: ${qDoc.data()?.status}`);
                } else if (node.text.includes('/')) {
                    console.log(`[${stdName}] ❌ MISSING from queue (Expected: crash prevented queueing)`);
                } else {
                     console.log(`[${stdName}] ❓ Not in queue and status is pending.`);
                }
            }
        }

    } catch (e: any) {
        console.error('Forensics failed:', e);
    }
}

const recipeId = process.argv.slice(2).find(a => !a.startsWith('-'));
if (!recipeId) {
    console.error('Usage: npx tsx scripts/investigation/recipe-logs.ts <recipe-id> [--staging]');
} else {
    investigate(recipeId);
}
