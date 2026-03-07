import { describe, it } from 'node:test';
import assert from 'node:assert';
import { calculateBridgeEdges, MinimalEdge } from '../lib/recipe-lanes/graph-logic';

describe('Undo & Bridge Logic', () => {
    it('should correctly calculate bridged edges for deletion', () => {
        // 1 -> 2 -> 3
        const edges: MinimalEdge[] = [
            { id: '1-2', source: '1', target: '2' },
            { id: '2-3', source: '2', target: '3' }
        ];
        
        const factory = (s: string, t: string) => ({ id: `${s}-${t}`, source: s, target: t });
        const result = calculateBridgeEdges('2', edges, factory);
        
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].source, '1');
        assert.strictEqual(result[0].target, '3');
        assert.strictEqual(result[0].id, '1-3');
    });

    it('should simulate a snapshot-based undo', () => {
        let nodes = [{ id: '1' }, { id: '2' }];
        const history: any[] = [];
        
        // Take Snapshot
        history.push(JSON.parse(JSON.stringify(nodes)));
        
        // Modify
        nodes.push({ id: '3' });
        assert.strictEqual(nodes.length, 3);
        
        // Undo
        nodes = history.pop();
        assert.strictEqual(nodes.length, 2);
        assert.ok(!nodes.find(n => n.id === '3'));
    });
});
