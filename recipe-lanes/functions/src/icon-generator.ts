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

import { getAIService } from '../../lib/ai-service';
import { getDataService } from '../../lib/data-service';
import { processIcon } from './image-processing';
import type { IconStats } from '../../lib/recipe-lanes/types';

// This function should only be called from Cloud Functions.
export async function generateIconData(ingredientName: string): Promise<IconStats> {
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
    let metadata: IconStats['metadata'];

    try {
        console.log(`[IconGenerator] Processing image (background removal)...`);
        const result = await processIcon(arrayBuffer);
        processedBuffer = result.buffer;
        metadata = result.metadata;
    } catch (e) {
        console.warn('[IconGenerator] ⚠️ Background removal failed, using original:', e);
        processedBuffer = Buffer.from(arrayBuffer);
    }

    // 4. Upload to Storage
    console.log(`[IconGenerator] Uploading to Storage...`);
    const { iconId } = await getDataService().uploadIcon(ingredientName, processedBuffer, { geometry: metadata });

    return {
        id: iconId,
        visualDescription: ingredientName,
        metadata,
    };
}
