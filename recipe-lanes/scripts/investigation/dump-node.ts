
import './setup-env';
import { db } from '../../lib/firebase-admin';
import { DB_COLLECTION_RECIPES } from '../../lib/config';

async function dumpNode() {
    const doc = await db.collection(DB_COLLECTION_RECIPES).doc('jD0d5cHqgVuQVD3AMpfH').get();
    const data = doc.data();
    console.log(JSON.stringify(data.graph.nodes[0], null, 2));
}
dumpNode();
