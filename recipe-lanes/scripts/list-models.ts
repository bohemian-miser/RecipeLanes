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