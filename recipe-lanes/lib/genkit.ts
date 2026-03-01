/*
 * Copyright (C) 2026 Bohemian Miser <https://substack.com/@bohemianmiser>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { genkit } from 'genkit';
import { vertexAI } from '@genkit-ai/google-genai';
import { enableFirebaseTelemetry } from '@genkit-ai/firebase';
import { logger } from 'genkit/logging';

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

// Enable debug logging for visibility
logger.setLogLevel('debug');

if (projectId == "recipe-lanes" || projectId == "recipe-lanes-staging"
) {
  // Enable Firebase Telemetry (if possible)
  try {
    enableFirebaseTelemetry();
  } catch (e) {
    console.warn("Failed to enable Firebase Telemetry:", e);
  }
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