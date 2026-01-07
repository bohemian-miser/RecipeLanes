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
    // sy = 40 + 36 = 76
    // ty = (200 + 40) - 36 = 204
    
    assertClose(result.sx, 50, 0.1, 'SX');
    assertClose(result.sy, 76, 0.1, 'SY');
    assertClose(result.tx, 50, 0.1, 'TX');
    assertClose(result.ty, 204, 0.1, 'TY');
    
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
    // sy = 40 (MinimalNode center Y)
    
    assertClose(result.sx, 86, 0.1, 'SX');
    assertClose(result.sy, 40, 0.1, 'SY');
    
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
    
    // Radius = (100/2) + 5 = 55
    // Distance = 200
    // Vector (0, 1)
    // sy = 40 + 55 = 95
    // ty = 240 - 55 = 185
    
    assertClose(result.sx, 50, 0.1, 'SX Fallback');
    assertClose(result.sy, 95, 0.1, 'SY Fallback');
    
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