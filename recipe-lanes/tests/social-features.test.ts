import { getDataService } from '../lib/data-service';
import type { RecipeGraph } from '../lib/recipe-lanes/types';
import { clearFirestore } from '../e2e/utils/admin-utils';
import { db } from '../lib/firebase-admin';
import assert from 'node:assert';

// Mock Graph
const mockGraph: RecipeGraph = {
    title: "Test Recipe",
    lanes: [],
    nodes: [{ id: '1', laneId: 'l1', text: 'Step 1', visualDescription: 'visual', type: 'action' }],
    layouts: {
        'swimlanes': [{ id: '1', x: 10, y: 10 }],
        'dagre': [{ id: '1', x: 20, y: 20 }]
    }
};

async function testSocialFeatures() {
    console.log("Testing Social Features...");
    await clearFirestore();
    const service = getDataService();

    // 1. Ownership & Visibility
    console.log(" [1] Ownership & Visibility");
    const id1 = await service.saveRecipe(mockGraph, undefined, 'user-123', 'public');
    const recipe1 = await service.getRecipe(id1);
    
    assert(recipe1, "Recipe should be saved");
    assert.strictEqual(recipe1.ownerId, 'user-123', "Owner ID mismatch");
    assert.strictEqual(recipe1.visibility, 'public', "Visibility mismatch");

    // 2. Filter Public
    console.log(" [2] Filter Public");
    const pubId = await service.saveRecipe({ ...mockGraph, title: 'Public One' }, undefined, 'u1', 'public');
    await db.collection('recipes').doc(pubId).update({ isVetted: true });

    await service.saveRecipe({ ...mockGraph, title: 'Private One' }, undefined, 'u1', 'unlisted');

    const publicRecipes = await service.getPublicRecipes(10);
    // Note: getPublicRecipes might return 'Public One' AND the previous 'Test Recipe' (if vetted? No id1 is not vetted)
    const titles = publicRecipes.map(r => r.title);
    assert(titles.includes('Public One'), "Should find public recipe");
    assert(!titles.includes('Private One'), "Should NOT find unlisted recipe");

    // 3. Search
    console.log(" [3] Search");
    const spagId = await service.saveRecipe({ ...mockGraph, title: 'Spaghetti Bolognese' }, undefined, 'u1', 'public');
    await db.collection('recipes').doc(spagId).update({ isVetted: true });
    
    const results = await service.searchPublicRecipes('Spaghetti');
    assert.strictEqual(results.length, 1, "Search count mismatch");
    assert.strictEqual(results[0].title, 'Spaghetti Bolognese', "Search title mismatch");

    // Search by content (Ingredient)
    const contentResults = await service.searchPublicRecipes('Step 1'); // mockGraph has "Step 1" node
    // Public One + Spaghetti = 2. id1 is public but not vetted.
    assert.strictEqual(contentResults.length, 2, "Content search count mismatch (Public One + Spaghetti)");
    
    const hiddenId = await service.saveRecipe({ 
        ...mockGraph, 
        title: 'Hidden Gem', 
        nodes: [{ id: '9', laneId: 'l1', text: 'SecretIngredient', visualDescription: '', type: 'ingredient' }]
    }, undefined, 'u1', 'public');
    await db.collection('recipes').doc(hiddenId).update({ isVetted: true });
    
    const secretResults = await service.searchPublicRecipes('SecretIngredient');
    assert.strictEqual(secretResults.length, 1, "Secret ingredient search failed");
    assert.strictEqual(secretResults[0].title, 'Hidden Gem');

    // 4. Layouts
    console.log(" [4] Independent Layouts");
    // Ensure layouts are preserved in MemoryStore (requires MemoryDataService update)
    const retrieved = await service.getRecipe(id1);
    assert(retrieved?.graph.layouts, "Layouts should be defined");
    assert.strictEqual(retrieved?.graph.layouts?.['swimlanes'][0].x, 10, "Swimlanes layout mismatch");

    // 5. Voting
    console.log(" [5] Voting");
    // User 1 Likes
    await service.voteRecipe(id1, 'user-1', 'like');
    let r = await service.getRecipe(id1);
    assert.strictEqual(r?.stats?.likes, 1, "Like count should be 1");

    // User 1 Likes again (No change)
    await service.voteRecipe(id1, 'user-1', 'like');
    r = await service.getRecipe(id1);
    assert.strictEqual(r?.stats?.likes, 1, "Like count should stay 1");

    // User 1 Dislikes (Switch)
    await service.voteRecipe(id1, 'user-1', 'dislike');
    r = await service.getRecipe(id1);
    assert.strictEqual(r?.stats?.likes, 0, "Like count should be 0");
    assert.strictEqual(r?.stats?.dislikes, 1, "Dislike count should be 1");

    // 6. Starring
    console.log(" [6] Starring");
    const isStarred = await service.toggleStar(id1, 'user-1');
    assert.strictEqual(isStarred, true, "Should be starred");

    const starred = await service.getStarredRecipes('user-1');
    assert.strictEqual(starred.length, 1, "Starred count mismatch");
    assert.strictEqual(starred[0].id, id1, "Starred ID mismatch");

    // Unstar
    const isStarred2 = await service.toggleStar(id1, 'user-1');
    assert.strictEqual(isStarred2, false, "Should be unstarred");
    
    const starred2 = await service.getStarredRecipes('user-1');
    assert.strictEqual(starred2.length, 0, "Starred count mismatch after unstar");

    // 7. Copy
    console.log(" [7] Copying");
    const newId = await service.copyRecipe(id1, 'copier');
    const copy = await service.getRecipe(newId);
    assert.strictEqual(copy?.ownerId, 'copier', "Copy owner mismatch");
    assert(copy?.graph.title?.includes('(Copy)'), "Copy title mismatch");
    assert.strictEqual(copy?.visibility, 'unlisted', "Copy should be unlisted");

    console.log("Social Features Tests PASS");
}

testSocialFeatures().catch(e => {
    console.error(e);
    process.exit(1);
});