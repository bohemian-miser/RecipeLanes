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

// Regression guard for Issue #20 ("Re-enable mobile tests"): the Playwright
// e2e config must define both a desktop and a *real* mobile-device project.
// The mobile project was previously removed, silently reducing the e2e suite to
// desktop-only. This pure-logic test keeps the mobile project (and its genuine
// device emulation) from regressing without needing the emulators/browsers.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import config from '../playwright.config';

type LooseProject = {
  name?: string;
  testMatch?: unknown;
  use?: Record<string, unknown>;
};

const projects = (config.projects ?? []) as LooseProject[];
const byName = (name: string) => projects.find((p) => p.name === name);

describe('playwright e2e device matrix (Issue #20)', () => {
  it('defines a desktop project running the full suite', () => {
    const desktop = byName('desktop');
    assert.ok(desktop, 'expected a "desktop" project');
    assert.notEqual(desktop!.use?.isMobile, true, 'desktop project must not be a mobile device');
    assert.equal(desktop!.testMatch, undefined, 'desktop project should run the full spec suite (no testMatch)');
  });

  it('defines a mobile project with real device emulation', () => {
    const mobile = byName('mobile');
    assert.ok(mobile, 'expected a "mobile" project');
    // Genuine device emulation, not a resized desktop viewport.
    assert.equal(mobile!.use?.isMobile, true, 'mobile project must emulate a real mobile device (isMobile)');
    assert.equal(mobile!.use?.hasTouch, true, 'mobile project must have touch enabled (hasTouch)');
    // Stay on the Chromium engine the rest of the suite is tuned for.
    assert.equal(mobile!.use?.defaultBrowserType, 'chromium', 'mobile project must use the Chromium engine');
  });

  it('runs the device-aware smoke suite on mobile', () => {
    const mobile = byName('mobile');
    const testMatch = mobile!.testMatch;
    assert.ok(testMatch instanceof RegExp, 'mobile project should scope its specs via a RegExp testMatch');
    assert.ok((testMatch as RegExp).test('e2e/smoke.spec.ts'), 'mobile project must run smoke.spec.ts');
    assert.ok(!(testMatch as RegExp).test('e2e/graph.spec.ts'), 'mobile project should not run desktop-only specs');
  });

  it('exposes both devices in the project matrix', () => {
    const names = projects.map((p) => p.name).sort();
    assert.deepEqual(names, ['desktop', 'mobile']);
  });
});
