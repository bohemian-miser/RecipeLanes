/**
 * Dump search terms from staging Firestore.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./staging-service-account.json \
 *     npx tsx scripts/dump-search-terms.ts
 *
 * Connects to recipe-lanes-staging, reads up to 200 docs from
 * 'ingredients_new', and for each doc prints the icon that has the
 * most searchTerms along with every term's text and source.
 * A summary is printed at the end.
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

// ---------------------------------------------------------------------------
// Bootstrap Firebase Admin against recipe-lanes-staging
// ---------------------------------------------------------------------------
const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!credsPath) {
  console.error('ERROR: GOOGLE_APPLICATION_CREDENTIALS env var is not set.');
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(credsPath, 'utf8'));

const app = initializeApp({
  credential: cert(serviceAccount),
  projectId: 'recipe-lanes-staging',
});

const db = getFirestore(app);

// ---------------------------------------------------------------------------
// Types (minimal, matching Firestore shape)
// ---------------------------------------------------------------------------
interface SearchTerm {
  text: string;
  source?: string;
}

interface Icon {
  id?: string;
  searchTerms?: SearchTerm[];
  [key: string]: unknown;
}

interface IngredientDoc {
  name?: string;
  icons?: Icon[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const snapshot = await db.collection('ingredients_new').limit(200).get();

  if (snapshot.empty) {
    console.log('No documents found in ingredients_new.');
    return;
  }

  let totalIconsWithTerms = 0;
  let totalTerms = 0;
  const sourceBreakdown: Record<string, number> = {};

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data() as IngredientDoc;
    const ingredientName = data.name ?? docSnap.id;
    const icons: Icon[] = data.icons ?? [];

    // Find the icon with the most searchTerms
    let bestIcon: Icon | null = null;
    let bestCount = 0;
    for (const icon of icons) {
      const count = icon.searchTerms?.length ?? 0;
      if (count > bestCount) {
        bestCount = count;
        bestIcon = icon;
      }
    }

    if (!bestIcon || bestCount === 0) continue;

    totalIconsWithTerms++;
    totalTerms += bestCount;

    const iconId = bestIcon.id ?? '(no id)';
    console.log(`\nIngredient: ${ingredientName}`);
    console.log(`  Icon ID: ${iconId}  (${bestCount} terms)`);

    for (const term of bestIcon.searchTerms ?? []) {
      const source = term.source ?? 'unknown';
      console.log(`    - [${source}] ${term.text}`);
      sourceBreakdown[source] = (sourceBreakdown[source] ?? 0) + 1;
    }
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n========================================');
  console.log('SUMMARY');
  console.log('========================================');
  console.log(`Total ingredient docs read  : ${snapshot.size}`);
  console.log(`Icons with searchTerms      : ${totalIconsWithTerms}`);
  console.log(`Total search terms          : ${totalTerms}`);
  console.log('\nBreakdown by source:');
  const sortedSources = Object.entries(sourceBreakdown).sort((a, b) => b[1] - a[1]);
  if (sortedSources.length === 0) {
    console.log('  (none)');
  } else {
    for (const [source, count] of sortedSources) {
      console.log(`  ${source.padEnd(20)} : ${count}`);
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
