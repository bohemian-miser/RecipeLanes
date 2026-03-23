import 'dotenv/config';
import dotenv from 'dotenv';
import { standardizeIngredientName } from '../lib/utils';

async function analyzeIconCacheHits() {
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

    console.log('Fetching all recipes...');
    const snapshot = await db.collection('recipes').orderBy('created_at', 'asc').get();
    console.log(`Found ${snapshot.size} total recipes.\n`);

    // Separate originals from forks
    const originals: any[] = [];
    let forkCount = 0;

    snapshot.forEach(doc => {
        const data = doc.data();
        const graph = data.graph;
        if (!graph?.nodes?.length) return;

        if (graph.sourceId) {
            forkCount++;
        } else {
            originals.push({ id: doc.id, data });
        }
    });

    console.log(`Originals: ${originals.length}  |  Forks excluded: ${forkCount}\n`);

    // Walk recipes in chronological order, simulating the cache
    const seen = new Set<string>();

    let ingHits = 0, ingMisses = 0;
    let actHits = 0, actMisses = 0;

    // Per-recipe cost tracking (4c/icon, misses only)
    const ICON_COST = 0.04;
    const recipeCosts: number[] = [];

    for (const { data } of originals) {
        const graph = data.graph;
        let recipeMisses = 0;

        for (const node of graph.nodes) {
            if (!node.visualDescription) continue;

            const key = standardizeIngredientName(String(node.visualDescription));
            const isHit = seen.has(key);

            if (node.type === 'ingredient') {
                isHit ? ingHits++ : ingMisses++;
            } else if (node.type === 'action') {
                isHit ? actHits++ : actMisses++;
            }

            if (!isHit) {
                seen.add(key);
                recipeMisses++;
            }
        }

        recipeCosts.push(recipeMisses * ICON_COST);
    }

    function pct(hits: number, total: number) {
        return total === 0 ? 'N/A' : `${((hits / total) * 100).toFixed(1)}%`;
    }

    const ingTotal = ingHits + ingMisses;
    const actTotal = actHits + actMisses;
    const allTotal = ingTotal + actTotal;

    console.log('=== Cache Hit Analysis (originals only, chronological) ===\n');
    console.log(`${'Node Type'.padEnd(12)} ${'Hits'.padStart(6)} ${'Misses'.padStart(8)} ${'Total'.padStart(7)} ${'Hit Rate'.padStart(9)}`);
    console.log('-'.repeat(46));
    console.log(`${'Ingredient'.padEnd(12)} ${String(ingHits).padStart(6)} ${String(ingMisses).padStart(8)} ${String(ingTotal).padStart(7)} ${pct(ingHits, ingTotal).padStart(9)}`);
    console.log(`${'Action'.padEnd(12)} ${String(actHits).padStart(6)} ${String(actMisses).padStart(8)} ${String(actTotal).padStart(7)} ${pct(actHits, actTotal).padStart(9)}`);
    console.log(`${'All'.padEnd(12)} ${String(ingHits + actHits).padStart(6)} ${String(ingMisses + actMisses).padStart(8)} ${String(allTotal).padStart(7)} ${pct(ingHits + actHits, allTotal).padStart(9)}`);

    console.log(`\nUnique visualDescriptions in cache after all originals: ${seen.size}`);

    // Cost stats across original recipes
    const sorted = [...recipeCosts].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    const mean = sum / sorted.length;
    const median = sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];
    const p90 = sorted[Math.floor(sorted.length * 0.9)];

    console.log('\n=== Per-Recipe Icon Cost (originals only, @$0.04/icon) ===');
    console.log(`  Mean:   $${mean.toFixed(3)}`);
    console.log(`  Median: $${median.toFixed(3)}`);
    console.log(`  P90:    $${p90.toFixed(3)}`);
    console.log(`  Max:    $${sorted[sorted.length - 1].toFixed(3)}`);
    console.log(`  Total:  $${sum.toFixed(2)} across ${originals.length} recipes`);

    // Cache hit rate over time (show how hit rate evolved in quartiles)
    console.log('\n=== Cache Hit Rate Over Time (quartiles of originals) ===');
    const q = Math.floor(originals.length / 4);
    const seenQ = new Set<string>();
    let qHits = 0, qTotal = 0, qIdx = 0;

    for (let i = 0; i < originals.length; i++) {
        const graph = originals[i].data.graph;
        for (const node of graph.nodes) {
            if (!node.visualDescription) continue;
            const key = standardizeIngredientName(String(node.visualDescription));
            const isHit = seenQ.has(key);
            if (isHit) qHits++;
            else seenQ.add(key);
            qTotal++;
        }

        // Print at each quartile boundary
        if (q > 0 && (i + 1) % q === 0 && qIdx < 4) {
            const label = `Q${qIdx + 1} (recipes ${i - q + 2}–${i + 1})`;
            console.log(`  ${label.padEnd(28)} hit rate: ${pct(qHits, qTotal).padStart(6)}  (${qHits}/${qTotal})`);
            qHits = 0; qTotal = 0; qIdx++;
        }
    }
}

analyzeIconCacheHits().catch(console.error);
