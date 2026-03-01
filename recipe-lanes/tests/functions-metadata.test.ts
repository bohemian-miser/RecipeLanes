import 'dotenv/config';
import { db, storage } from '../lib/firebase-admin';
import { createVisualRecipeAction } from '../app/actions';
import { setAIService, MockAIService } from '../lib/ai-service';
import { setAuthService, MockAuthService } from '../lib/auth-service';

// Use Mocks for parsing to ensure deterministic test
setAIService(new MockAIService());
setAuthService(new MockAuthService());

async function testMetadataPopulation() {
    console.log('\n=== Testing Cloud Function Metadata Population ===');
    
    const uniqueId = Date.now();
    const ingredientName = `Metadata-Test-Ham-${uniqueId}`;
    const recipeText = `Fry 1 ${ingredientName}`;

    // 1. Create Recipe (Fast Path)
    console.log('[Step 1] Creating recipe via createVisualRecipeAction...');
    const result = await createVisualRecipeAction(recipeText);
    if (!result.id) throw new Error("Failed to create recipe");
    const recipeId = result.id;
    console.log(` -> Recipe ID: ${recipeId}`);

    // 2. Poll Firestore until Background Worker updates the icon
    console.log('[Step 2] Waiting for Background Worker to populate icons...');
    let iconUrl: string | null = null;
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds

    while (attempts < maxAttempts) {
        const doc = await db.collection('recipes').doc(recipeId).get();
        const nodes = doc.data()?.graph?.nodes || [];
        const node = nodes.find((n: any) => n.visualDescription?.toLowerCase().includes('ham'));
        
        if (node?.iconUrl && node?.iconId) {
            iconUrl = node.iconUrl;
            console.log(` -> Icon populated after ${attempts}s: ${iconUrl}`);
            break;
        }
        
        await new Promise(r => setTimeout(r, 1000));
        attempts++;
    }

    if (!iconUrl) throw new Error("Background worker timed out or failed to update icons.");

    // 3. Verify Storage Metadata
    console.log('[Step 3] Verifying Storage Metadata...');
    try {
        let filePath: string;
        if (iconUrl.includes('/o/')) {
            const matches = iconUrl.match(new RegExp('/o/([^?]+)'));
            if (!matches || !matches[1]) throw new Error("Could not parse Storage path from API URL");
            filePath = decodeURIComponent(matches[1]);
        } else {
            // Handle https://storage.googleapis.com/BUCKET/PATH
            const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'recipe-lanes.firebasestorage.app';
            const parts = iconUrl.split(bucketName);
            if (parts.length < 2) throw new Error("Could not parse Storage path from Public URL");
            filePath = decodeURIComponent(parts[1]);
            if (filePath.startsWith('/')) filePath = filePath.substring(1);
        }
        
        const bucket = storage.bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'recipe-lanes.firebasestorage.app');
        const file = bucket.file(filePath);
        
        const [metadata] = await file.getMetadata();
        const custom = metadata.metadata || {};

        console.log(' -> Fetched Metadata:', custom);

        const expectedKeys = ['popularity_score', 'impressions', 'rejections', 'fullPrompt', 'visualDescription'];
        let missing = false;

        for (const key of expectedKeys) {
            if (!custom[key]) {
                console.error(`FAILURE: Missing metadata key: ${key}`);
                missing = true;
            }
        }

        if (custom.popularity_score === '1.0' && custom.impressions === '0') {
            console.log('SUCCESS: Core metrics (popularity_score, impressions) are correct.');
        } else {
            console.error(`FAILURE: Metadata values incorrect. popularity_score=${custom.popularity_score}, impressions=${custom.impressions}`);
            missing = true;
        }

        if (!missing) {
            console.log('=== TEST PASSED: Metadata populated correctly by Cloud Function ===');
        } else {
            process.exitCode = 1;
        }

    } catch (e) {
        console.error('Error during metadata verification:', e);
        process.exitCode = 1;
    }
}

testMetadataPopulation().catch(err => {
    console.error('Fatal Test Error:', err);
    process.exit(1);
});
