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

// Issue 282: feedback used to be wired up only inside app/lanes/page.tsx, so
// /gallery, /terms and friends had no way to report anything. The launcher is
// now mounted from the root layout — these tests cover the routes that
// previously had no entry point at all, and guard against the launcher
// double-rendering next to the /lanes header button.
test.describe('Global feedback launcher (Issue 282)', () => {
    const launcher = 'global-feedback-button';

    test('appears on pages that previously had no feedback button', async ({ page }) => {
        for (const route of ['/gallery', '/terms']) {
            await page.goto(route);
            await expect(
                page.getByTestId(launcher),
                `expected the feedback button on ${route}`,
            ).toBeVisible();
        }
    });

    test('opens the feedback modal from a non-lanes page', async ({ page }) => {
        await page.goto('/gallery');

        await page.getByTestId(launcher).click();

        // The modal is the shared FeedbackModal: same heading and fields as the
        // /lanes flow covered by recipes.spec.ts.
        await expect(page.getByRole('heading', { name: 'Feedback & Contribute' })).toBeVisible();
        await expect(page.locator('#message')).toBeVisible();
    });

    test('defers to the existing header button on desktop /lanes', async ({ page }) => {
        test.skip(test.info().project.name === 'mobile', 'asserts the md+ desktop layout');

        await page.goto('/lanes');

        // /lanes already shows "Feedback & Contribute" in its header at md+, so
        // the launcher must hide there rather than duplicate it.
        await expect(page.getByTitle('Feedback & Contribute')).toBeVisible();
        await expect(page.getByTestId(launcher)).toBeHidden();
    });
});
