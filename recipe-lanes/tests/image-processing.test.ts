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

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { processIcon } from '../functions/src/image-processing';
import { PNG } from 'pngjs';

describe('Image Processing', () => {
    it('should calculate centroid correctly for a square blob', async () => {
        const png = new PNG({ width: 10, height: 10 });
        png.data.fill(0);

        const drawPixel = (x: number, y: number) => {
            const idx = (y * 10 + x) << 2;
            png.data[idx] = 255;     // R
            png.data[idx + 1] = 0;   // G
            png.data[idx + 2] = 0;   // B
            png.data[idx + 3] = 255; // A (Opaque)
        };

        drawPixel(2, 2); drawPixel(3, 2); drawPixel(2, 3); drawPixel(3, 3);
        const result = await processIcon(PNG.sync.write(png));
        const meta = result.metadata;
        
        assert.ok(Math.abs(meta.center.x - 0.25) < 0.01);
        assert.ok(Math.abs(meta.center.y - 0.25) < 0.01);
    });

    it('should calculate centroid correctly for a rectangular blob', async () => {
        const png = new PNG({ width: 10, height: 10 });
        png.data.fill(0);
        
        const drawPixel = (x: number, y: number) => {
            const idx = (y * 10 + x) << 2;
            png.data[idx] = 255; png.data[idx+1] = 0; png.data[idx+2] = 0; png.data[idx+3] = 255;
        };
        
        drawPixel(2, 2); drawPixel(3, 2);
        const result = await processIcon(PNG.sync.write(png));
        const meta = result.metadata;

        assert.ok(Math.abs(meta.center.x - 0.25) < 0.01);
        assert.ok(Math.abs(meta.center.y - 0.50) < 0.01);
    });
});
