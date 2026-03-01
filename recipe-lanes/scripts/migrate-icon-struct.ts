import dotenv from 'dotenv';
import { FieldValue } from 'firebase-admin/firestore';
import { standardizeIngredientName, removeUndefined } from '../lib/utils';

async function migrateIconStruct() {
    const args = process.argv.slice(2);
    const stagingIndex = args.indexOf('--staging');
    
    if (stagingIndex !== -1) {
        console.log('✨ Switching to STAGING environment (.env.staging)...');
        if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
        }
        dotenv.config({ path: '.env.staging', override: true });
    } else {
        dotenv.config();
    }

    const { db } = await import('../lib/firebase-admin');
    
    const isDryRun = args.includes('--dry-run');
    const isForce = args.includes('--force');

    console.log(`Starting Recipe Icon Structure Migration...`);
    console.log(`-----------------------------------`);
    console.log(`Dry Run: ${isDryRun}`);
    console.log(`Force: ${isForce}`);
    console.log(`-----------------------------------`);

    const snapshot = await db.collection('recipes').get();
    console.log(`Found ${snapshot.size} recipes.`);

    let batch = db.batch();
    let opCount = 0;
    let nodesUpdated = 0;

    for (const doc of snapshot.docs) {
        const data = doc.data();
        const graph = data.graph;
        
        if (!graph || !Array.isArray(graph.nodes)) continue;

        let changed = false;
        let recipeNodesUpdated = 0;
        const nodes = graph.nodes;

        for (const node of nodes) {
            // Check if node has old fields and NO new field
            if ((node.iconId || node.iconUrl) && !node.icon) {
                
                if (isDryRun) {
                    console.log(`\n[Recipe ${doc.id}] Node "${node.text}":`);
                    console.log(`  BEFORE: { iconId: ${node.iconId}, iconUrl: ${node.iconUrl}, iconMetadata: ${node.iconMetadata ? '...' : 'undefined'} }`);
                }

                // Construct new object
                node.icon = {
                    iconId: node.iconId || null,
                    iconUrl: node.iconUrl,
                    metadata: node.iconMetadata
                };

                if (isDryRun) {
                    console.log(`  AFTER:  { icon: ${JSON.stringify(node.icon)} }`);
                }

                // Remove old fields
                delete node.iconId;
                delete node.iconUrl;
                delete node.iconMetadata;

                changed = true;
                nodesUpdated++;
                recipeNodesUpdated++;
            }
        }

        if (changed) {
            if (isDryRun) {
                console.log(`[DryRun] Would update recipe ${doc.id} (${recipeNodesUpdated} nodes)`);
            } else {
                batch.update(doc.ref, { 
                    "graph.nodes": removeUndefined(nodes),
                    updated_at: FieldValue.serverTimestamp()
                });
                opCount++;
            }
        }

        if (opCount >= 400) {
            await batch.commit();
            console.log(`Committed batch.`);
            batch = db.batch();
            opCount = 0;
        }
    }

    if (!isDryRun && opCount > 0) {
        await batch.commit();
        console.log(`Final batch committed.`);
    }

    console.log(`Migration Complete. Updated ${nodesUpdated} nodes.`);
}

migrateIconStruct().catch(console.error);
