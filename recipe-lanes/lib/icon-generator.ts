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

import { getAIService } from './ai-service';
import { getDataService } from './data-service';
import { processIcon } from './image-processing';
import { randomUUID } from 'crypto';

interface GenerateIconOptions {
    ingredientName: string;
    visualDescription?: string;
    skipStorage?: boolean; // For testing/mock
}

// This function should only be called from Cloud Functions.
export async function generateIconData(ingredientName: string) {
    // const { ingredientName, visualDescription = ingredientName, skipStorage = false } = options;
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

    // 4. Save to Storage (Upload)
    console.log(`[IconGenerator] Uploading to Storage...`);
    const dataService = getDataService();
    
    // Metadata
    const meta = {
        lcb: 0, 
        impressions: 0,
        rejections: 0,
        textModel: 'unknown',
        imageModel: 'imagen-3.0', // lies
        geometry: metadata 
    };

    const uploadResult = await dataService.uploadIcon(ingredientName, processedBuffer, 'image/png', meta);

    // Construct the full Icon object ready for publishing
    const iconData = {
        id: uploadResult.iconId,
        path: uploadResult.path,
        url: uploadResult.url,
        score: meta.lcb,
        impressions: meta.impressions,
        rejections: meta.rejections,
        visualDescription: ingredientName,
        fullPrompt: prompt,
        textModel: meta.textModel,
        imageModel: meta.imageModel,
        metadata: meta.geometry,
        created_at: new Date().toISOString()
    };

    return { 
        iconData
    };
}

export async function generateAndStoreIcon(ingredientName: string) {
    const { iconData } = await generateIconData(ingredientName);
    
    // Find or Create Ingredient Group
    const dataService = getDataService();
    let ingredientDocId;
    const match = await dataService.getIngredientByName(ingredientName);
    
    if (match) {
        ingredientDocId = match.id;
    } else {
        ingredientDocId = await dataService.createIngredient(ingredientName);
    }

    console.log(`[IconGenerator] Publishing to Firestore...`);
    const result = await dataService.publishIcon(ingredientDocId, ingredientName, iconData);

    console.log(`[IconGenerator] ✅ Success. Icon ID: ${result.iconId}`);
    return {
        ...result,
        prompt: iconData.fullPrompt,
        lcb: iconData.score
    };
}