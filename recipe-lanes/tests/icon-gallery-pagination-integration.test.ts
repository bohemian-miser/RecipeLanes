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

/**
 * Emulator-backed pagination tests for the shared icon gallery (issue #280).
 *
 * tests/icon-gallery-pagination.test.ts covers the paging arithmetic with a
 * stubbed Firestore. This file covers what a stub cannot: that the real
 * Firestore query getPagedIcons builds — `orderBy(...).count()` alongside
 * `orderBy(...).offset(...).limit(...)` — actually behaves as assumed.
 *
 * Requires the Firestore emulator. Run via `npm run test:unit:integration`, or
 * directly with the emulator already running:
 *   npx env-cmd -f .env.test node --import tsx --test tests/icon-gallery-pagination-integration.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getDataService } from '../lib/data-service';
import { db } from '../lib/firebase-admin';
import { DB_COLLECTION_ICON_INDEX } from '../lib/config';

/** Unique per run so a shared emulator instance cannot cross-contaminate. */
const RUN_TAG = `pagintest${Date.now()}`;
const SEEDED_IDS: string[] = [];

async function seedIcon(index: number, name: string): Promise<void> {
    const id = `${RUN_TAG}-${index}`;
    await db.collection(DB_COLLECTION_ICON_INDEX).doc(id).set({
        icon_id: id,
        ingredient_name: name,
        visualDescription: name,
        url: `https://example.com/${id}.png`,
        // Distinct, ordered timestamps — getPagedIcons orders by created_at desc,
        // and documents without the field are excluded from the ordered query.
        created_at: new Date(1_700_000_000_000 + index * 1000),
    });
    SEEDED_IDS.push(id);
}

describe('getPagedIcons pagination (emulator)', () => {
    const service = getDataService();
    let baselineTotal = 0;

    before(async () => {
        baselineTotal = (await service.getPagedIcons(1, 1)).total;
        for (let i = 0; i < 5; i++) {
            await seedIcon(i, `${RUN_TAG} ingredient ${i}`);
        }
    });

    after(async () => {
        await Promise.all(
            SEEDED_IDS.map(id => db.collection(DB_COLLECTION_ICON_INDEX).doc(id).delete()),
        );
    });

    it('total reflects the real collection size via the count() aggregation', async () => {
        // Proves count() is supported and exact: seeding 5 icons moves the total by
        // exactly 5, independent of which page was requested.
        const total = (await service.getPagedIcons(1, 1)).total;
        assert.strictEqual(total, baselineTotal + 5);

        const fromLaterPage = (await service.getPagedIcons(3, 1)).total;
        assert.strictEqual(fromLaterPage, total, 'total must not depend on the requested page');
    });

    it('a single full page does not advertise a phantom next page', async () => {
        // The regression: total used to be (page * limit) + icons.length, so a set
        // that fits on one page still reported two.
        const total = baselineTotal + 5;
        const res = await service.getPagedIcons(1, total);

        assert.strictEqual(res.icons.length, total, 'the whole set must fit on one page');
        assert.strictEqual(res.total, total);
        assert.strictEqual(Math.ceil(res.total / total), 1);
    });

    it('walks pages without skipping or repeating documents', async () => {
        const total = baselineTotal + 5;
        const limit = 2;
        const seen: string[] = [];

        for (let page = 1; page <= Math.ceil(total / limit); page++) {
            const res = await service.getPagedIcons(page, limit);
            assert.strictEqual(res.total, total, `page ${page} must report the real total`);
            seen.push(...res.icons.map((i: any) => i.id));
        }

        assert.strictEqual(seen.length, total, 'every document must appear exactly once');
        assert.strictEqual(new Set(seen).size, total, 'no document may appear twice');
        for (const id of SEEDED_IDS) {
            assert.ok(seen.includes(id), `seeded icon ${id} must appear while paging`);
        }
    });

    it('a page past the end is empty but still reports the real total', async () => {
        const total = baselineTotal + 5;
        const res = await service.getPagedIcons(total + 10, 1);

        assert.deepStrictEqual(res.icons, []);
        assert.strictEqual(res.total, total, 'an over-scrolled pager must be able to find its way back');
    });

    it('search totals count every match, not just the current page', async () => {
        const first = await service.getPagedIcons(1, 2, RUN_TAG);
        assert.strictEqual(first.total, 5, 'all 5 seeded icons match the run tag');
        assert.strictEqual(first.icons.length, 2);
        assert.strictEqual(Math.ceil(first.total / 2), 3);

        const last = await service.getPagedIcons(3, 2, RUN_TAG);
        assert.strictEqual(last.total, 5);
        assert.strictEqual(last.icons.length, 1, 'the third page holds the remaining match');

        const beyond = await service.getPagedIcons(4, 2, RUN_TAG);
        assert.strictEqual(beyond.total, 5);
        assert.deepStrictEqual(beyond.icons, []);

        // Pages must partition the match set.
        const second = await service.getPagedIcons(2, 2, RUN_TAG);
        const ids = [...first.icons, ...second.icons, ...last.icons].map((i: any) => i.id);
        assert.strictEqual(new Set(ids).size, 5);
    });

    it('a search with no matches reports a zero total', async () => {
        const res = await service.getPagedIcons(1, 20, `${RUN_TAG}-no-such-ingredient`);

        assert.deepStrictEqual(res.icons, []);
        assert.strictEqual(res.total, 0);
    });
});
