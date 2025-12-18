import { ai, textModel, imageModelName } from './genkit';

export async function generateIconFlow(input: { ingredient: string }) {
  const { ingredient } = input;
  
  // 1. Enrich Prompt (Text Model)
  // We ask the text model to create a visual description.
  const textResponse = await ai.generate({
    model: textModel,
    prompt: `Describe a distinct and recognizable visual representation of '${ingredient}' for a 64x64 pixel art icon. If it is an action (e.g. 'chop onion'), describe the tools and objects interacting (e.g. 'A knife slicing a red onion'). Do not describe hands. If it is an object (e.g. 'bag of sugar'), describe it with defining features or labels to ensure it is identifiable (e.g. 'A paper sack labeled "SUGAR" with a few cubes spilling out'). Keep it concise (under 30 words). Focus on visual subject matter only.`,
  });
  const visualDescription = textResponse.text || ingredient;

  // 2. Generate Image (Image Model)
  const imagePrompt = `Generate a high-quality 64x64 pixel art icon of ${visualDescription}. The style should be distinct, colorful, and clearly recognizable, suitable for a game inventory or flowchart. Use clean outlines and bright colors. Ensure the background is transparent.`;
  
  const imageResponse = await ai.generate({
    model: imageModelName,
    prompt: imagePrompt,
    output: { format: 'media' }
  });
  
  // Handle Genkit response structure for Media
  // Different plugins might structure media differently, but standard is `media` property on response/output.
  // With @genkit-ai/google-genai (Vertex), it should return media.
  
  let downloadURL = '';
  if (imageResponse.media) {
      downloadURL = imageResponse.media.url;
  } else if (imageResponse.output && typeof imageResponse.output === 'object' && 'media' in imageResponse.output) {
      // Fallback for some versions
      downloadURL = (imageResponse.output as any).media?.url;
  }

  if (!downloadURL) {
      throw new Error('No media URL returned from image generation');
  }

  return {
      url: downloadURL,
      visualDescription,
      imagePrompt,
      fullImagePrompt: imagePrompt
  };
}