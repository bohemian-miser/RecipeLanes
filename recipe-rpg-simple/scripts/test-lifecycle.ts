import 'dotenv/config';
import { getOrCreateIconAction, recordRejectionAction, getAllStorageFilesAction } from '../app/actions';
import { setAIService, MockAIService } from '../lib/ai-service';
import { setDataService, MemoryDataService } from '../lib/data-service';

// Explicitly use Mocks for tests
setAIService(new MockAIService());
setDataService(new MemoryDataService());

function urlsMatch(url1: string, url2: string) {
    if (!url1 || !url2) return false;
    try {
        const u1 = decodeURIComponent(url1.split('?')[0]);
        const u2 = decodeURIComponent(url2.split('?')[0]);
        return u1 === u2;
    } catch (e) {
        return url1.split('?')[0] === url2.split('?')[0];
    }
}

async function testComprehensiveLifecycle() {
  const ingredient = "Integration-Test-Burger-" + Date.now();
  console.log(`\n=== Starting Comprehensive Test for: ${ingredient} ===`);

  const generatedUrls: string[] = [];

  try {
    // --- STEP 1: Generate First Icon (A) ---
    console.log('\n[1] Generating Icon A...');
    const resA = await getOrCreateIconAction(ingredient, 0, []) as any;
    if (resA.error) throw new Error(resA.error);
    
    const urlA = resA.iconUrl;
    generatedUrls.push(urlA);
    console.log(` -> Icon A: ${urlA}`);
    console.log(` -> Score A: ${resA.popularityScore.toFixed(3)}`);

    // --- STEP 2: Reject A, Get B ---
    console.log('\n[2] Rejecting A, getting B...');
    await recordRejectionAction(urlA, ingredient);
    
    const resB = await getOrCreateIconAction(ingredient, 1, [urlA]) as any;
    if (resB.error) throw new Error(resB.error);
    
    const urlB = resB.iconUrl;
    generatedUrls.push(urlB);
    console.log(` -> Icon B: ${urlB}`);
    
    if (urlA === urlB) console.warn('WARNING: Got same icon A again (expected new generation).');
    else console.log(' -> Verified: Got new icon B.');

    // --- STEP 3: Reject B, Get C ---
    console.log('\n[3] Rejecting B, getting C...');
    await recordRejectionAction(urlB, ingredient);
    
    const resC = await getOrCreateIconAction(ingredient, 2, [urlA, urlB]) as any;
    if (resC.error) throw new Error(resC.error);
    
    const urlC = resC.iconUrl;
    generatedUrls.push(urlC);
    console.log(` -> Icon C: ${urlC}`);

    // --- STEP 4: Reset Session (New User) ---
    console.log('\n[4] Simulating New Session (Fresh Request)...');
    // We expect the system to pick the "best" existing icon.
    // A: n=1, r=1 (Bad)
    // B: n=1, r=1 (Bad)
    // C: n=1, r=0 (Good, LCB ~0.27)
    // Expected: Pick C.
    
    const resNewSession = await getOrCreateIconAction(ingredient, 0, []) as any;
    const pickedUrl = resNewSession.iconUrl;
    console.log(` -> System picked: ${pickedUrl}`);
    
    if (pickedUrl === urlC) {
        console.log('SUCCESS: System correctly picked Icon C (highest score).');
    } else {
        console.error(`FAILURE: System picked ${pickedUrl} instead of C.`);
    }

    // --- STEP 5: Verify Storage Metadata ---
    console.log('\n[5] Verifying Storage Metadata...');
    // We need to wait a moment for metadata writes to propagate if they are async in background?
    // Our actions await them, so should be fine.
    
    const storageFiles = await getAllStorageFilesAction();
    const fileC = storageFiles.find((f: any) => urlsMatch(f.publicUrl, urlC));
    
    if (fileC) {
        console.log(' -> Found Icon C in storage listing.');
        console.log(` -> Impressions: ${fileC.impressions} (Expected: 2)`);
        console.log(` -> Rejections: ${fileC.rejections} (Expected: 0)`);
        
        if (String(fileC.impressions) === '2') {
            console.log('SUCCESS: Impression count updated correctly (1 gen + 1 pickup).');
        } else {
            console.error('FAILURE: Incorrect impression count.');
        }
    } else {
        console.error('FAILURE: Icon C not found in storage listing.');
    }

  } catch (e) {
      console.error('TEST FAILED:', e);
  } finally {
      console.log('Test Complete.');
  }
}

testComprehensiveLifecycle();
