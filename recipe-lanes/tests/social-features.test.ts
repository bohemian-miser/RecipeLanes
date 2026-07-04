import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { getDataService, setDataService, MemoryDataService } from '../lib/data-service';
import { hashClaimToken, claimHashForCreate, isValidClaim } from '../lib/recipe-lanes/claim-token';
import { mintClaimToken, storeClaimToken, getClaimToken, clearClaimToken } from '../lib/recipe-lanes/claim-token-client';
import type { RecipeGraph } from '../lib/recipe-lanes/types';

// Mock Graph
const mockGraph: RecipeGraph = {
    title: "Test Recipe",
    lanes: [],
    nodes: [{ id: '1', laneId: 'l1', text: 'Step 1', visualDescription: 'Step 1', type: 'action', x: 0, y: 0 }],
    layouts: {
        'swimlanes': [{ id: '1', x: 10, y: 10 }],
        'dagre': [{ id: '1', x: 20, y: 20 }]
    }
};

describe('Social Features (Memory)', () => {
    let service: any;

    beforeEach(() => {
        setDataService(new MemoryDataService());
        service = getDataService();
    });

    it('should handle ownership and visibility', async () => {
        const id1 = await service.saveRecipe(mockGraph, undefined, 'user-123', 'public');
        const recipe1 = await service.getRecipe(id1);
        
        assert.ok(recipe1, "Recipe should be saved");
        assert.strictEqual(recipe1.ownerId, 'user-123', "Owner ID mismatch");
        assert.strictEqual(recipe1.visibility, 'public', "Visibility mismatch");
    });

    it('should filter public and vetted recipes', async () => {
        const pubId = await service.saveRecipe({ ...mockGraph, title: 'Public One' }, undefined, 'u1', 'public');
        await service.vetRecipe(pubId, true);

        await service.saveRecipe({ ...mockGraph, title: 'Private One' }, undefined, 'u1', 'unlisted');

        const publicRecipes = await service.getPublicRecipes(10);
        const titles = publicRecipes.map((r: any) => r.title);
        assert.ok(titles.includes('Public One'), "Should find public vetted recipe");
        assert.ok(!titles.includes('Private One'), "Should NOT find unlisted recipe");
    });

    it('should hide unvetted recipes from public view', async () => {
        await service.saveRecipe({ ...mockGraph, title: 'Public Unvetted' }, undefined, 'u1', 'public');
        const publicRecipes = await service.getPublicRecipes(10);
        const titles = publicRecipes.map((r: any) => r.title);
        assert.ok(!titles.includes('Public Unvetted'));
    });

    it('should filter recipes by user', async () => {
        await service.saveRecipe({ ...mockGraph, title: 'My Public' }, undefined, 'me', 'public');
        await service.saveRecipe({ ...mockGraph, title: 'My Private' }, undefined, 'me', 'private');
        await service.saveRecipe({ ...mockGraph, title: 'Other Public' }, undefined, 'other', 'public');

        const myRecipes = await service.getUserRecipes('me');
        const myTitles = myRecipes.map((r: any) => r.title);

        assert.ok(myTitles.includes('My Public'));
        assert.ok(myTitles.includes('My Private'));
        assert.ok(!myTitles.includes('Other Public'));
    });

    it('should search public recipes by title and content', async () => {
        const spagId = await service.saveRecipe({ ...mockGraph, title: 'Spaghetti Bolognese' }, undefined, 'u1', 'public');
        await service.vetRecipe(spagId, true);
        
        const results = await service.searchPublicRecipes('Spaghetti');
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].title, 'Spaghetti Bolognese');

        // Search by content (Node text)
        const contentResults = await service.searchPublicRecipes('Step 1');
        assert.ok(contentResults.length >= 1);
    });

    it('should track likes and dislikes', async () => {
        const id1 = await service.saveRecipe(mockGraph, undefined, 'u1', 'public');
        
        // User 1 Likes
        await service.voteRecipe(id1, 'user-1', 'like');
        let r = await service.getRecipe(id1);
        assert.strictEqual(r?.stats?.likes, 1);

        // User 1 Likes again (No change)
        await service.voteRecipe(id1, 'user-1', 'like');
        r = await service.getRecipe(id1);
        assert.strictEqual(r?.stats?.likes, 1);

        // User 1 Dislikes (Switch)
        await service.voteRecipe(id1, 'user-1', 'dislike');
        r = await service.getRecipe(id1);
        assert.strictEqual(r?.stats?.likes, 0);
        assert.strictEqual(r?.stats?.dislikes, 1);
    });

    it('should handle starring recipes', async () => {
        const id1 = await service.saveRecipe(mockGraph, undefined, 'u1', 'public');
        
        const isStarred = await service.toggleStar(id1, 'user-1');
        assert.strictEqual(isStarred, true);

        const starred = await service.getStarredRecipes('user-1');
        assert.strictEqual(starred.length, 1);
        assert.strictEqual(starred[0].id, id1);

        // Unstar
        const isStarred2 = await service.toggleStar(id1, 'user-1');
        assert.strictEqual(isStarred2, false);
        
        const starred2 = await service.getStarredRecipes('user-1');
        assert.strictEqual(starred2.length, 0);
    });

    it('should support copying recipes', async () => {
        const id1 = await service.saveRecipe(mockGraph, undefined, 'u1', 'public');
        const newId = await service.copyRecipe(id1, 'copier');
        const copy = await service.getRecipe(newId);

        assert.strictEqual(copy?.ownerId, 'copier');
        assert.ok(copy?.graph.title?.includes('(Copy)'));
        assert.strictEqual(copy?.visibility, 'unlisted');
    });

    it('should support a copy of a copy, each owned by its own copier', async () => {
        const originalId = await service.saveRecipe(mockGraph, undefined, 'author', 'public');

        const copyId = await service.copyRecipe(originalId, 'copier-1');
        const copy = await service.getRecipe(copyId);
        assert.strictEqual(copy?.ownerId, 'copier-1');
        assert.ok(copy?.graph.title?.includes('(Copy)'));

        const copyOfCopyId = await service.copyRecipe(copyId, 'copier-2');
        const copyOfCopy = await service.getRecipe(copyOfCopyId);
        assert.strictEqual(copyOfCopy?.ownerId, 'copier-2');
        assert.ok(copyOfCopy?.graph.title?.includes('(Copy) (Copy)'));

        // Copying the copy must not mutate the original or the first copy.
        const originalAfter = await service.getRecipe(originalId);
        assert.strictEqual(originalAfter?.ownerId, 'author');
        const copyAfter = await service.getRecipe(copyId);
        assert.strictEqual(copyAfter?.ownerId, 'copier-1');
    });

    it('should let a signed-in user copy an anon-owned public recipe and become its owner', async () => {
        const anonId = await service.saveRecipe(mockGraph, undefined, undefined);
        const anonRecipe = await service.getRecipe(anonId);
        assert.strictEqual(anonRecipe?.ownerId, undefined);
        assert.strictEqual(anonRecipe?.visibility, 'public');

        const copyId = await service.copyRecipe(anonId, 'copier-1');
        const copy = await service.getRecipe(copyId);
        assert.strictEqual(copy?.ownerId, 'copier-1');
        assert.strictEqual(copy?.visibility, 'unlisted');

        // The anon original is untouched by the copy.
        const originalAfter = await service.getRecipe(anonId);
        assert.strictEqual(originalAfter?.ownerId, undefined);
    });

    it('should default an anonymous create to public with ownerName "Anon" (#151)', async () => {
        const id = await service.saveRecipe(mockGraph, undefined, undefined);
        const r = await service.getRecipe(id);
        assert.strictEqual(r?.visibility, 'public');
        assert.strictEqual(r?.ownerId, undefined);
        assert.strictEqual(r?.ownerName, 'Anon');
    });

    it('should default a signed-in create to unlisted with no Anon ownerName (#151)', async () => {
        const id = await service.saveRecipe(mockGraph, undefined, 'user-1');
        const r = await service.getRecipe(id);
        assert.strictEqual(r?.visibility, 'unlisted');
        assert.notStrictEqual(r?.ownerName, 'Anon');
    });

    it('should preserve stored visibility across an autosave that omits it (#151)', async () => {
        const id = await service.saveRecipe(mockGraph, undefined, 'user-1', 'public');
        // Most autosave call sites (e.g. app/lanes/page.tsx) don't pass visibility explicitly.
        await service.saveRecipe({ ...mockGraph, title: 'Edited' }, id, 'user-1');
        const r = await service.getRecipe(id);
        assert.strictEqual(r?.visibility, 'public');
    });

    it('should not let a signed-in save claim ownership of an anon-owned recipe (#151)', async () => {
        const id = await service.saveRecipe(mockGraph, undefined, undefined); // anon create -> public
        await service.saveRecipe({ ...mockGraph, title: 'Edited by a visitor' }, id, 'user-1');
        const r = await service.getRecipe(id);
        assert.strictEqual(r?.ownerId, undefined, 'anon-owned recipe must stay unowned');
        assert.strictEqual(r?.ownerName, 'Anon', 'display name must stay Anon');
        assert.strictEqual(r?.graph.title, 'Edited by a visitor', 'the edit itself should still be saved');
    });

    it('should reject an anonymous save attempt on someone else\'s recipe (#151)', async () => {
        const id = await service.saveRecipe(mockGraph, undefined, 'user-1', 'public');
        await assert.rejects(() => service.saveRecipe({ ...mockGraph, title: 'Hijack attempt' }, id, undefined));
        const r = await service.getRecipe(id);
        assert.strictEqual(r?.ownerId, 'user-1');
        assert.strictEqual(r?.graph.title, 'Test Recipe');
    });

    it('should let a signed-in save claim an anon recipe when it presents the matching claim token (#151)', async () => {
        const id = await service.saveRecipe(mockGraph, undefined, undefined, undefined, undefined, 'secret-token');
        let r = await service.getRecipe(id);
        assert.strictEqual(r?.ownerId, undefined);

        await service.saveRecipe({ ...mockGraph, title: 'Now mine' }, id, 'user-1', undefined, 'Real Name', 'secret-token');
        r = await service.getRecipe(id);
        assert.strictEqual(r?.ownerId, 'user-1');
        assert.strictEqual(r?.ownerName, 'Real Name');
        assert.strictEqual(r?.graph.title, 'Now mine');
    });

    it('should not claim an anon recipe when the presented token is wrong (#151)', async () => {
        const id = await service.saveRecipe(mockGraph, undefined, undefined, undefined, undefined, 'secret-token');
        await service.saveRecipe({ ...mockGraph, title: 'Edited' }, id, 'user-1', undefined, 'Real Name', 'wrong-token');
        const r = await service.getRecipe(id);
        assert.strictEqual(r?.ownerId, undefined, 'wrong token must not transfer ownership');
        assert.strictEqual(r?.ownerName, 'Anon');
        assert.strictEqual(r?.graph.title, 'Edited', 'the edit itself should still be saved');
    });

    it('should not claim an anon recipe that was never given a claim token (#151)', async () => {
        const id = await service.saveRecipe(mockGraph, undefined, undefined); // no claimToken passed at creation
        await service.saveRecipe({ ...mockGraph, title: 'Edited' }, id, 'user-1', undefined, 'Real Name', 'any-token');
        const r = await service.getRecipe(id);
        assert.strictEqual(r?.ownerId, undefined);
    });

    it('should not let a claim token be used a second time after the recipe is claimed (#151)', async () => {
        const id = await service.saveRecipe(mockGraph, undefined, undefined, undefined, undefined, 'secret-token');
        await service.saveRecipe({ ...mockGraph, title: 'Claimed by user-1' }, id, 'user-1', undefined, 'User One', 'secret-token');

        // A different signed-in user presenting the same (now-spent) token
        // must not be able to steal it from user-1.
        await assert.rejects(() => service.saveRecipe({ ...mockGraph, title: 'Steal attempt' }, id, 'user-2', undefined, 'User Two', 'secret-token'));
        const r = await service.getRecipe(id);
        assert.strictEqual(r?.ownerId, 'user-1');
        assert.strictEqual(r?.graph.title, 'Claimed by user-1');
    });

    it('should not let a claim token claim an already-owned (non-anon) recipe (#151)', async () => {
        // Not anon-created, so it has no claim token — presenting any token must be a no-op, not a crash.
        const id = await service.saveRecipe(mockGraph, undefined, 'user-1', 'public');
        await service.saveRecipe({ ...mockGraph, title: 'Edited' }, id, 'user-1', undefined, undefined, 'some-token');
        const r = await service.getRecipe(id);
        assert.strictEqual(r?.ownerId, 'user-1');
    });
});

describe('claim-token lib (#151)', () => {
    it('server policy: stamps a hash only for anon creations, validates only exact tokens', () => {
        assert.strictEqual(claimHashForCreate('user-1', 'tok'), undefined, 'signed-in creator gets no claim hash');
        assert.strictEqual(claimHashForCreate(undefined, undefined), undefined, 'no token, no hash');
        const hash = claimHashForCreate(undefined, 'tok');
        assert.ok(hash && hash !== 'tok', 'anon creation gets a hash, never the raw token');
        assert.strictEqual(hash, hashClaimToken('tok'), 'create-path hash matches the canonical hash');

        assert.strictEqual(isValidClaim('user-1', 'tok', hash), true);
        assert.strictEqual(isValidClaim('user-1', 'wrong', hash), false);
        assert.strictEqual(isValidClaim(undefined, 'tok', hash), false, 'anon callers can never claim');
        assert.strictEqual(isValidClaim('user-1', 'tok', undefined), false, 'no stored hash, no claim');
    });

    it('client helpers: mint/store/get/clear own the localStorage key', () => {
        assert.strictEqual(mintClaimToken(true), undefined, 'signed-in creators mint nothing');
        const token = mintClaimToken(false);
        assert.ok(token && token.length > 0);

        const backing = new Map<string, string>();
        const storage = {
            getItem: (k: string) => backing.get(k) ?? null,
            setItem: (k: string, v: string) => { backing.set(k, v); },
            removeItem: (k: string) => { backing.delete(k); },
        } as unknown as Storage;

        assert.strictEqual(getClaimToken(storage, 'r1'), undefined);
        storeClaimToken(storage, 'r1', token!);
        assert.strictEqual(getClaimToken(storage, 'r1'), token);
        assert.strictEqual(getClaimToken(storage, 'r2'), undefined, 'keys are per-recipe');
        clearClaimToken(storage, 'r1');
        assert.strictEqual(getClaimToken(storage, 'r1'), undefined);
    });
});
