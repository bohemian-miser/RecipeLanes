# Design Document: Rust Vector Search Backend Integration

## 1. Context & Objective
The RecipeLanes project requires a fast, low-latency vector search capability to match user ingredients/actions to icons. Following prototyping in the `embedding-mini-project`, we have elected to proceed with a **Rust In-Memory Backend**. 

**Primary Goals:**
1.  **Future-Proof Architecture:** Design the system so the underlying "In-Memory" search can be swapped out for a managed database (e.g., Qdrant, Pinecone, or pgvector) with zero changes to the HTTP API or core business logic.
2.  **Accommodate Icon Refactor:** Support the ongoing codebase refactor where icons are indexed by a top-level `icon_id` rather than a visual description. The vector service will act purely as an `Embedding -> icon_id` retrieval engine.
3.  **Stateless & Scalable Deployment:** The service must be capable of spinning up from scratch, pulling the latest index, and serving requests instantly via Google Cloud Run.
4.  **Automated CI/CD:** Integrate smoothly with GitHub Actions for testing and deployment.

---

## 2. System Architecture & "Future-Proof" Design

To prevent locking ourselves into the in-memory approach, we will use a **Ports and Adapters (Hexagonal)** architecture within the Rust service.

### 2.1 Core Trait Abstraction
We will define a Rust `trait` representing the vector database operations. The HTTP layer (`axum`) will only interact with this trait.

```rust
#[async_trait]
pub trait VectorStore: Send + Sync {
    /// Search for the closest icons to a given dense vector
    async fn search(&self, query_vector: &[f32], limit: usize) -> Result<Vec<SearchResult>, StoreError>;
    
    /// Insert or update an icon vector
    async fn upsert(&self, icon_id: &str, vector: Vec<f32>) -> Result<(), StoreError>;
    
    /// Delete an icon vector
    async fn delete(&self, icon_id: &str) -> Result<(), StoreError>;
    
    /// Bulk load the initial dataset
    async fn load_initial_data(&self, data: Vec<IconRecord>) -> Result<(), StoreError>;
}

pub struct SearchResult {
    pub icon_id: String,
    pub score: f32,
}
```

### 2.2 Implementations
1.  **`InMemoryStore` (Initial implementation):** Implements `VectorStore` using a `RwLock<Vec<IconRecord>>` and performs brute-force (or SIMD-optimized) cosine similarity. It is blazing fast for < 100,000 records.
2.  **`MockStore` (For testing):** Implements `VectorStore` to return deterministic search results for HTTP integration tests without needing to load ONNX models.
3.  **`QdrantStore` / `PineconeStore` (Future):** If the dataset outgrows memory, we simply write a new struct that implements `VectorStore` and makes gRPC/HTTP calls to the managed DB, swapping it in `main.rs` via Dependency Injection.

---

## 3. Handling the Icon `icon_id` Refactor

Currently, the main codebase is refactoring icons to be referenced by a top-level `icon_id`. The vector search service will strictly respect this boundary:
*   **It does NOT store the image URLs or visual descriptions.**
*   It only stores: `icon_id: String` and `embedding: Vec<f32>`.
*   **Query Flow:** 
    1. User types "Peanut Butter".
    2. Next.js backend requests `/search?q=Peanut+Butter` from the Rust Service.
    3. Rust Service embeds the query and runs cosine similarity.
    4. Rust Service returns `[{ icon_id: "pb_123", score: 0.95 }, ...]`.
    5. Next.js backend takes those `icon_id`s, hydrates the actual icon URLs/metadata from Firestore, and returns them to the frontend.

---

## 4. Index Updating Strategy (Firebase Integration)

Since the Rust service is in-memory, it will lose its data when the container shuts down. We need a robust sync mechanism.

### 4.1 Startup Sync (Cold Start)
When the Rust container boots, it will hit a known Google Cloud Storage bucket (or query Firestore directly) to download a pre-computed JSON/Binary dump of all `icon_id`s and their vectors. It parses this dump into memory before opening the HTTP port to accept traffic.

### 4.2 Real-time Sync (Webhooks)
When an admin adds or edits an icon's metadata in the main RecipeLanes application:
1.  A **Firebase Cloud Function** (Firestore `onWrite` trigger) fires.
2.  The Firebase function calls the Rust service's `/api/upsert` endpoint.
3.  The Rust service embeds the new description string using `fastembed` and updates its `InMemoryStore` instantly.
4.  *(Optional)* A nightly GitHub Action dumps the current Firestore state to the Cloud Storage bucket to keep the "Cold Start" file up to date.

---

## 5. Deployment Plan

The service will be containerized and deployed to **Google Cloud Run**, keeping it within the same GCP network as Firebase to ensure ultra-low latency and free egress.

### 5.1 Dockerfile Structure
*   **Base:** Rust slim image.
*   **Build Step:** Compiles the `axum` web server. Downloads the `Xenova/all-MiniLM-L6-v2` ONNX weights and bakes them directly into the Docker image so the container does not need to download them at runtime.
*   **Runtime:** Exposes port 8080.

### 5.2 GitHub Actions Integration
We will add a new workflow: `.github/workflows/rust-vector-search.yml`

*   **Trigger:** Push to `main` modifying files in the `rust-vector-search/` directory.
*   **CI Steps:**
    1. `cargo fmt --check`
    2. `cargo clippy -- -D warnings`
    3. `cargo test`
*   **CD Steps:**
    1. Authenticate with Google Cloud (via Workload Identity Federation).
    2. Build Docker Image.
    3. Push to Google Artifact Registry.
    4. Execute `gcloud run deploy recipe-lanes-vector-search --image ...`

---

## 6. Implementation Specifics

*   **Frameworks:** `axum` (Web HTTP), `tokio` (Async runtime).
*   **Embedding Model:** `fastembed-rs` (Using `all-MiniLM-L6-v2` with `try_new_from_user_defined` to load baked-in weights).
*   **Math:** Raw iterations are sufficient for <10k records, but `ndarray` will be imported for optimized matrix multiplication if needed.
*   **Security:** 
    *   `/search` is accessible internally via GCP VPC (or secured via API Key if public).
    *   `/upsert` and `/delete` are secured via a rigid `ADMIN_API_KEY` validated in an Axum middleware layer.

---

## 7. Testing Strategy

1.  **VectorStore Unit Tests:**
    *   Insert 3 known vectors. Query a vector exactly matching one. Ensure the correct `icon_id` is returned with a score of `1.0`.
2.  **Axum Route Integration Tests:**
    *   Inject `MockStore` into the Axum router.
    *   Use `axum::test_helpers` to execute HTTP `POST /search` and assert JSON responses without hitting the network or spinning up a real server.
3.  **ONNX Model Loading Test:**
    *   Write a sanity-check unit test that asserts `TextEmbedding::try_new_from_user_defined` does not panic, ensuring the weights exist in the expected directory structure.