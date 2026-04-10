/**
 * Re-triggers icon resolution for a specific recipe.
 * Usage: npx tsx scripts/retrigger-recipe-icons.ts --staging <recipeId>
 */
import dotenv from 'dotenv';
const args = process.argv.slice(2);
const envArg = args.includes('--staging') ? 'staging' : args.includes('--prod') ? 'prod' : 'local';
dotenv.config({ path: envArg === 'local' ? '.env' : `.env.${envArg}`, override: true });

import { initializeApp } from 'firebase/app';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';

async function main() {
  const recipeId = args.find(a => !a.startsWith('--'));
  if (!recipeId) { console.error('Usage: retrigger-recipe-icons.ts [--staging|--prod] <recipeId>'); process.exit(1); }

  const { db } = await import('../lib/firebase-admin');
  const { standardizeIngredientName } = await import('../lib/utils');
  const { buildShortlistEntry, getNodeIngredientName, getNodeHydeQueries, mutateNodesByIngredient } = await import('../lib/recipe-lanes/model-utils');

  const doc = await db.collection('recipes').doc(recipeId).get();
  if (!doc.exists) { console.error('Recipe not found'); process.exit(1); }
  const nodes: any[] = doc.data()?.graph?.nodes ?? [];
  const pending = nodes.filter(n => !n.iconShortlist || n.iconShortlist.length === 0);
  console.log(`${pending.length} / ${nodes.length} nodes need icons`);
  if (pending.length === 0) { console.log('Nothing to do.'); process.exit(0); }

  const hydeMap = new Map<string, string[]>();
  for (const node of pending) {
    if (!node.visualDescription) continue;
    const stdName = standardizeIngredientName(getNodeIngredientName(node));
    const queries = getNodeHydeQueries(node);
    const existing = hydeMap.get(stdName) ?? [];
    hydeMap.set(stdName, Array.from(new Set([...existing, ...queries])));
  }
  const ingredients = Array.from(hydeMap.entries()).map(([name, queries]) => ({ name, queries: queries.length ? queries : [name] }));

  const clientApp = initializeApp({
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });
  const functions = getFunctions(clientApp, 'us-central1');
  if (envArg === 'local') connectFunctionsEmulator(functions, '127.0.0.1', 5001);

  const fn = httpsCallable<any, any>(functions, 'vectorSearch-searchIconVector');
  console.log(`Calling CF with ${ingredients.length} ingredients...`);
  const t0 = Date.now();
  const res = await fn({ ingredients, limit: 12 });
  console.log(`CF returned in ${Date.now() - t0}ms`);

  const results: { name: string; embedding: number[]; fast_matches: any[] }[] = res.data.results;
  for (const { name: stdName, fast_matches } of results) {
    if (!fast_matches || fast_matches.length === 0) { console.log(`  ${stdName}: no matches`); continue; }
    const iconDocs = await db.getAll(...fast_matches.map((m: any) => db.collection('icon_index').doc(m.icon_id)));
    const icons = iconDocs.filter(d => d.exists).map(d => {
      const { embedding, embedding_minilm, ...rest } = d.data()!;
      return { id: d.id, ...rest };
    });
    const ranked = icons
      .map(icon => {
        const fm = fast_matches.find((m: any) => m.icon_id === icon.id);
        return buildShortlistEntry(icon as any, 'search', fm?.score ?? 0);
      })
      .sort((a: any, b: any) => (b.matchScore ?? 0) - (a.matchScore ?? 0))
      .slice(0, 8);

    await db.runTransaction(async t => {
      const d = await t.get(db.collection('recipes').doc(recipeId));
      if (!d.exists) return;
      const recipeNodes: any[] = d.data()!.graph.nodes;
      mutateNodesByIngredient(recipeNodes, stdName, (n: any) => {
        n.iconShortlist = ranked;
        n.shortlistIndex = 0;
        delete n.status;
      });
      t.update(db.collection('recipes').doc(recipeId), { 'graph.nodes': recipeNodes });
    });
    console.log(`  ${stdName}: ${ranked.length} candidates (top: ${(ranked[0] as any)?.icon?.id})`);
  }
  console.log('Done.');
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
