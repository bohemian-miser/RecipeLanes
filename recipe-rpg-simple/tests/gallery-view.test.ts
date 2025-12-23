import { MemoryDataService, setDataService } from '../lib/data-service';
import type { RecipeGraph } from '../lib/recipe-lanes/types';
import assert from 'node:assert';

// Mock Graph
const mockGraph: RecipeGraph = {
    title: "Test Recipe",
    lanes: [],
    nodes: [{ id: '1', laneId: 'l1', text: 'Step 1', visualDescription: 'visual', type: 'action' }],
};

async function testGalleryView() {
    console.log("Testing Gallery View Logic...");
    const service = new MemoryDataService();
    setDataService(service);

    console.log(" [1] Public Filter");
    await service.saveRecipe({ ...mockGraph, title: 'Public 1' }, undefined, 'u1', 'public');
    await service.saveRecipe({ ...mockGraph, title: 'Private 1' }, undefined, 'u1', 'private');
    await service.saveRecipe({ ...mockGraph, title: 'Unlisted 1' }, undefined, 'u1', 'unlisted');

    const publicRecipes = await service.getPublicRecipes(10);
    const titles = publicRecipes.map(r => r.title);
    
    assert(titles.includes('Public 1'), "Should contain Public 1");
    assert(!titles.includes('Private 1'), "Should NOT contain Private 1");
    assert(!titles.includes('Unlisted 1'), "Should NOT contain Unlisted 1");

    console.log(" [2] User Filter");
    await service.saveRecipe({ ...mockGraph, title: 'My Public' }, undefined, 'me', 'public');
    await service.saveRecipe({ ...mockGraph, title: 'My Private' }, undefined, 'me', 'private');
    await service.saveRecipe({ ...mockGraph, title: 'Other Public' }, undefined, 'other', 'public');

    const myRecipes = await service.getUserRecipes('me');
    const myTitles = myRecipes.map(r => r.title);

    assert(myTitles.includes('My Public'), "Should see my public");
    assert(myTitles.includes('My Private'), "Should see my private");
    assert(!myTitles.includes('Other Public'), "Should NOT see others");

    console.log(" [3] Starred Filter");
    const id1 = await service.saveRecipe({ ...mockGraph, title: 'Starred One' }, undefined, 'other', 'public');
    const id2 = await service.saveRecipe({ ...mockGraph, title: 'Not Starred' }, undefined, 'other', 'public');

    await service.toggleStar(id1, 'me');

    const starred = await service.getStarredRecipes('me');
    assert.strictEqual(starred.length, 1);
    assert.strictEqual(starred[0].title, 'Starred One');
    
    console.log("Gallery View Tests PASS");
}

testGalleryView().catch(e => {
    console.error(e);
    process.exit(1);
});