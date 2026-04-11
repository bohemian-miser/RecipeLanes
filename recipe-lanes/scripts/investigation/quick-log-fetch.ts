import { execSync } from 'child_process';

export function runCloudTimeline(recipeId: string) {
    const projectId = 'recipe-lanes-staging';
    
    // We already know the crash happens because of the slash in "1/2 Tsp Salt".
    // Let's pull the direct logs relating to the crash and this recipe.
    const query = `gcloud logging read 'resource.type=("cloud_run_revision" OR "cloud_function") AND textPayload:"Value for argument \\"documentPath\\""' --project=${projectId} --limit=10 --format=json`;
    
    try {
        console.log(`Executing: ${query}`);
        const result = execSync(query, { encoding: 'utf8' });
        const logs = JSON.parse(result || '[]');
        
        console.log(`\n--- REAL GCP LOGS (App Hosting / Cloud Functions) ---`);
        logs.forEach((l: any) => {
            console.log(`[${l.timestamp}] [${l.severity}] ${l.textPayload || l.jsonPayload?.message}`);
        });
    } catch (e: any) {
         console.error("Failed to execute gcloud query:", e.message);
    }
}

if (require.main === module) {
    const arg = process.argv[2] || 'jD0d5cHqgVuQVD3AMpfH';
    runCloudTimeline(arg);
}
