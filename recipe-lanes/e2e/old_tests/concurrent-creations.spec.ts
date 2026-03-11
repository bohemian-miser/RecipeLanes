
// import { test, expect } from './utils/fixtures';
// import * as admin from 'firebase-admin';
// import { FirebaseDataService } from '../lib/data-service';
// import { DB_COLLECTION_RECIPES, DB_COLLECTION_QUEUE } from '../lib/config';
// import { getDataService } from '../lib/data-service';
// import { db } from '../lib/firebase-admin';
// import { FieldValue } from 'firebase-admin/firestore';

// test.describe('Integration: Concurrent Queueing', () => {
//     // We use Playwright test runner but this is effectively an integration test 
//     // using the Node.js environment provided by the runner.
    
//     // const db = admin.firestore();
//     // let service: FirebaseDataService;

//     // test.beforeAll(() => {
//     //     if (!admin.apps.length) {
//     //         const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "local-project-id";
//     //         process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
//     //         process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
//     //         process.env.GCLOUD_PROJECT = projectId;
//     //         admin.initializeApp({ projectId });
//     //     }
//     //     db = admin.firestore();
//     //     service = new FirebaseDataService();
//   // });
//     const service = getDataService();

//     test('should deduplicate queue items when multiple recipes request same icon concurrently', async () => {
//          const RUN_ID = Date.now().toString();
//          const INGREDIENT_NAME = `Concurrent Potato ${RUN_ID}`;
         
//          // 1. Create 2 Recipes that need this ingredient
//          const createRecipe = async (id: string) => {
//              await db.collection(DB_COLLECTION_RECIPES).doc(id).set({
//                  title: `Recipe ${id}`,
//                  ownerId: 'test-user',
//                  graph: {
//                      nodes: [
//                          { 
//                              id: 'n1', 
//                              text: INGREDIENT_NAME, 
//                              visualDescription: INGREDIENT_NAME,
//                              type: 'ingredient' 
//                          }
//                      ],
//                      rejections: {}
//                  }
//              });
//          };

//          const r1 = `recipe-${RUN_ID}-1`;
//          const r2 = `recipe-${RUN_ID}-2`;

//          await Promise.all([createRecipe(r1), createRecipe(r2)]);

//          // 2. Call resolveRecipeIcons concurrently
//          console.log(`[Test] Resolving icons for ${r1} and ${r2} concurrently...`);
         
//          await Promise.all([
//              service.resolveRecipeIcons(r1),
//              service.resolveRecipeIcons(r2)
//          ]);

//          // 3. Verify Queue
//          // Standard name usually lowercases it
//          const stdName = INGREDIENT_NAME.toLowerCase(); 
//          const queueDoc = await db.collection(DB_COLLECTION_QUEUE).doc(stdName).get();
//          const data = queueDoc.data();
         
//          expect(queueDoc.exists).toBe(true);
//          console.log('[Test] Queue Data:', data);

//          // Expect BOTH recipes to be listed
//          expect(data?.recipes).toContain(r1);
//          expect(data?.recipes).toContain(r2);
//          expect(data?.recipeCount).toBe(2);
         
//          // Expect only 1 queue item to exist (implied by doc id check)

//         // 4. Process the queue item (Simulate Cloud Task)
//          // We need to simulate the logic inside processIconTask manually here to avoid import issues
         
//          console.error('[Test] Simulating processIconTask transaction...');
         
//          // Mock Icon Data
//          const iconData = {
//              url: 'http://mock.url/icon.png',
//              storagePath: 'icons/mock.png',
//              id: 'mock-icon-id',
//              score: 0.9,
//              fullPrompt: 'Mock Prompt'
//          };

//          // We need to manually run the transaction logic from functions/src/index.ts
//          // because we can't easily import the cloud function trigger itself in this test context without robust mocking.
//          // Logic:
//          // 1. Get queue doc
//          // 2. For each recipe in queue, call assignIconToRecipe
//          // 3. Delete queue doc
         
//          // The User expects this to FAIL with "Firestore transactions require all reads to be executed before all writes."
//          // This is because `assignIconToRecipe` might be starting its OWN transaction or doing reads/writes in a way
//          // that violates the outer transaction's requirements if not passed `t` correctly, 
//          // OR if `assignIconToRecipe` does reads after writes in the shared context.
         
//         // Minimal Reproduction
//         console.error('[Test] Starting Minimal Reproduction...');
//         try {
//             await db.runTransaction(async (t) => {
//                 console.error('[Test] TR Start');
//                 // 1. Read
//                 const qDoc = await t.get(queueDoc.ref);
                
//                 // 2. Write
//                 t.update(queueDoc.ref, { recipeCount: FieldValue.increment(0) });
                
//                 // 3. Read Again (Should Fail)
//                 console.error('[Test] Attempting Read after Write...');
//                 const qDoc2 = await t.get(queueDoc.ref);
//                 console.error('[Test] Read Succeeded (Unexpected)');
//             });
//         } catch (e: any) {
//              console.error('[Test] Caught Expected Error:', e.message);
//              expect(e.message).toMatch(/Firestore transactions require all reads to be executed before all writes|read after write/i);
//         }
//     });
// });
