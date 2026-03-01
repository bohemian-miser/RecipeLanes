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
import jpeg from 'jpeg-js';

export interface IconMetadata {
    center: { x: number, y: number };
    bbox: { x: number, y: number, w: number, h: number };
}

export async function processIcon(imageBuffer: ArrayBuffer | Buffer): Promise<{ buffer: Buffer; metadata: IconMetadata }> {
    const buffer = Buffer.isBuffer(imageBuffer) ? imageBuffer : Buffer.from(imageBuffer);

    // Check for JPEG (FF D8 FF)
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        try {
            const raw = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: true });
            return processRawData(raw.width, raw.height, Buffer.from(raw.data));
        } catch (e) {
            console.warn('JPEG decode failed, falling back to PNG parse attempt.', e);
        }
    }

    return new Promise((resolve, reject) => {
        const png = new PNG({
            filterType: -1
        });

        png.parse(buffer, (error: Error, data: PNG) => {
            if (error) {
                return reject(error);
            }
            try {
                const result = processRawData(data.width, data.height, data.data);
                resolve(result);
            } catch (e) {
                reject(e);
            }
        });
    });
}

function processRawData(width: number, height: number, buffer: Buffer): { buffer: Buffer; metadata: IconMetadata } {
    // Helper: Get RGBA at index
    const getPixel = (idx: number) => {
        return {
            r: buffer[idx],
            g: buffer[idx + 1],
            b: buffer[idx + 2],
            a: buffer[idx + 3]
        };
    };

    // 1. Identify Background Color from Corners
    const getIndex = (x: number, y: number) => (y * width + x) << 2;
    
    const corners = [
        getPixel(getIndex(0, 0)),
        getPixel(getIndex(width - 1, 0)),
        getPixel(getIndex(0, height - 1)),
        getPixel(getIndex(width - 1, height - 1))
    ];

    const counts: Record<string, number> = {};
    let maxCount = 0;
    let bgColor = corners[0];

    for (const c of corners) {
        const key = `${c.r},${c.g},${c.b},${c.a}`;
        counts[key] = (counts[key] || 0) + 1;
        if (counts[key] > maxCount) {
            maxCount = counts[key];
            bgColor = c;
        }
    }

    const colorDist = (c1: any, c2: any) => {
        return Math.sqrt(
            Math.pow(c1.r - c2.r, 2) +
            Math.pow(c1.g - c2.g, 2) +
            Math.pow(c1.b - c2.b, 2) +
            Math.pow(c1.a - c2.a, 2)
        );
    };

    const THRESHOLD = 30;

    // 2. Flood Fill Background
    const queue: number[] = [];
    const visited = new Uint8Array(width * height); // 0 or 1

    const add = (x: number, y: number) => {
        if (x < 0 || x >= width || y < 0 || y >= height) return;
        const i = y * width + x;
        if (visited[i]) return;
        visited[i] = 1;
        queue.push(i);
    };

    // Add borders
    for (let x = 0; x < width; x++) { add(x, 0); add(x, height - 1); }
    for (let y = 0; y < height; y++) { add(0, y); add(width - 1, y); }

    while (queue.length > 0) {
        const idx = queue.pop()!;
        const pxIdx = idx << 2;
        const pixel = getPixel(pxIdx);

        if (colorDist(pixel, bgColor) <= THRESHOLD) {
            buffer[pxIdx + 3] = 0; // Transparent
            
            const x = idx % width;
            const y = Math.floor(idx / width);
            add(x + 1, y);
            add(x - 1, y);
            add(x, y + 1);
            add(x, y - 1);
        }
    }

    // 3. Blob Analysis
    const blobVisited = new Uint8Array(width * height);
    const blobs: { size: number, indices: number[] }[] = [];

    for (let i = 0; i < width * height; i++) {
        if (buffer[(i << 2) + 3] === 0 || blobVisited[i]) continue;

        const currentIndices: number[] = [];
        const bQueue = [i];
        blobVisited[i] = 1;

        while (bQueue.length > 0) {
            const curr = bQueue.pop()!;
            currentIndices.push(curr);
            
            const x = curr % width;
            const y = Math.floor(curr / width);

            const neighbors = [
                { nx: x + 1, ny: y },
                { nx: x - 1, ny: y },
                { nx: x, ny: y + 1 },
                { nx: x, ny: y - 1 }
            ];

            for (const {nx, ny} of neighbors) {
                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                    const nIdx = ny * width + nx;
                    if (!blobVisited[nIdx] && buffer[(nIdx << 2) + 3] !== 0) {
                        blobVisited[nIdx] = 1;
                        bQueue.push(nIdx);
                    }
                }
            }
        }
        blobs.push({ size: currentIndices.length, indices: currentIndices });
    }

    // Filter Blobs
    if (blobs.length > 0) {
        blobs.sort((a, b) => b.size - a.size);
        const largest = blobs[0];
        const minSize = largest.size * 0.10;

        for (let i = 1; i < blobs.length; i++) {
            if (blobs[i].size < minSize) {
                for (const idx of blobs[i].indices) {
                    buffer[(idx << 2) + 3] = 0;
                }
            }
        }
    }

    // 4. Find bounding box of non-transparent pixels AND Centroid
    let minX = width, maxX = 0, minY = height, maxY = 0;
    let sumX = 0, sumY = 0, totalPixels = 0;
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) << 2;
            if (buffer[idx + 3] !== 0) { // Non-transparent
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
                
                sumX += x;
                sumY += y;
                totalPixels++;
            }
        }
    }
    
    // If all transparent, return empty square
    if (minX > maxX) {
        const png = new PNG({ width: 1, height: 1 });
        png.data = Buffer.alloc(4);
        return { 
            buffer: PNG.sync.write(png), 
            metadata: { 
                center: { x: 0.5, y: 0.5 }, 
                bbox: { x: 0, y: 0, w: 1, h: 1 } 
            } 
        };
    }
    
    // 5. Calculate bounding box dimensions and create square
    const boxWidth = maxX - minX + 1;
    const boxHeight = maxY - minY + 1;
    const squareSize = Math.max(boxWidth, boxHeight);
    
    // Create new square buffer (all transparent)
    const newBuffer = Buffer.alloc(squareSize * squareSize * 4);
    
    // 6. Calculate position: centered horizontally, bottom aligned
    const offsetX = Math.floor((squareSize - boxWidth) / 2);
    const offsetY = squareSize - boxHeight;
    
    // 7. Copy pixels from bounding box to new position
    for (let y = 0; y < boxHeight; y++) {
        for (let x = 0; x < boxWidth; x++) {
            const srcIdx = ((minY + y) * width + (minX + x)) << 2;
            const dstIdx = ((offsetY + y) * squareSize + (offsetX + x)) << 2;
            
            newBuffer[dstIdx] = buffer[srcIdx];
            newBuffer[dstIdx + 1] = buffer[srcIdx + 1];
            newBuffer[dstIdx + 2] = buffer[srcIdx + 2];
            newBuffer[dstIdx + 3] = buffer[srcIdx + 3];
        }
    }
    
    // 8. Calculate Metadata in New Coordinates
    const centroidX = (sumX / totalPixels);
    const centroidY = (sumY / totalPixels);
    
    const newCentroidX = (centroidX - minX) + offsetX;
    const newCentroidY = (centroidY - minY) + offsetY;
    
    // Normalize coordinates (0-1) for resolution independence
    const metadata: IconMetadata = {
        center: {
            x: newCentroidX / squareSize,
            y: newCentroidY / squareSize
        },
        bbox: {
            x: offsetX / squareSize,
            y: offsetY / squareSize,
            w: boxWidth / squareSize,
            h: boxHeight / squareSize
        }
    };
    
    // Pack
    const png = new PNG({ width: squareSize, height: squareSize });
    png.data = newBuffer;
    return { buffer: PNG.sync.write(png), metadata };
}