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

import { getDataService } from '../lib/data-service';
import type { RecipeGraph } from '../lib/recipe-lanes/types';
import { db } from '../lib/firebase-admin';
import assert from 'node:assert';

// Mock Graph
const mockGraph: RecipeGraph = {
    title: "Test Recipe",
    lanes: [],
    nodes: [{ id: '1', laneId: 'l1', text: 'Step 1', visualDescription: 'visual', type: 'action' }],
};

async function testGalleryView() {
    console.log("Testing Gallery View Logic...");
    const service = getDataService();

    console.log(" [1] Public Filter");
    const pubId = await service.saveRecipe({ ...mockGraph, title: 'Public 1' }, undefined, 'u1', 'public');
    await db.collection('recipes').doc(pubId).update({ isVetted: true });

    await service.saveRecipe({ ...mockGraph, title: 'Private 1' }, undefined, 'u1', 'private');
    await service.saveRecipe({ ...mockGraph, title: 'Unlisted 1' }, undefined, 'u1', 'unlisted');

    const publicRecipes = await service.getPublicRecipes(10);
    const titles = publicRecipes.map(r => r.title);
    
    assert(titles.includes('Public 1'), "Should contain Public 1");
    assert(!titles.includes('Private 1'), "Should NOT contain Private 1");
    assert(!titles.includes('Unlisted 1'), "Should NOT contain Unlisted 1");
    
    // Test that unvetted is hidden
    const unvettedId = await service.saveRecipe({ ...mockGraph, title: 'Public Unvetted' }, undefined, 'u1', 'public');
    const publicRecipes2 = await service.getPublicRecipes(10);
    const titles2 = publicRecipes2.map(r => r.title);
    assert(!titles2.includes('Public Unvetted'), "Should NOT contain Unvetted recipe");

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