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
