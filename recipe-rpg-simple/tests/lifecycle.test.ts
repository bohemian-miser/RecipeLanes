import 'dotenv/config';
import { createDebugRecipeAction, addIngredientNodeAction, rerollIconAction } from '../app/actions';
import { setAIService, MockAIService } from '../lib/ai-service';
import { setDataService, MemoryDataService } from '../lib/data-service';
import { setAuthService, MockAuthService } from '../lib/auth-service';
import { db } from '../lib/firebase-admin';
import { DB_COLLECTION_INGREDIENTS, DB_COLLECTION_QUEUE } from '../lib/config';

// Explicitly use Mocks for tests
setAIService(new MockAIService());
setDataService(new MemoryDataService());
setAuthService(new MockAuthService());

// Simulate Worker (Queue Processor)
async function processQueue() {
    const queueRef = db.collection(DB_COLLECTION_QUEUE);
    const snapshot = await queueRef.where('status', '==', 'pending').get();
    
    if (snapshot.empty) return;
    
    console.log(`[Worker] Processing ${snapshot.size} items...`);
    const ai = new MockAIService();
    
    for (const doc of snapshot.docs) {
        const ingredient = doc.id; // Doc ID is standardized name
        console.log(`[Worker] Generating for ${ingredient}`);
        
        // Generate Mock Icon
        const iconUrl = await ai.generateImage(ingredient);
        const iconId = `icon-${Date.now()}-${Math.random()}`;
        
        // Write to ingredients_new
        const ingRef = db.collection(DB_COLLECTION_INGREDIENTS).doc(ingredient);
        const existing = (await ingRef.get()).data();
        const icons = existing?.icons || [];
        icons.push({
            id: iconId,
            url: iconUrl,
            score: 1.0,
            created_at: new Date()
        });

        await ingRef.set({
            name: ingredient,
            icons
        }, { merge: true });
        
        // Update Queue
        await doc.ref.update({ status: 'completed' });
    }
}

// Helper to get the current icon of a node from the DB
async function getNodeIcon(recipeId: string, nodeId: string) {
    const recipeRef = db.collection('recipes').doc(recipeId);
    const docSnap = await recipeRef.get();
    const graph = docSnap.data()?.graph;
    const node = graph?.nodes?.find((n: any) => n.id === nodeId);
    return { iconUrl: node?.iconUrl, iconId: node?.iconId };
}

async function testFakeGraphFlow() {
  const ingredient = "Integration-Burger-" + Date.now();
  console.log(`\n=== Starting Fake Graph Test for: ${ingredient} ===`);

  try {
    // 1. Create Debug Recipe (Fake Graph)
    console.log('\n[1] Creating Debug Recipe...');
    const r1 = await createDebugRecipeAction() as any;
    if (r1.error) throw new Error(r1.error);
    const recipeId = r1.recipeId;
    console.log(` -> Recipe ID: ${recipeId}`);

    // 2. Add Ingredient Node
    console.log('\n[2] Adding Ingredient Node...');
    const r2 = await addIngredientNodeAction(recipeId, ingredient) as any;
    if (r2.error) throw new Error(r2.error);
    const nodeId = r2.nodeId;
    console.log(` -> Node ID: ${nodeId}`);

    // 3. Process Queue & Resolve (Initial Gen)
    await processQueue();
    // Trigger resolve again to apply updates (simulate listener update or subsequent action)
    await rerollIconAction(nodeId, ingredient, '', [], recipeId, undefined);
    
    let current = await getNodeIcon(recipeId, nodeId);
    console.log(` -> Icon A: ${current.iconUrl}`);
    if (!current.iconUrl) throw new Error("Failed to generate Icon A");
    const urlA = current.iconUrl;

    // 4. Reroll (Reject A, Get B)
    console.log('\n[4] Rerolling (Reject A)...');
    // Pass current URL to reject it
    await rerollIconAction(nodeId, ingredient, urlA, [], recipeId, undefined);
    
    // Simulate Worker for new icon
    await processQueue();
    
    // Trigger resolve update
    await rerollIconAction(nodeId, ingredient, '', [], recipeId, undefined);
    
    current = await getNodeIcon(recipeId, nodeId);
    console.log(` -> Icon B: ${current.iconUrl}`);
    if (!current.iconUrl) throw new Error("Failed to generate Icon B");
    const urlB = current.iconUrl;
    
    if (urlA === urlB) console.warn("WARNING: Got same icon.");
    else console.log("SUCCESS: Got new icon.");

  } catch (e) {
      console.error('TEST FAILED:', e);
      process.exitCode = 1;
  }
}

testFakeGraphFlow();