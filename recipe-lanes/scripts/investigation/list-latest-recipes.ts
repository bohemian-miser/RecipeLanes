
import 'dotenv/config';
import dotenv from 'dotenv';
import { db } from '../lib/firebase-admin';

const DB_COLLECTION_RECIPES = 'recipes';

async function listLatestRecipes() {
    const args = process.argv.slice(2);
    const stagingIndex = args.indexOf('--staging');
    const isStaging = stagingIndex !== -1;
    
    if (isStaging) {
        console.log('✨ Switching to STAGING environment (.env.staging)...');
        dotenv.config({ path: '.env.staging', override: true });
        args.splice(stagingIndex, 1);
    }

    const authorFilter = args.find(a => a.startsWith('--author='))?.split('=')[1];
    const excludeAuthorFilter = args.find(a => a.startsWith('--exclude-author='))?.split('=')[1];

    // Default to 10 recipes if not specified
    const limitArg = args.find(a => !a.startsWith('--')) ;
    const limit = limitArg ? parseInt(limitArg) : 1000;
    const baseUrl = isStaging ? 'https://recipe-lanes-staging.web.app' : 'https://recipelanes.com';

    console.log(`Fetching latest recipes from ${DB_COLLECTION_RECIPES}...`);
    if (authorFilter) console.log(`🔍 Filtering for author: ${authorFilter}`);
    if (excludeAuthorFilter) console.log(`🚫 Excluding author: ${excludeAuthorFilter}`);
    console.log('------------------------------------------------------------');

    try {
        // Fetch a larger batch if we're filtering in memory, otherwise just the limit
        const fetchLimit = (authorFilter || excludeAuthorFilter) ? 100 : limit;
        
        let query: any = db.collection(DB_COLLECTION_RECIPES).orderBy('created_at', 'desc');
        
        // If it's a simple inclusive filter, we can do it in Firestore (requires index but likely exists for ownerName/ownerId)
        // However, to keep it robust across ID/Name, we'll filter in memory from a decent sized batch.
        
        const snapshot = await query.limit(fetchLimit).get();
        
        if (snapshot.empty) {
            console.log('No recipes found.');
            return;
        }

        let docs = snapshot.docs;

        // In-memory filtering
        if (authorFilter) {
            docs = docs.filter(doc => {
                const data = doc.data();
                return data.ownerName === authorFilter || data.ownerId === authorFilter;
            });
        }
        if (excludeAuthorFilter) {
            docs = docs.filter(doc => {
                const data = doc.data();
                return data.ownerName !== excludeAuthorFilter && data.ownerId !== excludeAuthorFilter;
            });
        }

        // Apply final limit
        docs = docs.slice(0, limit);

        const tableData = docs.map(doc => {
            const data = doc.data();
            return {
                Date: data.created_at?.toDate()?.toLocaleDateString() || 'Unknown',
                Time: data.created_at?.toDate()?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) || '',
                Author: (data.ownerName || data.ownerId || 'Anon').substring(0, 15),
                Title: (data.title || 'Untitled').substring(0, 50),
                Nodes: data.graph?.nodes?.length || 0,
                Link: `${baseUrl}/lanes?id=${doc.id}`
            };
        });

        console.table(tableData);

    } catch (e: any) {
        console.error('Failed to list recipes:', e);
    }
}

listLatestRecipes();
