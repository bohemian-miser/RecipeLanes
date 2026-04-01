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
import { getOrCreateIconAction, deleteIconByIdAction, getAllStorageFilesAction } from '../app/actions';
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

async function testDeletionSync() {
  const ingredient = "Sync-Test-Item-" + Date.now();
  console.log(`\n=== Starting Deletion Sync Test ===`);

  try {
    // 1. Create Icon
    const resA = await getOrCreateIconAction(ingredient, 0, []) as any;
    if (resA.error) throw new Error(resA.error);
    const idA = resA.id;
    const urlA = resA.url;
    console.log(` -> Created Icon: ${urlA} (${idA})`);

    // Wait for consistency
    await new Promise(r => setTimeout(r, 2000));

    // 2. Delete Icon
    console.log(" -> Deleting icon...");
    // Pass ingredient name to trigger targeted delete
    const delResA = await deleteIconByIdAction(idA, ingredient);
    if (!delResA.success) throw new Error(delResA.error);
    
    console.log(" -> Deletion command sent.");
    await new Promise(r => setTimeout(r, 2000)); // Wait for propagation

    // 3. Verify it is GONE from Storage List (Debug Gallery view)
    const storageFiles = await getAllStorageFilesAction();
    if (!storageFiles) throw new Error("Storage access denied!");
    const existsInStorage = storageFiles.some((f: any) => urlsMatch(f.publicUrl, urlA));
    if (existsInStorage) {
        console.error("FAILURE: Icon still exists in storage list!");
        throw new Error("Deletion failed verification");
    } else {
        console.log("SUCCESS: Icon removed from storage list.");
    }

    // 4. Verify it is NOT picked again by Forge (Firestore check)
    console.log(" -> Attempting to forge again (should generate NEW, not pick old)...");
    const resB = await getOrCreateIconAction(ingredient, 0, []) as any;
    if (resB.error) throw new Error(resB.error);
    const idB = resB.id;
    const urlB = resB.url;
    
    console.log(` -> New Icon URL: ${urlB} (${idB})`);

    if (idA === idB) {
        throw new Error("FAILURE: The system picked the DELETED icon! Synchronization is broken.");
    } else {
        console.log("SUCCESS: The system generated a NEW icon. Old one was correctly purged.");
    }
    
  } catch (e) {
      console.error("TEST FAILED:", e);
      process.exitCode = 1;
  }
}

testDeletionSync();