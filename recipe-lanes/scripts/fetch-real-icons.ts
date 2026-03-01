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

import 'dotenv/config';
import { ai, imageModelName } from '@/lib/genkit';
import * as fs from 'fs';
import * as path from 'path';

async function fetchIcon(ingredient: string) {
    console.log(`Generating icon for ${ingredient}...`);
    const prompt = `Generate a high-quality 64x64 pixel art icon of ${ingredient}. The style should be distinct, colorful, and clearly recognizable, suitable for a game inventory or flowchart. Use clean outlines and bright colors. Ensure the background is white.`;
    
    try {
        const response = await ai.generate({
            model: imageModelName,
            prompt,
            output: { format: 'media' },
        });

        if (!response.media || !response.media.url) {
            throw new Error('No media returned');
        }

        console.log(`Downloading ${response.media.url}...`);
        const res = await fetch(response.media.url);
        const buffer = await res.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        const dataUri = `data:image/png;base64,${base64}`;
        return dataUri;
    } catch (e) {
        console.error(`Failed to generate ${ingredient}:`, e);
        // Fallback to a red dot if AI fails (e.g. quota/perms) so script finishes
        return `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==`;
    }
}

async function main() {
    const icons = {
        egg: await fetchIcon('Egg'),
        flour: await fetchIcon('Flour')
    };

    const outPath = path.join(process.cwd(), 'e2e', 'fixtures', 'icons.json');
    fs.writeFileSync(outPath, JSON.stringify(icons, null, 2));
    console.log(`Saved icons to ${outPath}`);
}

main();