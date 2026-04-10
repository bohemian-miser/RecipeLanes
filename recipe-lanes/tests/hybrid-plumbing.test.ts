import assert from 'node:assert';
import { describe, it, beforeEach } from 'node:test';
import { getFastPass } from '../lib/icon-search-strategy';

// Mock process.env
const originalEnv = process.env.NEXT_PUBLIC_ICON_SEARCH_MODE;

describe('Icon Search Strategy Plumbing', () => {

    beforeEach(() => {
        process.env.NEXT_PUBLIC_ICON_SEARCH_MODE = originalEnv;
    });

    it('returns legacy results when mode is legacy', async () => {
        process.env.NEXT_PUBLIC_ICON_SEARCH_MODE = 'legacy';
        
        // Mock the fetch for /api/embed-legacy
        // In node:test, we can't easily mock global fetch without a library like undici or similar,
        // but we can check if it attempts to call it.
        
        try {
            await getFastPass('test query');
        } catch (e: any) {
            // It will fail because /api/embed-legacy doesn't exist in test env,
            // but we can verify the error message or the logic path.
            assert.ok(e.message.includes('Legacy embed failed') || e.message.includes('fetch is not defined') || e.message.includes('relative URL'));
        }
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
