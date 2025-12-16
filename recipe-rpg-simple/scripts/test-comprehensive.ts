import 'dotenv/config';
import { getOrCreateIconAction, deleteIconByUrlAction, deleteIngredientCategoryAction, getAllStorageFilesAction, recordRejectionAction } from '../app/actions';

function urlsMatch(url1: string, url2: string) {
    if (!url1 || !url2) return false;
    return url1.split('?')[0] === url2.split('?')[0];
}

async function testComprehensive() {
  const ingredient = "Comp-Test-" + Date.now();
  console.log(`\n=== Starting Comprehensive Test for: ${ingredient} ===`);

  try {
    // 1. Creation & Case Insensitivity
    console.log("\n[1] Testing Creation & Case Normalization...");
    const resA = await getOrCreateIconAction(ingredient.toLowerCase(), 0, []) as any; // Lowercase input
    const urlA = resA.iconUrl;
    console.log(` -> Created A (from lower): ${urlA}`);

    const resB = await getOrCreateIconAction(ingredient.toUpperCase(), 0, [urlA]) as any; // Uppercase input
    const urlB = resB.iconUrl;
    console.log(` -> Created B (from UPPER): ${urlB}`);
    
    // Check if they are in the same group? 
    // We can verify by checking if resB sees urlA as existing if we didn't exclude it?
    // Or just check the filenames/paths if they share the same Title Cased name.
    if (resA.iconUrl === resB.iconUrl) console.warn(" -> Warning: Got same icon, might not be creating new.");
    
    // 2. Reroll Logic & Scoring
    console.log("\n[2] Testing Reroll & Scoring...");
    // Reject A
    await recordRejectionAction(urlA, ingredient);
    // Get A again (should have lower score) or check storage metadata
    // We can't easily check score directly without fetching all.
    let storageFiles = await getAllStorageFilesAction();
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
    await deleteIconByUrlAction(urlA, ingredient); // Smart delete
    
    // Verify A is gone
    storageFiles = await getAllStorageFilesAction();
    if (storageFiles.some((f: any) => urlsMatch(f.publicUrl, urlA))) {
        throw new Error("Icon A failed to delete!");
    }
    console.log(" -> Icon A deleted successfully.");

    // Verify B is still there
    if (!storageFiles.some((f: any) => urlsMatch(f.publicUrl, urlB))) {
        throw new Error("Icon B was accidentally deleted!");
    }
    console.log(" -> Icon B preserved.");

    // 4. Category Cleanup
    console.log("\n[4] Testing Category Cleanup...");
    await deleteIngredientCategoryAction(ingredient);
    
    storageFiles = await getAllStorageFilesAction();
    if (storageFiles.some((f: any) => urlsMatch(f.publicUrl, urlB))) {
        throw new Error("Icon B failed to delete via category cleanup!");
    }
    console.log(" -> Category cleaned up successfully.");

    console.log("\n=== Test Passed Successfully ===");

  } catch (e) {
      console.error("\nTEST FAILED:", e);
      process.exit(1);
  }
}

testComprehensive();
