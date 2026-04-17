
import 'dotenv/config';
import dotenv from 'dotenv';
import { db } from '../lib/firebase-admin';

const DB_COLLECTION_INGREDIENTS = 'ingredients_new';

async function listIcons() {
    const args = process.argv.slice(2);
    const stagingIndex = args.indexOf('--staging');
    const isStaging = stagingIndex !== -1;
    
    if (isStaging) {
        console.log('✨ Switching to STAGING environment (.env.staging)...');
        dotenv.config({ path: '.env.staging', override: true });
        args.splice(stagingIndex, 1);
    }

    const sortBy = args.includes('--popularity') ? 'popularity' : 'recent';
    const limit = 200; // Default limit for display

    console.log(`Fetching icons from ${DB_COLLECTION_INGREDIENTS} (Sorted by: ${sortBy})...`);
    console.log('------------------------------------------------------------');

    try {
        const snapshot = await db.collection(DB_COLLECTION_INGREDIENTS).get();
        
        if (snapshot.empty) {
            console.log('No ingredients found.');
            return;
        }

        let allIcons: any[] = [];
        snapshot.docs.forEach(doc => {
            const data = doc.data();
            const icons = data.icons || [];
            icons.forEach((icon: any) => {
                let date = new Date(0);
                if (icon.created_at) {
                    if (typeof icon.created_at === 'string') {
                        date = new Date(icon.created_at);
                    } else if (icon.created_at.toDate) {
                        date = icon.created_at.toDate();
                    } else if (icon.created_at._seconds) {
                        date = new Date(icon.created_at._seconds * 1000);
                    }
                }
                
                allIcons.push({
                    ingredient: data.name || doc.id,
                    ...icon,
                    date
                });
            });
        });

        if (sortBy === 'popularity') {
            allIcons.sort((a, b) => (b.impressions || 0) - (a.impressions || 0));
        } else {
            allIcons.sort((a, b) => b.date.getTime() - a.date.getTime());
        }

        const displayList = allIcons//#.slice(0, limit);

        displayList.forEach(icon => {
            const dateStr = icon.date.toLocaleString();
            const popularity = icon.impressions || 0;
            const rejections = icon.rejections || 0;
            const name = icon.ingredient;//.padEnd(40).substring(0, 40);
            

            console.log(`${name}`);// | Recipes: ${popularity.toString().padStart(3)} | Refused: ${rejections.toString().padStart(3)}`);
            //console.log(`[${dateStr}] ${name} | Recipes: ${popularity.toString().padStart(3)} | Refused: ${rejections.toString().padStart(3)}`);
        });

        console.log('------------------------------------------------------------');
        console.log(`Total Icons: ${allIcons.length}`);

    } catch (e: any) {
        console.error('Failed to list icons:', e);
    }
}

listIcons();
