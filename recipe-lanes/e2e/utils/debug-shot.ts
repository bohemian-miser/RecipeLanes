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

import { Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Opt-in debug screenshot helper.
 *
 * By default this is a NO-OP so normal/CI runs are not slowed down or bloated
 * with image artifacts. Screenshots are only captured when the opt-in flag is
 * set:
 *
 *     E2E_SCREENSHOTS=1 npm run test:e2e
 *
 * Images land in e2e/test_screenshots/debug/<NN>-<name>.png (that directory is
 * gitignored). Files are numbered per process run so the capture order is clear.
 */

const DEBUG_DIR = path.join('e2e', 'test_screenshots', 'debug');
let counter = 0;

export function screenshotsEnabled(): boolean {
    return process.env.E2E_SCREENSHOTS === '1';
}

export async function debugShot(page: Page, name: string): Promise<void> {
    if (!screenshotsEnabled()) return; // no-op on normal/CI runs

    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    counter += 1;
    const num = counter.toString().padStart(2, '0');
    const safe = name.replace(/[^a-z0-9-_]/gi, '-');
    await page.screenshot({
        path: path.join(DEBUG_DIR, `${num}-${safe}.png`),
        fullPage: true,
    });
}
