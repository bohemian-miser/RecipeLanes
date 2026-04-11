/**
 * Audits icon_index docs against the IconStats schema and removes stale fields (url).
 *
 * Audit checks:
 *   - visualDescription: string
 *   - score: number
 *   - embedding_minilm: 384-length vector
 *   - embedding: 768-length vector
 *
 * Migration: removes the `url` field (not part of IconStats; icon path is derived from id).
 *
 * Usage:
 *   npx tsx scripts/audit-icon-index.ts [--staging]             # audit + dry-run migration
 *   npx tsx scripts/audit-icon-index.ts [--staging] --fix       # audit + live migration
 */

import dotenv from 'dotenv';
import { FieldValue } from 'firebase-admin/firestore';
import { DB_COLLECTION_ICON_INDEX } from '../lib/config';
import { scanCollection, createAuditor } from './lib/db-tools';

const staging = process.argv.includes('--staging');
const fix = process.argv.includes('--fix');

if (staging) {
    dotenv.config({ path: '.env.staging', override: true });
} else {
    dotenv.config();
}

function vectorLength(v: any): number | null {
    if (!v) return null;
    const arr = typeof v.toArray === 'function' ? v.toArray() : v;
    return Array.isArray(arr) ? arr.length : null;
}

const WRITE_BATCH = 200;

async function main() {
    const { db } = await import('../lib/firebase-admin');

    const auditor = createAuditor('icon_index IconStats', {
        'visualDescription': v => typeof v === 'string' && v.length > 0 || 'missing or empty',
        'score':             v => typeof v === 'number'                   || 'not a number',
        'embedding_minilm':  v => vectorLength(v) === 384                || `expected 384d, got ${vectorLength(v)}`,
        'embedding':         v => vectorLength(v) === 768                || `expected 768d, got ${vectorLength(v)}`,
        'url':               v => v === undefined                         || 'stale field — run --fix to remove',
    });

    const toFix: FirebaseFirestore.DocumentReference[] = [];
    let scanned = 0;

    console.log('Scanning icon_index...');
    for await (const doc of scanCollection(db, DB_COLLECTION_ICON_INDEX)) {
        auditor.check(doc.id, doc.data());
        if (doc.data().url !== undefined) toFix.push(doc.ref);
        scanned++;
        if (scanned % 100 === 0) process.stdout.write(`\r  scanned=${scanned} toFix=${toFix.length}  `);
    }
    console.log(`\r  scanned=${scanned} toFix=${toFix.length}  `);

    auditor.report();
    console.log(`\nDocs with stale url field: ${toFix.length}`);

    if (toFix.length === 0 || !fix) {
        if (!fix && toFix.length > 0) console.log('Run with --fix to apply removal.');
        return;
    }

    console.log(`Removing url field in batches of ${WRITE_BATCH}...`);
    let written = 0;
    for (let i = 0; i < toFix.length; i += WRITE_BATCH) {
        const batch = db.batch();
        for (const ref of toFix.slice(i, i + WRITE_BATCH)) {
            batch.update(ref, { url: FieldValue.delete() });
        }
        await batch.commit();
        written += Math.min(WRITE_BATCH, toFix.length - i);
        process.stdout.write(`\r  ${written}/${toFix.length} written  `);
    }
    console.log('\nDone.');
}

main().catch(e => {
    console.error('Script failed:', e);
    process.exit(1);
});
