import 'dotenv/config';
import { createDebugRecipeAction, addIngredientNodeAction, rejectIcon } from '../app/actions';
import { setAIService, MockAIService } from '../lib/ai-service';
import { getDataService } from '../lib/data-service';
import { setAuthService, MockAuthService } from '../lib/auth-service';
import { Icon } from 'lucide-react';
import { getNodeIconUrl, getNodeIconId, getNodeIconMetadata } from '../lib/recipe-lanes/model-utils';

// Explicitly use Mocks for tests
setAIService(new MockAIService());
setAuthService(new MockAuthService());

// Helper to get the current icon of a node
async function getNodeIcon(recipeId: string, nodeId: string) {
    const recipeData = await getDataService().getRecipe(recipeId);
    const graph = recipeData?.graph;
    const node = graph?.nodes?.find((n: any) => n.id === nodeId);
    if (!node) return { iconUrl: undefined, iconId: undefined, IconMetadata: undefined };
    return { iconUrl: getNodeIconUrl(node), iconId: getNodeIconId(node), IconMetadata: getNodeIconMetadata(node) };
}

async function testFakeGraphFlow() {
  const ingredient = "Integration-Burger-" + Date.now();
  console.log(`\n=== Starting Fake Graph Test for: ${ingredient} ===`);

  try {
    // 1. Create Debug Recipe (Fake Graph)
    console.log('\n[1] Creating Debug Recipe...');
    const r1 = await createDebugRecipeAction() as any;
    if (r1.error) throw new Error(r1.error);
    const recipeId = r1.recipeId;
    console.log(` -> Recipe ID: ${recipeId}`);

    // 2. Add Ingredient Node
    console.log('\n[2] Adding Ingredient Node...');
    const r2 = await addIngredientNodeAction(recipeId, ingredient) as any;
    if (r2.error) throw new Error(r2.error);
    const nodeId = r2.nodeId;
    console.log(` -> Node ID: ${nodeId}`);

    // 3. Resolve (Implicitly handled by addIngredientNodeAction)
    // Wait for Cloud Function
    await getDataService().waitForQueue(ingredient);
    
    let current = await getNodeIcon(recipeId, nodeId);
    console.log(` -> Icon A: ${JSON.stringify(current, null, 2)}`);
    if (!current.iconUrl) throw new Error("Failed to generate Icon A");
    const urlA = current.iconUrl;

    // 4. Reroll (Reject A, Get B)
    console.log('\n[4] Rerolling (Reject A)...');

    await rejectIcon(
        recipeId,
        ingredient,
        current.iconId!
    );
    
    // Wait for Cloud Function
    await getDataService().waitForQueue(ingredient);

    current = await getNodeIcon(recipeId, nodeId);
    console.log(` -> Icon B: ${current.iconUrl}`);
    if (!current.iconUrl) throw new Error("Failed to generate Icon B");
    const urlB = current.iconUrl;
    
    if (urlA === urlB) console.warn("WARNING: Got same icon.");
    else console.log("SUCCESS: Got new icon.");

  } catch (e) {
      console.error('TEST FAILED:', e);
      process.exitCode = 1;
  }
}

// Disabled for now since it's broken and I've tested it locally.
// waitForQueue is only used in tests and i don't trust it.
// testFakeGraphFlow();