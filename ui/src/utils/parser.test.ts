import { describe, it, expect } from 'vitest';
import { generateRecipePrompt, parseRecipeGraph } from './parser';

// Use simple string for mock response to avoid backtick hell
const JSON_CONTENT = JSON.stringify({
  "lanes": [
    { "id": "lane-1", "label": "Pot", "type": "cook" }
  ],
  "nodes": [
    {
      "id": "node-1",
      "laneId": "lane-1",
      "text": "Boil Water",
      "visualDescription": "Water boiling in pot",
      "type": "action"
    }
  ]
}, null, 2);

const MOCK_AI_RESPONSE = "```json\n" + JSON_CONTENT + "\n```";

describe('Recipe Parser', () => {
  describe('Prompt Generation', () => {
    it('should include the strict visual description guidelines', () => {
      const prompt = generateRecipePrompt('Test Recipe');
      expect(prompt).toContain('Descriptions should focus on the *object* and the *action*');
      expect(prompt).toContain('without showing human body parts (hands)');
      expect(prompt).toContain('A carrot going into a box grater'); // Example
    });

    it('should include the schema structure', () => {
      const prompt = generateRecipePrompt('Test Recipe');
      expect(prompt).toContain('lanes: {');
      expect(prompt).toContain('nodes: {');
      expect(prompt).toContain('laneId: string');
      expect(prompt).toContain('visualDescription: string');
    });
  });

  describe('Response Parsing', () => {
    it('should parse valid JSON from code block', () => {
      const graph = parseRecipeGraph(MOCK_AI_RESPONSE);
      expect(graph.lanes).toHaveLength(1);
      expect(graph.nodes).toHaveLength(1);
      expect(graph.nodes[0].text).toBe('Boil Water');
    });

    it('should parse raw JSON without code block', () => {
      const graph = parseRecipeGraph(JSON_CONTENT);
      expect(graph.lanes).toHaveLength(1);
    });

    it('should throw on invalid schema', () => {
      const invalidJson = JSON.stringify({ lanes: [], nodes: [{ id: '1' }] }); // Missing required fields
      expect(() => parseRecipeGraph(invalidJson)).toThrow();
    });
  });
});