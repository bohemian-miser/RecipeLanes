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
import { getOrCreateIconAction, recordRejectionAction, getAllStorageFilesAction } from '../app/actions';
import { setAIService, MockAIService } from '../lib/ai-service';
import { setDataService, MemoryDataService } from '../lib/data-service';
import { setAuthService, MockAuthService } from '../lib/auth-service';

// Explicitly use Mocks for tests
setAIService(new MockAIService());
setDataService(new MemoryDataService());
setAuthService(new MockAuthService());

async function testExtendedScenarios() {
  console.log('=== Starting Extended Scenarios Test ===');

  try {
    await testScenarioA();
    await testScenarioB();
    await testScenarioC();
  } catch (e) {
    console.error('FATAL TEST ERROR:', e);
    process.exitCode = 1;
  } finally {
    console.log('\n=== Tests Complete ===');
  }
}

async function testScenarioA() {
  const ingredient = "Test-Lucky-" + Date.now();
  console.log(`\n--- Scenario A: The Lucky Hit (${ingredient}) ---`);
  
  // 1. Generate First
  const res1 = await getOrCreateIconAction(ingredient, 0, []) as any;
  const url1 = res1.iconUrl;
  console.log(`[1] Generated: ${url1} (Score: ${res1.popularityScore.toFixed(3)})`);
  
  // 2. New Session (Selects existing)
  const res2 = await getOrCreateIconAction(ingredient, 0, []) as any;
  console.log(`[2] Selected: ${res2.iconUrl} (Score: ${res2.popularityScore.toFixed(3)})`);
  
  if (res2.iconUrl !== url1) throw new Error('Did not select existing lucky icon!');
  if (res2.popularityScore <= res1.popularityScore) throw new Error('Score did not increase!');

  // 3. New Session Again
  const res3 = await getOrCreateIconAction(ingredient, 0, []) as any;
  console.log(`[3] Selected: ${res3.iconUrl} (Score: ${res3.popularityScore.toFixed(3)})`);
  
  if (res3.popularityScore <= res2.popularityScore) throw new Error('Score did not increase on second hit!');
  
  // Verify Storage
  const files = await getAllStorageFilesAction();
  if (!files) throw new Error("Storage access denied!");
  
  const file = files.find((f: any) => f.publicUrl === url1);
  
  if (!file) throw new Error(`File not found in storage listing: ${url1}`);
  
  console.log(`[Storage] Impressions: ${file.impressions}`);
  if (String(file.impressions) !== '3') throw new Error(`Storage impressions mismatch. Expected 3, got ${file.impressions}`);
  
  console.log('PASSED Scenario A');
}

async function testScenarioB() {
  const ingredient = "Test-RejectLoop-" + Date.now();
  console.log(`\n--- Scenario B: The Reject Loop (${ingredient}) ---`);
  
  const urls: string[] = [];
  let currentUrl = '';
  
  // 1. Generate & Reject Loop (3 times)
  for (let i = 0; i < 3; i++) {
      const res = await getOrCreateIconAction(ingredient, i, urls) as any; // Pass rejection count and seen list
      currentUrl = res.iconUrl;
      if (urls.includes(currentUrl)) throw new Error('Generated duplicate icon in reject loop!');
      urls.push(currentUrl);
      
      console.log(`[${i+1}] Generated: ${currentUrl} (Score: ${res.popularityScore.toFixed(3)})`);
      
      // Reject
      await recordRejectionAction(currentUrl, ingredient);
      console.log(`    Rejected.`);
  }
  
  // Verify scores dropped
  // We can check one of them by generating a new session request, 
  // but simpler to check DB or just trust recordRejectionAction (tested elsewhere).
  
  // 4. Force 4th generation (Gate check)
  // Rejections = 3. 
  const res4 = await getOrCreateIconAction(ingredient, 3, urls) as any;
  console.log(`[4] Generated (4th): ${res4.iconUrl}`);
  if (urls.includes(res4.iconUrl)) throw new Error('Gate failed to generate new icon on 4th try');
  
  console.log('PASSED Scenario B');
}

async function testScenarioC() {
  const ingredient = "Test-Competition-" + Date.now();
  console.log(`\n--- Scenario C: Competition (${ingredient}) ---`);
  
  // 1. Generate A
  const resA = await getOrCreateIconAction(ingredient, 0, []) as any;
  const urlA = resA.iconUrl;
  console.log(`[1] Generated A: ${urlA} (Score: ${resA.popularityScore.toFixed(3)})`);
  
  // 2. Reject A
  await recordRejectionAction(urlA, ingredient);
  console.log('    Rejected A.');
  
  // 3. Generate B (In same session, A is seen/rejected)
  const resB = await getOrCreateIconAction(ingredient, 1, [urlA]) as any;
  const urlB = resB.iconUrl;
  console.log(`[2] Generated B: ${urlB} (Score: ${resB.popularityScore.toFixed(3)})`);
  
  // 4. New Session - Should pick B (Score ~0.27) over A (Score ~0)
  const resNew = await getOrCreateIconAction(ingredient, 0, []) as any;
  console.log(`[3] New Session Picked: ${resNew.iconUrl} (Score: ${resNew.popularityScore.toFixed(3)})`);
  
  if (resNew.iconUrl !== urlB) throw new Error('Did not pick the better icon (B)!');
  
  console.log('PASSED Scenario C');
}

testExtendedScenarios();