'use client';

import { useState, useRef } from 'react';
import { pipeline, env } from '@xenova/transformers';

// Skip local model caching to work well in dev
env.allowLocalModels = false;

type Result = {
  id: string;
  ingredient_name?: string;
  url?: string;
  icon_id?: string;
};

export default function Home() {
  const [query, setQuery] = useState('egg');
  const [method, setMethod] = useState('vertex-004');
  const [region, setRegion] = useState('us-central1');
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [metrics, setMetrics] = useState({ embed: 0, search: 0, total: 0 });
  const [error, setError] = useState('');
  
  const browserModelRef = useRef<any>(null);

  const initBrowserModel = async () => {
    if (!browserModelRef.current) {
      console.log('Loading browser embedding model...');
      browserModelRef.current = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    }
    return browserModelRef.current;
  };

  const handleSearch = async () => {
    setLoading(true);
    setError('');
    setResults([]);
    setMetrics({ embed: 0, search: 0, total: 0 });
    const startTotal = Date.now();
    
    try {
      let vector: number[] = [];
      let embedTime = 0;
      
      // 1. EMBEDDING
      if (method.startsWith('vertex')) {
        const model = method === 'vertex-004' ? 'text-embedding-004' : 'text-embedding-gecko@003';
        const res = await fetch('/api/embed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: query, model, region })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        vector = data.vector;
        embedTime = data.timeMs;
      } else if (method === 'browser') {
        const startEmbed = Date.now();
        const extractor = await initBrowserModel();
        const out = await extractor(query, { pooling: 'mean', normalize: true });
        vector = Array.from(out.data);
        embedTime = Date.now() - startEmbed;
      }
      
      // 2. SEARCH
      const searchRes = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vector, limit: 12 })
      });
      const searchData = await searchRes.json();
      if (!searchRes.ok) throw new Error(searchData.error);
      
      setResults(searchData.results);
      setMetrics({
        embed: embedTime,
        search: searchData.timeMs,
        total: Date.now() - startTotal
      });
      
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen p-8 bg-gray-50 text-gray-900 font-sans">
      <div className="max-w-4xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Embedding Search Minigame</h1>
        
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 space-y-4">
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-medium mb-1">Search Query</label>
              <input 
                type="text" 
                value={query}
                onChange={e => setQuery(e.target.value)}
                className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="e.g., 'egg'"
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
              />
            </div>
            
            <div className="w-48">
              <label className="block text-sm font-medium mb-1">Method</label>
              <select 
                value={method} 
                onChange={e => setMethod(e.target.value)}
                className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
              >
                <option value="vertex-004">Vertex (text-embedding-004)</option>
                <option value="browser">Browser (all-MiniLM-L6-v2)</option>
              </select>
            </div>
            
            <div className="w-40">
              <label className="block text-sm font-medium mb-1">Region (Vertex)</label>
              <select 
                value={region} 
                onChange={e => setRegion(e.target.value)}
                disabled={method === 'browser'}
                className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white disabled:opacity-50"
              >
                <option value="us-central1">us-central1</option>
                <option value="europe-west4">europe-west4</option>
                <option value="asia-northeast1">asia-northeast1</option>
              </select>
            </div>
            
            <div className="flex items-end">
              <button 
                onClick={handleSearch}
                disabled={loading}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium transition-colors h-[42px]"
              >
                {loading ? 'Searching...' : 'Search'}
              </button>
            </div>
          </div>
          
          {error && (
            <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm border border-red-200">
              {error}
            </div>
          )}
          
          <div className="flex gap-6 text-sm text-gray-500 bg-gray-50 p-3 rounded-lg border border-gray-100">
            <div><span className="font-semibold">Embedding:</span> {metrics.embed}ms</div>
            <div><span className="font-semibold">Search:</span> {metrics.search}ms</div>
            <div><span className="font-semibold">Total:</span> {metrics.total}ms</div>
          </div>
        </div>

        {results.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {results.map((r, i) => (
              <div key={r.id || i} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center text-center gap-3">
                {r.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.url} alt={r.ingredient_name} className="w-20 h-20 object-contain rounded-lg" />
                ) : (
                  <div className="w-20 h-20 bg-gray-100 rounded-lg flex items-center justify-center text-gray-400">No Img</div>
                )}
                <div>
                  <div className="font-medium text-sm line-clamp-2">{r.ingredient_name || r.id}</div>
                  <div className="text-xs text-gray-400 mt-1">{r.icon_id || 'no-icon-id'}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
