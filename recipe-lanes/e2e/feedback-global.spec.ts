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

import { test, expect } from './utils/fixtures';
import { CONSENT_STORAGE_KEY } from '../lib/consent';

// Issue 282: feedback was wired up only inside app/lanes/page.tsx, so every
// other route had no way to report anything. Each top bar now carries a
// FeedbackButton.
//
// These assertions deliberately check more than presence. An earlier attempt
// put a floating pill over the page; it was in the DOM and passed
// `toBeVisible()`, yet was covered by the consent banner and unreachable in
// the real app. So each case here also *clicks* the button — Playwright fails
// a click that another element intercepts — and the first-visit case runs with
// the consent banner deliberately left up.
test.describe('Feedback button in the top bar (Issue 282)', () => {
    // Routes that previously had no feedback entry point at all.
    const ROUTES = ['/gallery', '/gallery?filter=mine', '/icon_overview', '/terms'];

    for (const route of ROUTES) {
        test(`is present and opens the modal on ${route}`, async ({ page }) => {
            await page.goto(route);

            const button = page.getByTestId('feedback-button');
            await expect(button, `expected a feedback button in the ${route} top bar`).toBeVisible();

            await button.click();

            await expect(page.getByRole('heading', { name: 'Feedback & Contribute' })).toBeVisible();
            await expect(page.locator('#message')).toBeVisible();
        });
    }

    test('is reachable for a first-time visitor, with the consent banner up', async ({ page }) => {
        // The shared fixture pre-seeds consent so the banner never renders.
        // Clear it to get the real first-visit layout back — the state in which
        // the previous floating-pill attempt was completely covered.
        await page.addInitScript((key) => {
            try {
                window.localStorage.removeItem(key);
            } catch {
                // Ignore storage failures in restricted contexts.
            }
        }, CONSENT_STORAGE_KEY);

        await page.goto('/gallery');

        await expect(
            page.locator('[aria-label="Consent to terms"]'),
            'the banner must be up for this test to mean anything',
        ).toBeVisible();

        // The top bar is at the top of the viewport and the banner is pinned to
        // the bottom, so the two cannot overlap — this pins that property.
        const button = page.getByTestId('feedback-button');
        await expect(button).toBeVisible();
        await button.click();

        await expect(page.getByRole('heading', { name: 'Feedback & Contribute' })).toBeVisible();
    });

    // The routes above run signed-out, which on /icon_overview and
    // /gallery?filter=mine hits an auth gate that returns *before* the header.
    // Those gates carry their own button; this covers the header itself.
    test('is in the top bar of /icon_overview once signed in', async ({ page, login }) => {
        // Navigate first, then sign in. The `login` fixture waits on
        // `window._firebaseAuth`, which `lib/firebase-client.ts` only installs
        // once the app has loaded in the browser — calling login() on
        // about:blank just times out. Every other spec does goto-then-login.
        await page.goto('/icon_overview');
        await login('feedback-header-user');

        // Signing in replaces the auth gate with the real page, whose top bar
        // carries the button. Scoping to <header> is what makes this a top-bar
        // assertion rather than "somewhere on the page" — and it will not match
        // the gate screen's own button while the re-render is still pending.
        const button = page.locator('header').getByTestId('feedback-button');
        await expect(button).toBeVisible();

        await button.click();
        await expect(page.getByRole('heading', { name: 'Feedback & Contribute' })).toBeVisible();
    });

    test('/lanes keeps its own header button', async ({ page }) => {
        test.skip(test.info().project.name === 'mobile', 'the /lanes trigger is desktop-only by design');

        await page.goto('/lanes');

        // /lanes already had one and is untouched by this change; it is
        // `hidden md:flex` because the mobile header deliberately drops
        // secondary items (issue #139).
        await expect(page.getByTitle('Feedback & Contribute')).toBeVisible();
    });
});
