import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { setAIService } from '../lib/ai-service';
import { MockAIService } from '../lib/ai-service.mock';
import { setDataService, MemoryDataService, getDataService } from '../lib/data-service';
import { setAuthService, MockAuthService } from '../lib/auth-service';
import { createVisualRecipeFromImageAction } from '../app/actions';

// Photo-to-recipe flow (issue #182). The MockAIService.generateTextFromImage
// returns a fixed "Photo Mock Recipe" graph, so we exercise the action's
// validation + save pipeline rather than any real vision model.
const PNG_DATA_URL = 'data:image/png;base64,aGVsbG8gd29ybGQ=';

describe('Photo-to-recipe (issue #182)', () => {
    beforeEach(() => {
        setDataService(new MemoryDataService());
        setAIService(new MockAIService());
        setAuthService(new MockAuthService());
    });

    it('parses a photo data URL into a saved recipe', async () => {
        const result = await createVisualRecipeFromImageAction(PNG_DATA_URL);
        assert.ok(result.id, `Recipe should be created (got error: ${result.error})`);

        const saved = await getDataService().getRecipe(result.id!);
        assert.ok(saved, 'Recipe should be retrievable');
        assert.equal(saved.graph.title, 'Photo Mock Recipe');
        assert.equal(saved.graph.nodes.length, 3);
        // baseServes comes from the parsed graph (mock returns 2).
        assert.equal(saved.graph.serves, 2);
        // The vision model's transcription is stored so the textarea repopulates
        // and the recipe is searchable by content.
        assert.match(saved.graph.originalText ?? '', /Mix eggs and flour/);
    });

    it('rejects a non-image / malformed data URL', async () => {
        const result = await createVisualRecipeFromImageAction('not-a-data-url');
        assert.ok(result.error, 'Should return an error for a malformed payload');
        assert.ok(!result.id, 'Should not create a recipe');
    });

    it('rejects an oversized image before calling the model', async () => {
        // ~7MB of base64 → ~5.25MB decoded, over the 5MB ceiling. 'A' is a valid
        // base64 char and the length is a multiple of 4.
        const huge = `data:image/png;base64,${'A'.repeat(7 * 1024 * 1024)}`;
        const result = await createVisualRecipeFromImageAction(huge);
        assert.ok(result.error, 'Should return an error for an oversized image');
        assert.match(result.error!, /too large/i);
        assert.ok(!result.id, 'Should not create a recipe');
    });

    it('surfaces a model failure as an error', async () => {
        // 'RkFJTA==' is base64 for 'FAIL', which the mock treats as a model failure.
        const result = await createVisualRecipeFromImageAction('data:image/png;base64,RkFJTA==');
        assert.ok(result.error, 'Should return an error when the model output is unparseable');
        assert.ok(!result.id, 'Should not create a recipe');
    });
});
