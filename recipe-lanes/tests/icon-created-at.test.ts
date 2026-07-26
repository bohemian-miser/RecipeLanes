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
import { getIconCreatedAtMs, formatIconCreatedAt } from '../lib/recipe-lanes/icon-created-at';

// A fixed instant: 2026-07-24T00:14:35.752Z
const ISO = '2026-07-24T00:14:35.752Z';
const MS = Date.parse(ISO); // 1784...

describe('icon-created-at (issue #279)', () => {
    describe('getIconCreatedAtMs', () => {
        it('parses an ISO-8601 string (production data service)', () => {
            assert.equal(getIconCreatedAtMs(ISO), MS);
        });

        it('passes through an epoch-ms number (memory/test data service)', () => {
            assert.equal(getIconCreatedAtMs(MS), MS);
        });

        it('returns null for null / undefined / empty string', () => {
            assert.equal(getIconCreatedAtMs(null), null);
            assert.equal(getIconCreatedAtMs(undefined), null);
            assert.equal(getIconCreatedAtMs(''), null);
        });

        it('returns null for an unparseable value', () => {
            assert.equal(getIconCreatedAtMs('not-a-date'), null);
        });
    });

    describe('formatIconCreatedAt', () => {
        it('formats an ISO string as deterministic UTC (YYYY-MM-DD HH:mm UTC)', () => {
            assert.equal(formatIconCreatedAt(ISO), '2026-07-24 00:14 UTC');
        });

        it('formats an epoch-ms number identically to the equivalent ISO string', () => {
            assert.equal(formatIconCreatedAt(MS), formatIconCreatedAt(ISO));
            assert.equal(formatIconCreatedAt(MS), '2026-07-24 00:14 UTC');
        });

        it('zero-pads month, day, hour and minute', () => {
            // 2026-01-05T03:07:00Z -> single-digit month/day/hour/minute
            assert.equal(formatIconCreatedAt('2026-01-05T03:07:00.000Z'), '2026-01-05 03:07 UTC');
        });

        it('returns "Unknown" when the timestamp is missing', () => {
            assert.equal(formatIconCreatedAt(null), 'Unknown');
            assert.equal(formatIconCreatedAt(undefined), 'Unknown');
            assert.equal(formatIconCreatedAt(''), 'Unknown');
        });

        it('returns "Unknown" for an unparseable value', () => {
            assert.equal(formatIconCreatedAt('garbage'), 'Unknown');
        });
    });
});
