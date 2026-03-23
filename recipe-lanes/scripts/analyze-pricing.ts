import 'dotenv/config';
import dotenv from 'dotenv';
import { standardizeIngredientName } from '../lib/utils';

const ICON_COST = 0.04;

async function analyzePricing() {
    const args = process.argv.slice(2);
    const stagingIndex = args.indexOf('--staging');
    if (stagingIndex !== -1) {
        if (process.env.GOOGLE_APPLICATION_CREDENTIALS) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
        dotenv.config({ path: '.env.staging', override: true });
    } else {
        dotenv.config();
    }

    const { db } = await import('../lib/firebase-admin');

    const snapshot = await db.collection('recipes').orderBy('created_at', 'asc').get();

    // Separate originals from forks (same logic as cache hit script)
    const originals: any[] = [];
    snapshot.forEach(doc => {
        const data = doc.data();
        const graph = data.graph;
        if (!graph?.nodes?.length) return;
        if (!graph.sourceId) originals.push({ id: doc.id, data });
    });

    // Simulate cache and compute per-recipe: node count, actual icon cost, revenue at various credit prices
    const seen = new Set<string>();
    const recipes: { nodes: number; actualCost: number }[] = [];

    for (const { data } of originals) {
        const graph = data.graph;
        let misses = 0;

        for (const node of graph.nodes) {
            if (!node.visualDescription) continue;
            const key = standardizeIngredientName(String(node.visualDescription));
            if (!seen.has(key)) {
                seen.add(key);
                misses++;
            }
        }

        recipes.push({
            nodes: graph.nodes.length,
            actualCost: misses * ICON_COST,
        });
    }

    const sorted = [...recipes].sort((a, b) => a.nodes - b.nodes);
    const n = sorted.length;

    const p = (pct: number) => sorted[Math.floor(n * pct / 100)];
    const p80 = p(80);
    const p80nodes = p80.nodes;

    // credit value: $1 = (p80nodes + 1) credits  →  1 credit = 1/(p80nodes+1) dollars
    const creditsPerDollar = p80nodes + 1;
    const creditValue = 1 / creditsPerDollar;

    console.log('=== Pricing Calibration ===');
    console.log(`P80 node count:     ${p80nodes} nodes`);
    console.log(`Credits for P80:    ${p80nodes + 1} credits = $1.00`);
    console.log(`Credit value:       $${creditValue.toFixed(5)} per credit`);
    console.log(`                    (~$${(creditValue * 100).toFixed(3)} per credit in cents)`);

    // Revenue and cost at each percentile
    console.log('\n=== Revenue vs Cost by Percentile ===');
    console.log(`${'Pct'.padEnd(5)} ${'Nodes'.padStart(6)} ${'Revenue'.padStart(9)} ${'Actual Cost'.padStart(12)} ${'Margin $'.padStart(10)} ${'Margin %'.padStart(9)}`);
    console.log('-'.repeat(55));

    for (const pct of [25, 50, 75, 80, 90, 95]) {
        const r = p(pct);
        const revenue = (r.nodes + 1) * creditValue;
        const cost = r.actualCost;
        const marginAbs = revenue - cost;
        const marginPct = (marginAbs / revenue) * 100;
        console.log(`P${String(pct).padEnd(3)}  ${String(r.nodes).padStart(6)} ${('$' + revenue.toFixed(3)).padStart(9)} ${('$' + cost.toFixed(3)).padStart(12)} ${('$' + marginAbs.toFixed(3)).padStart(10)} ${(marginPct.toFixed(1) + '%').padStart(9)}`);
    }

    // Mean
    const meanNodes = recipes.reduce((a, r) => a + r.nodes, 0) / n;
    const meanCost = recipes.reduce((a, r) => a + r.actualCost, 0) / n;
    const meanRevenue = (meanNodes + 1) * creditValue;
    const meanMargin = meanRevenue - meanCost;
    console.log(`${'Mean'.padEnd(5)}  ${String(meanNodes.toFixed(1)).padStart(6)} ${('$' + meanRevenue.toFixed(3)).padStart(9)} ${('$' + meanCost.toFixed(3)).padStart(12)} ${('$' + meanMargin.toFixed(3)).padStart(10)} ${((meanMargin / meanRevenue) * 100).toFixed(1).padStart(8)}%`);

    // Subscription tier profitability
    console.log('\n=== Subscription Tier Profitability ===');
    console.log('Assuming mean recipe cost and mean node count.\n');

    const tiers = [
        { name: 'Starter', price: 5, recipesPerMonth: 10 },
        { name: 'Pro',     price: 12, recipesPerMonth: 25 },
    ];

    for (const tier of tiers) {
        const revenue = tier.price;
        const variableCost = tier.recipesPerMonth * meanCost;
        const margin = revenue - variableCost;
        const effectivePerRecipe = revenue / tier.recipesPerMonth;
        const creditEquiv = (meanNodes + 1) * creditValue;
        console.log(`${tier.name} ($${tier.price}/mo, ${tier.recipesPerMonth} recipes/mo)`);
        console.log(`  Variable cost:       $${variableCost.toFixed(2)}`);
        console.log(`  Gross margin:        $${margin.toFixed(2)} (${((margin / revenue) * 100).toFixed(1)}%)`);
        console.log(`  Effective per recipe:$${effectivePerRecipe.toFixed(3)} vs à la carte $${creditEquiv.toFixed(3)}`);
        console.log(`  Discount vs à la carte: ${(((creditEquiv - effectivePerRecipe) / creditEquiv) * 100).toFixed(1)}%\n`);
    }

    // Worst-case: all users hit P90 recipes
    console.log('=== Worst-Case: All Recipes at P90 ===');
    const p90r = p(90);
    for (const tier of tiers) {
        const variableCost = tier.recipesPerMonth * p90r.actualCost;
        const margin = tier.price - variableCost;
        console.log(`${tier.name}: revenue $${tier.price} | cost $${variableCost.toFixed(2)} | margin $${margin.toFixed(2)} (${((margin / tier.price) * 100).toFixed(1)}%)`);
    }
}

analyzePricing().catch(console.error);
