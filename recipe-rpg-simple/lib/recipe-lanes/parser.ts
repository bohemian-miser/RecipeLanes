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

### Schema
Return ONLY raw JSON complying with this TypeScript interface:

${BLOCK_START}
${SCHEMA_INTERFACE}
${BLOCK_END}

### Visual Description Guidelines (CRITICAL)

1. **INGREDIENT Nodes (The "Item"):**
   - **Atomic & Generic:** Visuals must be simple, singular, and reusable inventory items.
   - **NO Quantities:** Never show specific numbers (e.g. "3 eggs"). Visual should be "An egg".
   - **NO Containers/Context:** Do not show where it is going (e.g. "falling into bowl"). Show just the item (e.g. "A pile of sugar").
   - **Examples:**
     - "3 Eggs" -> "A single raw egg"
     - "500g Beef" -> "Raw minced beef"
     - "Cup of Milk" -> "A glass jug of milk"

2. **ACTION Nodes (The "State"):**
   - **Contextual:** Depict the ingredients *undergoing* the action or the *result state* in the vessel.
   - **Active:** "Whisking", "Boiling", "Frying".
   - **No Hands:** Focus on the food and tools.
   - **Examples:**
     - "Whisk Ingredients" -> "A wire whisk beating ingredients in a bowl"
     - "Simmer" -> "Red sauce bubbling gently in a pan"

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