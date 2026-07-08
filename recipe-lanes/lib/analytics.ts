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
 * GA4 user-funnel analytics (client-only).
 *
 * `track()` is the only export call sites should use: it is synchronous,
 * fire-and-forget, and never throws — an analytics outage must never break
 * the app. All initialization is lazy and internal.
 *
 * Analytics stays a silent no-op unless ALL of the following hold:
 *  - we are running in the browser (`typeof window !== 'undefined'`);
 *  - we are NOT pointed at the Firebase emulators (`NEXT_PUBLIC_USE_FIREBASE_EMULATOR`
 *    is how emulator/test mode is detected — see firebase-client.ts);
 *  - a GA4 measurement ID is configured (`NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID`);
 *  - the user has consented to the Terms of Service / Privacy Policy (Issue 147);
 *  - `isSupported()` (from `firebase/analytics`) resolves true.
 */

import type { Analytics } from 'firebase/analytics';
import { app } from './firebase-client';
import { CONSENT_STORAGE_KEY, hasConsented } from './consent';

type AnalyticsHandle = { analytics: Analytics; logEvent: typeof import('firebase/analytics').logEvent };

let analyticsPromise: Promise<AnalyticsHandle | null> | null = null;

function getAnalyticsHandle(): Promise<AnalyticsHandle | null> {
    if (!analyticsPromise) {
        analyticsPromise = (async () => {
            try {
                if (!app) return null;
                const { getAnalytics, isSupported, logEvent } = await import('firebase/analytics');
                const supported = await isSupported();
                if (!supported) return null;
                return { analytics: getAnalytics(app), logEvent };
            } catch {
                return null;
            }
        })();
    }
    return analyticsPromise;
}

/**
 * Pure decision logic behind the guard, extracted so it is unit-testable
 * without a browser/emulator: given the inputs {@link canTrack} would
 * otherwise read from `window`/`process.env` itself, decide whether it is
 * safe to send an event.
 */
export function computeCanTrack(params: {
    hasWindow: boolean;
    useEmulator: string | undefined;
    measurementId: string | undefined;
    consentStored: string | null | undefined;
}): boolean {
    const { hasWindow, useEmulator, measurementId, consentStored } = params;
    if (!hasWindow) return false;
    if (useEmulator === 'true') return false;
    if (!measurementId) return false;
    return hasConsented(consentStored);
}

/**
 * Synchronous guards only — no async work, so this is cheap to call on every
 * `track()` invocation.
 */
function canTrack(): boolean {
    const hasWindow = typeof window !== 'undefined';
    let consentStored: string | null = null;
    if (hasWindow) {
        try {
            consentStored = window.localStorage.getItem(CONSENT_STORAGE_KEY);
        } catch {
            // localStorage unavailable (e.g. privacy mode) — treat as no consent.
            consentStored = null;
        }
    }
    return computeCanTrack({
        hasWindow,
        useEmulator: process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR,
        measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
        consentStored,
    });
}

/**
 * Fire a GA4 event. Synchronous and fire-and-forget — the async init and
 * send happen internally and are never awaited by callers. Never throws.
 */
export function track(eventName: string, params?: Record<string, unknown>): void {
    try {
        if (!canTrack()) return;
        getAnalyticsHandle()
            .then((handle) => {
                if (!handle) return;
                handle.logEvent(handle.analytics, eventName, params);
            })
            .catch(() => {
                // Analytics failures must never surface to the app.
            });
    } catch {
        // Analytics failures must never surface to the app.
    }
}
