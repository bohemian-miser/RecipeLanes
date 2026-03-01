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

// import { getAIService } from './ai-service';

// export async function generateIconFlow(input: { ingredient: string }) {
//   const { ingredient } = input;
//   console.log(`[generateIconFlow] 🟢 Starting flow for: "${ingredient}"`);
  
//   const aiService = getAIService();
  
//   // We use the input directly as the visual description (provided by structured parser)
//   const visualDescription = ingredient;

//   // 2. Generate Image (Image Model)
//   const imagePrompt = `Generate a high-quality 64x64 pixel art icon of ${ingredient}. The style should be distinct, colorful, and clearly recognizable, suitable for a game inventory or flowchart. Use clean outlines and bright colors. Ensure the background is white.`;
  
//   console.log(`[generateIconFlow] 🎨 Prompting AI Service: "${imagePrompt.substring(0, 50)}..."`);
  
//   // getAIService().generateImage handles the model call and returns the URL directly
//   const downloadURL = await aiService.generateImage(imagePrompt);

//   if (!downloadURL) {
//       console.error(`[generateIconFlow] 🔴 No download URL returned from AI Service for: "${ingredient}"`);
//       throw new Error('No media URL returned from image generation');
//   }
  
//   console.log(`[generateIconFlow] ✅ Success. URL: ${downloadURL.substring(0, 50)}...`);

//   return {
//       url: downloadURL,
//       ingredient,
//       imagePrompt,
//       fullImagePrompt: imagePrompt
//   };
// }