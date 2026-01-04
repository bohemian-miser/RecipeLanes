'use client';

import { useEffect, useState } from 'react';
import { getPagedIconsAction, deleteIconByUrlAction } from '@/app/actions';
import { Search, ChevronLeft, ChevronRight, Loader2, Trash2, Sparkles } from 'lucide-react';
import { db } from '@/lib/firebase-client';
import { collectionGroup, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';

export function SharedGallery() {
  const [icons, setIcons] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [newArrivalIds, setNewArrivalIds] = useState<Set<string>>(new Set());
  const limitCount = 20;

  useEffect(() => {
    const fetchIcons = async () => {
      setLoading(true);
      try {
        const res = await getPagedIconsAction(page, limitCount, search);
        setIcons(res.icons);
        setTotal(res.total);
      } catch (err) {
        console.error('Failed to fetch gallery:', err);
      } finally {
        setLoading(false);
      }
    };

    const timer = setTimeout(() => {
        fetchIcons();
    }, 300); // Debounce search

    return () => clearTimeout(timer);
  }, [page, search]);

  // Real-time listener for new arrivals
  useEffect(() => {
    if (!db || Object.keys(db).length === 0 || search || page > 1) return;

    const q = query(
      collectionGroup(db, 'icons'),
      where('marked_for_deletion', '==', false),
      orderBy('created_at', 'desc'),
      limit(5)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const data = change.doc.data();
          const newIcon = { 
            id: change.doc.id, 
            ...data,
            created_at: data.created_at?.toDate?.()?.toISOString() || data.created_at || null,
          } as any;
          
          setIcons(prev => {
            const exists = prev.some(i => i.id === newIcon.id || i.url === newIcon.url);
            if (exists) return prev;
            
            // Mark as new arrival for visual flair
            setNewArrivalIds(ids => new Set(ids).add(newIcon.id));
            return [newIcon, ...prev].slice(0, 50);
          });
        }
      });
    });

    return () => unsubscribe();
  }, [search, page]);

  const handleDelete = async (url: string, ingredient: string) => {
    //   if (!confirm('Are you sure you want to delete this icon?')) return;
      try {
          const res = await deleteIconByUrlAction(url, ingredient);
          if (res.success) {
              setIcons(prev => prev.filter(i => i.url !== url));
              setTotal(t => t - 1);
          } else {
              alert('Delete failed: ' + res.error);
          }
      } catch (e) {
          alert('Delete failed');
      }
  };

  const totalPages = Math.ceil(total / limitCount);

  return (
    <div className="w-full space-y-6 pt-8 border-t border-zinc-800" data-testid="shared-gallery">
      <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <h2 className="text-xl text-yellow-500 font-mono uppercase tracking-widest text-center">Community Collection</h2>
          
          <div className="relative w-full md:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input 
                  type="text"
                  placeholder="Search ingredients..."
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-full py-1.5 pl-9 pr-4 text-sm text-zinc-300 focus:outline-none focus:border-yellow-500/50"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
          </div>
      </div>
      
      {loading ? (
          <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 text-zinc-600 animate-spin" />
          </div>
      ) : icons.length === 0 ? (
          <div className="text-center text-zinc-600 py-12 text-sm">No icons found.</div>
      ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4">
              {icons.map((icon) => (
                <div key={icon.id} className="relative aspect-square bg-zinc-800 border-2 border-zinc-700 shadow-md group overflow-hidden rounded-lg">
                   <div className="absolute top-1 right-1 z-10 bg-black/60 px-1.5 py-0.5 text-[8px] font-mono text-green-400 pointer-events-none rounded backdrop-blur-sm">
                      {Number(icon.popularity_score || 0).toFixed(1)}
                   </div>
                   <div className="absolute top-1 left-1 z-10 bg-black/60 px-1.5 py-0.5 text-[8px] font-mono text-zinc-400 pointer-events-none rounded backdrop-blur-sm">
                      {icon.impressions || 0} / {icon.rejections || 0}
                   </div>
                   
                   {newArrivalIds.has(icon.id) && (
                      <div className="absolute top-1 left-1/2 -translate-x-1/2 z-10 bg-yellow-500/90 px-2 py-0.5 text-[8px] font-bold text-black pointer-events-none rounded-full shadow-[0_0_10px_rgba(234,179,8,0.5)] flex items-center gap-1 animate-pulse">
                          <Sparkles className="w-2 h-2" />
                          NEW
                      </div>
                   )}
                   
                   <button 
                       onClick={(e) => { e.stopPropagation(); handleDelete(icon.url, icon.ingredient_name); }}
                       className="absolute top-7 right-1 z-20 p-1 bg-red-900/80 hover:bg-red-600 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity"
                       title="Delete Icon"
                   >
                       <Trash2 className="w-3 h-3" />
                   </button>

                   <div className="absolute bottom-0 left-0 right-0 z-10 bg-black/70 p-1 text-[9px] text-zinc-300 text-center truncate backdrop-blur-sm translate-y-full group-hover:translate-y-0 transition-transform">
                       {icon.ingredient_name || icon.ingredient}
                   </div>
                   <img 
                     src={icon.url} 
                     alt={icon.ingredient_name}
                     title={icon.visualDescription || icon.ingredient_name}
                     className="w-full h-full object-contain rendering-pixelated transition-transform group-hover:scale-110"
                     style={{ imageRendering: 'pixelated' }}
                   />
                </div>
              ))}
          </div>
      )}

      {totalPages > 1 && (
          <div className="flex justify-center items-center gap-4 mt-6">
              <button 
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1 || loading}
                  className="p-2 rounded-full bg-zinc-800 text-zinc-400 hover:text-white disabled:opacity-50 disabled:hover:text-zinc-400 transition-colors"
              >
                  <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs text-zinc-500 font-mono">
                  Page {page} of {totalPages}
              </span>
              <button 
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages || loading}
                  className="p-2 rounded-full bg-zinc-800 text-zinc-400 hover:text-white disabled:opacity-50 disabled:hover:text-zinc-400 transition-colors"
              >
                  <ChevronRight className="w-4 h-4" />
              </button>
          </div>
      )}
    </div>
  );
}
