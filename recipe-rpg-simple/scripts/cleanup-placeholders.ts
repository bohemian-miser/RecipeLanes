import dotenv from 'dotenv';
dotenv.config();

async function run() {
  const args = process.argv.slice(2);
  const stagingIndex = args.indexOf('--staging');
  
  if (stagingIndex !== -1) {
      console.log('✨ Switching to STAGING environment (.env.staging)...');
      dotenv.config({ path: '.env.staging', override: true });
  }

  // Dynamic import
  const { db } = await import('../lib/firebase-admin');

  async function cleanup() {
    console.log('Starting cleanup of placeholder icons...');
    
    const badPatterns = [
        'placehold.co',
        '127.0.0.1',
        'localhost',
        // 'firebasestorage.app/o/icons%2Fseed', // Also clean seeded data if it leaked,
        // 'https://storage.googleapis.com/recipe-lanes.firebasestorage.app/icons%2F'
    ];

    // 1. Clean Icons
    const ingredients = await db.collection('ingredients').get();
    console.log(`Scanning ${ingredients.size} ingredients...`);
    
    let deletedCount = 0;
    
    for (const ingDoc of ingredients.docs) {
        const icons = await ingDoc.ref.collection('icons').get();
        const batch = db.batch();
        let batchCount = 0;
        
        for (const iconDoc of icons.docs) {
            const data = iconDoc.data();
            const url = data.url || '';
            console.log(`Checking icon: ${url}`);   
            if (badPatterns.some(p => url.includes(p))) {
                console.log(`Deleting bad icon: ${url}`);
                batch.delete(iconDoc.ref);
                batchCount++;
                deletedCount++;
            }
        }
        
        if (batchCount > 0) {
            await batch.commit();
        }
    }
    
    console.log(`Deleted ${deletedCount} bad icons.`);

    // 2. Clean Recipes
    const recipes = await db.collection('recipes').get();
    console.log(`Scanning ${recipes.size} recipes...`);
    
    let recipeUpdateCount = 0;

    for (const recipeDoc of recipes.docs) {
        const data = recipeDoc.data();
        const graph = data.graph;
        
        if (graph && graph.nodes) {
            let modified = false;
            const newNodes = graph.nodes.map((n: any) => {
              //   console.log(`Checking recipe node icon: ${n.iconUrl}`);
                if (n.iconUrl && badPatterns.some(p => n.iconUrl.includes(p))) {
                    console.log(`Clearing bad icon from recipe ${recipeDoc.id} node ${n.text}`);
                    modified = true;
                    return { ...n, iconUrl: null, iconId: null };
                }
                return n;
            });
            
            if (modified) {
                await recipeDoc.ref.update({ 'graph.nodes': newNodes });
                recipeUpdateCount++;
            }
        }
    }

    console.log(`Updated ${recipeUpdateCount} recipes.`);
    console.log('Cleanup complete.');
  }

  await cleanup().catch(console.error);
}

run();
