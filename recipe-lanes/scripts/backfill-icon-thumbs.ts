/**
 * Backfill 128x128 thumbnails for all icons in Firebase Storage.
 * Lists all files under the icons/ prefix, skips .thumb.png files and any icon
 * whose .thumb.png sibling already exists, then resizes + uploads the thumbnail.
 *
 * Usage:
 *   npx env-cmd -f .env.staging node --import tsx scripts/backfill-icon-thumbs.ts --staging [--dry-run]
 */
import * as admin from 'firebase-admin';
import sharp from 'sharp';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const STAGING = args.includes('--staging');

const PROJECT = STAGING ? 'recipe-lanes-staging' : 'recipe-lanes';
const BUCKET_NAME = STAGING
    ? 'recipe-lanes-staging.firebasestorage.app'
    : 'recipe-lanes.firebasestorage.app';

async function main() {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        console.error('Set GOOGLE_APPLICATION_CREDENTIALS=./service-account.json');
        process.exit(1);
    }

    admin.initializeApp({ projectId: PROJECT });
    const bucket = admin.storage().bucket(BUCKET_NAME);

    console.log(`[backfill-thumbs] project=${PROJECT}, bucket=${BUCKET_NAME}, dry_run=${DRY_RUN}`);

    // List all files under icons/ prefix
    const [allFiles] = await bucket.getFiles({ prefix: 'icons/' });
    console.log(`[backfill-thumbs] Total files in icons/: ${allFiles.length}`);

    // Build a set of existing thumb paths for fast lookup
    const existingThumbs = new Set<string>();
    const mainFiles: typeof allFiles = [];

    for (const f of allFiles) {
        if (f.name.endsWith('.thumb.png')) {
            existingThumbs.add(f.name);
        } else if (f.name.endsWith('.png')) {
            mainFiles.push(f);
        }
    }

    console.log(`[backfill-thumbs] Main .png files: ${mainFiles.length}`);
    console.log(`[backfill-thumbs] Existing .thumb.png files: ${existingThumbs.size}`);

    let alreadyHaveThumb = 0;
    let newlyCreated = 0;
    let errors = 0;
    const toProcess: typeof allFiles = [];

    for (const f of mainFiles) {
        const thumbName = f.name.replace(/\.png$/, '.thumb.png');
        if (existingThumbs.has(thumbName)) {
            alreadyHaveThumb++;
        } else {
            toProcess.push(f);
        }
    }

    console.log(`[backfill-thumbs] Already have thumb: ${alreadyHaveThumb}`);
    console.log(`[backfill-thumbs] To process: ${toProcess.length}`);

    if (DRY_RUN) {
        console.log('[backfill-thumbs] DRY RUN — first 10 files that would be processed:');
        for (const f of toProcess.slice(0, 10)) {
            console.log(`  ${f.name} -> ${f.name.replace(/\.png$/, '.thumb.png')}`);
        }
        console.log('[backfill-thumbs] DRY RUN complete — no files written.');
        process.exit(0);
    }

    for (let i = 0; i < toProcess.length; i++) {
        const f = toProcess[i];
        const thumbName = f.name.replace(/\.png$/, '.thumb.png');
        try {
            // Download original
            const [contents] = await f.download();

            // Resize to 128x128 nearest-neighbour (pixel art)
            const thumbBuffer = await sharp(contents)
                .resize(128, 128, { kernel: sharp.kernel.nearest })
                .png()
                .toBuffer();

            // Upload thumbnail
            const thumbFile = bucket.file(thumbName);
            await thumbFile.save(thumbBuffer, {
                metadata: { contentType: 'image/png' }
            });
            await thumbFile.makePublic();

            newlyCreated++;
            if ((i + 1) % 10 === 0 || i === toProcess.length - 1) {
                process.stdout.write(`\r[backfill-thumbs] ${i + 1}/${toProcess.length} done (${errors} errors)  `);
            }
        } catch (e: any) {
            console.error(`\n[backfill-thumbs] error processing ${f.name}: ${e.message}`);
            errors++;
        }
    }

    console.log(`\n[backfill-thumbs] Done. already_had_thumb=${alreadyHaveThumb}, newly_created=${newlyCreated}, errors=${errors}`);
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
