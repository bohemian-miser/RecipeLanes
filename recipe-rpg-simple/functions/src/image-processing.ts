
import { PNG } from 'pngjs';

export async function processIcon(imageBuffer: ArrayBuffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const png = new PNG({
            filterType: -1
        });

        png.parse(Buffer.from(imageBuffer), (error: Error, data: PNG) => {
            if (error) {
                return reject(error);
            }

            const width = data.width;
            const height = data.height;
            const buffer = data.data; // The raw pixel data

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

            // Pack
            const outBuffer = PNG.sync.write(data);
            resolve(outBuffer);
        });
    });
}
