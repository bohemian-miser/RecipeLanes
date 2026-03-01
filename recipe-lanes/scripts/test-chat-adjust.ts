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

import 'dotenv/config';
import { ai, textModel } from '../lib/genkit';
import { generateAdjustmentPrompt } from '../lib/recipe-lanes/adjuster';
import { parseRecipeGraph } from '../lib/recipe-lanes/parser';
import type { RecipeGraph } from '../lib/recipe-lanes/types';

// Initial Graph: "Boil Water"
const INITIAL_GRAPH: RecipeGraph = {
  lanes: [{ id: 'l1', label: 'Pot', type: 'cook' }],
  nodes: [
    { id: 'n1', laneId: 'l1', text: 'Boil Water', visualDescription: 'Water boiling', type: 'action' }
  ]
};

async function testChatAdjust() {
  const instruction = "Add salt to the pot before boiling.";
  console.log('=== Testing Chat Adjustment ===');
  console.log(`Instruction: "${instruction}"`);

  const prompt = generateAdjustmentPrompt(INITIAL_GRAPH, instruction);
  
  try {
      const response = await ai.generate({
          model: textModel,
          prompt: prompt,
          config: { temperature: 0.2 }
      });

      const newGraph = parseRecipeGraph(response.text);
      console.log('✅ Parsed New Graph');
      
      // Verification
      const hasSalt = newGraph.nodes.some(n => n.text.toLowerCase().includes('salt'));
      const hasBoil = newGraph.nodes.some(n => n.text.toLowerCase().includes('boil'));
      
      if (hasSalt && hasBoil) {
          console.log('SUCCESS: Graph updated with Salt.');
      } else {
          console.error('FAILURE: Salt not found in updated graph.');
          console.log(JSON.stringify(newGraph, null, 2));
          process.exitCode = 1;
      }

  } catch (e: any) {
      console.error('TEST FAILED:', e.message);
      process.exitCode = 1;
  }
}

testChatAdjust();