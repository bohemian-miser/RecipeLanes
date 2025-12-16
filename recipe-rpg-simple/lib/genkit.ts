import { genkit, z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';

// Models defined as strings to avoid import issues
export const imageModelName = 'googleai/imagen-4.0-generate-001'; 
export const embeddingModel = 'googleai/text-embedding-004';
export const textModel = 'googleai/gemini-2.5-flash';

// Always initialize with Google AI plugin.
// If API Key is missing in Prod, this might throw or fail at runtime, which is expected (we want to know).
// In Dev/Test, we should use the MockAIService via dependency injection, avoiding this instance entirely.
export const ai = genkit({
  plugins: [googleAI()],
});