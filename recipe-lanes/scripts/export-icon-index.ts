import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Usage: npx tsx scripts/export-icon-index.ts [--staging | --prod] [--output <path>]
//
// Exports the MiniLM (384d) embeddings from Firestore icon_index into the JSON file
// bundled into the Node CF. Run this before deploying the CF to refresh the index.

async function run() {
    const args = process.argv.slice(2);
    const envArg = args.includes('--prod') ? 'prod' : 'staging';

    const outputPath = (() => {
        const i = args.indexOf('--output');
        if (i !== -1 && args[i + 1]) return args[i + 1];
        return path.resolve(__dirname, '../functions/src/vector-search/data/icon_index.json');
    })();

    const envFile = envArg === 'prod' ? '.env.prod' : '.env.staging';
    dotenv.config({ path: path.resolve(__dirname, `../${envFile}`) });

    const serviceAccountPath = path.resolve(__dirname, `../${envArg}-service-account.json`);
    if (!fs.existsSync(serviceAccountPath)) {
        console.error(`Service account file not found at ${serviceAccountPath}`);
        process.exit(1);
    }

    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.cert(require(serviceAccountPath)) });
    }

    const db = admin.firestore();

    console.log(`Fetching icon_index from ${envArg}...`);
    const snap = await db.collection('icon_index').get();
    console.log(`Found ${snap.size} docs.`);

    const records: { id: string; embedding: number[] }[] = [];
    let missing = 0;

    for (const doc of snap.docs) {
        const data = doc.data();
        const raw = data.embedding_minilm;
        if (!raw) {
            missing++;
            continue;
        }
        const arr: number[] = typeof raw.toArray === 'function' ? raw.toArray() : raw;
        if (!Array.isArray(arr) || arr.length !== 384) {
            console.warn(`Skipping ${doc.id}: embedding_minilm has unexpected length ${arr?.length}`);
            missing++;
            continue;
        }
        records.push({ id: doc.id, embedding: arr });
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(records));

    console.log(`Exported ${records.length} icons (${missing} skipped — no embedding_minilm).`);
    console.log(`Written to: ${outputPath}`);

    if (missing > 0) {
        console.warn(`Run scripts/backfill-embeddings.ts --${envArg} to generate missing MiniLM embeddings.`);
    }
}

run().catch(console.error);
