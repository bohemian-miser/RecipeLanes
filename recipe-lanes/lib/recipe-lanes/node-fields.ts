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
 * Exhaustive ownership map for every `RecipeNode` field (issue #220).
 *
 * `mergeNode` (lib/stores/recipe-store.ts) used to decide "structurally
 * identical" from a hand-picked subset of fields (text/quantity/unit/
 * visualDescription + the shortlist key). Any field NOT in that subset —
 * e.g. `status`, `laneId`, `duration` — could change on an incoming
 * snapshot and be silently dropped by the fast path, because the merge
 * never noticed. That is how #220 happened: `failRecipeIcon` writes
 * `status: 'failed'` and nothing else, so the old comparison saw "nothing
 * changed" and returned the stale node — infinite spinner.
 *
 * The fix: classify every field's ownership ONCE, here, and derive the
 * merge algorithm from the map instead of an ad hoc field list. The
 * `satisfies Record<keyof RecipeNode, FieldOwnership>` check below makes
 * forgetting to classify a newly-added `RecipeNode` field a compile error.
 *
 * Ownership categories:
 * - 'client': the client is the source of truth. A background server
 *   snapshot must NOT overwrite the local value (e.g. rendered x/y — see
 *   the design-principles comment in recipe-store.ts for why).
 * - 'server': the server is the source of truth. An incoming value must
 *   win, AND a change to one of these fields must trigger a merge even if
 *   every other field is untouched (this is the #220 fix — status flips
 *   like `pending` -> `failed` must not be swallowed by the fast path).
 * - 'structural': recipe content/topology. Server-authored via
 *   AI generation, but also locally editable (updateNode); either side's
 *   change must be reflected.
 *
 * This map is also intended for a later PR's `saveRecipe` reconciliation,
 * so keep it dependency-light — it imports only the `RecipeNode` type.
 */

import type { RecipeNode } from './types';

export type FieldOwnership = 'client' | 'server' | 'structural';

export const NODE_FIELD_OWNERSHIP = {
    // Structural — recipe content/topology.
    id: 'structural',
    laneId: 'structural',
    text: 'structural',
    visualDescription: 'structural',
    type: 'structural',
    inputs: 'structural',
    temperature: 'structural',
    duration: 'structural',
    quantity: 'structural',
    unit: 'structural',
    canonicalName: 'structural',
    iconTheme: 'structural',

    // Server — the server is authoritative; a change must always be
    // reflected, even in isolation.
    iconShortlist: 'server',
    status: 'server',
    fastMatches: 'server',
    hydeQueries: 'server',
    iconQuery: 'server',

    // Client — the client is authoritative; a background snapshot must
    // never clobber these.
    x: 'client',
    y: 'client',
    rotation: 'client',
    textPos: 'client',
    shortlistIndex: 'client',
    shortlistCycled: 'client',
} as const satisfies Record<keyof RecipeNode, FieldOwnership>;

type NodeFieldOwnershipMap = typeof NODE_FIELD_OWNERSHIP;

function fieldsWithOwnership<O extends FieldOwnership>(
    ownership: O,
): readonly (keyof NodeFieldOwnershipMap & keyof RecipeNode)[] {
    return (Object.keys(NODE_FIELD_OWNERSHIP) as (keyof NodeFieldOwnershipMap)[]).filter(
        (field) => NODE_FIELD_OWNERSHIP[field] === ownership,
    );
}

export const CLIENT_FIELDS: readonly (keyof RecipeNode)[] = fieldsWithOwnership('client');
export const SERVER_FIELDS: readonly (keyof RecipeNode)[] = fieldsWithOwnership('server');
export const STRUCTURAL_FIELDS: readonly (keyof RecipeNode)[] = fieldsWithOwnership('structural');
