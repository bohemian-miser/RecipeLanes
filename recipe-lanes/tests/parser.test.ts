import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseRecipeGraph, generateRecipePrompt } from '../lib/recipe-lanes/parser';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const minimalNode = {
  id: 'n1',
  laneId: 'l1',
  text: '2 Eggs',
  visualDescription: 'egg',
  type: 'ingredient' as const,
};

const nodeWithHyde = {
  ...minimalNode,
  id: 'n2',
  hydeQueries: [
    // 4 short tags
    'egg',
    'cracked egg',
    'raw egg',
    'white egg',
    // 4 medium phrases
    'raw egg icon pixel art',
    'cracked egg on plate',
    'white egg simple icon',
    'egg ingredient pixel art',
    // 4 longer descriptions
    'cracked raw egg with yolk pixel art icon white background',
    'single white egg simple pixel art recipe card',
    'fresh egg cracked open showing yellow yolk pixel art',
    'egg ingredient icon for recipe infographic white background',
  ],
};

const minimalGraph = {
  title: 'Test Recipe',
  lanes: [{ id: 'l1', label: 'Bowl', type: 'prep' as const }],
  nodes: [minimalNode],
};

const graphWithHyde = {
  title: 'Test Recipe',
  lanes: [{ id: 'l1', label: 'Bowl', type: 'prep' as const }],
  nodes: [nodeWithHyde],
};

// ---------------------------------------------------------------------------
// parseRecipeGraph — hydeQueries pass-through
// ---------------------------------------------------------------------------

describe('parseRecipeGraph', () => {

  it('passes hydeQueries through to RecipeNode when present', () => {
    const json = JSON.stringify(graphWithHyde);
    const result = parseRecipeGraph(json);

    assert.ok(result.nodes.length === 1, 'should have one node');
    const node = result.nodes[0];
    assert.ok(Array.isArray(node.hydeQueries), 'hydeQueries should be an array');
    assert.strictEqual(node.hydeQueries!.length, 12, 'should have 12 queries');
    assert.strictEqual(node.hydeQueries![0], 'egg');
    assert.strictEqual(
      node.hydeQueries![8],
      'cracked raw egg with yolk pixel art icon white background',
    );
  });

  it('does not break when hydeQueries is absent (graceful optional)', () => {
    const json = JSON.stringify(minimalGraph);
    const result = parseRecipeGraph(json);

    assert.ok(result.nodes.length === 1, 'should have one node');
    const node = result.nodes[0];
    assert.strictEqual(node.hydeQueries, undefined, 'hydeQueries should be undefined when not provided');
  });

  it('passes hydeQueries through when wrapped in markdown code fence', () => {
    const json = '```json\n' + JSON.stringify(graphWithHyde) + '\n```';
    const result = parseRecipeGraph(json);

    const node = result.nodes[0];
    assert.ok(Array.isArray(node.hydeQueries), 'hydeQueries should survive markdown stripping');
    assert.strictEqual(node.hydeQueries!.length, 12);
  });

  it('handles a mix of nodes with and without hydeQueries', () => {
    const mixed = {
      title: 'Mixed',
      lanes: [{ id: 'l1', label: 'Pan', type: 'cook' as const }],
      nodes: [minimalNode, nodeWithHyde],
    };
    const result = parseRecipeGraph(JSON.stringify(mixed));

    assert.strictEqual(result.nodes.length, 2);
    assert.strictEqual(result.nodes[0].hydeQueries, undefined);
    assert.ok(Array.isArray(result.nodes[1].hydeQueries));
  });

});

// ---------------------------------------------------------------------------
// generateRecipePrompt — schema includes hydeQueries
// ---------------------------------------------------------------------------

describe('generateRecipePrompt', () => {

  it('includes hydeQueries field in the schema block', () => {
    const prompt = generateRecipePrompt('Boil 2 eggs for 10 minutes');
    assert.ok(
      prompt.includes('hydeQueries'),
      'prompt should mention hydeQueries in the schema',
    );
  });

});
