import 'dotenv/config';
import { createVisualRecipeAction, getOrCreateIconAction } from '../app/actions';
import { setAIService, MockAIService } from '../lib/ai-service';
import { setDataService, MemoryDataService } from '../lib/data-service';
import { setAuthService, MockAuthService } from '../lib/auth-service';

// Custom Mock for this test
class CustomMockAIService extends MockAIService {
    async generateText(prompt: string): Promise<string> {
        // Return a graph with Carrot and Onion
        return JSON.stringify({
            title: "Carrot and Onion",
            lanes: [{ id: "lane1", label: "Board", type: "prep" }],
            nodes: [
                { id: "n1", laneId: "lane1", text: "1 Carrot", visualDescription: "Carrot", type: "ingredient" },
                { id: "n2", laneId: "lane1", text: "1 Onion", visualDescription: "Onion", type: "ingredient" }
            ]
        });
    }
}

// Explicitly use Mocks for tests
setAIService(new CustomMockAIService());
const dataService = new MemoryDataService();
setDataService(dataService);
setAuthService(new MockAuthService());

async function testOptimisticFlow() {
  console.log('\n=== Testing Optimistic Return + Background Trigger Flow ===');

  // 1. Pre-seed Cache with an Icon for "Carrot"
  console.log('[Setup] Seeding cache for "Carrot"...');
  const seedRes = await getOrCreateIconAction("Carrot");
  if ('error' in seedRes) throw new Error("Seed failed");
  const carrotUrl = seedRes.iconUrl;
  console.log(` -> Seeded Carrot: ${carrotUrl}`);

  // 2. Call createVisualRecipeAction with "Carrot and Onion"
  // Expect: Carrot has icon, Onion is null
  console.log('\n[Action] Calling createVisualRecipeAction("Chop 1 Carrot and 1 Onion")...');
  const result = await createVisualRecipeAction("Chop 1 Carrot and 1 Onion");
  
  if (result.error) throw new Error(result.error);
  if (!result.id) throw new Error("No graph returned");
  // get the graph  

  
//   const nodes = result.graph.nodes.filter(n => n.type === 'ingredient');
//   console.log(` -> Graph has ${nodes.length} ingredients.`);

//   // Assertions
//   const carrotNode = nodes.find(n => n.text.toLowerCase().includes('carrot'));
//   const onionNode = nodes.find(n => n.text.toLowerCase().includes('onion'));

//   if (!carrotNode) throw new Error("Carrot node missing");
//   if (!onionNode) throw new Error("Onion node missing");

//   // Carrot should have icon (Optimistic Cache Hit)
//   if (carrotNode.iconUrl === carrotUrl) {
//       console.log('SUCCESS: Carrot has cached icon URL.');
//   } else {
//       console.error(`FAILURE: Carrot icon mismatch. Got: ${carrotNode.iconUrl}`);
//   }

//   // Onion should NOT have icon (Optimistic Cache Miss)
//   if (!onionNode.iconUrl && !onionNode.iconId) {
//       console.log('SUCCESS: Onion has NO icon (Optimistic null).');
//   } else {
//       console.error(`FAILURE: Onion has icon prematurely: ${onionNode.iconUrl}`);
//   }

//   // 3. Verify Save
//   if (result.id) {
//       console.log(`SUCCESS: Recipe Saved with ID: ${result.id}`);
//       const saved = await dataService.getRecipe(result.id);
//       if (saved) {
//           console.log(' -> Recipe exists in DB.');
//           if (saved.graph.nodes.find(n => n.text.includes('Onion'))?.iconUrl === undefined) {
//                console.log(' -> DB matches return state (Onion is empty).');
//           }
//       } else {
//           console.error('FAILURE: Recipe not found in DB.');
//       }
//   } else {
//       console.error('FAILURE: No Recipe ID returned.');
//   }

//   // Note: We cannot easily test the Cloud Function trigger here as it requires the Emulator or Deployed environment.
//   // We trust the integration test/manual verification for the background worker.
  
//   console.log('Optimistic Flow Test Complete.');
}

testOptimisticFlow();
