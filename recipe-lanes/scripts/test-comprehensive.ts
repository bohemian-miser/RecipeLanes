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
import { getOrCreateIconAction, deleteIconByIdAction, getAllStorageFilesAction, recordRejectionAction } from '../app/actions';
import { setAIService, MockAIService } from '../lib/ai-service';
import { setDataService, MemoryDataService } from '../lib/data-service';
import { setAuthService, MockAuthService } from '../lib/auth-service';

// Explicitly use Mocks for tests
setAIService(new MockAIService());
setDataService(new MemoryDataService());
setAuthService(new MockAuthService());

function urlsMatch(url1: string, url2: string) {
    return url1 === url2;
}

async function testComprehensive() {
  const ingredient = "Comp-Test-" + Date.now();
  console.log(`\n=== Starting Comprehensive Test for: ${ingredient} ===`);

  try {
    // 1. Creation & Case Insensitivity
    console.log("\n[1] Testing Creation & Case Normalization...");
    const resA = await getOrCreateIconAction(ingredient.toLowerCase(), 0, []) as any; // Lowercase input
    const idA = resA.id;
    const urlA = resA.url;
    console.log(` -> Created A (from lower): ${urlA} (${idA})`);

    const resB = await getOrCreateIconAction(ingredient.toUpperCase(), 0, [urlA]) as any; // Uppercase input
    const idB = resB.id;
    const urlB = resB.url;
    console.log(` -> Created B (from UPPER): ${urlB} (${idB})`);
    
    if (idA === idB) console.warn(" -> Warning: Got same icon, might not be creating new.");
    
    // 2. Reroll Logic & Scoring
    console.log("\n[2] Testing Reroll & Scoring...");
    // Reject A
    await recordRejectionAction(idA, ingredient);
    // Get A again (should have lower score) or check storage metadata
    let storageFiles = await getAllStorageFilesAction();
    if (!storageFiles) throw new Error("Storage access denied in test!");

    const fileA = storageFiles.find((f: any) => urlsMatch(f.publicUrl, urlA));
    if (fileA) {
        console.log(` -> Icon A Score: ${fileA.popularityScore}, Rejections: ${fileA.rejections}`);
        if (Number(fileA.rejections) < 1) throw new Error("Rejection count not updated!");
    } else {
        throw new Error("Icon A not found in storage!");
    }

    // 3. Deletion & Persistence
    console.log("\n[3] Testing Deletion...");
    // Delete A
    await deleteIconByIdAction(idA, ingredient); // Smart delete
    
    // Verify A is gone
    storageFiles = await getAllStorageFilesAction();
    if (!storageFiles) throw new Error("Storage access denied!");
    if (storageFiles.some((f: any) => urlsMatch(f.publicUrl, urlA))) {
        throw new Error("Icon A failed to delete!");
    }
    console.log(" -> Icon A deleted successfully.");

    // Verify B is still there
    if (!storageFiles.some((f: any) => urlsMatch(f.publicUrl, urlB))) {
        throw new Error("Icon B was accidentally deleted!");
    }
    console.log(" -> Icon B preserved.");

    console.log("\n=== Test Passed Successfully ===");

  } catch (e) {
      console.error("\nTEST FAILED:", e);
      process.exitCode = 1;
  }
}

testComprehensive();