'use client';

import { useState, useRef, useEffect } from 'react';

type Result = {
  id: string;
  ingredient_name?: string;
  url?: string;
  icon_id?: string;
};

type RunMetrics = {
  methodName: string;
  embedTime: number;
  searchTime: number;
  totalTime: number;
  results: Result[];
  error?: string;
};

export default function Home() {
  const [query, setQuery] = useState('egg');
  const [loading, setLoading] = useState(false);
  const [runs, setRuns] = useState<RunMetrics[]>([]);
  
  const workerRef = useRef<Worker | null>(null);
  const messageIdRef = useRef(0);
  const resolversRef = useRef<Record<number, { resolve: (val: any) => void, reject: (err: any) => void }>>({});

  useEffect(() => {
    // Initialize worker
    workerRef.current = new Worker(new URL('../lib/worker.ts', import.meta.url));
    workerRef.current.onmessage = (e) => {
      const { id, status, vector, error } = e.data;
      if (resolversRef.current[id]) {
        if (status === 'success') resolversRef.current[id].resolve(vector);
        else resolversRef.current[id].reject(new Error(error));
        delete resolversRef.current[id];
      }
    };
    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  const getBrowserEmbedding = (text: string, model: string): Promise<number[]> => {
    return new Promise((resolve, reject) => {
      if (!workerRef.current) return reject(new Error('Worker not initialized'));
      const id = ++messageIdRef.current;
      resolversRef.current[id] = { resolve, reject };
      workerRef.current.postMessage({ id, text, model });
    });
  };

  const handleSearch = async () => {
    setLoading(true);
    setRuns([]);
    
    const methods = [
      { name: 'Vertex 004 (us-central1)', model: 'text-embedding-004', region: 'us-central1', type: 'vertex' },
      { name: 'Vertex 004 (europe-west4)', model: 'text-embedding-004', region: 'europe-west4', type: 'vertex' },
      { name: 'Vertex 004 (asia-northeast1)', model: 'text-embedding-004', region: 'asia-northeast1', type: 'vertex' },
      { name: 'Vertex Multilingual 002 (us-central1)', model: 'text-multilingual-embedding-002', region: 'us-central1', type: 'vertex' },
      { name: 'Browser MiniLM (Local)', model: 'Xenova/all-MiniLM-L6-v2', type: 'browser' },
    ];

    // Execute all concurrently
    const promises = methods.map(async m => {
      try {
        const start = Date.now();
        let vector: number[] = [];
        let embedTime = 0;

        // 1. EMBED
        if (m.type === 'vertex') {
          const embedRes = await fetch('/api/embed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: query, model: m.model, region: m.region })
          });
          if (!embedRes.ok) throw new Error((await embedRes.json()).error);
          const data = await embedRes.json();
          vector = data.vector;
          embedTime = data.timeMs;
        } else if (m.type === 'browser') {
          const embedStart = Date.now();
          vector = await getBrowserEmbedding(query, m.model);
          embedTime = Date.now() - embedStart;
        }

        // 2. SEARCH
        const searchRes = await fetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vector, limit: 12 })
        });
        if (!searchRes.ok) throw new Error((await searchRes.json()).error);
        const { results, timeMs: searchTime } = await searchRes.json();

        const result: RunMetrics = { 
          methodName: m.name, 
          embedTime, 
          searchTime, 
          totalTime: Date.now() - start, 
          results 
        };
        
        // Add to runs incrementally
        setRuns(prev => [...prev, result]);
        
      } catch (e: any) {
        setRuns(prev => [...prev, {
          methodName: m.name,
          embedTime: 0, searchTime: 0, totalTime: 0,
          results: [],
          error: e.message
        }]);
      }
    });

    await Promise.allSettled(promises);
    setLoading(false);
  };

  return (
    <main className="min-h-screen p-8 bg-gray-50 text-gray-900 font-sans">
      <div className="max-w-[1400px] mx-auto space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Embedding Search Minigame</h1>
        
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-end gap-4">
          <div className="flex-1 min-w-[300px]">
            <label className="block text-sm font-medium mb-1">Search Query</label>
            <input 
              type="text" 
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-lg"
              placeholder="e.g., 'egg'"
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <button 
            onClick={handleSearch}
            disabled={loading}
            className="px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium transition-colors h-[52px]"
          >
            {loading ? 'Searching all...' : 'Search'}
          </button>
        </div>

        {runs.length > 0 && (
          <div className="overflow-x-auto bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr>
                  <th className="p-4 border-b-2 font-semibold w-1/4">Method</th>
                  <th className="p-4 border-b-2 font-semibold w-1/5">Latency</th>
                  <th className="p-4 border-b-2 font-semibold">Top 12 Results</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run, i) => (
                  <tr key={i} className="border-b last:border-0 hover:bg-gray-50 align-top">
                    <td className="p-4 font-medium whitespace-nowrap">
                      {run.methodName}
                      {run.error && <div className="text-red-500 text-sm mt-2 max-w-[200px] whitespace-normal break-words">{run.error}</div>}
                    </td>
                    <td className="p-4 text-sm whitespace-nowrap">
                      {run.error ? '-' : (
                        <div className="space-y-1">
                          <div className="text-gray-500 flex justify-between">
                            <span>Embed:</span> 
                            <span className="text-gray-900 font-medium ml-2">{run.embedTime}ms</span>
                          </div>
                          <div className="text-gray-500 flex justify-between">
                            <span>DB Search:</span> 
                            <span className="text-gray-900 font-medium ml-2">{run.searchTime}ms</span>
                          </div>
                          <div className="text-blue-600 font-semibold flex justify-between mt-2 pt-2 border-t border-gray-100">
                            <span>Total RTT:</span>
                            <span className="ml-2">{run.totalTime}ms</span>
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="p-4">
                      {run.results.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {run.results.map((r, j) => (
                            <div key={j} className="flex flex-col items-center gap-1 w-20 group relative">
                              {r.url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={r.url} alt={r.ingredient_name} className="w-16 h-16 object-contain rounded-md bg-gray-50 border border-gray-100" />
                              ) : (
                                <div className="w-16 h-16 bg-gray-100 rounded-md border border-gray-200 flex items-center justify-center text-[10px] text-gray-400">No Img</div>
                              )}
                              <div className="text-[10px] text-center leading-tight line-clamp-2 w-full px-1" title={r.ingredient_name}>
                                {r.ingredient_name || r.id}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
