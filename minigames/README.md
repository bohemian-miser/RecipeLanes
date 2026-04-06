# Embedding Search Minigame

A small Next.js playground for testing embedding search latency and relevance across different providers and models.

## Features
- **Timing metrics**: Measures both Embedding Latency and Firestore Search Latency.
- **Vertex AI Embeddings**: `text-embedding-004` across different GCP regions (`us-central1`, `europe-west4`, etc.).
- **Local Browser Embeddings**: Uses `Xenova/all-MiniLM-L6-v2` via HuggingFace's `Transformers.js` right in the browser. 

## Setup

1. Make sure you have your staging service account key. The app expects `staging-service-account.json` to be at the root of the `minigames` directory.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the development server:
   ```bash
   npm run dev
   ```
4. Open [http://localhost:3000](http://localhost:3000)

## Scripts

- `scripts/migrate-embeddings.mjs`: Node script to embed all current icons in `icon_index` using the local browser model `all-MiniLM-L6-v2` (dimension 384) and save them to a new staging collection `icon_index_browser`.
- `scripts/create-index.ts`: Creates the necessary Firestore Vector Index for `icon_index_browser` (since it requires a 384-dimensional index instead of the 768-dimensional one used by Vertex).
- `scripts/test-vertex.ts`: Simple CLI test to measure cold start vs warm start for the Vertex embedding.
