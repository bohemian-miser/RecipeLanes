import { z } from 'zod';
import { ai, textModel, imageModelName } from './genkit';

// Input/Output Schemas
const IconInput = z.object({
  ingredient: z.string(),
});

const IconOutput = z.object({
  url: z.string(),
  visualDescription: z.string(),
  imagePrompt: z.string(),
  fullImagePrompt: z.string(),
});

export const generateIconFlow = ai.defineFlow(
  {
    name: 'generateIconFlow',
    inputSchema: IconInput,
    outputSchema: IconOutput,
  },
  async (input) => {
    const { ingredient } = input;
    console.log(`[Flow] Starting generation for: ${ingredient}`);

    // Step 1: Use Ingredient as Visual Description directly (Skipping Text Model)
    const visualDescription = ingredient;
    console.log(`[Flow] Visual Description: ${visualDescription}`);

    // Step 2: Generate Image (Imagen)
    const fullImagePrompt = `Generate a high-quality 64x64 pixel art icon of: ${visualDescription}. 
    The style should be distinct, colorful, and clearly recognizable, suitable for a game inventory or flowchart. 
    Use clean outlines and bright colors. Ensure the background is transparent.`;
    
    const imageResponse = await ai.generate({
      model: imageModelName,
      prompt: fullImagePrompt,
      output: { format: 'media' } // Request media output
    });

    // Extract Media URL
    const media = imageResponse.media;
    if (!media || !media.url) {
      throw new Error('No image generated');
    }

    return {
      url: media.url,
      visualDescription,
      imagePrompt: visualDescription,
      fullImagePrompt,
    };
  }
);
