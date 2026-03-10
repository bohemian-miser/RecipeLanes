import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getDataService, setDataService, MemoryDataService } from '../lib/data-service';

describe('Stats Logic (Memory)', () => {
    it('should track impressions and rejections correctly', async () => {
        // Force Memory Service for Unit Test
        setDataService(new MemoryDataService());
        const service = getDataService();

        const ingName = 'Test Ingredient';
        const iconData = {
            id: 'icon-1', // Note: MemoryStore will replace this with its own ID
            url: 'http://test/icon1.png',
            score: 0,
            impressions: 0,
            rejections: 0,
            metadata: { center: { x: 0, y: 0 }, bbox: { x: 0, y: 0, w: 1, h: 1 } }
        };

        const stdId = 'test-ingredient';

        // 1. Publish (Returns the actual IconStats with the new generated ID)
        const published = await service.publishIcon(stdId, ingName, iconData);
        const actualId = published.id;
        
        // 2. Record Impression using the actual generated ID
        await service.recordImpression(stdId, actualId);
        let icons = await service.getIconsForIngredient(stdId);
        assert.strictEqual(icons[0].impressions, 1, 'Impression count should be 1');
        assert.strictEqual(icons[0].rejections, 0, 'Rejection count should be 0');

        // 3. Record Rejection
        await service.recordRejection(iconData.url, ingName, stdId);
        icons = await service.getIconsForIngredient(stdId);
        assert.strictEqual(icons[0].rejections, 1, 'Rejection count should be 1');
        
        // 4. Verify Score
        assert.ok(typeof (icons[0].popularity_score) === 'number', 'Score should be a number');
    });
});
