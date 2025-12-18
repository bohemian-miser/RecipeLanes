import { describe, it, expect } from 'vitest';
import { generateRecipePrompt } from './parser';

describe('Recipe Parser Prompt Generation', () => {
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

  it('should inject the recipe text', () => {
    const recipe = "Boil water in a pot.";
    const prompt = generateRecipePrompt(recipe);
    expect(prompt).toContain(recipe);
  });
});