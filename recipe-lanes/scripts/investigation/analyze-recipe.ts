
import './setup-env';
import { db } from '../../lib/firebase-admin';
import { standardizeIngredientName } from '../../lib/utils';
import { DB_COLLECTION_INGREDIENTS, DB_COLLECTION_QUEUE, DB_COLLECTION_RECIPES } from '../../lib/config';

async function analyzeRecipe() {
    const args = process.argv.slice(2);
    const recipeId = args.find(a => !a.startsWith('-'));

    if (!recipeId) {
        console.error('Usage: npx tsx scripts/investigation/analyze-recipe.ts <recipe-id> [--staging]');
        process.exit(1);
    }

    console.log(`\n🔍 Analyzing Recipe: ${recipeId}`);
    
    try {
        const recipeDoc = await db.collection(DB_COLLECTION_RECIPES).doc(recipeId).get();
        if (!recipeDoc.exists) {
            console.error('❌ Recipe not found.');
            return;
        }

        const recipe = recipeDoc.data()!;
        console.log(`Title: ${recipe.title || recipe.graph?.title || 'Untitled'}`);
        console.log(`Visibility: ${recipe.visibility}`);
        console.log(`Owner: ${recipe.ownerId} (${recipe.ownerName || 'Unknown'})`);
        console.log(`Created At: ${recipe.created_at?.toDate?.().toISOString() || 'N/A'}`);
        console.log(`Updated At: ${recipe.updated_at?.toDate?.().toISOString() || 'N/A'}`);

        const nodes = recipe.graph?.nodes || [];
        console.log(`\nNodes (${nodes.length}):`);

        for (const node of nodes) {
            if (node.type !== 'ingredient') continue;
            const ingredientName = node.text || node.visualDescription || '';
            const stdName = standardizeIngredientName(ingredientName);
            const status = node.status || 'OK';
            const iconId = node.iconShortlist?.[node.shortlistIndex || 0]?.icon?.id;
            const shortlistCount = node.iconShortlist?.length || 0;

            console.log(`\n- [${stdName}]`);
            console.log(`  Status: ${status}`);
            console.log(`  Current Icon: ${iconId || 'None'}`);
            console.log(`  Shortlist: ${shortlistCount} items`);

            // Check Queue
            const safeId = stdName.replace(/\//g, '_');
            const queueDoc = await db.collection(DB_COLLECTION_QUEUE).doc(safeId).get();
            if (queueDoc.exists) {
                const qData = queueDoc.data()!;
                console.log(`  📦 Queue: ${qData.status} (created ${qData.created_at?.toDate?.().toISOString() || 'N/A'})`);
                if (qData.error) console.log(`  ⚠️ Queue Error: ${qData.error}`);
                if (qData.recipes?.includes(recipeId)) {
                    console.log(`  ✅ Recipe is in this queue item.`);
                } else {
                    console.log(`  ❌ Recipe is NOT in this queue item, but queue exists for this ingredient.`);
                }
            } else {
                console.log(`  📦 Queue: Not found. (Checked ${safeId})`);
            }

            // Check Ingredient Doc
            const ingDoc = await db.collection(DB_COLLECTION_INGREDIENTS).doc(safeId).get();
            if (ingDoc.exists) {
                const iData = ingDoc.data()!;
                const iconCount = iData.icons?.length || 0;
                console.log(`  🥗 Ingredient Doc: Found (${iconCount} icons)`);
                if (iconId) {
                    const hasCurrent = iData.icons?.some((i: any) => i.id === iconId);
                    console.log(`  ✅ Current icon ${iconId} exists in ingredient doc: ${hasCurrent}`);
                }
            } else {
                console.log(`  🥗 Ingredient Doc: Not found.`);
            }
        }
        
        console.log('\n--- Analysis Complete ---');
    } catch (e: any) {
        console.error('❌ Error:', e);
    }
}

analyzeRecipe();
