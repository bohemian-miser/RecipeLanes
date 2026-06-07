import 'dotenv/config';
import { db } from '../lib/firebase-admin';
import { standardizeIngredientName } from '../lib/utils';

async function main() {
  const recipeId = process.argv[2];
  if (!recipeId) { console.error('Usage: npx tsx scripts/debug-recipe-nodes.ts <recipeId>'); process.exit(1); }

  const doc = await db.collection('recipes').doc(recipeId).get();
  if (!doc.exists) { console.log('NOT FOUND'); process.exit(1); }
  const data = doc.data()!;
  const nodes = data.graph?.nodes || [];
  console.log(`Title: ${data.title || data.graph?.title}`);
  console.log(`Nodes: ${nodes.length}\n`);

  for (const n of nodes) {
    const shortlistLen = n.iconShortlist?.length ?? 0;
    const stdName = standardizeIngredientName(n.visualDescription || n.text || '');
    console.log(`[${n.type}] "${n.text}"`);
    console.log(`  vd:       "${n.visualDescription}"`);
    console.log(`  stdName:  "${stdName}"`);
    console.log(`  status:   ${n.status ?? 'none'}`);
    console.log(`  shortlist: ${shortlistLen} entries`);
    console.log(`  inputs:   ${JSON.stringify(n.inputs ?? [])}`);
    console.log('');
  }

  // Also check queue entries for all nodes
  console.log('--- Queue entries ---');
  for (const n of nodes) {
    const stdName = standardizeIngredientName(n.visualDescription || n.text || '');
    const q = await db.collection('icon_queue').doc(stdName).get();
    if (q.exists) {
      const qd = q.data()!;
      console.log(`  "${stdName}": status=${qd.status} error=${qd.error ?? 'none'}`);
    }
  }
}

main().catch(console.error);
