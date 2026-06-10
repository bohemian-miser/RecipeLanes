/*
 * Copyright (C) 2026 Bohemian Miser
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { selectAIService, RealAIService, MockAIService, NodeCFAIService } from '../lib/ai-service';

// Silence the loud guard logging during assertions.
let errorMock: ReturnType<typeof mock.method>;

describe('selectAIService production guard', () => {
    beforeEach(() => {
        mock.method(console, 'warn', () => {});
        errorMock = mock.method(console, 'error', () => {});
    });
    afterEach(() => {
        mock.restoreAll();
    });

    it('mock flag + prod signal → RealAIService (fail-safe, never placeholders)', () => {
        const svc = selectAIService({ MOCK_AI: 'true', NODE_ENV: 'production' });
        assert.ok(svc instanceof RealAIService);
        // Loud config-leak error must fire.
        assert.equal(errorMock.mock.calls.length, 1);
    });

    it('emulator flag + prod signal → RealAIService', () => {
        const svc = selectAIService({ FUNCTIONS_EMULATOR: 'true', NODE_ENV: 'production' });
        assert.ok(svc instanceof RealAIService);
    });

    it('mock flag + non-prod → MockAIService (dev/test unchanged)', () => {
        const svc = selectAIService({ MOCK_AI: 'true', NODE_ENV: 'development' });
        assert.ok(svc instanceof MockAIService);
    });

    it('emulator flag + no NODE_ENV → MockAIService', () => {
        const svc = selectAIService({ NEXT_PUBLIC_USE_FIREBASE_EMULATOR: 'true' });
        assert.ok(svc instanceof MockAIService);
    });

    it('no mock flag, node_cf mode → NodeCFAIService', () => {
        const svc = selectAIService({ NEXT_PUBLIC_ICON_SEARCH_MODE: 'node_cf' });
        assert.ok(svc instanceof NodeCFAIService);
    });

    it('no flags → RealAIService', () => {
        const svc = selectAIService({});
        assert.ok(svc instanceof RealAIService);
    });
});
