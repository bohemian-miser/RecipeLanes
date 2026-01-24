import { getAIService } from '../../lib/ai-service';
import { getDataService } from '../../lib/data-service';
import { processIcon } from './image-processing';
import { randomUUID } from 'crypto';

interface GenerateIconOptions {
    ingredientName: string;
    visualDescription?: string;
    skipStorage?: boolean; // For testing/mock
}

// This functipno should only be called from Cloud Functions.
export async function generateAndStoreIcon(options: GenerateIconOptions) {
    const { ingredientName, visualDescription = ingredientName, skipStorage = false } = options;
    console.log(`[IconGenerator] 🟢 Generating icon for: "${ingredientName}"`);

    // 1. Generate Image (AI)
    const prompt = `For use in a recipe card infographic, generate a high-quality 64x64 pixel art icon of "${ingredientName}".
    The style should be distinct, colorful, and clearly recognizable, suitable for a game inventory or flowchart.
    Use clean outlines and bright colors.
    Ensure the background is white.`;
    
    console.log(`[IconGenerator] 🎨 Prompting AI: "${prompt.substring(0, 50)}..."`);
    const aiService = getAIService();
    const downloadURL = await aiService.generateImage(prompt);

    if (!downloadURL) {
        throw new Error('No media URL returned from image generation');
    }

    // 2. Download Image
    console.log(`[IconGenerator] Downloading from: ${downloadURL.substring(0, 30)}...`);
    const response = await fetch(downloadURL);
    if (!response.ok) throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
    const arrayBuffer = await response.arrayBuffer();

    // 3. Process Image (Transparency)
    let processedBuffer: Buffer;
    let metadata: any; 

    try {
        console.log(`[IconGenerator] Processing image (background removal)...`);
        const result = await processIcon(arrayBuffer);
        processedBuffer = result.buffer;
        metadata = result.metadata;
    } catch (e) {
        console.warn('[IconGenerator] ⚠️ Background removal failed, using original:', e);
        processedBuffer = Buffer.from(arrayBuffer);
    }

    // 4. Save to Storage & DB
    console.log(`[IconGenerator] Saving to DataService...`);
    
    // Find or Create Ingredient Group
    const dataService = getDataService();
    let ingredientDocId;
    const match = await dataService.getIngredientByName(ingredientName);
    
    if (match) {
        ingredientDocId = match.id;
    } else {
        ingredientDocId = await dataService.createIngredient(ingredientName);
    }

    // Metadata
    const meta = {
        lcb: 0, // Initial score (wilson score for 1 impression, 0 rejections is >0 but we use helper usually)
        impressions: 0,
        rejections: 0,
        textModel: 'unknown',
        imageModel: 'imagen-3.0',
        geometry: metadata // Save geometric metadata (center, bbox)
    };

    // Save
    const result = await dataService.saveIcon(
        ingredientDocId,
        ingredientName,
        visualDescription,
        prompt,
        downloadURL, // Original URL (or we could use a new one if we upload processed)
        processedBuffer,
        meta
    );

    console.log(`[IconGenerator] ✅ Success. Icon ID: ${result.iconId}`);
    return {
        ...result,
        prompt,
        lcb: meta.lcb
    };
}
