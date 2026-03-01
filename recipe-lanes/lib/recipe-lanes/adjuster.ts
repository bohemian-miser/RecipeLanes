/*
 * Copyright (C) 2026 Bohemian Miser <https://substack.com/@bohemianmiser>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

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