import { genkit, z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';

// Models defined as strings to avoid import issues
export const imageModelName = 'googleai/imagen-4.0-generate-001'; 
export const embeddingModel = 'googleai/text-embedding-004';
export const textModel = 'googleai/gemini-2.5-flash';

const plugins = [];
if (process.env.GEMINI_API_KEY) {
  plugins.push(googleAI());
} else {
  console.warn('GEMINI_API_KEY is not set. Using MOCK models for AI generation.');
}

export const ai = genkit({
  plugins,
});

// Register mocks if no API key
if (!process.env.GEMINI_API_KEY) {
  ai.defineModel({ name: textModel }, async (req) => {
    return { 
      content: [{ text: "Mock visual description for test" }]
    };
  });

  ai.defineModel({ name: imageModelName }, async (req) => {
    return {
      content: [],
      media: {
        url: `https://placehold.co/64x64/png?text=Mock`
      }
    };
  });
}