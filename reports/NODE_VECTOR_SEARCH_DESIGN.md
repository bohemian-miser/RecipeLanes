# Design Document: Client-Orchestrated Hybrid Vector Search

## 1. Context & Objective
We need a blazing-fast, serverless icon search architecture that avoids infrastructure management while providing real-time accuracy. The previous iteration suffered from a bottleneck: waiting for a single backend to complete both a fast cache lookup *and* a slow database query.

**The Breakthrough:** The embedding engine (a Node.js Cloud Function) will perform the dense vector math via `@huggingface/transformers`, query its baked-in cache, and **return the computed embedding vector alongside the fast cache results**. The Next.js client will instantly render the fast results and optionally use the returned embedding to trigger a native Firestore vector search (`findNearest`) in the background to catch any fresh icons not yet in the snapshot.

**Primary Goals:**
1.  **Client-Side Orchestration:** Separate the "Fast Path" (Snapshot Cache) and "Slow Path" (Live Firestore), orchestrated by the client.
2.  **No Infrastructure Management:** Utilize standard Firebase Cloud Functions (Node.js) to leverage existing workflows and avoid setting up complex external Rust containers.
3.  **Bulletproof Fallbacks:** Implement a Strategy Pattern in the frontend, controlled by Firebase Remote Config, to instantly toggle between Node.js In-Memory, In-Browser, or Legacy Vertex AI modes.

---

## 2. The Client-Orchestrated Hybrid Flow

By returning the vector embedding from our initial fast pass, we completely eliminate the need to call the embedding API twice.

### The Execution Timeline:
1.  **User Types:** "Peanut Butter"
2.  **Fast Pass (0-50ms):** The client hits the active Strategy (e.g., Node CF). 
    *   The strategy embeds the text into a `[0.12, -0.04, ...]` vector.
    *   It searches its baked-in snapshot (in-memory).
    *   It returns: `{ embedding: [...], fast_matches: [{icon_id: "1", score: 0.99}] }`.
3.  **UI Paint (50ms):** The client fetches the necessary Firestore metadata for the IDs and immediately updates the recipe graph.
4.  **Slow Pass (Parallel, 50-200ms):** The client takes the returned `embedding` and queries live Firestore using Firebase's native vector search.
5.  **Merge & Re-paint (200ms):** The client receives the Firestore results, merges them with the `fast_matches` (union by `icon_id`, keeping the highest score), and seamlessly updates the UI with any brand-new icons.

---

## 3. The Strategy Pattern (Future-Proof Flexibility)

We abstract the "Fast Pass" behind a unified interface in the Next.js client (`getFastPass`).

```typescript
interface SearchResponse {
    embedding: number[];
    fast_matches: { icon_id: string, score: number }[];
    snapshot_timestamp: number;
}
```

The app dynamically resolves between:
*   **Strategy A: Node Cloud Function (`vectorSearch-searchIconVector`)** (Primary)
*   **Strategy B: Fully In-Browser (WebWorker)** (Fallback 1)
*   **Strategy C: Legacy Vertex AI `text-embedding-004`** (Fallback 2)

---

## 4. Node.js In-Memory Backend ("Just Code Deployment")

To achieve the speed of an in-memory database without managing servers or leaving the Firebase ecosystem, we deploy a **Firebase Cloud Function**.

During the CI/CD pipeline (`scripts/vector-search.sh`):
1.  A script (`pull-db.ts`) downloads the latest Firestore icon vectors.
2.  The vectors are formatted into a `icon_index.json` snapshot.
3.  The `firebase deploy` CLI builds and deploys the function with the snapshot bundled inside.
4.  At runtime, the Node function reads `icon_index.json` into RAM once. `@huggingface/transformers` generates local embeddings dynamically, and plain JS executes instantaneous Cosine Similarity across the arrays.

---

## Appendix: Implementation Log

**Work Updates:**
- **Pivot:** Scrapped the Serverless Rust container concept to stay strictly within the Node.js/Firebase ecosystem per engineering requirements.
- **Node CF Implementation:** Built `searchIconVector` Cloud Function using `@huggingface/transformers` for text-embedding and standard Node FS for loading the local database. Set `env.cacheDir = "/tmp/.cache/huggingface"` to prevent read-only filesystem exceptions.
- **Testing & Deployment Scripts:** Created `scripts/vector-search.sh` which wraps the entire lifecycle:
  * `./vector-search.sh deploy --staging` (Pulls DB -> Builds -> Deploys specific function).
  * `./vector-search.sh test --staging` (Invokes the test-search.ts to print match scores and timing metrics to the terminal).
  * `./vector-search.sh status --staging` (Fetches GCP logs and deployment states).
- **Client Side React Orchestration:** 
    * Restructured `icon-search-strategy.ts` into a functional SOTA setup.
    * Wired up `useHybridIconSearch.ts` which fires the Cloud Function, then correctly chunks arrays to hydrate via the native client-side Firebase SDK.
    * **Dual-View UI:** Expanded `icon_overview/page.tsx` to mount *two* `<IconSearchCandidates>` lists simultaneously. Now, when a user searches, they see the real-time Vertex AI + Firestore results stacked directly above the new Node.js In-Memory results for an exact A/B performance comparison.
