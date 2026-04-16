import 'dotenv/config';
import { db } from '../lib/firebase-admin';
import { standardizeIngredientName } from '../lib/utils';
import { getNodeIngredientName } from '../lib/recipe-lanes/model-utils';

async function checkRecipe(recipeId: string) {
    const doc = await db.collection('recipes').doc(recipeId).get();
    const data = doc.data();
    const nodes = data?.graph?.nodes || [];
    const toProcess = nodes.filter((n: any) => n.visualDescription && (n.status === 'pending' || n.status === 'processing' || !n.iconShortlist?.length));
    const ok = nodes.filter((n: any) => n.iconShortlist?.length > 0).length;
    console.log(`${recipeId}: ${ok}/${nodes.length} ok, ${toProcess.length} still need icons`);
    for (const n of toProcess) {
        const stdName = standardizeIngredientName(getNodeIngredientName(n));
        const q = await db.collection('icon_queue').doc(stdName).get();
        console.log(`  [${n.status||'none'}] "${n.text}" → queue: ${q.exists ? q.data()?.status : 'NONE'}`);
    }
}

async function main() {
    await checkRecipe('AZIgu8aCf5Lf3xLoHZTY');
    await checkRecipe('NLPfXQp9jdn3bjGIgtvI');
}
main().catch(console.error);
