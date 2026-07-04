import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { getDataService, setDataService, MemoryDataService } from '../lib/data-service';
import { memoryStore } from '../lib/store';
import { setAIService } from '../lib/ai-service';
import { MockAIService } from '../lib/ai-service.mock';
import { setAuthService, MockAuthService } from '../lib/auth-service';
import { createVisualRecipeAction } from '../app/actions';
import { getNodeIconUrl } from '../lib/recipe-lanes/model-utils';
import { looksLikeUrl } from '../lib/recipe-lanes/input-utils';
import { standardizeIngredientName } from '../lib/utils';

describe('standardizeIngredientName', () => {
    it('folds accents/diacritics to ASCII', () => {
        assert.strictEqual(standardizeIngredientName('jalapeño'), 'Jalapeno');
        assert.strictEqual(standardizeIngredientName('Sautéed Crème'), 'Sauteed Creme');
        // Accented and unaccented forms produce the same key
        assert.strictEqual(
            standardizeIngredientName('purée'),
            standardizeIngredientName('puree')
        );
    });
});

// Mock Graph
const mockGraph: any = {
    title: "Test Recipe",
    lanes: [],
    nodes: [{ id: '1', laneId: 'l1', text: 'Step 1', visualDescription: 'Step 1', type: 'action', x: 0, y: 0 }],
};

describe('Data Service & Actions', () => {
    let service: any;

    beforeEach(() => {
        memoryStore.clear();
        setDataService(new MemoryDataService());
        setAIService(new MockAIService());
        setAuthService(new MockAuthService());
        service = getDataService();
    });

    describe('Social & Gallery', () => {
        it('should handle visibility and vetting', async () => {
            const id = await service.saveRecipe({ ...mockGraph, title: 'Public' }, undefined, 'u1', 'public');
            await service.vetRecipe(id, true);
            const publicRecipes = await service.getPublicRecipes(10);
            assert.ok(publicRecipes.some((r: any) => r.title === 'Public'));
        });

        it('should handle starring', async () => {
            const id = await service.saveRecipe(mockGraph, undefined, 'u1', 'public');
            await service.toggleStar(id, 'u1');
            const starred = await service.getStarredRecipes('u1');
            assert.strictEqual(starred.length, 1);
        });
    });

    describe('Optimistic Actions', () => {
        it('should use cached icons in createVisualRecipeAction', async () => {
            const carrotIcon = { id: 'c1', url: 'carrot.png', score: 1.0 };
            await service.publishIcon('carrot', 'Carrot', carrotIcon);

            // Mock AI to return a Carrot
            class CarrotAI extends MockAIService {
                async generateText() {
                    return JSON.stringify({
                        title: "Carrot",
                        lanes: [],
                        nodes: [{ id: "n1", text: "Carrot", visualDescription: "Carrot", type: "ingredient" }]
                    });
                }
            }
            setAIService(new CarrotAI());

            const result = await createVisualRecipeAction("Carrot");
            const saved = await service.getRecipe(result.id);
            const carrotNode = saved.graph.nodes[0];
            const iconUrl = getNodeIconUrl(carrotNode);
            assert.ok(typeof iconUrl === 'string' && iconUrl.length > 0, 'carrot node should have a derived icon URL');
        });
    });

    describe('Anon visibility & fork ownership (#151)', () => {
        it('defaults an anonymous createVisualRecipeAction to public', async () => {
            setAuthService(new MockAuthService(null));
            const result = await createVisualRecipeAction('1 Onion');
            assert.ok(result.id);
            const saved = await service.getRecipe(result.id);
            assert.strictEqual(saved.visibility, 'public');
            assert.strictEqual(saved.ownerId, undefined);
        });

        it('defaults a signed-in createVisualRecipeAction to unlisted', async () => {
            setAuthService(new MockAuthService({ uid: 'author-1', isAdmin: false }));
            const result = await createVisualRecipeAction('1 Onion');
            const saved = await service.getRecipe(result.id);
            assert.strictEqual(saved.visibility, 'unlisted');
            assert.strictEqual(saved.ownerId, 'author-1');
        });

        it('forking someone else\'s recipe creates a new doc and does not touch the original', async () => {
            setAuthService(new MockAuthService({ uid: 'author-1', isAdmin: false }));
            const original = await createVisualRecipeAction('1 Onion');

            setAuthService(new MockAuthService({ uid: 'forker-1', isAdmin: false }));
            const fork = await createVisualRecipeAction('1 Onion', original.id);

            assert.notStrictEqual(fork.id, original.id);
            const forkedRecipe = await service.getRecipe(fork.id);
            assert.strictEqual(forkedRecipe.ownerId, 'forker-1');
            assert.strictEqual(forkedRecipe.graph.sourceId, original.id);
            assert.ok(forkedRecipe.graph.title?.startsWith('Copy of '));

            const originalAfter = await service.getRecipe(original.id);
            assert.strictEqual(originalAfter.ownerId, 'author-1');
        });

        it('forking a fork chains sourceId (copy of a copy)', async () => {
            setAuthService(new MockAuthService({ uid: 'author-1', isAdmin: false }));
            const original = await createVisualRecipeAction('1 Onion');

            setAuthService(new MockAuthService({ uid: 'forker-1', isAdmin: false }));
            const fork1 = await createVisualRecipeAction('1 Onion', original.id);

            setAuthService(new MockAuthService({ uid: 'forker-2', isAdmin: false }));
            const fork2 = await createVisualRecipeAction('1 Onion', fork1.id);

            const fork2Recipe = await service.getRecipe(fork2.id);
            assert.strictEqual(fork2Recipe.ownerId, 'forker-2');
            assert.strictEqual(fork2Recipe.graph.sourceId, fork1.id);

            // The first fork must remain owned by forker-1, untouched by the second fork.
            const fork1Recipe = await service.getRecipe(fork1.id);
            assert.strictEqual(fork1Recipe.ownerId, 'forker-1');
        });

        it('forking an anon-owned public recipe does not grant ownership of the original', async () => {
            setAuthService(new MockAuthService(null));
            const original = await createVisualRecipeAction('1 Onion');
            const originalRecipe = await service.getRecipe(original.id);
            assert.strictEqual(originalRecipe.ownerId, undefined);
            assert.strictEqual(originalRecipe.visibility, 'public');

            setAuthService(new MockAuthService({ uid: 'forker-1', isAdmin: false }));
            const fork = await createVisualRecipeAction('1 Onion', original.id);

            const forkedRecipe = await service.getRecipe(fork.id);
            assert.strictEqual(forkedRecipe.ownerId, 'forker-1');

            const originalAfter = await service.getRecipe(original.id);
            assert.strictEqual(originalAfter.ownerId, undefined, 'anon original must remain unowned');
            assert.strictEqual(originalAfter.ownerName, 'Anon');
        });
    });
});

describe('looksLikeUrl', () => {
    it('flags bare URLs', () => {
        assert.equal(looksLikeUrl('https://example.com/recipe'), true);
        assert.equal(looksLikeUrl('http://foo.com'), true);
        assert.equal(looksLikeUrl('  https://example.com/recipe  '), true);
        assert.equal(looksLikeUrl('www.example.com/recipe'), true);
    });

    it('does not flag real recipe text', () => {
        assert.equal(looksLikeUrl(''), false);
        assert.equal(looksLikeUrl('   '), false);
        assert.equal(looksLikeUrl('1 cup flour\n2 eggs'), false);
        assert.equal(looksLikeUrl('See more at https://example.com for tips'), false);
        assert.equal(looksLikeUrl('Carrot soup'), false);
    });
});
