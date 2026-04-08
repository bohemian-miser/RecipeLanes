# Design Document: Hybrid Icon Search Architecture (Cloud Function & In-Browser)

## 1. Context & Objective
Following initial prototyping, the objective has shifted from managing a dedicated Rust vector database container to a completely **Serverless & Client-Hybrid** architecture. We want zero infrastructure management ("just code deployment"), blazing-fast cold starts, and the ability to dynamically swap search execution strategies on the fly without deploying new client code.

**Primary Architecture Goals:**
1.  **Zero-Management Serverless:** Utilize Google Cloud Functions to serve the search. 
2.  **Baked-In State:** Data is baked directly into the deployment artifact. No fetching large datasets on cold starts.
3.  **Strategy Pattern & Remote Toggles:** The frontend must seamlessly fall back between Cloud Functions, fully local In-Browser execution, or the legacy Vertex AI search using Firebase Remote Config.
4.  **Real-Time Gap Mitigation:** Handle the edge-case where a user creates a new icon and immediately searches for it, bypassing the baked index.

---

## 2. The Strategy Pattern (Client-Side Abstraction)

To ensure we can easily swap between backend, browser, and legacy implementations, the Next.js frontend will implement the **Strategy Pattern**.

A factory function will read a Firebase Remote Config value (e.g., `icon_search_mode = "browser" | "cloud_function" | "legacy"`) and instantiate the correct strategy.

```typescript
// 1. The Strategy Interface
interface IconSearchStrategy {
    search(query: string, limit: number): Promise<SearchResult[]>;
}

// 2. Implementations
class BrowserLocalSearch implements IconSearchStrategy {
    // Loads Int8 index and ONNX model in background web worker
    async search(query: string, limit: number) { ... }
}

class CloudFunctionSearch implements IconSearchStrategy {
    // Hits the stateless Cloud Function endpoint
    async search(query: string, limit: number) { ... }
}

class LegacyVertexSearch implements IconSearchStrategy {
    // Current fallback using Vertex AI and Firestore native search
    async search(query: string, limit: number) { ... }
}

// 3. Execution (Context)
async function getSearchEngine(): Promise<IconSearchStrategy> {
    const mode = await getFirebaseRemoteConfig('icon_search_mode');
    switch(mode) {
        case 'browser': return new BrowserLocalSearch();
        case 'cloud_function': return new CloudFunctionSearch();
        default: return new LegacyVertexSearch();
    }
}
```
**Benefits:** If the Cloud Function proves too slow for certain regions, or we want to save on compute costs, we simply flip the Firebase config to `browser`, and users start doing the embedding and search entirely on their own devices.

---

## 3. Cloud Function Backend: "Baked-In" Data Strategy

We do not want a database. We want a fast function. 

### 3.1 The "Baked" Build Process
Instead of the Cloud Function connecting to Firestore or Cloud Storage on boot, the vector index is bundled **into the code artifact itself** during the CI/CD pipeline. 

When the function scales from 0 to 1, the operating system simply loads a local file from disk to memory (taking milliseconds) rather than making network requests.

### 3.2 Deployment Triggers & Cost Analysis
*   **Deployment Cost:** Google Cloud Build offers 120 free minutes per day. Pushing a Cloud Function is essentially **free**. The only cost is a fraction of a cent per month for storing the compressed deployment artifact in Google Artifact Registry.
*   **When to Deploy:**
    *   **Nightly Cron:** A GitHub Action runs every night at 2:00 AM.
    *   **Threshold Trigger:** If the database grows by `X` new icons since the last build, a Firestore webhook triggers the GitHub Action to rebuild early.

### 3.3 Index Optimization (KNN Deduplication)
As the DB grows, we must keep the baked payload tiny. During the GitHub Action build step, we will run a pre-processing script:
*   Perform K-Nearest Neighbors (KNN) on all vectors.
*   If two icons have a similarity score of `> 0.99` (they mean exactly the same thing conceptually), drop one from the vector index and map its visual UI reference to the primary icon. 
*   **Result:** We only ship conceptually distinct vectors.

---

## 4. Mitigating the "Fresh Icon" Gap

**The Problem:** If the index is only baked nightly, and a user creates a brand new icon at 10:00 AM, the Cloud Function won't know about it until tomorrow.

**The Solution: Parallel Hybrid Search**
During the GitHub Action build, we inject an environment variable into the Cloud Function: `LAST_INDEX_TIMESTAMP`.

When the user searches:
1.  **Fast Path:** The Cloud Function performs the dense vector search against its baked memory.
2.  **Slow Path (Parallel):** The Cloud Function simultaneously queries live Firestore for any icons where `created_at > LAST_INDEX_TIMESTAMP`. It performs a brute-force comparison on *just* those few new icons.
3.  **Merge:** The results are merged, sorted by score, and returned to the user.

This guarantees absolute real-time accuracy without sacrificing the 0ms lookup speed of the 99% historical dataset.

---

## 5. Technology Stack for the Cloud Function

Since we want "just code deployment", deploying a custom Rust container to Cloud Functions is possible but adds friction. 
We will instead use **Node.js Cloud Functions (2nd Gen)** leveraging `@huggingface/transformers` to match the exact same pipeline we built for the browser.

*   **Runtime:** Node.js 20.
*   **Embedding Model:** `Xenova/all-MiniLM-L6-v2` loaded locally via ONNX Runtime Node.
*   **Database:** `Float32Array` or `Int8Array` loaded from a local `.bin` file bundled in the deployment zip.

---

## 6. Summary of Workflows

**1. The CI/CD Rebuild Pipeline (GitHub Actions)**
1. Fetches all icons from Firestore.
2. Runs Vector generation for any missing embeddings.
3. Deduplicates vectors (KNN distance threshold).
4. Compresses index into Int8 `.bin` format.
5. Injects `BUILD_TIMESTAMP`.
6. Executes `gcloud functions deploy`.

**2. The Client Search Flow**
1. Next.js App loads.
2. Checks Firebase Remote Config.
3. If `browser`: Downloads the Int8 bin in the background and searches locally.
4. If `cloud_function`: Sends query to GCP Function -> Function searches baked Int8 bin + parallel queries Firestore for new delta icons -> returns unified list.