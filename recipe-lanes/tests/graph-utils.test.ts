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

import { getEdgeParams } from '../lib/recipe-lanes/graph-utils';

// Mock Node factory
const createNode = (id: string, x: number, y: number, textPos = 'bottom', type = 'minimal'): any => ({
    id,
    type,
    position: { x, y },
    width: 100,
    height: 100,
    data: { textPos }
});

const assertClose = (actual: number, expected: number, tolerance = 0.1, msg = '') => {
    if (Math.abs(actual - expected) > tolerance) {
        throw new Error(`${msg}: Expected ${expected}, got ${actual}`);
    }
};

function testVertical() {
    console.log("Testing Vertical Edge (With Handles)...");
    const n1 = createNode('1', 0, 0);
    const h1 = { x: 50, y: 50 };
    
    const n2 = createNode('2', 0, 200);
    const h2 = { x: 50, y: 250 };

    const result = getEdgeParams(n1, n2, h1, h2);
    
    // MinimalNode centers icon at y+40 (was 32). Radius 36.
    // sy = 50 (Handle Center) + 36 (Radius) = 86
    // ty = 250 (Handle Center) - 36 (Radius) = 214
    
    assertClose(result.sx, 50, 0.1, 'SX');
    assertClose(result.sy, 86, 0.1, 'SY');
    assertClose(result.tx, 50, 0.1, 'TX');
    assertClose(result.ty, 214, 0.1, 'TY');
    
    console.log("Vertical PASS");
}

function testHorizontal() {
    console.log("Testing Horizontal Edge (With Handles)...");
    const n1 = createNode('1', 0, 0);
    const h1 = { x: 50, y: 50 };
    
    const n2 = createNode('2', 200, 0);
    const h2 = { x: 250, y: 50 };

    const result = getEdgeParams(n1, n2, h1, h2);
    
    // Radius = 36
    // Vector (1, 0)
    // sx = 50 + 36 = 86
    // sy = 50 (Handle Center)
    
    assertClose(result.sx, 86, 0.1, 'SX');
    assertClose(result.sy, 50, 0.1, 'SY');
    
    console.log("Horizontal PASS");
}

function testFallback() {
    console.log("Testing Fallback (No Handles)...");
    // textPos='bottom' -> Center at (x+w/2, y+40)
    // Node1 (0,0) -> Center (50, 40)
    // Node2 (0,200) -> Center (50, 240)
    const n1 = createNode('1', 0, 0, 'bottom');
    const n2 = createNode('2', 0, 200, 'bottom');
    
    const result = getEdgeParams(n1, n2);
    
    // Radius = 36 (Classic Fallback)
    // Distance = 200
    // Vector (0, 1)
    // sy = 50 + 36 = 86
    
    assertClose(result.sx, 50, 0.1, 'SX Fallback');
    assertClose(result.sy, 86, 0.1, 'SY Fallback');
    
    console.log("Fallback PASS");
}

try {
    testVertical();
    testHorizontal();
    testFallback();
    console.log("All Graph Utils Tests Passed!");
} catch (e) {
    console.error(e);
    process.exit(1);
}