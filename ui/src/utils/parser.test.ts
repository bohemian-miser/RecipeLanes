import { describe, it, expect } from 'vitest';
import { parseRecipe } from './parser';

describe('parseRecipe', () => {
  it('should parse ingredients correctly', () => {
    const input = `- Flour
- Sugar`;
    const result = parseRecipe(input);
    expect(result.ingredients).toHaveLength(2);
    expect(result.ingredients[0].name).toBe('Flour');
    expect(result.ingredients[1].name).toBe('Sugar');
  });

  it('should parse steps and extract lanes', () => {
    const input = `1. Mix ingredients [Bowl]`;
    const result = parseRecipe(input);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].label).toBe('1');
    expect(result.steps[0].description).toBe('Mix ingredients');
    expect(result.steps[0].resource).toBe('Bowl');
    expect(result.lanes).toContain('Bowl');
  });

  it('should parse dependencies', () => {
    const input = `1. Mix ingredients [Bowl] (ingredient-0)
2. Bake [Oven] (step-0)`;
    const result = parseRecipe(input);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].dependencies).toEqual(['ingredient-0']);
    expect(result.steps[1].dependencies).toEqual(['step-0']);
  });

  it('should handle mixed input', () => {
    const input = `- Eggs
1. Whisk [Bowl] (ingredient-0)`;
    const result = parseRecipe(input);
    expect(result.ingredients).toHaveLength(1);
    expect(result.steps).toHaveLength(1);
    expect(result.lanes).toHaveLength(1);
  });
});
