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

    // Regression: the launcher rested at bottom-8 / z-[80] while the consent
    // banner is fixed bottom-0, full width, z-[90] — so it was completely
    // covered and unclickable for anyone who had not accepted yet, i.e. every
    // first-time visitor. The shared fixture pre-seeds consent so the banner
    // never renders, which is precisely why the other tests here stayed green.
    test('is visible and clickable for a first-time visitor, with the consent banner up', async ({ page }) => {
        await page.addInitScript((key) => {
            try {
                window.localStorage.removeItem(key);
            } catch {
                // Ignore storage failures in restricted contexts.
            }
        }, CONSENT_STORAGE_KEY);

        await page.goto('/gallery');

        const banner = page.locator('[aria-label="Consent to terms"]');
        await expect(banner, 'the banner must actually be up for this test to mean anything').toBeVisible();

        const button = page.getByTestId('global-feedback-button');
        await expect(button).toBeVisible();

        // Presence is not enough — the original bug had a "visible" button sat
        // entirely behind the banner. Require real vertical separation.
        const buttonBox = (await button.boundingBox())!;
        const bannerBox = (await banner.boundingBox())!;
        expect(
            buttonBox.y + buttonBox.height,
            'launcher must sit fully above the consent banner, not behind it',
        ).toBeLessThanOrEqual(bannerBox.y);

        // ...and it must take a real click. Playwright fails this if another
        // element intercepts the pointer event.
        await button.click();
        await expect(page.getByRole('heading', { name: 'Feedback & Contribute' })).toBeVisible();
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
