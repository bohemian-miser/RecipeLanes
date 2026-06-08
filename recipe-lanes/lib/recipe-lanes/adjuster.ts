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

const PATCH_SCHEMA = `
interface RecipePatch {
  message: string;          // one sentence describing what changed, shown to the user
  addNodes?: {
    id: string; laneId: string; text: string; visualDescription: string;
    type: 'ingredient' | 'action'; inputs?: string[];
    temperature?: string; duration?: string;
  }[];
  updateNodes?: { id: string; [field: string]: any }[];  // only the fields that change
  removeNodeIds?: string[];
  addLanes?: { id: string; label: string; type: 'prep' | 'cook' | 'serve' }[];
  removeLaneIds?: string[];
  updateTitle?: string;
}

// Fallback — return a full graph only if the change is so extensive a patch would be larger:
interface RecipeGraph {
  lanes: { id: string; label: string; type: 'prep' | 'cook' | 'serve' }[];
  nodes: {
    id: string; laneId: string; text: string; visualDescription: string;
    type: 'ingredient' | 'action'; inputs?: string[];
    temperature?: string; duration?: string;
  }[];
}
`;

/** Strip internal fields that bloat the prompt and confuse the model. */
function stripGraphForPrompt(graph: RecipeGraph): object {
  return {
    title: graph.title,
    serves: graph.serves,
    baseServes: graph.baseServes,
    lanes: graph.lanes,
    nodes: graph.nodes.map(n => ({
      id: n.id,
      laneId: n.laneId,
      text: n.text,
      visualDescription: n.visualDescription,
      type: n.type,
      inputs: n.inputs,
      temperature: n.temperature,
      duration: n.duration,
      quantity: n.quantity,
      unit: n.unit,
    })),
  };
}

export function generateAdjustmentPrompt(currentGraph: RecipeGraph, userInstruction: string): string {
  return `You are an expert recipe graph editor.

### Task
Apply the "User Instruction" to the "Current Graph" and return a JSON object.

### Preferred output: RecipePatch
Return a patch when the change is surgical (add/remove/edit a few nodes).
Return a full RecipeGraph only when the change rewrites most of the graph.

### Schema
\`\`\`typescript
${PATCH_SCHEMA}
\`\`\`

### Rules
- **Prefer patch**: For most edits, a patch is smaller and faster to return.
- **Preserve IDs**: Do not change IDs for unchanged nodes.
- **New nodes**: Set \`visualDescription\` to an active, object-focused phrase (no hands).
- **message**: Always include a one-sentence summary of what changed.
- **Merging nodes**: Always do BOTH steps: (1) add the combined result in `addNodes`, (2) put every source node in `removeNodeIds`. Never remove nodes without adding their replacement. Inputs refs are cleaned automatically.

### Current Graph
\`\`\`json
${JSON.stringify(stripGraphForPrompt(currentGraph), null, 2)}
\`\`\`

### User Instruction
"${userInstruction}"

Return ONLY the JSON object (no markdown, no explanation).`;
}