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
import { deriveIconOwners, pickIconCreator } from '../lib/recipe-lanes/icon-creator';

describe('icon-creator (issue #283)', () => {
    describe('deriveIconOwners', () => {
        it('collects owner UIDs in queue order', () => {
            assert.deepEqual(
                deriveIconOwners([{ ownerId: 'alice' }, { ownerId: 'bob' }]),
                ['alice', 'bob']
            );
        });

        it('deduplicates a user who queued the same icon from several recipes', () => {
            assert.deepEqual(
                deriveIconOwners([{ ownerId: 'alice' }, { ownerId: 'bob' }, { ownerId: 'alice' }]),
                ['alice', 'bob']
            );
        });

        it('drops anonymous recipes, which carry no ownerId', () => {
            assert.deepEqual(
                deriveIconOwners([{}, { ownerId: 'alice' }, {}]),
                ['alice']
            );
        });

        it('drops missing recipe docs without throwing', () => {
            // A recipe deleted mid-forge reads back as undefined from getAll().
            assert.deepEqual(
                deriveIconOwners([undefined, null, { ownerId: 'alice' }]),
                ['alice']
            );
        });

        it('ignores non-string and blank ownerId values', () => {
            assert.deepEqual(
                deriveIconOwners([{ ownerId: 42 }, { ownerId: '' }, { ownerId: '   ' }, { ownerId: 'alice' }]),
                ['alice']
            );
        });

        it('trims surrounding whitespace so it dedupes against the clean UID', () => {
            assert.deepEqual(
                deriveIconOwners([{ ownerId: ' alice ' }, { ownerId: 'alice' }]),
                ['alice']
            );
        });

        it('returns an empty list for no recipes at all', () => {
            assert.deepEqual(deriveIconOwners([]), []);
        });
    });

    describe('pickIconCreator', () => {
        it('attributes the icon to the first owner in queue order', () => {
            assert.equal(pickIconCreator(['alice', 'bob']), 'alice');
        });

        it('returns undefined when nothing is attributable', () => {
            // Callers omit the field entirely rather than writing null to Firestore.
            assert.equal(pickIconCreator([]), undefined);
        });
    });

    describe('end-to-end shape', () => {
        it('leaves a fully anonymous forge unattributed', () => {
            const owners = deriveIconOwners([{}, {}]);
            assert.deepEqual(owners, []);
            assert.equal(pickIconCreator(owners), undefined);
        });

        it('attributes a normal single-recipe forge to that recipe owner', () => {
            const owners = deriveIconOwners([{ ownerId: 'mock-user' }]);
            assert.equal(pickIconCreator(owners), 'mock-user');
        });
    });
});
