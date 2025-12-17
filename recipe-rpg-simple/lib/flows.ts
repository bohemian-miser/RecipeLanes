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
    // Structured prompt to preserve object identity while enabling better descriptions for abstract concepts
    const textPrompt = `You are an expert pixel art prompt optimizer.
    The user's input is: '${ingredient}'.
    
    Rules:
    1. If the input is a concrete physical object (e.g., 'golf ball', 'apple', 'sword'), return it EXACTLY as is, optionally adding 1 simple adjective if needed for clarity (e.g., 'white golf ball'). DO NOT describe it as "a spherical object".
    2. If the input is an action, abstract concept, or complex scene (e.g., 'running', 'victory', 'cooking'), describe a distinct visual representation of it in under 15 words.
    3. Return ONLY the final prompt string. Do not include quotes or explanations.`;
    
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
      imagePrompt,
    };
  }
);
