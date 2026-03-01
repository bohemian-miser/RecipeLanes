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


import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

// 1. Setup Environment BEFORE import
// We want to simulate the "Accidental Leak" scenario:
// MOCK_AI is set (leaked), but FUNCTIONS_EMULATOR is NOT set (Production).
process.env.MOCK_AI = 'true';
delete process.env.FUNCTIONS_EMULATOR;

// Mock Firebase Admin and Genkit to avoid side effects during import
// We assume tsx handles this, or we might crash.
// Ideally we rely on the fact that we just want to import the module and check the behavior.
// But `index.ts` calls `initializeApp()`. 
// If we can't mock imports easily without a framework like Jest, this is hard.
// However, we can check if we can inspect the generated JS or just trust the logic?

// Alternative: Parse the source file string. 
// "const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';"
// If we regex for "process.env.MOCK_AI", we can verify it's gone.

import fs from 'fs';
import path from 'path';

describe('Production Logic Verification', () => {
  it('should not contain MOCK_AI check in isEmulator logic', () => {
    const indexPath = path.join(__dirname, '../functions/src/index.ts');
    const content = fs.readFileSync(indexPath, 'utf-8');
    
    // Check for the specific removed pattern
    const hasMockCheck = content.includes("process.env.MOCK_AI === 'true'");
    
    // We expect this to be FALSE now.
    // However, MOCK_AI might be used elsewhere? 
    // In `index.ts`, `isEmulator` was the only place using it for the toggle.
    // Wait, the prompt I saw earlier used `if (isEmulator) ...`.
    
    if (hasMockCheck) {
        // If it's still there, check context. 
        // Maybe it's checking `const isEmulator = ...`.
        const isEmulatorLine = content.split('\n').find(line => line.includes('const isEmulator ='));
        if (isEmulatorLine && isEmulatorLine.includes("process.env.MOCK_AI === 'true'")) {
             assert.fail(`Found unsafe MOCK_AI check in isEmulator definition: ${isEmulatorLine}`);
        }
    }
    assert.ok(true, "isEmulator logic is safe");
  });
});