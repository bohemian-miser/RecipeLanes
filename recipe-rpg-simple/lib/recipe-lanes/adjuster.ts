import type { RecipeGraph } from './types';

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
    text: string; // Concise instruction
    visualDescription: string; // Active, object-focused visual prompt (no hands)
    type: 'ingredient' | 'action';
    inputs?: string[]; // IDs of previous nodes
    temperature?: string;
    duration?: string;
    iconUrl?: string; // Preserve existing icon URLs if node is unchanged!
  }[];
}
`;

export function generateAdjustmentPrompt(currentGraph: RecipeGraph, userInstruction: string): string {
  const BLOCK_START = "```typescript";
  const BLOCK_END = "```";

  return `
You are an expert recipe graph editor.
Your goal is to MODIFY the provided "Current Graph" based on the "User Instruction".

### Rules
1. **Preserve ID/State:** Keep existing nodes/lanes if they are still relevant. Do not regenerate IDs for unchanged nodes.
2. **Preserve Icons:** If you keep a node, KEEP its 
iconUrl
 if present.
3. **New Nodes:** If adding nodes, generate a 
visualDescription
 following the guidelines (Active, Object-Focused, No Hands).
4. **Schema:** The output must match the schema strictly.

### Schema
${BLOCK_START}
${SCHEMA_INTERFACE}
${BLOCK_END}

### Current Graph (JSON)
${JSON.stringify(currentGraph, null, 2)}

### User Instruction
"${userInstruction}"

Return ONLY the full updated JSON.
`;
}