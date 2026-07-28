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
import { CONSENT_STORAGE_KEY, needsConsent } from '@/lib/consent';

/**
 * Shared subscription to the persisted consent decision (Issue 147).
 *
 * Consent is backed by localStorage, an external store. We read it during
 * render via useSyncExternalStore (rather than syncing into state in an
 * effect), which keeps consumers hydration-safe and side-effect-free.
 *
 * This lives here rather than inside `ConsentBanner` because more than one
 * component needs the answer: the banner decides whether to render, and the
 * global feedback launcher has to move out from under the banner while it is
 * up (Issue 282). Two independent copies of this store could disagree about
 * whether the banner is on screen, which is exactly the bug being fixed — so
 * there is one store and both read it.
 */
const listeners = new Set<() => void>();

/** Tell every subscriber the stored consent changed (after a local write). */
export function notifyConsentChanged(): void {
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

// The server (and the hydrating first client paint) render as though consent
// were settled, avoiding a hydration mismatch; the real answer arrives once the
// client can read localStorage.
function getServerSnapshot(): boolean {
    return false;
}

/** True while the user still needs to accept the current terms. */
export function useConsentPending(): boolean {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
