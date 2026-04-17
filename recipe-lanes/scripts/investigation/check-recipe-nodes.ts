import 'dotenv/config';
import { db } from '../lib/firebase-admin';

async function main() {
  const recipeId = process.argv[2] || 'AZIgu8aCf5Lf3xLoHZTY';
  const doc = await db.collection('recipes').doc(recipeId).get();
  if (!doc.exists) { console.log('NOT FOUND'); process.exit(1); }
  const data = doc.data();
  const created = data.created_at?.toDate ? data.created_at.toDate().toISOString() : 'unknown';
  const updated = data.updated_at?.toDate ? data.updated_at.toDate().toISOString() : 'unknown';
  console.log(`created_at: ${created}`);
  console.log(`updated_at: ${updated}`);
  const nodes = data.graph?.nodes || [];
  console.log(`Title: ${data.title || data.graph?.title}`);
  console.log(`Nodes: ${nodes.length}`);
  for (const n of nodes) {
    const hasIcon = !!(n.iconShortlist?.length && n.iconShortlist[0]?.icon?.id);
    const status = n.status || (hasIcon ? 'ok' : 'NO_ICON');
    console.log(`  [${status}] "${n.text}" / vd="${n.visualDescription}" shortlist=${n.iconShortlist?.length ?? 0}`);
  }

  const allVds = nodes
    .filter(n => n.visualDescription && !n.iconShortlist?.length)
    .map(n => n.visualDescription);
  const unique = [...new Set(allVds)];

  console.log('\n--- icon_queue (all statuses) ---');
  for (const name of unique) {
    const q = await db.collection('icon_queue').doc(name).get();
    if (q.exists) {
      const qd = q.data();
      const qcreated = qd.created_at?.toDate ? qd.created_at.toDate().toISOString() : 'unknown';
      console.log(`  ["${name}"]: status=${qd.status} created=${qcreated} error=${qd.error || 'none'}`);
    } else {
      console.log(`  ["${name}"]: NO ENTRY`);
    }
  }
}

main().catch(console.error);
