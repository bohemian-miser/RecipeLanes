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

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    ROUTES_WITH_OWN_TRIGGER,
    normalizePathname,
    hasOwnFeedbackTrigger,
    feedbackLauncherClassName,
} from '../lib/feedback-launcher';

// Issue 282: the feedback button must appear on every page. The launcher is
// mounted once from the root layout, so the only per-route decision left is
// where it must step aside for an existing trigger — `/lanes` renders its own
// in the desktop header (`hidden md:flex`), and nowhere else does.
describe('global feedback launcher (Issue 282)', () => {
    describe('normalizePathname', () => {
        it('leaves ordinary paths untouched', () => {
            assert.equal(normalizePathname('/gallery'), '/gallery');
            assert.equal(normalizePathname('/tools/umap'), '/tools/umap');
        });

        it('drops a trailing slash so /lanes/ and /lanes agree', () => {
            assert.equal(normalizePathname('/lanes/'), '/lanes');
            assert.equal(normalizePathname('/tools/umap/'), '/tools/umap');
        });

        it('keeps the root path as /', () => {
            assert.equal(normalizePathname('/'), '/');
        });

        it('falls back to / for empty, null and undefined input', () => {
            assert.equal(normalizePathname(''), '/');
            assert.equal(normalizePathname('   '), '/');
            assert.equal(normalizePathname(null), '/');
            assert.equal(normalizePathname(undefined), '/');
        });
    });

    describe('hasOwnFeedbackTrigger', () => {
        it('is true for /lanes, which has a feedback button in its header', () => {
            assert.equal(hasOwnFeedbackTrigger('/lanes'), true);
            assert.equal(hasOwnFeedbackTrigger('/lanes/'), true);
        });

        it('is false for every route that had no feedback entry point', () => {
            for (const route of ['/gallery', '/icon_overview', '/terms', '/tools/umap', '/']) {
                assert.equal(hasOwnFeedbackTrigger(route), false, `expected launcher on ${route}`);
            }
        });

        it('matches exactly, not by prefix', () => {
            // A future sibling route must not inherit /lanes' exemption and end
            // up with no feedback button at all.
            assert.equal(hasOwnFeedbackTrigger('/lanes-archive'), false);
            assert.equal(hasOwnFeedbackTrigger('/lanes/settings'), false);
        });

        it('treats a missing pathname as an ordinary route', () => {
            assert.equal(hasOwnFeedbackTrigger(null), false);
            assert.equal(hasOwnFeedbackTrigger(undefined), false);
        });
    });

    describe('feedbackLauncherClassName', () => {
        it('hides the launcher from md up on /lanes, where the header trigger shows', () => {
            const className = feedbackLauncherClassName('/lanes');
            assert.ok(
                className.split(/\s+/).includes('md:hidden'),
                `expected md:hidden on /lanes, got: ${className}`,
            );
        });

        it('never hides the launcher on routes without their own trigger', () => {
            for (const route of ['/gallery', '/icon_overview', '/terms', '/tools/umap', '/']) {
                const className = feedbackLauncherClassName(route);
                assert.ok(
                    !className.split(/\s+/).includes('md:hidden'),
                    `launcher must stay visible on ${route}, got: ${className}`,
                );
            }
        });

        it('is always rendered — no route drops the button entirely', () => {
            for (const route of ['/lanes', '/gallery', '/icon_overview', '/terms', '/', null]) {
                const classes = feedbackLauncherClassName(route).split(/\s+/);
                assert.ok(classes.includes('fixed'), `expected a pinned button on ${route}`);
                assert.ok(classes.includes('flex'), `expected a visible button on ${route}`);
                assert.ok(!classes.includes('hidden'), `${route} must not hide the button outright`);
            }
        });
    });

    // Regression: the consent banner is `fixed bottom-0 left-0 right-0 z-[90]`
    // and full width, so it covered the launcher at its resting bottom-8 /
    // z-[80] for every user who had not yet accepted — i.e. every first-time
    // visitor, who saw no feedback button at all. The banner is 54px tall on
    // desktop and 121px on a phone, so the raised offset must clear 121px.
    describe('clearing the consent banner', () => {
        const classesFor = (route: string, consentPending: boolean) =>
            feedbackLauncherClassName(route, { consentPending }).split(/\s+/);

        it('lifts the launcher clear of the banner while consent is pending', () => {
            const classes = classesFor('/gallery', true);
            assert.ok(classes.includes('bottom-36'), `expected a raised offset, got: ${classes.join(' ')}`);
            assert.ok(!classes.includes('bottom-8'), 'must not keep the resting offset under the banner');
        });

        it('raises the launcher above the banner z-index while consent is pending', () => {
            const classes = classesFor('/gallery', true);
            assert.ok(classes.includes('z-[95]'), `expected to outrank the banner, got: ${classes.join(' ')}`);
            assert.ok(!classes.includes('z-[80]'), 'z-[80] sits under the banner z-[90]');
        });

        it('returns to the resting position once consent is accepted', () => {
            const classes = classesFor('/gallery', false);
            assert.ok(classes.includes('bottom-8'), `expected the resting offset, got: ${classes.join(' ')}`);
            assert.ok(classes.includes('z-[80]'), 'should not keep outranking other chrome unnecessarily');
            assert.ok(!classes.includes('bottom-36'), 'must not stay lifted with no banner to clear');
        });

        it('defaults to the resting position when no state is supplied', () => {
            const classes = feedbackLauncherClassName('/gallery').split(/\s+/);
            assert.ok(classes.includes('bottom-8'));
            assert.ok(classes.includes('z-[80]'));
        });

        it('never yields two competing offsets or z-indexes', () => {
            for (const consentPending of [true, false]) {
                const classes = classesFor('/gallery', consentPending);
                assert.equal(
                    classes.filter((c) => c.startsWith('bottom-')).length, 1,
                    `exactly one bottom offset expected, got: ${classes.join(' ')}`,
                );
                assert.equal(
                    classes.filter((c) => c.startsWith('z-[')).length, 1,
                    `exactly one z-index expected, got: ${classes.join(' ')}`,
                );
            }
        });

        it('still defers to the /lanes header trigger while lifted', () => {
            // The consent offset and the per-route exemption are independent —
            // one must not clobber the other.
            assert.ok(classesFor('/lanes', true).includes('md:hidden'));
            assert.ok(classesFor('/lanes', true).includes('bottom-36'));
            assert.ok(!classesFor('/gallery', true).includes('md:hidden'));
        });
    });

    it('exempts only /lanes — every other route relies on the launcher', () => {
        assert.deepEqual(ROUTES_WITH_OWN_TRIGGER, ['/lanes']);
    });
});
