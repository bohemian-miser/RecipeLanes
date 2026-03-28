import 'dotenv/config';
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { standardizeIngredientName } from '../lib/utils';

async function analyzeActionIcons() {
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

    // Collect all action node visualDescriptions (include forks — we want full population)
    const allActionDescs: string[] = [];
    let recipesWithActionNodes = 0;
    let totalRecipes = 0;

    snapshot.forEach(doc => {
        const data = doc.data();
        const graph = data.graph;
        if (!graph?.nodes?.length) return;

        totalRecipes++;
        let recipeHasAction = false;
        for (const node of graph.nodes) {
            if (node.type === 'action' && node.visualDescription) {
                allActionDescs.push(standardizeIngredientName(String(node.visualDescription)));
                recipeHasAction = true;
            }
        }
        if (recipeHasAction) recipesWithActionNodes++;
    });

    // --- Frequency map ---
    const freq = new Map<string, number>();
    for (const desc of allActionDescs) {
        freq.set(desc, (freq.get(desc) ?? 0) + 1);
    }

    const totalActionNodes = allActionDescs.length;
    const uniqueDescs = freq.size;

    // Sorted by frequency descending
    const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);

    console.log(`=== Action Node Icon Analysis ===\n`);
    console.log(`Total action nodes:          ${totalActionNodes}`);
    console.log(`Unique standardized descs:   ${uniqueDescs}`);
    console.log(`Recipes with action nodes:   ${recipesWithActionNodes} / ${totalRecipes}`);

    // --- Top 50 ---
    console.log(`\n--- Top 50 Most Frequent Action Descriptions ---`);
    let top50Total = 0;
    const top50: [string, number][] = sorted.slice(0, 50);
    for (const [desc, count] of top50) top50Total += count;
    console.log(`Top 50 cover ${top50Total} / ${totalActionNodes} nodes = ${((top50Total / totalActionNodes) * 100).toFixed(1)}%\n`);
    console.log(`${'Rank'.padEnd(5)} ${'Count'.padStart(6)} ${'Cumul%'.padStart(8)}  Description`);
    console.log('-'.repeat(70));
    let cumul = 0;
    for (let i = 0; i < top50.length; i++) {
        const [desc, count] = top50[i];
        cumul += count;
        console.log(`${String(i + 1).padEnd(5)} ${String(count).padStart(6)} ${((cumul / totalActionNodes) * 100).toFixed(1).padStart(7)}%  ${desc}`);
    }

    // --- Cumulative coverage curve ---
    console.log(`\n--- Cumulative Coverage Curve ---`);
    const thresholds = [0.50, 0.75, 0.90, 0.95, 0.99];
    const coveragePoints: { threshold: number; uniqueCount: number }[] = [];
    let running = 0;
    let tIdx = 0;
    for (let i = 0; i < sorted.length && tIdx < thresholds.length; i++) {
        running += sorted[i][1];
        while (tIdx < thresholds.length && running / totalActionNodes >= thresholds[tIdx]) {
            coveragePoints.push({ threshold: thresholds[tIdx], uniqueCount: i + 1 });
            tIdx++;
        }
    }
    for (const { threshold, uniqueCount } of coveragePoints) {
        console.log(`  ${(threshold * 100).toFixed(0)}% coverage → top ${uniqueCount} unique descriptions`);
    }

    // --- Recipes with 0 coverage from top 50 ---
    const top50Set = new Set(top50.map(([d]) => d));
    let recipesNotCovered = 0;
    snapshot.forEach(doc => {
        const data = doc.data();
        const graph = data.graph;
        if (!graph?.nodes?.length) return;

        const actionNodes = graph.nodes.filter((n: any) => n.type === 'action' && n.visualDescription);
        if (actionNodes.length === 0) return;

        const allCovered = actionNodes.every((n: any) =>
            top50Set.has(standardizeIngredientName(String(n.visualDescription)))
        );
        if (!allCovered) recipesNotCovered++;
    });
    console.log(`\nRecipes where ≥1 action node falls outside top-50 set: ${recipesNotCovered} / ${recipesWithActionNodes}`);

    // --- Semantic clustering of top 100 ---
    console.log(`\n--- Semantic Clusters (top 100 descriptions) ---`);
    const top100 = sorted.slice(0, 100);

    const clusterDefs: { label: string; keywords: string[] }[] = [
        { label: 'mix/stir/combine', keywords: ['mix', 'stir', 'combine', 'fold', 'blend', 'whisk', 'beat', 'toss', 'incorporate', 'swirl', 'agitate', 'emulsify', 'cream'] },
        { label: 'chop/cut/slice', keywords: ['chop', 'slice', 'cut', 'dice', 'mince', 'julienne', 'halve', 'quarter', 'trim', 'shred', 'grate', 'zest', 'peel', 'score', 'split', 'separate', 'break'] },
        { label: 'fry/sauté', keywords: ['fry', 'sauté', 'saute', 'pan-fry', 'pan fry', 'shallow', 'stir-fry', 'stir fry', 'deep-fry', 'deep fry', 'sear', 'brown', 'crisp'] },
        { label: 'boil/simmer/blanch', keywords: ['boil', 'simmer', 'blanch', 'parboil', 'poach', 'steep', 'reduce', 'deglaze', 'braise'] },
        { label: 'bake/roast', keywords: ['bake', 'roast', 'broil', 'grill', 'toast', 'char', 'caramelize', 'gratinate', 'au gratin'] },
        { label: 'steam/heat', keywords: ['steam', 'heat', 'warm', 'reheat', 'microwave', 'cook'] },
        { label: 'add/pour/drizzle', keywords: ['add', 'pour', 'drizzle', 'sprinkle', 'season', 'salt', 'garnish', 'top', 'coat', 'brush', 'baste', 'glaze', 'marinate', 'dress'] },
        { label: 'rest/cool/chill', keywords: ['rest', 'cool', 'chill', 'refrigerate', 'freeze', 'set', 'solidify'] },
        { label: 'press/shape/roll', keywords: ['press', 'shape', 'roll', 'flatten', 'spread', 'knead', 'stretch', 'form', 'mold', 'mould', 'stuff', 'fill', 'layer', 'assemble'] },
        { label: 'drain/strain/rinse', keywords: ['drain', 'strain', 'rinse', 'wash', 'pat dry', 'dry', 'sift', 'filter'] },
        { label: 'serve/plate', keywords: ['serve', 'plate', 'arrange', 'present', 'portion', 'dish'] },
    ];

    const clusters: { label: string; count: number; members: string[] }[] = clusterDefs.map(c => ({
        label: c.label,
        count: 0,
        members: [],
    }));
    const unclusteredTop100: [string, number][] = [];

    for (const [desc, count] of top100) {
        const lower = desc.toLowerCase();
        let matched = false;
        for (let i = 0; i < clusterDefs.length; i++) {
            if (clusterDefs[i].keywords.some(kw => lower.includes(kw))) {
                clusters[i].count += count;
                clusters[i].members.push(desc);
                matched = true;
                break;
            }
        }
        if (!matched) unclusteredTop100.push([desc, count]);
    }

    for (const cluster of clusters.sort((a, b) => b.count - a.count)) {
        if (cluster.members.length === 0) continue;
        console.log(`\n  [${cluster.label}] — ${cluster.count} nodes`);
        console.log(`    ${cluster.members.join(', ')}`);
    }
    if (unclusteredTop100.length > 0) {
        console.log(`\n  [unclustered] — ${unclusteredTop100.reduce((s, [, c]) => s + c, 0)} nodes`);
        console.log(`    ${unclusteredTop100.map(([d]) => d).join(', ')}`);
    }

    // --- Fixed library estimates ---
    console.log(`\n--- Fixed Icon Library Coverage Estimates ---`);
    const libSizes = [20, 30, 50];
    for (const n of libSizes) {
        const topN = sorted.slice(0, n);
        const covered = topN.reduce((s, [, c]) => s + c, 0);
        console.log(`  Top ${String(n).padStart(2)} canonical icons → ${((covered / totalActionNodes) * 100).toFixed(1)}% of action nodes served from library`);
    }

    // --- Build results markdown ---
    const top50Rows = top50.map(([desc, count], i) => {
        const pctOfTotal = ((count / totalActionNodes) * 100).toFixed(2);
        return `| ${i + 1} | ${desc} | ${count} | ${pctOfTotal}% |`;
    }).join('\n');

    const clusterRows = clusters
        .filter(c => c.members.length > 0)
        .sort((a, b) => b.count - a.count)
        .map(c => `| ${c.label} | ${c.count} | ${c.members.join(', ')} |`)
        .join('\n');

    const unclustered = unclusteredTop100;
    const unclusteredRow = unclustered.length > 0
        ? `| unclustered | ${unclustered.reduce((s, [, c]) => s + c, 0)} | ${unclustered.map(([d]) => d).join(', ')} |`
        : '';

    const coverageRows = coveragePoints.map(({ threshold, uniqueCount }) =>
        `| ${(threshold * 100).toFixed(0)}% | ${uniqueCount} |`
    ).join('\n');

    const libRows = libSizes.map(n => {
        const covered = sorted.slice(0, n).reduce((s, [, c]) => s + c, 0);
        return `| ${n} | ${((covered / totalActionNodes) * 100).toFixed(1)}% |`;
    }).join('\n');

    // Recommended icon set: top 30 by freq
    const recommendedSet = sorted.slice(0, 30).map(([d], i) => `${i + 1}. ${d}`).join('\n');

    const md = `# Action Icon Analysis Results
_Generated: ${new Date().toISOString()}_

## Summary

| Metric | Value |
|--------|-------|
| Total action nodes | ${totalActionNodes} |
| Unique standardized descriptions | ${uniqueDescs} |
| Recipes with action nodes | ${recipesWithActionNodes} / ${totalRecipes} |
| Top-50 node coverage | ${((top50Total / totalActionNodes) * 100).toFixed(1)}% |
| Recipes not fully covered by top-50 | ${recipesNotCovered} / ${recipesWithActionNodes} |

## Cumulative Coverage Curve

| Coverage | Unique descriptions needed |
|----------|---------------------------|
${coverageRows}

## Fixed Library Coverage

| Library size (N) | % action nodes served from library |
|------------------|-----------------------------------|
${libRows}

## Top 50 Most Frequent Action Descriptions

| Rank | Description | Count | % of all action nodes |
|------|-------------|-------|-----------------------|
${top50Rows}

## Semantic Clusters (top 100 descriptions)

| Cluster | Node count | Members |
|---------|------------|---------|
${clusterRows}
${unclusteredRow}

## Recommended Minimum Icon Set (top 30 by frequency)

These 30 canonical icons cover the majority of action nodes in production data.

${recommendedSet}

## Key Findings

- **${((sorted.slice(0, 20).reduce((s, [, c]) => s + c, 0) / totalActionNodes) * 100).toFixed(0)}%** of all action nodes are covered by the top 20 descriptions.
- **${((sorted.slice(0, 30).reduce((s, [, c]) => s + c, 0) / totalActionNodes) * 100).toFixed(0)}%** covered by top 30 — a fixed 30-icon library is the sweet spot.
- **${((sorted.slice(0, 50).reduce((s, [, c]) => s + c, 0) / totalActionNodes) * 100).toFixed(0)}%** covered by top 50.
- Semantic clustering shows most descriptions collapse into ~11 visual archetypes (mix, chop, fry, boil, bake, steam, add/season, rest/cool, press/shape, drain, serve).
- A pre-built library of 30 icons with heuristic matching would eliminate generation costs for the vast majority of action nodes.
`;

    const outPath = path.join(__dirname, 'action-icon-analysis-results.md');
    fs.writeFileSync(outPath, md, 'utf8');
    console.log(`\nResults written to scripts/action-icon-analysis-results.md`);
}

analyzeActionIcons().catch(console.error);
