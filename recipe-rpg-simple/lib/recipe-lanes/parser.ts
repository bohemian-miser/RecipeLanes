import { z } from 'zod';
import type { RecipeGraph } from './types';

// Schema Definition (Matching TypeScript Interface)
const RecipeGraphSchema = z.object({
  lanes: z.array(z.object({
    id: z.string(),
    label: z.string(),
    type: z.enum(['prep', 'cook', 'serve'])
  })),
  nodes: z.array(z.object({
    id: z.string(),
    laneId: z.string(),
    text: z.string(),
    visualDescription: z.string(),
    type: z.enum(['ingredient', 'action']),
    inputs: z.array(z.string()).optional(),
    temperature: z.string().optional(),
    duration: z.string().optional()
  }))
});

const SCHEMA_INTERFACE = `
interface RecipeGraph {
  lanes: {
    id: string;
    label: string; // e.g. "Skillet"
    type: 'prep' | 'cook' | 'serve';
  }[];
  nodes: {
    id: string;
    laneId: string; // Must match a lane.id
    text: string; // Concise instruction e.g. "Add onions" or "2 Onions"
    visualDescription: string; // Detailed prompt for pixel-art icon
    type: 'ingredient' | 'action';
    inputs?: string[]; // IDs of previous nodes flowing into this one
    temperature?: string; // e.g. "Medium Heat" (for actions)
    duration?: string; // e.g. "5 min" (for actions)
  }[];
}
`;

export function generateRecipePrompt(recipeText: string): string {
  const BLOCK_START = "```typescript";
  const BLOCK_END = "```";

  return `
You are an expert recipe parser. Your goal is to convert the following cooking instructions into a structured "Swimlane Graph" JSON.

### Core Philosophy: The State-Flow Pattern
1. **Ingredient Nodes (Input):** Represent *new* items being added. Visuals show the ingredient in its *prepared* state (e.g. "Chopped Onion").
2. **Action Nodes (State):** Represent the *result* state of the vessel. Visuals show the *combined state* (e.g. "Onions frying in pan").
3. **Lanes (Containers):** Represents physical locations (Bowl, Pan, Pot).

### Critical Rules
1. **QUANTITY:** The \`text\` field for Ingredient Nodes MUST include the specific quantity used in that step (e.g. "3 Eggs", "200g Flour", "Pinch of Salt"). Never just "Eggs".
2. **SPLIT INGREDIENTS:** If an ingredient is divided and used in different steps (e.g. "Add half sugar now, half later"), create **TWO separate Ingredient Nodes** with the partial quantities (e.g. "100g Sugar" and "100g Sugar").
3. **SPLIT OUTPUTS:** If a mixture is divided (e.g. "Pour batter into two pans"), the single Action Node producing the mixture should be listed as an input for **BOTH** destination nodes.

### Schema
Return ONLY raw JSON complying with this TypeScript interface:

${BLOCK_START}
${SCHEMA_INTERFACE}
${BLOCK_END}

### Visual Description Guidelines (CRITICAL)

1. **INGREDIENT Nodes (The "Item"):**
   - **Atomic & Generic:** Visuals must be simple, singular, and reusable inventory items.
   - **NO Quantities:** Never show specific numbers (e.g. "3 eggs"). Visual should be "An egg".
   - **Standard Forms:** For condiments/liquids, show the standard container/dispenser (e.g. "Salt Shaker", "Bottle of Oil", "Jug of Milk"). For bulk solids, show a simple pile (e.g. "Pile of Flour").
   - **NO Action Context:** Do not show pouring/falling/mixing. Just the item.
   - **Examples:**
     - "3 Eggs" -> "A single raw egg"
     - "Salt" -> "Salt Shaker"
     - "Olive Oil" -> "Bottle of Olive Oil"

2. **ACTION Nodes (The "State"):**

### Input Recipe
"${recipeText}"
`;
}

export function parseRecipeGraph(aiResponse: string): RecipeGraph {
  try {
    // 1. Clean Markdown code blocks if present
    let jsonStr = aiResponse.trim();
    if (jsonStr.startsWith('\`\`\`')) {
      jsonStr = jsonStr.replace(/^\`\`\`(json)?/, '').replace(/\`\`\`$/, '');
    }
    jsonStr = jsonStr.trim();

    // 2. Parse JSON
    const rawObj = JSON.parse(jsonStr);

    // 3. Validate Schema
    return RecipeGraphSchema.parse(rawObj);
  } catch (e) {
    console.error('Failed to parse recipe graph:', e);
    throw new Error('Invalid AI Response Format');
  }
}