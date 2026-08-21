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
    NODE_FIELD_OWNERSHIP,
    CLIENT_FIELDS,
    SERVER_FIELDS,
    STRUCTURAL_FIELDS,
} from '../lib/recipe-lanes/node-fields';

describe('node-fields ownership map (issue #220)', () => {
    it('classifies exactly the expected CLIENT fields', () => {
        assert.deepEqual(
            [...CLIENT_FIELDS].sort(),
            ['rotation', 'shortlistCycled', 'shortlistIndex', 'shortlistSeenAll', 'textPos', 'x', 'y'].sort(),
        );
    });

    it('classifies exactly the expected SERVER fields', () => {
        assert.deepEqual(
            [...SERVER_FIELDS].sort(),
            ['fastMatches', 'hydeQueries', 'iconQuery', 'iconShortlist', 'status'].sort(),
        );
    });

    it('classifies exactly the expected STRUCTURAL fields', () => {
        assert.deepEqual(
            [...STRUCTURAL_FIELDS].sort(),
            [
                'canonicalName',
                'duration',
                'iconTheme',
                'id',
                'inputs',
                'laneId',
                'quantity',
                'temperature',
                'text',
                'type',
                'unit',
                'visualDescription',
            ].sort(),
        );
    });

    it('has no field classified more than once (categories are disjoint)', () => {
        const all = [...CLIENT_FIELDS, ...SERVER_FIELDS, ...STRUCTURAL_FIELDS];
        assert.equal(all.length, new Set(all).size);
    });

    it('the three categories exactly cover every key in the map', () => {
        const fromCategories = new Set([...CLIENT_FIELDS, ...SERVER_FIELDS, ...STRUCTURAL_FIELDS]);
        const fromMap = new Set(Object.keys(NODE_FIELD_OWNERSHIP));
        assert.deepEqual(fromCategories, fromMap);
    });
});
