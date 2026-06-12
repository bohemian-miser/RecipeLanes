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
 * Next.js server-startup hook.
 *
 * The dev/e2e harness (`npm run dev:emulators`, the Playwright `next dev`
 * server) injects the mock AI client here via dependency injection. The block
 * is guarded by `NODE_ENV !== 'production'` so that `next build` statically
 * proves it dead and tree-shakes both the branch and the dynamically-imported
 * mock module out of the production bundle. Production (`next start`) therefore
 * keeps the real client constructed in lib/ai-service.ts — no env flag selects
 * the mock anywhere in app/composition code.
 */
export async function register() {
  if (process.env.NODE_ENV !== 'production') {
    const { setAIService } = await import('./lib/ai-service');
    const { MockAIService } = await import('./lib/ai-service.mock');
    setAIService(new MockAIService());
    console.log('[instrumentation] dev/e2e: injected MockAIService (no MOCK_AI flag)');
  }
}
