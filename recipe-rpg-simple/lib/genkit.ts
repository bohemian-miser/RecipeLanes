import { genkit } from 'genkit';
import { vertexAI } from '@genkit-ai/vertexai';

// Models defined as strings to avoid import issues
// Using Vertex AI models which use ADC (no API Key required in Prod)
export const imageModelName = 'vertexai/imagen-3.0-generate-001'; 
export const embeddingModel = 'vertexai/text-embedding-004';
export const textModel = 'vertexai/gemini-2.5-flash';

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'ropgcp';

export const ai = genkit({
  plugins: [
    vertexAI({ 
      location: 'us-central1',
      projectId: projectId 
    })
  ],
});