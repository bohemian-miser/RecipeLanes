import { genkit } from 'genkit';
import { vertexAI } from '@genkit-ai/google-genai';
import { enableFirebaseTelemetry } from '@genkit-ai/firebase';
import { logger } from 'genkit/logging';

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'ropgcp';

// Enable debug logging for visibility
logger.setLogLevel('debug');

// Only enable telemetry if we are NOT in a test environment and we have a project ID
// This prevents "Unable to detect Project Id" log spam during CI/Tests
if (process.env.NODE_ENV !== 'test' && (process.env.GCLOUD_PROJECT || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID)) {
    enableFirebaseTelemetry();
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