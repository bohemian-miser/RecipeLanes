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
 * Anon recipe-claim policy (#151 follow-up), in one place.
 *
 * An anonymously created recipe mints a random token in the creator's browser
 * (see claim-token-client.ts); the server stores only its SHA-256 hash on the
 * recipe doc. A later signed-in save that presents the original token — and
 * only that — moves ownership to the caller, and only while the recipe still
 * has no owner. Both DataService implementations delegate here so the rules
 * can't drift apart.
 *
 * Server-only: uses node crypto. The browser half lives in
 * claim-token-client.ts.
 */

import { createHash } from 'crypto';

export function hashClaimToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

/**
 * Create path: the hash to stamp on a brand-new recipe doc, or undefined.
 * Only anon creations carry a claim hash — a signed-in creator already owns
 * the recipe.
 */
export function claimHashForCreate(userId: string | undefined, claimToken: string | undefined): string | undefined {
    return !userId && claimToken ? hashClaimToken(claimToken) : undefined;
}

/**
 * Update path: does this save prove ownership of a still-unowned recipe?
 * Callers must already have established that the recipe has no ownerId —
 * this only checks the token proof.
 */
export function isValidClaim(userId: string | undefined, claimToken: string | undefined, storedHash: string | undefined): boolean {
    return !!userId && !!claimToken && !!storedHash && hashClaimToken(claimToken) === storedHash;
}
