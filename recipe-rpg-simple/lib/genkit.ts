import { genkit } from 'genkit';
import { vertexAI } from '@genkit-ai/google-genai';
import { enableFirebaseTelemetry } from '@genkit-ai/firebase';
import { logger } from 'genkit/logging';

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

// Enable debug logging for visibility
logger.setLogLevel('debug');

try {
    enableFirebaseTelemetry();
} catch (e) {
    console.warn("Failed to enable Firebase Telemetry:", e);
}
// Models defined as strings to avoid import issues
// Using Vertex AI models which use ADC (no API Key required in Prod)
export const imageModelName = 'vertexai/imagen-4.0-generate-001'; 
export const embeddingModel = 'vertexai/text-embedding-004';
export const textModel = 'vertexai/gemini-2.5-flash';

export const ai = genkit({
  plugins: [
    vertexAI({ 
      location: 'us-central1',
      projectId: projectId 
    })
  ],
});