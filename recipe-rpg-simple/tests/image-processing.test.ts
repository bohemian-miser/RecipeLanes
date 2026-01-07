import { processIcon } from '../lib/image-processing';
import { PNG } from 'pngjs';

async function testCentroidCalculation() {
    console.log('\n=== Testing Centroid Calculation ===');

    // Create a 10x10 image
    const png = new PNG({ width: 10, height: 10 });
    // Fill with transparent (0)
    png.data.fill(0);

    // Draw a 2x2 square at (2,2)
    // Pixels: (2,2), (3,2), (2,3), (3,3)
    // Original Centroid: (2.5, 2.5)
    // BBox: x=2, y=2, w=2, h=2
    // Square Size: 2
    // OffsetX: (2-2)/2 = 0
    // OffsetY: 2-2 = 0
    
    // Pixel indices (idx is start of RGBA quad)
    const drawPixel = (x: number, y: number) => {
        const idx = (y * 10 + x) << 2;
        png.data[idx] = 255;     // R
        png.data[idx+1] = 0;     // G
        png.data[idx+2] = 0;     // B
        png.data[idx+3] = 255;   // A (Opaque)
    };

    drawPixel(2, 2);
    drawPixel(3, 2);
    drawPixel(2, 3);
    drawPixel(3, 3);

    const buffer = PNG.sync.write(png);
    
    // Process
    const result = await processIcon(buffer);
    const meta = result.metadata;
    
    console.log('Metadata:', JSON.stringify(meta, null, 2));

    // Centroid relative to new square (2x2)
    // Original X centroid of blob = 2.5
    // Original Y centroid of blob = 2.5
    // minX=2, minY=2
    // offsetX=0, offsetY=0
    // NewX = (2.5 - 2) + 0 = 0.5
    // NewY = (2.5 - 2) + 0 = 0.5
    // Normalized X = 0.5 / 2 = 0.25
    // Normalized Y = 0.5 / 2 = 0.25
    
    const expectedX = 0.25;
    const expectedY = 0.25;
    
    if (Math.abs(meta.center.x - expectedX) < 0.01 && Math.abs(meta.center.y - expectedY) < 0.01) {
        console.log('SUCCESS: Centroid calculation correct (Square Blob).');
    } else {
        console.error(`FAILURE: Expected (${expectedX}, ${expectedY}), got (${meta.center.x}, ${meta.center.y})`);
        process.exitCode = 1;
    }

    // Test Case 2: Rectangular Blob 2x1 at (2,2)
    // Pixels: (2,2), (3,2)
    // Original Centroid: (2.5, 2.0)
    // BBox: x=2, y=2, w=2, h=1
    // Square Size: 2 (max dimension)
    // OffsetX: (2-2)/2 = 0
    // OffsetY: 2-1 = 1 (Bottom aligned)
    // NewX = (2.5 - 2) + 0 = 0.5
    // NewY = (2.0 - 2) + 1 = 1.0
    // Normalized X = 0.5 / 2 = 0.25
    // Normalized Y = 1.0 / 2 = 0.50

    const png2 = new PNG({ width: 10, height: 10 });
    png2.data.fill(0);
    
    const drawPixel2 = (x: number, y: number) => {
        const idx = (y * 10 + x) << 2;
        png2.data[idx] = 255; png2.data[idx+1] = 0; png2.data[idx+2] = 0; png2.data[idx+3] = 255;
    };
    
    drawPixel2(2, 2);
    drawPixel2(3, 2);
    
    const result2 = await processIcon(PNG.sync.write(png2));
    const meta2 = result2.metadata;
    console.log('Metadata 2:', JSON.stringify(meta2, null, 2));
    
    const ex2X = 0.25;
    const ex2Y = 0.50;

    if (Math.abs(meta2.center.x - ex2X) < 0.01 && Math.abs(meta2.center.y - ex2Y) < 0.01) {
        console.log('SUCCESS: Centroid calculation correct (Rect Blob).');
    } else {
        console.error(`FAILURE: Expected (${ex2X}, ${ex2Y}), got (${meta2.center.x}, ${meta2.center.y})`);
        process.exitCode = 1;
    }
}

testCentroidCalculation();
