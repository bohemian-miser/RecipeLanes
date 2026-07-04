/*
 * Copyright (C) 2026 Bohemian Miser <https://substack.com/@bohemianmiser>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    TERMS_VERSION,
    CONSENT_STORAGE_KEY,
    currentConsentRecord,
    needsConsent,
    hasConsented,
} from '../lib/consent';

// Issue 147: legal consent gate. The consent decision must be driven purely by
// comparing the persisted acceptance against the current terms version, so a
// user is prompted exactly when they have never consented or the terms changed
// since they last did.
describe('consent gate (Issue 147)', () => {
    describe('needsConsent', () => {
        it('requires consent when nothing was ever stored (null)', () => {
            assert.equal(needsConsent(null), true);
        });

        it('requires consent when nothing was ever stored (undefined / no arg)', () => {
            assert.equal(needsConsent(undefined), true);
            assert.equal(needsConsent(), true);
        });

        it('requires consent for an empty or whitespace-only value', () => {
            assert.equal(needsConsent(''), true);
            assert.equal(needsConsent('   '), true);
        });

        it('requires consent when a stale (older) version was accepted', () => {
            assert.equal(needsConsent('2020-01-01'), true);
            assert.notEqual('2020-01-01', TERMS_VERSION);
        });

        it('does NOT require consent when the current version was accepted', () => {
            assert.equal(needsConsent(TERMS_VERSION), false);
        });

        it('tolerates surrounding whitespace on a matching stored value', () => {
            assert.equal(needsConsent(`  ${TERMS_VERSION}  `), false);
        });

        it('requires consent for a non-string persisted value', () => {
            // Defends against a corrupted/legacy localStorage entry.
            assert.equal(needsConsent(123 as unknown as string), true);
            assert.equal(needsConsent({} as unknown as string), true);
        });
    });

    describe('hasConsented', () => {
        it('is the exact inverse of needsConsent', () => {
            assert.equal(hasConsented(TERMS_VERSION), true);
            assert.equal(hasConsented(null), false);
            assert.equal(hasConsented('2020-01-01'), false);
        });
    });

    describe('currentConsentRecord', () => {
        it('persists exactly the current terms version', () => {
            assert.equal(currentConsentRecord(), TERMS_VERSION);
        });

        it('produces a value that immediately satisfies the gate (round-trip)', () => {
            assert.equal(needsConsent(currentConsentRecord()), false);
            assert.equal(hasConsented(currentConsentRecord()), true);
        });
    });

    describe('constants', () => {
        it('exposes a stable, non-empty storage key', () => {
            assert.equal(typeof CONSENT_STORAGE_KEY, 'string');
            assert.ok(CONSENT_STORAGE_KEY.length > 0);
        });

        it('exposes a non-empty terms version', () => {
            assert.equal(typeof TERMS_VERSION, 'string');
            assert.ok(TERMS_VERSION.trim().length > 0);
        });
    });
});
