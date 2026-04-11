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
 * Standalone Firestore helpers for recipe node manipulation.
 * These are extracted from data-service to keep that file focused on
 * higher-level operations and to make the helpers independently testable.
 */

import type { Transaction } from 'firebase-admin/firestore';
import { db } from './firebase-admin';
import { DB_COLLECTION_RECIPES } from './config';
import { mutateNodesByIngredient } from './recipe-lanes/model-utils';

/**
 * Sets or clears the `status` field on all recipe nodes whose standardized
 * ingredient name is in `stdNames`.
 *
 * Pass `undefined` as `status` to delete the field (the normal/done state).
 * Pass an optional `t` to run inside an existing transaction; otherwise
 * creates its own.
 */
export async function setIngredientStatuses(
    recipeId: string,
    stdNames: string[],
    status: 'pending' | 'failed' | undefined,
    t?: Transaction,
): Promise<void> {
    const recipeRef = db.collection(DB_COLLECTION_RECIPES).doc(recipeId);
    const run = async (tx: Transaction) => {
        const doc = await tx.get(recipeRef);
        if (!doc.exists) return;
        const nodes: any[] = doc.data()?.graph?.nodes || [];
        let changed = false;
        for (const stdName of stdNames) {
            changed = mutateNodesByIngredient(nodes, stdName, (n) => {
                if (status === undefined) delete n.status;
                else n.status = status;
            }) || changed;
        }
        if (changed) tx.update(recipeRef, { 'graph.nodes': nodes });
    };
    t ? await run(t) : await db.runTransaction(run);
}
