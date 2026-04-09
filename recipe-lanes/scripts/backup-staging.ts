import dotenv from 'dotenv';
import * as admin from 'firebase-admin';
import * as fs from 'fs';

dotenv.config({ path: '.env.staging', override: true });

async function main() {
    if (!admin.apps.length) {
        admin.initializeApp();
    }
    const db = admin.firestore();

    console.log('Downloading staging ingredients_new...');
    const ingredientsSnap = await db.collection('ingredients_new').get();
    
    console.log('Downloading staging icon_index...');
    const iconIndexSnap = await db.collection('icon_index').get();

    const data = {
        ingredients_new: ingredientsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        icon_index: iconIndexSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    };

    fs.writeFileSync('staging_backup.json', JSON.stringify(data, null, 2));
    console.log(`Backup complete! Saved ${ingredientsSnap.size} ingredients and ${iconIndexSnap.size} icons to staging_backup.json`);
    
    process.exit(0);
}

main().catch(console.error);