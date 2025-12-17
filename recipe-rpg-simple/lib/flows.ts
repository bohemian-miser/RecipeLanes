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
    const textPrompt = `Describe a distinct and recognizable visual representation of '${ingredient}' for a 64x64 pixel art icon. If it is an action (e.g. 'chop onion'), describe the tools and objects interacting (e.g. 'A knife slicing a red onion'). Do not describe hands. If it is an object (e.g. 'bag of sugar'), describe it with defining features or labels to ensure it is identifiable (e.g. 'A paper sack labeled "SUGAR" with a few cubes spilling out'). Keep it concise (under 30 words). Focus on visual subject matter only.`;
    
    const textResponse = await ai.generate({
      model: textModel,
      prompt: textPrompt,
    });
    const visualDescription = textResponse.text || ingredient;
    console.log(`[Flow] Description: ${visualDescription}`);

    // Step 2: Generate Image (Imagen)
    const imagePrompt = `Generate a high-quality 64x64 pixel art icon of ${visualDescription}. The style should be distinct, colorful, and clearly recognizable, suitable for a game inventory or flowchart. Use clean outlines and bright colors. Ensure the background is transparent.`;
    
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
