import { z } from 'zod';
import { ai, textModel, imageModelName } from './genkit';

// Input/Output Schemas
const IconInput = z.object({
  ingredient: z.string(),
});

const IconOutput = z.object({
  url: z.string(),
  visualDescription: z.string(),
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

    // Step 1: Generate Visual Description (Gemini)
    const textPrompt = `Describe a distinct and recognizable visual representation of '${ingredient}' for a 64x64 pixel art icon. 
    If it is an action, describe the tools/objects. 
    If it is an object, describe defining features/labels.
    Keep it concise (under 30 words). Focus on visual subject matter only.
    Return ONLY the description. Do not include "Here is a description" or similar text.`;
    
    const textResponse = await ai.generate({
      model: textModel,
      prompt: textPrompt,
    });
    
    let visualDescription = textResponse.text;
    console.log(`[Flow] Raw Gemini response: ${JSON.stringify(textResponse.toJSON())}`);
    
    if (!visualDescription || visualDescription.length < 5) {
        console.warn('[Flow] Description generation failed or empty. Falling back to ingredient name.');
        visualDescription = ingredient;
    }
    
    console.log(`[Flow] Final Description: ${visualDescription}`);

    // Step 2: Generate Image (Imagen)
    const imagePrompt = `Generate a high-quality 64x64 pixel art icon of: ${visualDescription}. 
    The style should be distinct, colorful, and clearly recognizable, suitable for a game inventory or flowchart. 
    Use clean outlines and bright colors. Ensure the background is transparent.`;
    
    const imageResponse = await ai.generate({
      model: imageModelName,
      prompt: imagePrompt,
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
    };
  }
);
