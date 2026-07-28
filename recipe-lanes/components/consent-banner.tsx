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

'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import {
    CONSENT_STORAGE_KEY,
    currentConsentRecord,
    needsConsent,
} from '@/lib/consent';

// Consent is backed by localStorage, an external store. We read it during
// render via useSyncExternalStore (rather than syncing into state in an
// effect), which keeps the component hydration-safe and side-effect-free.
const listeners = new Set<() => void>();

function emitChange() {
    for (const listener of listeners) listener();
}

function subscribe(onStoreChange: () => void): () => void {
    listeners.add(onStoreChange);
    const onStorage = (e: StorageEvent) => {
        if (e.key === CONSENT_STORAGE_KEY) onStoreChange();
    };
    window.addEventListener('storage', onStorage);
    return () => {
        listeners.delete(onStoreChange);
        window.removeEventListener('storage', onStorage);
    };
}

function getSnapshot(): boolean {
    try {
        return needsConsent(window.localStorage.getItem(CONSENT_STORAGE_KEY));
    } catch {
        // localStorage unavailable (e.g. privacy mode) — show the notice.
        return true;
    }
}

// The server (and the hydrating first client paint) render nothing, avoiding a
// hydration mismatch; the banner appears once the client reads localStorage.
function getServerSnapshot(): boolean {
    return false;
}

/**
 * One-time consent gate (Issue 147).
 *
 * Renders a slim bottom banner asking the user to accept the Terms of Service &
 * Privacy Policy, then persists their acceptance in localStorage. The banner
 * reappears only if the terms version changes (see `lib/consent.ts`).
 *
 * All decision logic lives in `lib/consent.ts` (pure, unit-tested); this
 * component is only the localStorage + UI shell around it.
 */
export function ConsentBanner() {
    const show = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

    if (!show) return null;

    const accept = () => {
        try {
            window.localStorage.setItem(CONSENT_STORAGE_KEY, currentConsentRecord());
        } catch {
            // Best effort: nothing else to do if we cannot persist.
        }
        emitChange();
    };

    return (
        <div
            role="dialog"
            aria-modal="false"
            aria-label="Consent to terms"
            className="fixed bottom-0 left-0 right-0 z-[90] border-t border-zinc-700 bg-zinc-900/95 backdrop-blur px-4 py-3 text-xs text-zinc-300 shadow-lg"
        >
            <div className="mx-auto flex max-w-4xl flex-col items-center gap-2 sm:flex-row sm:justify-between">
                <p className="leading-relaxed">
                    We use cookies and local storage to run Recipe Lanes. By using this
                    site you agree to our{' '}
                    <Link
                        href="/terms"
                        className="font-medium text-yellow-500 underline underline-offset-2 hover:text-yellow-400"
                    >
                        Terms of Service &amp; Privacy Policy
                    </Link>
                    .
                </p>
                <button
                    type="button"
                    onClick={accept}
                    className="shrink-0 rounded bg-yellow-500 px-4 py-1.5 font-semibold text-zinc-900 transition-colors hover:bg-yellow-400"
                >
                    I agree
                </button>
            </div>
        </div>
    );
}
