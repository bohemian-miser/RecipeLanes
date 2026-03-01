import 'dotenv/config';
import { getDataService } from '../lib/data-service';

async function main() {
    const name = "Lamb Chop";
    console.log(`Looking up: ${name}`);
    
    const service = getDataService();
    const match = await service.getIngredientByName(name);
    
    if (!match) {
        console.log("No ingredient match found.");
        return;
    }
    
    console.log(`Found Ingredient ID: ${match.id}`);
    console.log(`Data:`, match.data);
    
    const icons = await service.getIconsForIngredient(match.id);
    console.log(`Found ${icons.length} icons.`);
    
    icons.forEach(icon => {
        console.log(`- ID: ${icon.id}`);
        console.log(`  URL: ${icon.url}`);
        console.log(`  Score: ${icon.popularity_score}`);
        console.log(`  Impressions: ${icon.impressions}`);
        console.log(`  Marked for deletion: ${icon.marked_for_deletion}`);
    });
    
    // Simulate Action Logic
    const bestIcon = icons
        .filter((i: any) => !i.marked_for_deletion)
        .sort((a: any, b: any) => (b.popularity_score || 0) - (a.popularity_score || 0))[0];

    if (bestIcon) {
        console.log(`
Best Icon Selected: ${bestIcon.id} (Score: ${bestIcon.popularity_score})`);
        
        const PROVEN_SAMPLE_SIZE = 20;
        const QUALITY_FLOOR_LCB = 0.40;
        
        const n = bestIcon.impressions || 0;
        const score = bestIcon.popularity_score || 0;
        
        if (n >= PROVEN_SAMPLE_SIZE && score < QUALITY_FLOOR_LCB) {
            console.log(`❌ SKIPPED due to Quality Floor (n=${n}, score=${score} < ${QUALITY_FLOOR_LCB})`);
        } else {
            console.log(`✅ RETURNED (Optimistic Hit)`);
        }
    } else {
        console.log(`
No valid icon found (all deleted or empty).`);
    }
}

main();
