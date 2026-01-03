import { Jimp } from 'jimp';

export async function processIcon(imageBuffer: ArrayBuffer): Promise<Buffer> {
    const image = await Jimp.read(Buffer.from(imageBuffer));
    const width = image.bitmap.width;
    const height = image.bitmap.height;

    // 1. Identify Background Color
    const corners = [
        image.getPixelColor(0, 0),
        image.getPixelColor(width - 1, 0),
        image.getPixelColor(0, height - 1),
        image.getPixelColor(width - 1, height - 1)
    ];
    
    const counts: Record<number, number> = {};
    let maxCount = 0;
    let bgColor = corners[0];
    
    for (const c of corners) {
        counts[c] = (counts[c] || 0) + 1;
        if (counts[c] > maxCount) {
            maxCount = counts[c];
            bgColor = c;
        }
    }
    
    const intToRGBA = (i: number) => {
        return {
            r: (i >>> 24) & 0xff,
            g: (i >>> 16) & 0xff,
            b: (i >>> 8) & 0xff,
            a: i & 0xff
        };
    };
    
    const bgRgba = intToRGBA(bgColor);

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
    const queue: {x: number, y: number}[] = [];
    const floodVisited = new Set<string>();
    
    for (let x = 0; x < width; x++) {
        queue.push({x, y: 0});
        queue.push({x, y: height - 1});
    }
    for (let y = 0; y < height; y++) {
        queue.push({x: 0, y});
        queue.push({x: width - 1, y});
    }

    while (queue.length > 0) {
        const {x, y} = queue.pop()!;
        const key = `${x},${y}`;
        if (floodVisited.has(key)) continue;
        floodVisited.add(key);

        if (x < 0 || x >= width || y < 0 || y >= height) continue;

        const color = intToRGBA(image.getPixelColor(x, y));
        if (colorDist(color, bgRgba) <= THRESHOLD) {
            image.setPixelColor(0x00000000, x, y); // Set transparent
            
            queue.push({x: x+1, y});
            queue.push({x: x-1, y});
            queue.push({x, y: y+1});
            queue.push({x, y: y-1});
        }
    }

    // 3. Blob Analysis
    const blobs: { pixels: {x: number, y: number}[], size: number }[] = [];
    const blobVisited = new Set<string>();

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (image.getPixelColor(x, y) !== 0x00000000 && !blobVisited.has(`${x},${y}`)) {
                const blobPixels: {x: number, y: number}[] = [];
                const bQueue = [{x, y}];
                
                while (bQueue.length > 0) {
                    const p = bQueue.pop()!;
                    const k = `${p.x},${p.y}`;
                    if (blobVisited.has(k)) continue;
                    blobVisited.add(k);
                    
                    if (p.x < 0 || p.x >= width || p.y < 0 || p.y >= height) continue;
                    if (image.getPixelColor(p.x, p.y) === 0x00000000) continue;

                    blobPixels.push(p);
                    bQueue.push({x: p.x+1, y: p.y});
                    bQueue.push({x: p.x-1, y: p.y});
                    bQueue.push({x: p.x, y: p.y+1});
                    bQueue.push({x: p.x, y: p.y-1});
                }
                blobs.push({ pixels: blobPixels, size: blobPixels.length });
            }
        }
    }

    // Filter Blobs
    if (blobs.length > 0) {
        blobs.sort((a, b) => b.size - a.size);
        const largest = blobs[0];
        
        for (let i = 1; i < blobs.length; i++) {
            if (blobs[i].size < largest.size * 0.10) {
                 blobs[i].pixels.forEach(p => image.setPixelColor(0x00000000, p.x, p.y));
            }
        }
    }

    // @ts-ignore
    if (image.getBufferAsync) {
         // @ts-ignore
         return image.getBufferAsync('image/png');
    }
    // @ts-ignore
    return image.getBuffer('image/png');
}