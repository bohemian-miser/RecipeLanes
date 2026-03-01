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