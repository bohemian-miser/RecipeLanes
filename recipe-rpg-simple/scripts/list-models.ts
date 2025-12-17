import { genkit } from 'genkit';
import { vertexAI } from '@genkit-ai/google-genai';

const ai = genkit({
  plugins: [vertexAI({ location: 'us-central1' })],
});

// Access the internal registry if possible, or just log known models if the plugin exposes them.
// Genkit v1 might not expose a simple listModels().
// But I can try to console.log the plugin or check if there is a helper.

// Actually, I can try to import the model references from the plugin package.
// But listing them is better.

async function list() {
  console.log("Checking Genkit Vertex AI models...");
  // This is a hacky way to see what's registered if there isn't a public API.
  // But let's try to just output the import if possible.
}

list();
