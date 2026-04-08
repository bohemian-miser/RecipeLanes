
import './setup-env';
import { db, storage } from '../../lib/firebase-admin';
import { standardizeIngredientName } from '../../lib/utils';
import { DB_COLLECTION_QUEUE, DB_COLLECTION_RECIPES, DB_COLLECTION_ICON_INDEX } from '../../lib/config';
import { execSync } from 'child_process';

interface TimelineEvent {
    timestamp: number;
    type: 'ARTIFACT' | 'LOG' | 'STORAGE';
    source: string;
    message: string;
    severity?: string;
}

async function buildTimeline(recipeId: string) {
    console.log(`\n=== 🔎 CLOUD TIMELINE FORENSICS: ${recipeId} ===\n`);
    const timeline: TimelineEvent[] = [];

    // 1. Fetch Recipe
    const recipeDoc = await db.collection(DB_COLLECTION_RECIPES).doc(recipeId).get();
    if (!recipeDoc.exists) {
        console.error('❌ Recipe not found.');
        return;
    }
    const recipe = recipeDoc.data()!;
    const createdTime = recipe.created_at?.toDate()?.getTime() || Date.now();
    
    timeline.push({
        timestamp: createdTime,
        type: 'ARTIFACT',
        source: 'Firestore (recipes)',
        message: `Recipe '${recipe.title}' document created.`
    });

    const nodes = recipe.graph?.nodes || [];
    const stdNames = nodes
        .filter((n: any) => n.type === 'ingredient')
        .map((n: any) => standardizeIngredientName(n.text || n.visualDescription || ''));
    
    const iconIds: string[] = [];

    // 2. Fetch Queue Artifacts & Gather Icon IDs
    console.log(`Gathering Firestore Artifacts...`);
    for (const stdName of stdNames) {
        const safeId = stdName.replace(/\//g, '_'); // Safe lookup
        const qDoc = await db.collection(DB_COLLECTION_QUEUE).doc(safeId).get();
        if (qDoc.exists) {
            const qData = qDoc.data()!;
            if (qData.created_at) {
                timeline.push({
                    timestamp: qData.created_at.toDate().getTime(),
                    type: 'ARTIFACT',
                    source: `Firestore (icon_queue)`,
                    message: `Queue doc created for [${stdName}]. Status: ${qData.status}`
                });
            }
        }

        // Find associated icons
        const node = nodes.find((n: any) => standardizeIngredientName(n.text || n.visualDescription) === stdName);
        if (node && node.iconShortlist) {
            node.iconShortlist.forEach((entry: any) => {
                if (entry.icon?.id) iconIds.push(entry.icon.id);
            });
        }
    }

    // 3. Fetch Icon Index Artifacts
    for (const iconId of iconIds) {
        const indexDoc = await db.collection(DB_COLLECTION_ICON_INDEX).doc(iconId).get();
        if (indexDoc.exists && indexDoc.data()?.created_at) {
            timeline.push({
                timestamp: indexDoc.data()!.created_at.toDate().getTime(),
                type: 'ARTIFACT',
                source: `Firestore (icon_index)`,
                message: `Embedding index created for icon ${iconId.substring(0,8)}...`
            });
        }
    }

    // 4. Fetch Storage Artifacts
    console.log(`Gathering Storage Artifacts...`);
    const bucket = storage.bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
    const uniqueIconIds = [...new Set(iconIds)];
    
    for (const iconId of uniqueIconIds) {
        // Find the node to get the stdName for the path
        const matchingEntry = nodes.flatMap((n:any) => n.iconShortlist || []).find((e:any) => e.icon?.id === iconId);
        if (!matchingEntry) continue;

        // Visual description is used for paths, fallback to node text
        const vd = matchingEntry.icon.visualDescription;
        const stdName = standardizeIngredientName(vd || '');
        const shortId = iconId.substring(0, 8);
        const kebabName = stdName.trim().replace(/\s+/g, '-');
        
        const mainPath = `icons/${kebabName}-${shortId}.png`;
        const thumbPath = `icons/${kebabName}-${shortId}.thumb.png`;

        for (const filePath of [mainPath, thumbPath]) {
            try {
                const [metadata] = await bucket.file(filePath).getMetadata();
                if (metadata.timeCreated) {
                    timeline.push({
                        timestamp: new Date(metadata.timeCreated).getTime(),
                        type: 'STORAGE',
                        source: 'Cloud Storage',
                        message: `File generated: ${filePath}`
                    });
                }
            } catch (e: any) {
                // File doesn't exist or permissions issue, ignore
            }
        }
    }

    // 5. Fetch GCP Logs via gcloud
    console.log(`Fetching GCP Logs (this may take a moment)...`);
    const startTime = new Date(createdTime - 2 * 60000).toISOString(); // 2 mins before
    const endTime = new Date(createdTime + 10 * 60000).toISOString();  // 10 mins after
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'recipe-lanes-staging';

    // To prevent massive Genkit embedding dumps, we exclude logs containing 'embeddings' and focus on our known log markers
    const logFilter = `(resource.type="cloud_run_revision" OR resource.type="cloud_function") 
        AND timestamp>="${startTime}" AND timestamp<="${endTime}"
        AND NOT textPayload:"[genkit] Output"
        AND NOT jsonPayload.message:"embeddings"`;
    
    // We flatten the filter string for the CLI
    const cleanFilter = logFilter.replace(/\n/g, ' ').replace(/\s+/g, ' ');
    const cmd = `gcloud logging read '${cleanFilter}' --project=${projectId} --format=json --limit=1000`;

    try {
        const logsRaw = execSync(cmd, { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 50 }); // 50MB max buffer
        const gcpLogs = JSON.parse(logsRaw || '[]');

        for (const log of gcpLogs) {
            const text = log.textPayload || log.jsonPayload?.message || '';
            
            // Further filter in-memory to only include relevant recipe lifecycle events
            const isRelevant = text.includes(recipeId) || 
                               stdNames.some(name => text.includes(name)) ||
                               text.includes('resolveRecipeIcons') ||
                               text.includes('createVisualRecipeAction') ||
                               text.includes('Value for argument "documentPath"');
            
            if (isRelevant) {
                const svcName = log.resource?.labels?.service_name || log.resource?.labels?.function_name || log.resource?.type;
                timeline.push({
                    timestamp: new Date(log.timestamp).getTime(),
                    type: 'LOG',
                    source: `GCP (${svcName})`,
                    message: text.trim(),
                    severity: log.severity
                });
            }
        }
    } catch (e: any) {
        console.error('Failed to fetch GCP logs:', e.message);
    }

    // 6. Sort and Format Output
    timeline.sort((a, b) => a.timestamp - b.timestamp);

    console.log(`\n--- ⏳ TIMELINE ---`);
    for (const evt of timeline) {
        const timeStr = new Date(evt.timestamp).toISOString();
        const sevMark = evt.severity === 'ERROR' ? '❌' : evt.severity === 'WARNING' ? '⚠️' : 'ℹ️';
        const typeMark = evt.type === 'ARTIFACT' ? '📄' : evt.type === 'STORAGE' ? '🖼️' : sevMark;
        
        console.log(`[${timeStr}] ${typeMark} [${evt.source}]`);
        console.log(`    ${evt.message.replace(/\n/g, '\n    ')}\n`);
    }
}

const argId = process.argv.slice(2).find(a => !a.startsWith('-'));
if (!argId) {
    console.error('Usage: npx tsx scripts/investigation/cloud-timeline.ts <recipe-id> [--staging]');
} else {
    buildTimeline(argId);
}
