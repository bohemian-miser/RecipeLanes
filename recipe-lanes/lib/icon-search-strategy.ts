export interface FastMatch {
  icon_id: string;
  score: number;
}

export interface SearchResponse {
  embedding: number[];
  fast_matches: FastMatch[];
  snapshot_timestamp: number;
}

export interface IconSearchStrategy {
  getFastPass(query: string, limit: number): Promise<SearchResponse>;
}

// 1. Rust Cloud Run Strategy
export class RustCloudRunStrategy implements IconSearchStrategy {
  private endpoint: string;

  constructor(endpoint: string = 'http://127.0.0.1:8080') {
    this.endpoint = endpoint;
  }

  async getFastPass(query: string, limit: number): Promise<SearchResponse> {
    const res = await fetch(\`\${this.endpoint}/search\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit })
    });
    
    if (!res.ok) throw new Error(\`Rust backend failed: \${await res.text()}\`);
    
    return await res.json();
  }
}

// 2. Legacy Vertex AI Strategy (Fallback)
export class LegacyVertexStrategy implements IconSearchStrategy {
  async getFastPass(query: string, limit: number): Promise<SearchResponse> {
    // We hit the server action to get the embedding, but return empty fast_matches
    // so the client immediately falls back to the "slow" live Firestore query.
    const res = await fetch('/api/embed-legacy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    
    if (!res.ok) throw new Error(\`Legacy embed failed: \${await res.text()}\`);
    const { embedding } = await res.json();
    
    return {
      embedding,
      fast_matches: [], // Force full reliance on slow pass
      snapshot_timestamp: Date.now(),
    };
  }
}

// 3. Browser Local Strategy
export class BrowserLocalStrategy implements IconSearchStrategy {
  async getFastPass(query: string, limit: number): Promise<SearchResponse> {
    // Stub for now. We can migrate the WebWorker from the mini-project later
    // if we actually decide to ship the 90MB ONNX model to mobile users.
    throw new Error("BrowserLocalStrategy not fully implemented in main app yet.");
  }
}

// Factory to resolve the active strategy based on Firebase Config or Environment variables
export function getActiveSearchStrategy(): IconSearchStrategy {
  // In a real production setting, you'd fetch this from Firebase Remote Config.
  // For now, we use env vars to seamlessly switch between implementations.
  const mode = process.env.NEXT_PUBLIC_ICON_SEARCH_MODE || 'rust';
  
  switch (mode) {
    case 'rust':
      return new RustCloudRunStrategy(process.env.NEXT_PUBLIC_RUST_VECTOR_URL);
    case 'browser':
      return new BrowserLocalStrategy();
    case 'legacy':
    default:
      return new LegacyVertexStrategy();
  }
}
