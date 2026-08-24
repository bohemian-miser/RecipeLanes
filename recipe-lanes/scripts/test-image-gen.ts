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

// Smoke-test image generation against REAL Vertex AI — the one thing no test
// tier can cover (everything else runs MOCK_AI). Use it to validate a model id
// before changing lib/genkit.ts, and to diagnose "model was not found" 404s
// like the 2026-08-17 imagen-4.0 shutdown.
//
// Usage (needs GCP creds, e.g. `gcloud auth application-default login` or a
// service account via GOOGLE_APPLICATION_CREDENTIALS; project comes from
// .env.staging like the other scripts):
//
//   npx tsx scripts/test-image-gen.ts                     # current configured model
//   npx tsx scripts/test-image-gen.ts gemini-2.5-flash-image
//   npx tsx scripts/test-image-gen.ts vertexai/gemini-3.1-flash-image
//
// Prints PASS with the returned media size, or the raw provider error.

import * as dotenv from 'dotenv';
import * as path from 'path';
import { ai, imageModelName } from '../lib/genkit';

dotenv.config({ path: path.resolve(__dirname, '../.env.staging') });

async function main() {
    const arg = process.argv[2];
    const model = arg ? (arg.includes('/') ? arg : `vertexai/${arg}`) : imageModelName;
    const prompt = 'A cute pixel art icon of a carrot, 64x64, white background';

    console.log(`Model:  ${model}`);
    console.log(`Prompt: "${prompt}"`);

    const started = Date.now();
    try {
        const response = await ai.generate({ model, prompt });
        const url = response.media?.url;
        if (!url) {
            console.error('FAIL: response contained no media. Raw text:', response.text?.slice(0, 200));
            process.exit(1);
        }
        const bytes = url.startsWith('data:')
            ? Math.round((url.length - url.indexOf(',') - 1) * 3 / 4)
            : NaN;
        console.log(`PASS in ${Date.now() - started}ms — media returned` +
            (Number.isFinite(bytes) ? ` (~${Math.round(bytes / 1024)} KB inline)` : ` (${url.slice(0, 60)}…)`));
    } catch (e) {
        console.error(`FAIL in ${Date.now() - started}ms:`);
        console.error(e);
        process.exit(1);
    }
}

main();
