# Design Document: Client-Orchestrated Hybrid Vector Search

## 1. Context & Objective
We need a blazing-fast, serverless icon search architecture that avoids infrastructure management while providing real-time accuracy. The previous iteration suffered from a bottleneck: waiting for a single backend to complete both a fast cache lookup *and* a slow database query.

**The Breakthrough:** The embedding engine (whether a Rust Cloud function or a Browser WebWorker) will perform the dense vector math, query its baked-in cache, and **return the computed embedding vector alongside the fast cache results**. The Next.js client will instantly render the fast results and use the returned embedding to trigger a native Firestore vector search (`findNearest`) in the background to catch any fresh icons not yet in the snapshot.

**Primary Goals:**
1.  **Client-Side Orchestration:** Separate the "Fast Path" (Snapshot Cache) and "Slow Path" (Live Firestore), orchestrated by the client.
2.  **No Infrastructure Management:** Utilize Serverless Rust (Google Cloud Run) which scales to 0 and deploys as a single stateless artifact.
3.  **Bulletproof Fallbacks:** Implement a Strategy Pattern in the frontend, controlled by Firebase Remote Config, to instantly toggle between Rust, In-Browser, or Legacy Vertex AI modes.

---

## 2. The Client-Orchestrated Hybrid Flow

By returning the vector embedding from our initial fast pass, we completely eliminate the need to call the embedding API twice.

### The Execution Timeline:
1.  **User Types:** "Peanut Butter"
2.  **Fast Pass (0-50ms):** The client hits the active Strategy (e.g., Rust CF). 
    *   The strategy embeds the text into a `[0.12, -0.04, ...]` vector.
    *   It searches its baked-in snapshot (in-memory).
    *   It returns: `{ embedding: [...], fast_matches: [{id: "1", score: 0.99}] }`.
3.  **UI Paint (50ms):** The client immediately updates the recipe graph with the `fast_matches`. The user sees instant results.
4.  **Slow Pass (Parallel, 50-200ms):** The client takes the returned `embedding` and queries live Firestore using Firebase's native vector search:
    *   `collection('icons').findNearest(embedding)`
    *   *(Optimization: We can filter this query to only include icons `created_at > SNAPSHOT_TIMESTAMP` to make it a micro-query).*
5.  **Merge & Re-paint (200ms):** The client receives the Firestore results, merges them with the `fast_matches` (union by `icon_id`, keeping the highest score), and seamlessly updates the UI with any brand-new icons.

---

## 3. The Strategy Pattern (Future-Proof Flexibility)

We will abstract the "Fast Pass" behind a unified interface in the Next.js client. Firebase Remote Config will dictate which strategy is instantiated.

```typescript
// 1. The Unified Interface
interface SearchResponse {
    embedding: number[];
    fast_matches: { icon_id: string, score: number }[];
    snapshot_timestamp: number;
}

interface IconSearchStrategy {
    getFastPass(query: string, limit: number): Promise<SearchResponse>;
}

// 2. The Implementations

// Strategy A: Serverless Rust (Primary Target)
class RustCloudRunStrategy implements IconSearchStrategy {
    async getFastPass(query: string, limit: number) {
        // Hits the fast stateless Rust container endpoint
        const res = await fetch('https://rust-search-xyz.run.app/search', { body: query });
        return res.json();
    }
}

// Strategy B: Fully In-Browser (Fallback 1)
class BrowserLocalStrategy implements IconSearchStrategy {
    async getFastPass(query: string, limit: number) {
        // Embeds via WebGPU/WASM, searches Int8 array locally
        return await this.worker.postMessage({ query, limit });
    }
}

// Strategy C: Legacy Vertex AI (Fallback 2)
class LegacyVertexStrategy implements IconSearchStrategy {
    async getFastPass(query: string, limit: number) {
        // Hits Vertex API just to get the embedding. fast_matches is empty.
        const embedding = await getVertexEmbedding(query);
        return { embedding, fast_matches: [], snapshot_timestamp: Date.now() };
    }
}

// 3. The Orchestrator Hook
function useHybridIconSearch() {
    const strategy = getStrategyFromRemoteConfig();

    return async (query: string) => {
        // 1. Fast Pass
        const { embedding, fast_matches, snapshot_timestamp } = await strategy.getFastPass(query);
        updateUI(fast_matches); // INSTANT RENDER

        // 2. Slow Pass (Background)
        const freshIcons = await firestore.collection('icons')
             .where('created_at', '>', snapshot_timestamp)
             .findNearest('embedding_field', embedding);
        
        // 3. Merge
        updateUI(mergeResults(fast_matches, freshIcons)); 
    }
}
```

---

## 4. Serverless Rust Backend ("Just Code Deployment")

To achieve the speed of Rust without managing servers, we will deploy it to **Google Cloud Run**. 
*Cloud Run is Google's serverless container platform. It acts exactly like a Cloud Function (scales to zero, pay per millisecond, zero infra management), but allows native Rust binaries.*

### 4.1 Deployment Artifact (The "Baked" Index)
During the GitHub Actions CI/CD pipeline:
1.  A script downloads the latest Firestore icon vectors.
2.  The vectors are compressed into a binary file (`index.bin`).
3.  A Rust HTTP server (`axum`) is compiled.
4.  The `index.bin` and the ONNX model weights are **copied directly into the Docker image**.
5.  Deployed to Cloud Run.

**Result:** When the Rust service wakes up from sleep, it doesn't need to download anything from the internet. It maps the local `index.bin` file straight into memory in <10ms and immediately serves requests.

---

## 5. Index Refresh Strategy

Because the client automatically queries Firestore for any icons newer than the backend's `snapshot_timestamp`, **the backend index does not need to be updated perfectly in real-time.** 

1.  **Cost Efficiency:** We do not need expensive listeners or continuous deployments.
2.  **Nightly Cron:** A GitHub action runs once a day to rebuild the Rust container and In-Browser `.bin` file with the newest batch of icons.
3.  **Seamless Handoff:** As soon as the new backend deploys, its `snapshot_timestamp` increments. The client-side Firestore query automatically adjusts, querying a smaller window of "new" icons.