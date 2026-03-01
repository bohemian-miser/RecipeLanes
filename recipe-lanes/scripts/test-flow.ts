import 'dotenv/config';
import { generateIconFlow } from '../lib/flows';

async function run() {
  const testInputs = ["Spicy Ramen", "Golden Sword", "Magic Backpack"];
  
  console.log("=== Testing Generation Flow Locally ===");
  
  for (const input of testInputs) {
      console.log(`\n--- Input: "${input}" ---`);
      try {
        const result = await generateIconFlow({ ingredient: input });
        console.log(`[SUCCESS]`);
        console.log(`Description: "${result.visualDescription}"`);
        console.log(`Image URL:   ${result.url}`);
      } catch (e: any) {
        console.error(`[FAILURE]`, e.message);
        if (e.message.includes('API key')) {
            console.error("  (Hint: Ensure you have run 'gcloud auth application-default login' locally)");
        }
      }
  }
}

run();
