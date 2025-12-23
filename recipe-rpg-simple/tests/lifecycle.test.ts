import 'dotenv/config';
import { getOrCreateIconAction, recordRejectionAction, getAllStorageFilesAction, rerollIconAction } from '../app/actions';
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
    
    const resNewSession = await getOrCreateIconAction(ingredient, 0, []) as any;
    const pickedUrl = resNewSession.iconUrl;
    console.log(` -> System picked: ${pickedUrl}`);
    
    if (pickedUrl === urlC) {
        console.log('SUCCESS: System correctly picked Icon C (highest score).');
    } else {
        console.error(`FAILURE: System picked ${pickedUrl} instead of C.`);
    }

    // --- STEP 4b: Cycle through remaining candidates (A, B) ---
    console.log('\n[4b] Rejecting C, Expecting A or B...');
    await recordRejectionAction(pickedUrl, ingredient);
    
    const resNext = await getOrCreateIconAction(ingredient, 1, [pickedUrl]) as any;
    const urlNext = resNext.iconUrl;
    console.log(` -> System picked: ${urlNext}`);
    
    const knownUrls = [urlA, urlB];
    if (knownUrls.includes(urlNext)) {
        console.log('SUCCESS: System cycled to a previous candidate (A or B).');
    } else {
        console.warn(`WARNING: System generated new ${urlNext} instead of using A/B cache.`);
    }

    // --- STEP 4c: Exhaust Cache, Expect D ---
    console.log('\n[4c] Exhausting cache, Expecting D...');
    const seenSoFar = [pickedUrl, urlNext, urlA, urlB]; 
    const resFinal = await getOrCreateIconAction(ingredient, 2, seenSoFar) as any;
    const urlD = resFinal.iconUrl;
    console.log(` -> System picked: ${urlD}`);
    
    if (!seenSoFar.includes(urlD)) {
         console.log('SUCCESS: System generated new Icon D after cache exhaustion.');
    } else {
         console.error('FAILURE: System did not generate new icon.');
    }

    // --- STEP 5: Verify Storage Metadata ---
    console.log('\n[5] Verifying Storage Metadata...');
    
    const storageFiles = await getAllStorageFilesAction();
    if (!storageFiles) throw new Error("Storage access denied!");
    
    const fileC = storageFiles.find((f: any) => urlsMatch(f.publicUrl, urlC));
    
    if (fileC) {
        console.log(' -> Found Icon C in storage listing.');
        console.log(` -> Impressions: ${fileC.impressions} (Expected: 2)`);
        console.log(` -> Rejections: ${fileC.rejections} (Expected: 1)`); // Rejected in Step 4b
        
        // C was picked in Step 3 (n=1, r=0), Step 4 (n=2, r=0).
        // Then Rejected in Step 4b (n=2, r=1).
        
        if (String(fileC.impressions) === '2') {
            console.log('SUCCESS: Impression count updated correctly.');
        } else {
            console.error('FAILURE: Incorrect impression count.');
        }
    } else {
        console.error('FAILURE: Icon C not found in storage listing.');
    }

  } catch (e) {
      console.error('TEST FAILED:', e);
      process.exitCode = 1;
  } finally {
      console.log('Test Complete.');
  }
}

async function testRerollAction() {
    console.log('\n=== Testing Reroll Action (Wrapper) ===');
    const ingredient = "Reroll-Test-" + Date.now();
    
    // 1. Create Initial Icon
    const res1 = await getOrCreateIconAction(ingredient, 0, []) as any;
    const url1 = res1.iconUrl;
    console.log(`[Reroll] Initial: ${url1}`);

    // 2. Reroll (Should record rejection and get new)
    const res2 = await rerollIconAction('node-1', ingredient, url1, [url1]) as any;
    const url2 = res2.iconUrl;
    console.log(`[Reroll] New: ${url2}`);
    
    if (url1 !== url2) {
        console.log('SUCCESS: Reroll generated new icon.');
    } else {
        console.error('FAILURE: Reroll returned same icon.');
    }
}

async function run() {
    await testComprehensiveLifecycle();
    await testRerollAction();
}

run();
