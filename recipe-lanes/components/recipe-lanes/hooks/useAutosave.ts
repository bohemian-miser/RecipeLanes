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

import { useRef, useEffect, useCallback } from 'react';
import { createAutosaveScheduler } from '../../../lib/recipe-lanes/autosave-scheduler';

export { createAutosaveScheduler } from '../../../lib/recipe-lanes/autosave-scheduler';

interface UseAutosaveParams {
    /** Called when the debounce timer fires or a flush is requested. */
    onSave: () => void;
    /** When false, scheduleAutosave is a no-op (e.g. viewer, not owner). */
    enabled: boolean;
}

interface UseAutosaveReturn {
    /**
     * Queue a debounced save.  N rapid calls within AUTOSAVE_DELAY_MS result
     * in exactly one onSave invocation.
     */
    scheduleAutosave: () => void;
    /**
     * Immediately fire any pending save and cancel the timer.
     * Safe to call even when no save is pending.
     */
    flushAutosave: () => void;
}

/**
 * Provides a debounced autosave scheduler with flush-on-hide/unmount
 * semantics.
 *
 * - Multiple rapid calls to scheduleAutosave() collapse into a single
 *   onSave() call fired AUTOSAVE_DELAY_MS after the last schedule call.
 * - flushAutosave() fires immediately (used on pagehide, unmount, and
 *   router navigation).
 * - Does not call onSave() unless scheduleAutosave() was called at least
 *   once since the last save.
 */
export function useAutosave({ onSave, enabled }: UseAutosaveParams): UseAutosaveReturn {
    // Keep a stable ref so the scheduler closure doesn't capture a stale onSave.
    const onSaveRef = useRef(onSave);
    useEffect(() => {
        onSaveRef.current = onSave;
    }, [onSave]);

    // Lazily created outside render (callbacks/effects only) to satisfy
    // the no-ref-access-during-render rule.
    const schedulerRef = useRef<ReturnType<typeof createAutosaveScheduler> | null>(null);
    const getScheduler = useCallback(() => {
        if (schedulerRef.current === null) {
            schedulerRef.current = createAutosaveScheduler(() => onSaveRef.current());
        }
        return schedulerRef.current;
    }, []);

    const flushAutosave = useCallback(() => {
        getScheduler().flush();
    }, [getScheduler]);

    const scheduleAutosave = useCallback(() => {
        if (!enabled) return;
        getScheduler().schedule();
    }, [enabled, getScheduler]);

    // Flush on page hide (tab switch, browser close) and on unmount.
    useEffect(() => {
        const handlePageHide = () => flushAutosave();
        window.addEventListener('pagehide', handlePageHide);
        return () => {
            window.removeEventListener('pagehide', handlePageHide);
            // Flush on unmount so navigation away doesn't lose edits.
            flushAutosave();
        };
    }, [flushAutosave]);

    return { scheduleAutosave, flushAutosave };
}
