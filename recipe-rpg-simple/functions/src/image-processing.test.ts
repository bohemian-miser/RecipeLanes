
import { processIcon } from './image-processing';
import { PNG } from 'pngjs';
import assert from 'assert';

async function testBackgroundRemoval() {
    console.log('Test: Background Removal');
    
    const width = 64;
    const height = 64;
    const png = new PNG({ width, height });

    // Fill with white (Background)
    for (let i = 0; i < width * height; i++) {
        const idx = i << 2;
        png.data[idx] = 255;
        png.data[idx + 1] = 255;
        png.data[idx + 2] = 255;
        png.data[idx + 3] = 255;
    }

    // Draw red square (Content) in center
    for (let y = 20; y < 44; y++) {
        for (let x = 20; x < 44; x++) {
            const idx = (y * width + x) << 2;
            png.data[idx] = 255;
            png.data[idx + 1] = 0;
            png.data[idx + 2] = 0;
            png.data[idx + 3] = 255;
        }
    }

    const inputBuffer = PNG.sync.write(png);
    
    console.log('Processing...');
    const start = Date.now();
    const outputBuffer = await processIcon(inputBuffer);
    console.log(`Processed in ${Date.now() - start}ms`);

    const outputPng = PNG.sync.read(outputBuffer);

    // Verify Corner (Should be transparent)
    const cornerIdx = 0;
    const cornerAlpha = outputPng.data[cornerIdx + 3];
    assert.strictEqual(cornerAlpha, 0, 'Corner should be transparent');

    // Verify Center (Should be opaque red)
    const centerIdx = (32 * width + 32) << 2;
    const centerAlpha = outputPng.data[centerIdx + 3];
    assert.strictEqual(centerAlpha, 255, 'Center should be opaque');
    
    const centerRed = outputPng.data[centerIdx];
    assert.strictEqual(centerRed, 255, 'Center should be red');

    console.log('✅ Background Removal Test Passed');
}

testBackgroundRemoval().catch(err => {
    console.error('❌ Test Failed:', err);
    process.exit(1);
});
