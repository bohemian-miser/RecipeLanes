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


import { PNG } from 'pngjs';
import { processIcon } from '../functions/src/image-processing';
import fs from 'fs/promises';
import path from 'path';

async function main() {
    console.log('Creating test image...');
    
    const png = new PNG({ width: 64, height: 64 });
    // Fill white
    for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
            const idx = (64 * y + x) << 2;
            png.data[idx] = 255;
            png.data[idx+1] = 255;
            png.data[idx+2] = 255;
            png.data[idx+3] = 255;
        }
    }

    // Draw red square
    for (let y = 20; y < 44; y++) {
        for (let x = 20; x < 44; x++) {
            const idx = (64 * y + x) << 2;
            png.data[idx] = 255;
            png.data[idx+1] = 0;
            png.data[idx+2] = 0;
            png.data[idx+3] = 255;
        }
    }

    const buffer = PNG.sync.write(png);
    const inputPath = path.join(process.cwd(), 'debug', 'bg-removal-input-pngjs.png');
    await fs.writeFile(inputPath, buffer);
    console.log(`Saved input to ${inputPath}`);

    console.log('Processing image (removing background)...');
    const resultBuffer = await processIcon(buffer);

    const outputPath = path.join(process.cwd(), 'debug', 'bg-removal-output-pngjs.png');
    await fs.writeFile(outputPath, resultBuffer);
    console.log(`Saved output to ${outputPath}`);
    
    // Verify
    const outPng = PNG.sync.read(resultBuffer);
    const cornerIdx = 0;
    const centerIdx = (64 * 32 + 32) << 2;
    
    const cornerAlpha = outPng.data[cornerIdx + 3];
    const centerAlpha = outPng.data[centerIdx + 3];
    
    console.log(`Corner Alpha: ${cornerAlpha} (Expected 0)`);
    console.log(`Center Alpha: ${centerAlpha} (Expected 255)`);

    if (cornerAlpha === 0 && centerAlpha === 255) {
        console.log('✅ Verification SUCCESS');
    } else {
        console.error('❌ Verification FAILED');
        process.exit(1);
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});