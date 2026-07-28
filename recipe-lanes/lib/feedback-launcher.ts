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
 * Placement logic for the global feedback launcher (Issue 282).
 *
 * Feedback used to be reachable only from the `/lanes` header, so every other
 * route (`/gallery`, `/icon_overview`, `/terms`, `/tools/umap`) had no way to
 * report anything. The launcher is now mounted once from the root layout, which
 * means it renders on every route — including the one that already has its own
 * trigger.
 *
 * Rather than duplicate the control there, the launcher hides itself exactly
 * where an existing trigger is already visible. On `/lanes` that trigger lives
 * in the desktop header and is itself `hidden md:flex`, so the launcher hides
 * from the `md` breakpoint up and stays visible below it — which is also how
 * `/lanes` gains a feedback entry point on mobile, where it previously had none.
 *
 * The decision is pure so it can be unit-tested without rendering React.
 */

/**
 * Routes whose own UI already renders a feedback trigger at `md` and above.
 * Matched exactly (after normalisation) — never by prefix, so a future
 * `/lanes-archive` route would still get the launcher.
 */
export const ROUTES_WITH_OWN_TRIGGER = ['/lanes'];

/** Shared styling: a compact pill pinned to the bottom-right. */
const BASE_CLASSES = [
    'fixed right-3',
    'flex items-center gap-2 rounded-full',
    'border border-zinc-700 bg-zinc-800/90 backdrop-blur shadow-lg',
    'px-3 py-2 text-xs font-semibold text-zinc-300',
    'transition-colors hover:border-yellow-500/50 hover:text-white',
].join(' ');

/**
 * Resting position: clear of the `bottom-0` chrome (ReactFlow attribution and
 * the Terms link), below the consent banner's `z-[90]`.
 */
const RESTING_POSITION = 'bottom-8 z-[80]';

/**
 * Position while the consent banner is on screen.
 *
 * The banner is `fixed bottom-0 left-0 right-0` and **full width**, so every
 * bottom-anchored control is behind it — at the resting `bottom-8` (32px) the
 * launcher was completely covered and unclickable for anyone who had not yet
 * accepted, which is every first-time visitor. The banner measures 54px on
 * desktop and 121px on a phone (it stacks below `sm`), so 144px clears it
 * outright rather than overlapping it; the raised z-index is belt-and-braces
 * for any future banner that grows taller still.
 *
 * Sitting fully above the banner also means the launcher never covers the
 * banner's own "I agree" button, which on narrow viewports is the lowest
 * element in the stack.
 */
const ABOVE_CONSENT_POSITION = 'bottom-36 z-[95]';

/**
 * Trailing-slash-insensitive pathname, so `/lanes/` and `/lanes` agree.
 * The root path stays `/`. Query strings never reach here — Next's
 * `usePathname()` excludes them — but an empty value is tolerated.
 */
export function normalizePathname(pathname: string | null | undefined): string {
    if (!pathname) return '/';
    const trimmed = pathname.trim();
    if (trimmed === '') return '/';
    return trimmed.length > 1 ? trimmed.replace(/\/+$/, '') || '/' : trimmed;
}

/** True when the route already shows its own feedback trigger at `md`+. */
export function hasOwnFeedbackTrigger(pathname: string | null | undefined): boolean {
    return ROUTES_WITH_OWN_TRIGGER.includes(normalizePathname(pathname));
}

/** Runtime state the launcher's placement depends on. */
export interface FeedbackLauncherState {
    /** True while the consent banner is on screen, occupying the bottom strip. */
    consentPending?: boolean;
}

/**
 * Class list for the launcher button: the shared pill styling, a bottom offset
 * that depends on whether the consent banner is currently covering the bottom
 * of the viewport, and `md:hidden` on routes that already provide their own
 * desktop trigger.
 */
export function feedbackLauncherClassName(
    pathname: string | null | undefined,
    { consentPending = false }: FeedbackLauncherState = {},
): string {
    const position = consentPending ? ABOVE_CONSENT_POSITION : RESTING_POSITION;
    const visibility = hasOwnFeedbackTrigger(pathname) ? ' md:hidden' : '';
    return `${BASE_CLASSES} ${position}${visibility}`;
}
