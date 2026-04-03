import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { getDataService, setDataService, MemoryDataService } from '../lib/data-service';
import { memoryStore } from '../lib/store';
import { setAIService, MockAIService } from '../lib/ai-service';
import { setAuthService, MockAuthService } from '../lib/auth-service';
import { createVisualRecipeAction } from '../app/actions';
import { getNodeIconUrl } from '../lib/recipe-lanes/model-utils';

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
});
