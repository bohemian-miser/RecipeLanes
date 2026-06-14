import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { setAIService, MockAIService } from '../lib/ai-service';
import { setDataService, MemoryDataService, getDataService } from '../lib/data-service';
import { setAuthService, AuthSession } from '../lib/auth-service';
import { setIconQueueConfig } from '../lib/icon-queue-config';
import { createVisualRecipeAction } from '../app/actions';
import { db } from '../lib/firebase-admin';
import { DB_COLLECTION_CONFIG, ICON_QUEUE_CONFIG_DOC } from '../lib/config';

// Regression: the anon-forge gate must cover recipe CREATION, not just the
// manual "add ingredient" action. Previously an anonymous user could create a
// recipe and have every ingredient's icon FORGED even with allowAnonForge=false,
// because createVisualRecipeAction triggered resolveRecipeIcons ungated.
//
// Note: existing-icon search pre-population is intentionally NOT gated (it is a
// cheap reuse of already-generated icons, not the AI-generation abuse vector).
// So we assert on whether *forging* (resolveRecipeIcons) was triggered, not on
// whether the node ended up with an icon URL.
// Reads config from Firestore -> emulator-backed test.

class MockAuth {
    constructor(private user: AuthSession | null) {}
    async verifyAuth() { return this.user; }
}

class RecipeMockAI extends MockAIService {
    async generateText(): Promise<string> {
        return JSON.stringify({
            title: 'Gate Test',
            lanes: [{ id: 'lane1', label: 'Board', type: 'prep' }],
            nodes: [
                { id: 'n1', laneId: 'lane1', text: '1 Rutabaga', visualDescription: 'Rutabaga', type: 'ingredient' },
            ],
        });
    }
}

// MemoryDataService that records whether forging (resolveRecipeIcons) was triggered.
class SpyDataService extends MemoryDataService {
    forgeTriggered = false;
    async resolveRecipeIcons(id: string, fn?: any): Promise<void> {
        this.forgeTriggered = true;
        return super.resolveRecipeIcons(id, fn);
    }
}

describe('Anon forge gate covers recipe creation (regression)', () => {
    let spy: SpyDataService;

    beforeEach(async () => {
        await db.collection(DB_COLLECTION_CONFIG).doc(ICON_QUEUE_CONFIG_DOC).delete().catch(() => {});
        spy = new SpyDataService();
        setDataService(spy);
        setAIService(new RecipeMockAI());
    });

    afterEach(async () => {
        await db.collection(DB_COLLECTION_CONFIG).doc(ICON_QUEUE_CONFIG_DOC).delete().catch(() => {});
    });

    it('does not forge on anon recipe creation when allowAnonForge is false (recipe still saved)', async () => {
        setAuthService(new MockAuth(null));
        await setIconQueueConfig({ allowAnonForge: false });

        const res = await createVisualRecipeAction('1 Rutabaga');
        assert.ok(res.id, 'recipe should still be created even when forging is blocked');
        assert.strictEqual(spy.forgeTriggered, false, 'forging must NOT run for anon when allowAnonForge is false');
    });

    it('forges on anon recipe creation when allowAnonForge is true', async () => {
        setAuthService(new MockAuth(null));
        await setIconQueueConfig({ allowAnonForge: true });

        const res = await createVisualRecipeAction('1 Rutabaga');
        assert.ok(res.id, 'recipe should be created');
        assert.strictEqual(spy.forgeTriggered, true, 'forging should run for anon when allowAnonForge is true');
    });
});
