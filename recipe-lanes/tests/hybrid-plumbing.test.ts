import assert from 'node:assert';
import { describe, it, beforeEach } from 'node:test';
import { getFastPass } from '../lib/icon-search-strategy';
import { setAIService } from '../lib/ai-service';
import { MockAIService } from '../lib/ai-service.mock';

// Mock process.env
const originalEnv = process.env.NEXT_PUBLIC_ICON_SEARCH_MODE;

describe('Icon Search Strategy Plumbing', () => {

    beforeEach(() => {
        process.env.NEXT_PUBLIC_ICON_SEARCH_MODE = originalEnv;
        // Inject the mock AI service (pure DI). Without this, getFastPass('legacy')
        // would reach getLegacyEmbeddingAction -> getAIService().embedTexts(), which
        // now defaults to the RealAIService and blocks ~600s on a Firestore/Vertex
        // connection in CI before throwing — there is no MOCK_AI env flag anymore.
        setAIService(new MockAIService());
    });

    it('returns legacy results when mode is legacy', async () => {
        process.env.NEXT_PUBLIC_ICON_SEARCH_MODE = 'legacy';

        // The legacy path embeds the query via the injected AI service and returns
        // an empty fast-match set (vector search happens later in the pipeline).
        const res = await getFastPass('test query');

        assert.ok(Array.isArray(res.embedding) && res.embedding.length > 0,
            'legacy mode should return a non-empty embedding from the AI service');
        assert.deepStrictEqual(res.fast_matches, [],
            'legacy mode returns no inline fast matches');
        assert.ok(typeof res.snapshot_timestamp === 'number',
            'legacy mode should stamp a snapshot timestamp');
    });

    it('throws error for unimplemented browser mode', async () => {
        process.env.NEXT_PUBLIC_ICON_SEARCH_MODE = 'browser';
        await assert.rejects(
            () => getFastPass('test'),
            /Browser execution mode not fully migrated/
        );
    });

    it('identifies invalid search modes', async () => {
        // @ts-ignore
        process.env.NEXT_PUBLIC_ICON_SEARCH_MODE = 'invalid-mode';
        await assert.rejects(
            () => getFastPass('test'),
            /Invalid search mode/
        );
    });
});
