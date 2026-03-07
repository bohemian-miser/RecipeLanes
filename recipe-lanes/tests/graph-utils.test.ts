import { describe, it } from 'node:test';
import assert from 'node:assert';
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

describe('Graph Utils', () => {
    it('should calculate vertical edge parameters correctly', () => {
        const n1 = createNode('1', 0, 0);
        const h1 = { x: 50, y: 50 };
        
        const n2 = createNode('2', 0, 200);
        const h2 = { x: 50, y: 250 };

        const result = getEdgeParams(n1, n2, h1, h2);
        
        assert.ok(Math.abs(result.sx - 50) < 1, 'sx should be approx 50');
        assert.ok(Math.abs(result.sy - 86) < 1, 'sy should be approx 86');
        assert.ok(Math.abs(result.tx - 50) < 1, 'tx should be approx 50');
        assert.ok(Math.abs(result.ty - 214) < 1, 'ty should be approx 214');
    });

    it('should calculate horizontal edge parameters correctly', () => {
        const n1 = createNode('1', 0, 0);
        const h1 = { x: 50, y: 50 };
        
        const n2 = createNode('2', 200, 0);
        const h2 = { x: 250, y: 50 };

        const result = getEdgeParams(n1, n2, h1, h2);
        
        assert.ok(Math.abs(result.sx - 86) < 1, 'sx should be approx 86');
        assert.ok(Math.abs(result.sy - 50) < 1, 'sy should be approx 50');
    });

    it('should fallback correctly when no handles are provided', () => {
        const n1 = createNode('1', 0, 0, 'bottom');
        const n2 = createNode('2', 0, 200, 'bottom');
        
        const result = getEdgeParams(n1, n2);
        
        assert.ok(Math.abs(result.sx - 50) < 1, 'sx fallback should be approx 50');
        assert.ok(Math.abs(result.sy - 86) < 1, 'sy fallback should be approx 86');
    });
});
