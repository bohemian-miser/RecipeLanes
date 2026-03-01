'use client';

import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase-client';
import { collection, onSnapshot, query, where, orderBy, limit, getCountFromServer } from 'firebase/firestore';
import { Loader2, XCircle, Clock, RotateCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { retryIconGenerationAction } from '@/app/actions';
import { DB_COLLECTION_QUEUE } from '@/lib/config';

interface QueueItem {
  id: string;
  ingredientName: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  recipes?: string[];
  error?: string;
  created_at?: any;
}

export function QueueMonitor() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 5;

  useEffect(() => {
    // Check if db is initialized (it might be an empty object during build)
    if (!db || Object.keys(db).length === 0) return;

    try {
      // 1. Fetch Total Count (Async, once)
      const countQuery = query(
        collection(db, DB_COLLECTION_QUEUE),
        where('status', 'in', ['pending', 'processing', 'failed'])
      );
      getCountFromServer(countQuery).then(snap => setTotalCount(snap.data().count)).catch(console.warn);

      // 2. Listen for Active Items (Limited)
      const q = query(
        collection(db, DB_COLLECTION_QUEUE),
        where('status', 'in', ['pending', 'processing', 'failed']),
        orderBy('recipeCount', 'desc'),
        orderBy('created_at', 'asc'),
        limit(500)
      );

      const unsubscribe = onSnapshot(q, (snapshot) => {
        const newItems = snapshot.docs.map(doc => ({
          id: doc.id,
          ingredientName: doc.id,
          ...doc.data()
        })) as QueueItem[];
        
        // Sort by Priority (Recipe Count)
        newItems.sort((a, b) => (b.recipes?.length || 0) - (a.recipes?.length || 0));
        
        setItems(newItems);
        // Update total count if we have all items, otherwise rely on server count
        if (newItems.length < 500) setTotalCount(newItems.length);
      }, (err) => {
        console.warn('QueueMonitor listener failed:', err);
      });

      return () => unsubscribe();
    } catch (e) {
      console.warn('QueueMonitor setup failed:', e);
    }
  }, []);

  const handleRetry = async (ingredientName: string) => {
      try {
          await retryIconGenerationAction(ingredientName);
      } catch (e) {
          console.error('Retry failed', e);
      }
  };

  if (items.length === 0) return null;

  const totalPages = Math.ceil(items.length / PAGE_SIZE);
  const paginatedItems = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="w-full max-w-2xl mx-auto bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="bg-zinc-900 px-4 py-2 border-b border-zinc-800 flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400 flex items-center gap-2">
          <Clock className="w-3 h-3" />
          Forge Backlog
        </h3>
        <span className="text-[10px] font-mono text-zinc-600 bg-zinc-800 px-1.5 rounded">
          {items.length === totalCount ? `${items.length} ACTIVE` : `${items.length} / ${totalCount} ACTIVE`}
        </span>
      </div>
      <div className="divide-y divide-zinc-900">
        {paginatedItems.map((item) => (
          <div 
            key={item.id} 
            className="px-4 py-2 flex items-center justify-between hover:bg-zinc-900/50 transition-colors"
            data-testid="backlog-item"
            data-ingredient={item.ingredientName}
          >
            <div className="flex flex-col">
              <span className="text-sm font-medium text-zinc-200 truncate max-w-[200px]">
                {item.ingredientName}
              </span>
              <span className="text-[10px] text-zinc-500 font-mono">
                {item.recipes?.length || 0} Pending Recipes
              </span>
            </div>
            
            <div className="flex items-center gap-3">
              {item.status === 'processing' && (
                <div className="flex items-center gap-2 text-yellow-500">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span className="text-[10px] font-bold uppercase">Processing</span>
                </div>
              )}
              {item.status === 'pending' && (
                <div className="flex items-center gap-2 text-zinc-500">
                  <Clock className="w-3 h-3" />
                  <span className="text-[10px] font-bold uppercase">Queued</span>
                </div>
              )}
              {item.status === 'failed' && (
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 text-red-500" title={item.error}>
                      <XCircle className="w-3 h-3" />
                      <span className="text-[10px] font-bold uppercase">Failed</span>
                    </div>
                    <button 
                        onClick={() => handleRetry(item.ingredientName)}
                        className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-white transition-colors"
                        title="Retry"
                        aria-label="Retry"
                    >
                        <RotateCw className="w-3 h-3" />
                    </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      
      {totalPages > 1 && (
          <div className="bg-zinc-900/50 px-2 py-1 flex items-center justify-center gap-4 border-t border-zinc-800">
              <button 
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-30 disabled:hover:text-zinc-500"
              >
                  <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-[10px] font-mono text-zinc-500">
                  {page} / {totalPages}
              </span>
              <button 
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="p-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-30 disabled:hover:text-zinc-500"
              >
                  <ChevronRight className="w-4 h-4" />
              </button>
          </div>
      )}
    </div>
  );
}
