'use client';

import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase-client';
import { collection, onSnapshot, query, where, orderBy, limit } from 'firebase/firestore';
import { Loader2, XCircle, Clock } from 'lucide-react';

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

  useEffect(() => {
    // Check if db is initialized (it might be an empty object during build)
    if (!db || Object.keys(db).length === 0) return;

    try {
      // Listen for non-completed items
      const q = query(
        collection(db, 'icon_queue'),
        where('status', 'in', ['pending', 'processing', 'failed']),
        orderBy('created_at', 'desc'),
        limit(10)
      );

      const unsubscribe = onSnapshot(q, (snapshot) => {
        const newItems = snapshot.docs.map(doc => ({
          id: doc.id,
          ingredientName: doc.id,
          ...doc.data()
        })) as QueueItem[];
        setItems(newItems);
      }, (err) => {
        console.warn('QueueMonitor listener failed:', err);
      });

      return () => unsubscribe();
    } catch (e) {
      console.warn('QueueMonitor setup failed:', e);
    }
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="w-full max-w-2xl mx-auto bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="bg-zinc-900 px-4 py-2 border-b border-zinc-800 flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400 flex items-center gap-2">
          <Clock className="w-3 h-3" />
          Background Forge Queue
        </h3>
        <span className="text-[10px] font-mono text-zinc-600 bg-zinc-800 px-1.5 rounded">
          {items.length} ACTIVE
        </span>
      </div>
      <div className="divide-y divide-zinc-900 max-h-48 overflow-y-auto">
        {items.map((item) => (
          <div key={item.id} className="px-4 py-2 flex items-center justify-between hover:bg-zinc-900/50 transition-colors">
            <div className="flex flex-col">
              <span className="text-sm font-medium text-zinc-200 truncate max-w-[200px]">
                {item.ingredientName}
              </span>
              <span className="text-[10px] text-zinc-500 font-mono">
                {item.recipes?.length || 0} recipes waiting
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
                <div className="flex items-center gap-2 text-red-500" title={item.error}>
                  <XCircle className="w-3 h-3" />
                  <span className="text-[10px] font-bold uppercase">Failed</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
