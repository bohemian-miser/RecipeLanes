import { test, expect } from './utils/fixtures';
import { screenshot, screenshotDir } from './utils/screenshot';
import * as admin from 'firebase-admin';
import { DB_COLLECTION_QUEUE, DB_COLLECTION_RECIPES } from '../lib/config';

test.describe('Icon Queue Stress Test', () => {
    // Unique ID for this test run
    const RUN_ID = Date.now().toString();

    // Helper to initialize admin
    const initAdmin = () => {
        if (!admin.apps.length) {
            const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "local-project-id";
            process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
            process.env.GCLOUD_PROJECT = projectId;
            admin.initializeApp({ projectId });
        }
        return admin.firestore();
    };

    test('reproduction: quota failure blocks subsequent items (STRESS SCENARIO)', async ({ page, login }) => {
        const dir = screenshotDir('icon-queue-stress', 'desktop');
        const RUN_ID = Date.now().toString();
        // 1. Navigate to Icon Overview (Icon Maker) - Pre-load for auth injection
        await page.goto('/icon_overview');
        
        // Login as test user
        await login();
        
        await expect(page.getByText('Forge Icons')).toBeVisible();
        await screenshot(page, dir, 'initial-load');

        // 0. Cleanup Queue (Ensure fresh start for UI visibility)
        const db = initAdmin(); // Initialize db here to use it for cleanup
        console.log('[StressTest] Cleaning up queue...');
        const queueDocs = await db.collection(DB_COLLECTION_QUEUE).listDocuments();
        if (queueDocs.length > 0) {
            const batch = db.batch();
            for (const doc of queueDocs) {
                batch.delete(doc);
            }
            await batch.commit();
            console.log(`[StressTest] Deleted ${queueDocs.length} existing queue items.`);
        }

        // 1. Create multiple ingredients
        // We add them quickly to ensure they get queued up
        const items = [
            `Normal-${RUN_ID}-1`,
            `Force_quota_error_stress_${RUN_ID}`, // This will fail
            `Normal-${RUN_ID}-2`,
            `Normal-${RUN_ID}-3`,
            `Force_quota_error_stress_${RUN_ID}_2`, // Fail 2
            `Force_quota_error_stress_${RUN_ID}_3`  // Fail 3
        ];

        console.log('[StressTest] Adding items via UI...');
        for (const item of items) {
            await page.getByPlaceholder('ENTER INGREDIENT...').fill(item);
            await page.getByRole('button', { name: 'Generate Icon' }).click();
            // Small delay to ensure order but fast enough to queue
            await page.waitForTimeout(500);
        }

        // 3. Monitor Queue/Results
        // We expect the Quota item to fail (mock error)
        // AND validation of the bug: subsequent items might get stuck?
        // Actually, if the processor is async, others MIGHT process.
        // But the user claims they get stuck.
        
        console.log('[StressTest] Waiting for processing...');
        
        // Wait for enough time for things to potentially process
        await page.waitForTimeout(10000);
        
        // Take screenshot of the state
        await screenshot(page, dir, 'stuck-state');
        console.log('[StressTest] Screenshot taken: stuck-state');

        // Verify Quota Item Failed (It might show as error or just stuck depending on UI)
        // The UI `QueueMonitor` probably shows status.
        // Let's check Firestore directly for precise status assertion
        
        // Verify Quota items failed
        const quotaItems = [
            `Force_quota_error_stress_${RUN_ID}`,
            `Force_quota_error_stress_${RUN_ID}_2`,
            `Force_quota_error_stress_${RUN_ID}_3`
        ];

        for (const qItem of quotaItems) {
            const qDoc = await db.collection(DB_COLLECTION_QUEUE).doc(qItem).get();
            expect(qDoc.data()?.status).toBe('failed');
            console.log(`[StressTest] Quota item ${qItem} failed as expected.`);
        }

        // Verify other items succeeded
        for (const item of items) {
            if (item.includes('Force_quota_error')) continue;
            // Standardize name (Title Case for these generic ones)
            // "Normal-<RUN_ID>-1" -> "Normal-<RUN_ID>-1" (Already styled)
            const nDoc = await db.collection(DB_COLLECTION_QUEUE).doc(item).get();
            // Successful items are DELETED from queue, OR marked completed?
            // "Successfully updated 1 recipes and deleted queue item." => Deleted.
            expect(nDoc.exists).toBe(false);
            console.log(`[StressTest] Item ${item} processed and removed from queue.`);
        }

        // 4. Retry the Quota Item via UI (Reroll)
        // We need to find the icon card and click Reroll (Refresh icon)
        // But wait, if it failed, does it show in the list? 
        // `icon_overview/page.tsx` only shows icons from `graph.nodes`. 
        // If `processIconQueue` failed, it might NOT have updated the recipe node with an iconUrl/id?
        // If it failed, the node is there but has no icon.
        // `IconDisplay` filters? No, it maps nodes. 
        // `isPending: !getNodeIconUrl(n) && !getNodeIconId(n)`
        // So it should show as Pending or similar.
        
        // The UI handles "Reroll" which calls `rejectIcon`.
        // `rejectIcon` (action) triggers `processIconQueue`? No, it removes the icon from recipe.
        // Then `resolveRecipeIcons` (if triggered) would re-queue it.
        
        // Actually, the user said "once the first hits quota, the rest get stuck".
        // Let's verify if `normal-${RUN_ID}-2` processed.
        const normal2 = await db.collection(DB_COLLECTION_QUEUE).doc(`normal-${RUN_ID}-2`).get();
        console.log(`[StressTest] Item after quota error status: ${normal2.data()?.status}`);
        
        // If the bug is "rest get stuck", then this expectation passes if they ARE stuck (pending).
        // If they successfully processed (completed/deleted), then the "rest get stuck" hypothesis might be wrong 
        // OR my reproduction isn't triggering the specific condition (e.g. single thread crash).
        // But let's assert the RE_TRY of the failed one gets stuck.
        
        // Reset the failed item to pending explicitly to simulate "Retry" button behavior if UI doesn't support it directly for failed items
        // Or if the user clicks "Reroll" on a placeholder?
        
        // 4. Retry via UI "Retry" button in QueueMonitor
        // This sets status to 'pending' but since it's an update, the CF (listening to onCreate) won't fire.
        // Result: Stagnant 'pending' item.
        
        console.log('[StressTest] Attempting Retry via QueueMonitor...');
        
        // Open QueueMonitor (if it's a drawer/modal? Or is it always visible?)
        // In app/icon_overview/page.tsx, it seems always rendered or part of layout.
        // Let's scroll to it or just find it.
        const queueMonitor = page.locator('.max-w-2xl'); 
        await expect(queueMonitor).toBeVisible();
        
        // Debug: Screenshot and log content
        await screenshot(page, dir, 'queue-monitor-debug');
        console.log('[StressTest] QueueMonitor text:', await queueMonitor.innerText());

        for (const qItem of quotaItems) {
            console.log(`[StressTest] Retrying ${qItem}...`);
            const itemRow = queueMonitor.locator(`[data-ingredient="${qItem}"]`);
            await expect(itemRow).toBeVisible();
            
            // Find Retry button
            const retryBtn = itemRow.getByRole('button', { name: "Retry" });
            await expect(retryBtn).toBeVisible();
            await retryBtn.click();
            
            // Verify status changes
            // Since "Force_quota_error" triggers a persistent error in MockAIService,
            // the item will likely go Pending -> Processing -> Failed (AGAIN).
            // So we CANNOT expect 'Failed' to disappear permanently.
            // We just want to ensure it doesn't stay 'Queued' (Pending) forever.
            // We'll rely on the DB check below to confirm it's not 'pending'.
            console.log(`[StressTest] Retried ${qItem}. Waiting for processing...`);
        }
        
        // 5. Verify it gets PROCESSED (Fix verification)
        console.log('[StressTest] Waiting to see if it processes...');
        await page.waitForTimeout(15000); // Wait 15s.
        
        await screenshot(page, dir, 'fixed-state-retry');
        
        for (const qItem of quotaItems) {
             const qDoc = await db.collection(DB_COLLECTION_QUEUE).doc(qItem).get();
             if (!qDoc.exists) {
                 console.log(`[StressTest] ${qItem} processed and deleted (Success).`);
             } else {
                 const data = qDoc.data();
                 console.log(`[StressTest] ${qItem} status: ${data?.status}`);
                 // It should be 'processing' or 'completed' or 'failed' (if it failed again, but mock AI should pass on retry if we didn't force error again? 
                 // Wait, we forced error by Name. "Force_quota_error..."
                 // The Mock AI service checks for "Force_quota_error" in the name to trigger error?
                 // Let's check `lib/ai-service.ts`.
                 
                 // If the name still triggers error, it might fail again.
                 // But at least it shouldn't be 'pending'.
                 expect(data?.status).not.toBe('pending');
             }
        }

    });
});

