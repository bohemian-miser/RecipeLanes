/* eslint-disable @next/next/no-img-element */
'use client';

import { useEffect, useState, useMemo } from 'react';
import { getAllStorageFilesAction } from '@/app/actions';
import { ChevronDown, ChevronRight } from 'lucide-react';

export function DebugGallery({ refreshKey }: { refreshKey?: number }) {
  const [storageFiles, setStorageFiles] = useState<any[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  useEffect(() => {
    console.log(`[DebugGallery] Mounting/Refreshing (Key: ${refreshKey})...`);
    setLoading(true);
    
    getAllStorageFilesAction()
      .then((files) => {
        console.log('[DebugGallery] Storage data:', files);
        setStorageFiles(files);
        setLoading(false);
      })
      .catch((err) => {
        console.error('[DebugGallery] Storage failed:', err);
        setErrors([`Storage Error: ${err?.message || 'Unknown error'}`]);
        setLoading(false);
      });
  }, [refreshKey]);

  const groupedStorageFiles = useMemo(() => {
    const groups: Record<string, any[]> = {};
    storageFiles.forEach(file => {
      // Parse filename: icons/Ingredient-Name-12345.png
      const basename = file.name.split('/').pop() || '';
      const nameWithoutExt = basename.replace('.png', '');
      const parts = nameWithoutExt.split('-');
      // Remove timestamp (last part)
      if (parts.length > 1 && !isNaN(Number(parts[parts.length - 1]))) {
          parts.pop();
      }
      // Reassemble ingredient name (approximate)
      const category = parts.join(' ') || 'Uncategorized';
      
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(file);
    });
    return groups;
  }, [storageFiles]);

  const storageCategories = useMemo(() => Object.keys(groupedStorageFiles).sort(), [groupedStorageFiles]);

  const toggleStorageCategory = (category: string) => {
    const key = `storage:${category}`;
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (loading) return <div className="p-4 text-zinc-500 font-mono text-xs animate-pulse">Loading Debug Gallery...</div>;

  return (
    <div className="w-full mt-12 border-t-2 border-zinc-800 pt-8 space-y-8">
      {errors.length > 0 && (
        <div className="bg-red-900/20 border border-red-800 p-4 text-red-400 font-mono text-xs">
          <h3 className="font-bold mb-2">Debug Errors:</h3>
          <ul className="list-disc pl-4 space-y-1">
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      <div>
        <h2 className="text-xl text-zinc-500 font-mono mb-4 uppercase tracking-widest">Storage Files (GCS) ({storageFiles.length})</h2>
        <div className="space-y-4">
          {storageCategories.map((category) => {
             const key = `storage:${category}`;
             const isCollapsed = collapsedCategories.has(key);
             const categoryFiles = groupedStorageFiles[category];
             
             return (
               <div key={key} className="border-2 border-zinc-800 bg-zinc-900/30">
                 <button 
                   onClick={() => toggleStorageCategory(category)}
                   className="w-full flex items-center justify-between p-3 bg-zinc-800/50 hover:bg-zinc-800 transition-colors text-left"
                 >
                   <div className="flex items-center gap-2">
                     {isCollapsed ? <ChevronRight className="h-4 w-4 text-zinc-500" /> : <ChevronDown className="h-4 w-4 text-zinc-500" />}
                     <span className="text-sm font-bold text-zinc-300 uppercase tracking-wider">{category}</span>
                     <span className="text-xs text-zinc-500 bg-zinc-900 px-1.5 py-0.5 rounded-full">{categoryFiles.length}</span>
                   </div>
                 </button>

                 {!isCollapsed && (
                   <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
                      {categoryFiles.map((file) => (
                        <div key={file.name} className="flex flex-col gap-2 p-2 bg-zinc-900/50 border border-zinc-800 overflow-hidden text-xs">
                          <div className="relative aspect-square w-full bg-zinc-950 border border-zinc-700 flex items-center justify-center relative group">
                             <img 
                               src={file.publicUrl} 
                               alt="debug-file" 
                               className="w-full h-full object-contain z-10 relative" 
                               style={{ imageRendering: 'pixelated' }}
                               onError={(e) => {
                                   e.currentTarget.style.display = 'none';
                               }}
                             />
                             <div className="absolute inset-0 flex items-center justify-center text-[8px] text-zinc-600 z-0">IMG FAIL</div>
                          </div>
                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="text-blue-400 font-bold truncate">{file.name.split('/').pop()}</div>
                            <div className="text-zinc-400">Score: <span className="text-green-400 font-bold">{Number(file.popularityScore).toFixed(3) || 'N/A'}</span></div>
                            <div className="text-[10px] text-zinc-500 break-all font-mono select-all cursor-pointer hover:text-zinc-300" onClick={() => window.open(file.publicUrl, '_blank')}>
                                Imp: {file.impressions} | Rej: {file.rejections}
                            </div>
                          </div>
                        </div>
                      ))}
                   </div>
                 )}
               </div>
             );
          })}
           {storageFiles.length === 0 && (
              <div className="p-4 text-zinc-600 italic">No files found in bucket 'icons/' prefix.</div>
          )}
        </div>
      </div>
    </div>
  );
}
