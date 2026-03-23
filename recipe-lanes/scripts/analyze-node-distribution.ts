import 'dotenv/config';
import dotenv from 'dotenv';
import type { RecipeGraph } from '../lib/recipe-lanes/types';

async function analyzeNodeDistribution() {
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
    const snapshot = await db.collection('recipes').get();
    console.log(`Found ${snapshot.size} recipes.\n`);

    const nodeCounts: number[] = [];
    const ingredientCounts: number[] = [];
    const actionCounts: number[] = [];

    snapshot.forEach(doc => {
        const data = doc.data();
        const graph = data.graph as RecipeGraph;
        if (!graph?.nodes?.length) return;

        const ingredients = graph.nodes.filter(n => n.type === 'ingredient').length;
        const actions = graph.nodes.filter(n => n.type === 'action').length;
        const total = graph.nodes.length;

        nodeCounts.push(total);
        ingredientCounts.push(ingredients);
        actionCounts.push(actions);
    });

    if (nodeCounts.length === 0) {
        console.log('No recipes with nodes found.');
        return;
    }

    function stats(values: number[]) {
        const sorted = [...values].sort((a, b) => a - b);
        const sum = sorted.reduce((a, b) => a + b, 0);
        const mean = sum / sorted.length;
        const median = sorted.length % 2 === 0
            ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
            : sorted[Math.floor(sorted.length / 2)];
        const p25 = sorted[Math.floor(sorted.length * 0.25)];
        const p75 = sorted[Math.floor(sorted.length * 0.75)];
        const p90 = sorted[Math.floor(sorted.length * 0.90)];
        const variance = sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / sorted.length;
        const stddev = Math.sqrt(variance);
        return { min: sorted[0], max: sorted[sorted.length - 1], mean, median, p25, p75, p90, stddev };
    }

    function histogram(values: number[], bucketSize = 5) {
        const min = Math.min(...values);
        const max = Math.max(...values);
        const buckets = new Map<number, number>();

        for (const v of values) {
            const bucket = Math.floor(v / bucketSize) * bucketSize;
            buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
        }

        const maxCount = Math.max(...buckets.values());
        const barWidth = 40;
        const total = values.length;

        const sortedBuckets = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
        const rows = sortedBuckets.map(([bucket, count]) => {
            const label = `${String(bucket).padStart(3)}–${String(bucket + bucketSize - 1).padStart(3)}`;
            const bar = '█'.repeat(Math.round((count / maxCount) * barWidth));
            const pct = ((count / total) * 100).toFixed(1);
            return `  ${label} | ${bar.padEnd(barWidth)} ${count} (${pct}%)`;
        });

        return rows.join('\n');
    }

    const totalStats = stats(nodeCounts);
    const ingStats = stats(ingredientCounts);
    const actStats = stats(actionCounts);

    console.log('=== Total Nodes per Recipe ===');
    console.log(`  Count:  ${nodeCounts.length}`);
    console.log(`  Min:    ${totalStats.min}`);
    console.log(`  Max:    ${totalStats.max}`);
    console.log(`  Mean:   ${totalStats.mean.toFixed(1)}`);
    console.log(`  Median: ${totalStats.median}`);
    console.log(`  P25:    ${totalStats.p25}`);
    console.log(`  P75:    ${totalStats.p75}`);
    console.log(`  P90:    ${totalStats.p90}`);
    console.log(`  StdDev: ${totalStats.stddev.toFixed(1)}`);

    console.log('\n=== Ingredient Nodes ===');
    console.log(`  Mean: ${ingStats.mean.toFixed(1)}  Median: ${ingStats.median}  Max: ${ingStats.max}`);

    console.log('\n=== Action Nodes ===');
    console.log(`  Mean: ${actStats.mean.toFixed(1)}  Median: ${actStats.median}  Max: ${actStats.max}`);

    console.log('\n=== Histogram: Total Nodes (bucket size = 5) ===');
    console.log(histogram(nodeCounts, 5));

    // Cost estimate assuming 4c/icon and ~50% cache hit rate
    const ICON_COST = 0.04;
    const cacheHitRate = 0.5;
    const avgNewIcons = ingStats.mean * (1 - cacheHitRate);
    const avgCostPerRecipe = avgNewIcons * ICON_COST;

    console.log('\n=== Cost Estimates (rough) ===');
    console.log(`  Avg ingredient nodes:     ${ingStats.mean.toFixed(1)}`);
    console.log(`  Assumed cache hit rate:   50%`);
    console.log(`  Avg new icons/recipe:     ${avgNewIcons.toFixed(1)}`);
    console.log(`  Avg cost/recipe (@4¢/icon): $${avgCostPerRecipe.toFixed(3)}`);
    console.log(`  P90 cost/recipe:          $${(ingStats.p90 * (1 - cacheHitRate) * ICON_COST).toFixed(3)}`);
}

analyzeNodeDistribution().catch(console.error);
