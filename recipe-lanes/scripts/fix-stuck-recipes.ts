import 'dotenv/config';
import { getDataService } from '../lib/data-service';
import { serverBatchIconSearch } from '../lib/search-orchestrator';

const RECIPE_IDS = [
    'AZIgu8aCf5Lf3xLoHZTY',
    'NLPfXQp9jdn3bjGIgtvI',
];

async function main() {
    const ds = getDataService();
    for (const id of RECIPE_IDS) {
        console.log(`\n--- resolveRecipeIcons: ${id} ---`);
        await ds.resolveRecipeIcons(id, serverBatchIconSearch);
        console.log(`Done: ${id}`);
    }
}

main().catch(console.error);
