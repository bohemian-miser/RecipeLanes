
import './setup-env';
import { db } from '../../lib/firebase-admin';
import { DB_COLLECTION_RECIPES } from '../../lib/config';

async function listNodes() {
    const doc = await db.collection(DB_COLLECTION_RECIPES).doc('jD0d5cHqgVuQVD3AMpfH').get();
    const nodes = doc.data().graph.nodes;
    nodes.forEach((n: any, i: number) => {
        console.log(`${i}: [${n.text || n.visualDescription}] - Status: ${n.status || 'OK'}`);
    });
}
listNodes();
