import 'dotenv/config';
import { db } from '../lib/firebase-admin';
import { standardizeIngredientName } from '../lib/utils';

async function main() {
  const name = process.argv[2];

  if (name) {
    const stdName = standardizeIngredientName(name);
    console.log(`Looking up queue entry: "${stdName}"`);
    const q = await db.collection('icon_queue').doc(stdName).get();
    console.log('exists:', q.exists);
    if (q.exists) console.log(JSON.stringify(q.data(), null, 2));
  }

  // List 10 most recent queue entries
  console.log('\n--- Recent queue entries ---');
  const recent = await db.collection('icon_queue').orderBy('created_at', 'desc').limit(10).get();
  if (recent.empty) { console.log('(empty)'); return; }
  recent.forEach(d => {
    const data = d.data();
    const created = data.created_at?.toDate ? data.created_at.toDate().toISOString() : 'unknown';
    console.log(`  [${data.status}] "${d.id}" created=${created}`);
  });
}

main().catch(console.error);
