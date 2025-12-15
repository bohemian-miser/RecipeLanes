import 'dotenv/config';
import { getOrCreateIconAction, deleteIconByUrlAction, deleteIngredientCategoryAction, getAllStorageFilesAction } from '../app/actions';

function urlsMatch(url1: string, url2: string) {
    if (!url1 || !url2) return false;
    return url1.split('?')[0] === url2.split('?')[0];
}

async function testDeletion() {
  const ingredient = "Deletion-Test-Item-" + Date.now();
  const catIngredient = "Deletion-Test-Category-" + Date.now();
  
  console.log(`\n=== Starting Deletion Test ===`);

  try {
    // --- Test 1: Single Icon Deletion ---
    console.log(`\n[1] Testing Single Icon Deletion for: ${ingredient}`);
    
    // 1. Create Icon
    const resA = await getOrCreateIconAction(ingredient, 0, []) as any;
    if (resA.error) throw new Error(resA.error);
    const urlA = resA.iconUrl;
    console.log(` -> Created Icon: ${urlA}`);

    // Wait for consistency
    await new Promise(r => setTimeout(r, 2000));

    // 2. Verify existence
    let storageFiles = await getAllStorageFilesAction();
    console.log(` -> Found ${storageFiles.length} files in storage.`);
    
    let exists = storageFiles.some((f: any) => urlsMatch(f.publicUrl, urlA));
    if (!exists) {
        console.warn(" -> Sample of files found:");
        storageFiles.slice(0, 5).forEach((f: any) => console.log(`    - ${f.publicUrl}`));
        throw new Error("Icon not found in storage after creation.");
    }
    console.log(" -> Verified icon exists in storage.");

    // 3. Delete Icon
    console.log(" -> Deleting icon...");
    // Note: We don't pass the ingredient name here to test the fallback/lookup logic if we want, 
    // or we pass it to test the "Smart Delete". 
    // Let's pass it to test the optimal path.
    const delResA = await deleteIconByUrlAction(urlA, ingredient);
    if (!delResA.success) throw new Error(delResA.error);

    // 4. Verify deletion
    storageFiles = await getAllStorageFilesAction();
    exists = storageFiles.some((f: any) => urlsMatch(f.publicUrl, urlA));
    if (exists) throw new Error("Icon still exists in storage after deletion!");
    console.log("SUCCESS: Single icon deletion working.");


    // --- Test 2: Category Deletion ---
    console.log(`\n[2] Testing Category Deletion for: ${catIngredient}`);

    // 1. Create Icon in Category
    const resB = await getOrCreateIconAction(catIngredient, 0, []) as any;
    if (resB.error) throw new Error(resB.error);
    const urlB = resB.iconUrl;
    console.log(` -> Created Icon 1: ${urlB}`);
    
    // 2. Verify existence
    await new Promise(r => setTimeout(r, 1000));
    storageFiles = await getAllStorageFilesAction();
    const fileB = storageFiles.find((f: any) => urlsMatch(f.publicUrl, urlB));
    if (!fileB) throw new Error("Icon B not found in storage.");
    console.log(" -> Verified Icon B exists.");

    // 3. Delete Category
    console.log(` -> Deleting category: ${catIngredient}...`);
    const delResB = await deleteIngredientCategoryAction(catIngredient);
    if (!delResB.success) throw new Error(delResB.error);

    // 4. Verify deletion
    storageFiles = await getAllStorageFilesAction();
    const existsB = storageFiles.some((f: any) => urlsMatch(f.publicUrl, urlB));
    // Also check if any file starts with this ingredient name (approx check since filename structure is known)
    const anyLeft = storageFiles.some((f: any) => f.name.includes(catIngredient.replace(/\s+/g, '-')));
    
    if (existsB || anyLeft) {
        console.error("Storage state sample:", storageFiles.filter((f:any) => f.name.includes('Deletion-Test')));
        throw new Error("Category or its items still exist in storage!");
    }
    console.log("SUCCESS: Category deletion working.");

  } catch (e) {
      console.error("TEST FAILED:", e);
      process.exit(1);
  }
}

testDeletion();
