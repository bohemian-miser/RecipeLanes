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
import { computeCanTrack } from '../lib/analytics';
import { TERMS_VERSION } from '../lib/consent';

// GA4 funnel analytics (Issue: analytics-funnel-events). computeCanTrack is the
// pure guard behind track() — it must refuse to track whenever any one of the
// hard guards fails, and only allow it when every guard passes.
describe('analytics guard (computeCanTrack)', () => {
    const consented = { hasWindow: true, useEmulator: undefined, measurementId: 'G-TEST123', consentStored: TERMS_VERSION };

    it('is a no-op outside the browser (no window)', () => {
        assert.equal(computeCanTrack({ ...consented, hasWindow: false }), false);
    });

    it('is a no-op when pointed at the Firebase emulators', () => {
        assert.equal(computeCanTrack({ ...consented, useEmulator: 'true' }), false);
    });

    it('is a no-op when no measurement ID is configured', () => {
        assert.equal(computeCanTrack({ ...consented, measurementId: undefined }), false);
        assert.equal(computeCanTrack({ ...consented, measurementId: '' }), false);
    });

    it('is a no-op when the user has not consented', () => {
        assert.equal(computeCanTrack({ ...consented, consentStored: null }), false);
        assert.equal(computeCanTrack({ ...consented, consentStored: '2020-01-01' }), false);
    });

    it('allows tracking only when every guard passes', () => {
        assert.equal(computeCanTrack(consented), true);
    });

    it('tolerates an emulator flag value other than the string "true"', () => {
        assert.equal(computeCanTrack({ ...consented, useEmulator: 'false' }), true);
        assert.equal(computeCanTrack({ ...consented, useEmulator: undefined }), true);
    });
});
