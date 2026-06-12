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
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import fs from 'fs';
import path from 'path';

import { getAIService, RealAIService, NodeCFAIService } from '../lib/ai-service';

const ROOT = path.join(__dirname, '..');

describe('Production Logic Verification (pure DI, no MOCK_AI flag)', () => {
  it('ai-service.ts never references the mock module or MOCK_AI', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib/ai-service.ts'), 'utf-8');
    assert.ok(
      !src.includes('ai-service.mock'),
      'lib/ai-service.ts must not reference the mock module — mock is injected via setAIService()',
    );
    assert.ok(
      !src.includes('MOCK_AI'),
      'lib/ai-service.ts must not read MOCK_AI — no env flag selects the mock',
    );
  });

  it('default service is a real client (never the mock) when nothing is injected', () => {
    const svc = getAIService();
    assert.ok(
      svc instanceof RealAIService || svc instanceof NodeCFAIService,
      'Default getAIService() must return a real client, not a mock',
    );
  });

  it('no process.env.MOCK_AI reference exists anywhere in source/config', () => {
    // grep exits non-zero with empty stdout when there are no matches.
    // Excludes: node_modules, Next build dirs, the functions build output
    // (functions/lib — regenerated from source), and this test file itself
    // (which legitimately names the string in its assertion).
    let out = '';
    try {
      out = execSync(
        "grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.json' --include='*.yaml' --include='*.mjs' " +
          '"process.env.MOCK_AI" ' +
          'app components lib functions/src scripts tests .env.test package.json firebase.json ' +
          'apphosting.yaml apphosting.prod.yaml apphosting.staging.yaml next.config.ts ' +
          '--exclude=verify-production-logic.test.ts',
        { cwd: ROOT },
      ).toString();
    } catch (e: any) {
      out = (e.stdout || '').toString();
    }
    assert.strictEqual(out.trim(), '', `Found process.env.MOCK_AI references (should be zero):\n${out}`);
  });
});
