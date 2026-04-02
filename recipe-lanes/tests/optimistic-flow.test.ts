import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { setAIService, MockAIService } from '../lib/ai-service';
import { setDataService, MemoryDataService, getDataService } from '../lib/data-service';
import { setAuthService, MockAuthService } from '../lib/auth-service';
import { createVisualRecipeAction } from '../app/actions';
import { getNodeIconUrl } from '../lib/recipe-lanes/model-utils';

// Mock Next.js headers/cookies/navigation
// We need to mock these before importing actions that use them
// But since we use setAuthService(MockAuthService), we might bypass some.

class CustomMockAIService extends MockAIService {
    async generateText(): Promise<string> {
        return JSON.stringify({
            title: "Carrot and Onion",
            lanes: [{ id: "lane1", label: "Board", type: "prep" }],
            nodes: [
                { id: "n1", laneId: "lane1", text: "1 Carrot", visualDescription: "Carrot", type: "ingredient" },
                { id: "n2", laneId: "lane1", text: "1 Onion", visualDescription: "Onion", type: "ingredient" }
            ]
        });
    }
}

describe('Optimistic Flow (Memory)', () => {
    let service: any;

    beforeEach(() => {
        setDataService(new MemoryDataService());
        setAIService(new CustomMockAIService());
        setAuthService(new MockAuthService());
        service = getDataService();
    });

    it('should use cached icons optimistically', async () => {
        // 1. Seed Cache for Carrot
        const carrotIcon = {
            id: 'icon-carrot',
            url: 'http://test/carrot.png',
            score: 1.0,
            metadata: { center: { x: 0.5, y: 0.5 }, bbox: { x: 0, y: 0, w: 1, h: 1 } }
        };
        await service.publishIcon('carrot', 'Carrot', carrotIcon);

        // 2. Create Recipe
        const result = await createVisualRecipeAction("1 Carrot and 1 Onion");
        assert.ok(result.id, "Recipe should be created");

        // 3. Verify
        const saved = await service.getRecipe(result.id);
        assert.ok(saved, "Recipe should be retrievable");

        const carrotNode = saved.graph.nodes.find((n: any) => n.visualDescription === 'Carrot');
        const onionNode = saved.graph.nodes.find((n: any) => n.visualDescription === 'Onion');

        assert.ok(carrotNode, "Carrot node missing");
        assert.ok(onionNode, "Onion node missing");

        // Carrot should HAVE a derived icon URL (path derived from icon id + ingredient name)
        const carrotUrl = getNodeIconUrl(carrotNode);
        assert.ok(typeof carrotUrl === 'string' && carrotUrl.length > 0, 'Carrot should have a derived icon URL');

        // Onion should NOT have an icon yet (it was just queued)
        // MemoryDataService.resolveRecipeIcons automatically assigns mock icons for queued items 
        // to simulate the async process finishing instantly in memory.
        // Let's verify it got SOME icon.
        assert.ok(getNodeIconUrl(onionNode), "Onion should have a generated mock icon");
    });
});
