import { genkit, z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';

if (!process.env.GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY is not set in environment variables');
}

export const ai = genkit({
  plugins: [googleAI()],
});

// Models defined as strings to avoid import issues
export const imageModelName = 'googleai/imagen-4.0-generate-001';  //imagen-3.0-generate-002 doesn't work
export const embeddingModel = 'googleai/text-embedding-004';
export const textModel = 'googleai/gemini-2.5-flash';