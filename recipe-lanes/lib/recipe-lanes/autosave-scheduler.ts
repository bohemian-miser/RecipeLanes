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
 * Pure (no-React) autosave scheduler factory.
 *
 * Multiple calls to schedule() within delayMs collapse into a single
 * onSave() call fired after the last schedule() call.  flush() fires
 * immediately and cancels any pending timer.
 *
 * Extracted from useAutosave so it can be unit-tested without a DOM or
 * React renderer.
 */
export const AUTOSAVE_DELAY_MS = 1500;

export function createAutosaveScheduler(
    onSave: () => void,
    delayMs = AUTOSAVE_DELAY_MS,
) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending = false;

    function schedule() {
        pending = true;
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            if (pending) {
                pending = false;
                onSave();
            }
        }, delayMs);
    }

    function flush() {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        if (pending) {
            pending = false;
            onSave();
        }
    }

    function hasPending() {
        return pending;
    }

    return { schedule, flush, hasPending };
}
