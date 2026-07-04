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
 * Browser half of the anon recipe-claim flow (#151 follow-up): mints the
 * plaintext token and owns its localStorage key. The server half (hashing and
 * the claim rules) lives in claim-token.ts. Takes the Storage as a parameter
 * (like draft-persistence.ts) so it stays testable without a browser.
 */

const claimKey = (recipeId: string) => `claim_token_${recipeId}`;

/** Mint a fresh token for an anon creation; signed-in creators don't need one. */
export function mintClaimToken(isSignedIn: boolean): string | undefined {
    return isSignedIn ? undefined : crypto.randomUUID();
}

export function storeClaimToken(storage: Storage, recipeId: string, token: string): void {
    storage.setItem(claimKey(recipeId), token);
}

export function getClaimToken(storage: Storage, recipeId: string): string | undefined {
    return storage.getItem(claimKey(recipeId)) ?? undefined;
}

export function clearClaimToken(storage: Storage, recipeId: string): void {
    storage.removeItem(claimKey(recipeId));
}
