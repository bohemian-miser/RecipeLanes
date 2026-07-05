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

// Consent / Terms of Service gating logic (Issue 147).
//
// Pure, dependency-free helpers so they can be unit-tested and reused on both
// the client (sign-in gate) and server. Bump CURRENT_TERMS_VERSION whenever the
// Terms of Service change materially — users whose stored acceptance predates
// the new version are treated as not having consented and are re-prompted.

export const CURRENT_TERMS_VERSION = '2026-07-04';

/** A user's stored record of Terms of Service acceptance. */
export interface ConsentRecord {
  /** The Terms version string the user last accepted, if any. */
  termsVersion?: string | null;
  /** ISO timestamp of when they accepted, if any. */
  acceptedAt?: string | null;
}

/**
 * True when the user must (re-)accept the Terms of Service before proceeding.
 *
 * A user needs to accept when they have no recorded acceptance, or when the
 * version they accepted differs from the current one (i.e. the terms changed
 * since they last agreed).
 */
export function needsTermsAcceptance(
  record: ConsentRecord | null | undefined,
  currentVersion: string = CURRENT_TERMS_VERSION,
): boolean {
  const accepted = record?.termsVersion;
  if (!accepted) return true;
  return accepted !== currentVersion;
}

/**
 * Whether a sign-in / continue action may proceed.
 *
 * It may proceed if the user has ticked the "I agree" box in the current form
 * (`agreedNow`), or if they already have a valid, up-to-date recorded
 * acceptance and therefore don't need to consent again.
 */
export function canProceedToSignIn(
  agreedNow: boolean,
  record?: ConsentRecord | null,
  currentVersion: string = CURRENT_TERMS_VERSION,
): boolean {
  return agreedNow || !needsTermsAcceptance(record, currentVersion);
}

/** Build a fresh consent record for the current terms version. */
export function makeConsentRecord(acceptedAt: string): ConsentRecord {
  return { termsVersion: CURRENT_TERMS_VERSION, acceptedAt };
}
