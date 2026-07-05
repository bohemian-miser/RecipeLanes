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
  CURRENT_TERMS_VERSION,
  needsTermsAcceptance,
  canProceedToSignIn,
  makeConsentRecord,
} from '../lib/legal/consent';

describe('consent gate (Issue 147: require ToS acceptance)', () => {
  describe('needsTermsAcceptance', () => {
    it('requires acceptance when there is no record', () => {
      assert.equal(needsTermsAcceptance(null), true);
      assert.equal(needsTermsAcceptance(undefined), true);
      assert.equal(needsTermsAcceptance({}), true);
    });

    it('requires acceptance when termsVersion is empty/nullish', () => {
      assert.equal(needsTermsAcceptance({ termsVersion: null }), true);
      assert.equal(needsTermsAcceptance({ termsVersion: '' }), true);
    });

    it('does not require acceptance when the accepted version is current', () => {
      assert.equal(
        needsTermsAcceptance({ termsVersion: CURRENT_TERMS_VERSION }),
        false,
      );
    });

    it('requires re-acceptance when the accepted version is stale', () => {
      assert.equal(
        needsTermsAcceptance({ termsVersion: '2000-01-01' }),
        true,
      );
    });

    it('compares against an explicitly passed current version', () => {
      assert.equal(
        needsTermsAcceptance({ termsVersion: 'v2' }, 'v2'),
        false,
      );
      assert.equal(
        needsTermsAcceptance({ termsVersion: 'v1' }, 'v2'),
        true,
      );
    });
  });

  describe('canProceedToSignIn', () => {
    it('blocks when the user has not agreed and has no prior acceptance', () => {
      assert.equal(canProceedToSignIn(false), false);
      assert.equal(canProceedToSignIn(false, null), false);
    });

    it('allows when the user ticks the agree box now', () => {
      assert.equal(canProceedToSignIn(true), true);
      assert.equal(canProceedToSignIn(true, null), true);
    });

    it('allows without re-ticking when a current acceptance already exists', () => {
      assert.equal(
        canProceedToSignIn(false, { termsVersion: CURRENT_TERMS_VERSION }),
        true,
      );
    });

    it('blocks a stale prior acceptance until the user re-agrees', () => {
      assert.equal(
        canProceedToSignIn(false, { termsVersion: '2000-01-01' }),
        false,
      );
      assert.equal(
        canProceedToSignIn(true, { termsVersion: '2000-01-01' }),
        true,
      );
    });
  });

  describe('makeConsentRecord', () => {
    it('stamps the current terms version and the given timestamp', () => {
      const ts = '2026-07-04T12:00:00.000Z';
      const record = makeConsentRecord(ts);
      assert.equal(record.termsVersion, CURRENT_TERMS_VERSION);
      assert.equal(record.acceptedAt, ts);
      // A freshly-made record should satisfy the gate without re-agreeing.
      assert.equal(needsTermsAcceptance(record), false);
    });
  });
});
