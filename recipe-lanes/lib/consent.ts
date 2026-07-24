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
 * Legal consent tracking (Issue 147).
 *
 * Single source of truth for the current Terms of Service / Privacy Policy
 * version and whether a given stored consent value still satisfies it. All of
 * the decision logic lives here so it is pure and unit-testable; the
 * `ConsentBanner` component is only a thin localStorage + UI wrapper around
 * these helpers, and the Terms page renders `TERMS_VERSION` as its
 * "last updated" marker.
 */

/**
 * The version of the Terms of Service / Privacy Policy currently in effect.
 *
 * Bump this (to a later date string) whenever the legal terms materially
 * change: users who previously accepted an older version will then be
 * re-prompted to consent, because {@link needsConsent} compares against it.
 */
export const TERMS_VERSION = '2026-07-04';

/**
 * The `localStorage` key under which the accepted terms version is persisted.
 * Namespaced to avoid collisions with other app state.
 */
export const CONSENT_STORAGE_KEY = 'recipelanes.consent.version';

/**
 * The value to persist when the user accepts the terms currently in effect.
 */
export function currentConsentRecord(): string {
    return TERMS_VERSION;
}

/**
 * Whether the user still needs to (re-)consent, given the value previously
 * persisted under {@link CONSENT_STORAGE_KEY} (`null`/`undefined` when nothing
 * was ever stored).
 *
 * Returns `true` when there is no stored value, when it is a non-string, when
 * it is blank/whitespace, or when it does not match the current
 * {@link TERMS_VERSION} (i.e. the terms changed since the user last agreed).
 * Returns `false` only when the stored value matches the current version.
 */
export function needsConsent(stored?: string | null): boolean {
    if (typeof stored !== 'string') return true;
    return stored.trim() !== TERMS_VERSION;
}

/**
 * Inverse of {@link needsConsent}: whether the stored value satisfies the
 * terms currently in effect.
 */
export function hasConsented(stored?: string | null): boolean {
    return !needsConsent(stored);
}
