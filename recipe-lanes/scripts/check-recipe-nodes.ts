import dotenv from 'dotenv';
dotenv.config({ path: '.env.staging', override: true });
async function main() {
  const { db } = await import('../lib/firebase-admin');
  const RECIPE_ID = process.argv[2] ?? 'sOEvVM1ZnRsJFOgosjzP';
  const doc = await db.collection('recipes').doc(RECIPE_ID).get();
  if (!doc.exists) { console.log('Recipe not found'); return; }
  const nodes = doc.data()?.graph?.nodes ?? [];
  console.log(`Recipe ${RECIPE_ID} — ${nodes.length} nodes:`);
  for (const n of nodes) {
    console.log(` ${n.text ?? n.visualDescription} | status: ${n.status ?? '-'} | shortlist: ${n.iconShortlist?.length ?? 0} | icon: ${n.iconShortlist?.[0]?.icon?.id ?? 'none'}`);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
