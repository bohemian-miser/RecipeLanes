import { genkit, z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';

// Models defined as strings to avoid import issues
export const imageModelName = 'googleai/imagen-4.0-generate-001'; 
export const embeddingModel = 'googleai/text-embedding-004';
export const textModel = 'googleai/gemini-2.5-flash';

const plugins = [googleAI()];

// Mocking Logic:
// Only mock if API Key is missing AND we are NOT in production.
// This allows Production to attempt using Application Default Credentials (ADC) if Key is missing.
const shouldMock = !process.env.GEMINI_API_KEY && (!!process.env.CI || process.env.NODE_ENV !== 'production');

if (shouldMock) {
  console.warn('GEMINI_API_KEY is not set. Using MOCK models (CI/Dev mode).');
}

export const ai = genkit({
  plugins,
});

// Register mocks if needed
if (shouldMock) {
  ai.defineModel({ name: textModel } as any, async (req) => {
    return { 
      candidates: [{
        index: 0,
        message: { role: 'model', content: [{ text: "Mock visual description for test" }] },
        finishReason: 'stop'
      }]
    } as any;
  });

  ai.defineModel({ name: imageModelName } as any, async (req) => {
    return {
      candidates: [{
        index: 0,
        message: { 
          role: 'model', 
          content: [{ media: { url: `https://placehold.co/64x64/png?text=Mock` } }] 
        },
        finishReason: 'stop'
      }]
    } as any;
  });
}