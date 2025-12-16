/* eslint-disable @next/next/no-img-element */
'use client';

import { useEffect, useState, useMemo } from 'react';
import { getAllStorageFilesAction, deleteIconByUrlAction, deleteIngredientCategoryAction } from '@/app/actions';
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';

export function DebugGallery({ refreshKey }: { refreshKey?: number }) {
  const [storageFiles, setStorageFiles] = useState<any[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  useEffect(() => {
    // console.log(`[DebugGallery] Mounting/Refreshing (Key: ${refreshKey})...`);
    setLoading(true);
    
    getAllStorageFilesAction()
      .then((files) => {
        setStorageFiles(files);
        setLoading(false);
      })
      .catch((err) => {
        console.error('[DebugGallery] Storage failed:', err);
        setErrors([`Storage Error: ${err?.message || 'Unknown error'}`]);
        setLoading(false);
      });
  }, [refreshKey]);

  // Hide if unauthorized (null) or loading
  if (loading) return null; // Don't show loading pulse for unauthorized users? Or show pulse then hide?
  // User said "don't show". If we show pulse then disappear, it's ok.
  // But if we want to be clean, maybe keep loading?
  // Let's hide completely if null.
  if (storageFiles === null) return null;

  const handleDeleteIcon = async (url: string, name: string, ingredientName: string) => {
      if (!confirm(`Delete icon ${name}?`)) return;
      setDeleting(url);
      try {
          const result = await deleteIconByUrlAction(url, ingredientName);
          if (result && !result.success) throw new Error(result.error);
          setStorageFiles(prev => prev ? prev.filter(f => f.publicUrl !== url) : null);
      } catch (err: any) {
          setErrors(prev => [...prev, `Delete Error: ${err.message}`]);
      } finally {
          setDeleting(null);
      }
  };

  const handleDeleteCategory = async (category: string) => {
      if (!confirm(`Delete ENTIRE category "${category}" and ALL its icons? This cannot be undone.`)) return;
      setDeleting(`cat:${category}`);
      try {
          const result = await deleteIngredientCategoryAction(category);
          if (result && !result.success) throw new Error(result.error);
          // Filter out all files that match this category logic
          setStorageFiles(prev => prev ? prev.filter(f => {
              const basename = f.name.split('/').pop() || '';
              const nameWithoutExt = basename.replace('.png', '');
              const parts = nameWithoutExt.split('-');
              if (parts.length > 1 && !isNaN(Number(parts[parts.length - 1]))) parts.pop();
              const fileCategory = parts.join(' ') || 'Uncategorized';
              return fileCategory !== category;
          }) : null);
      } catch (err: any) {
          setErrors(prev => [...prev, `Delete Category Error: ${err.message}`]);
      } finally {
          setDeleting(null);
      }
  };

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
                 <div className="flex items-center justify-between p-3 bg-zinc-800/50">
                     <button 
                       onClick={() => toggleStorageCategory(category)}
                       className="flex-1 flex items-center gap-2 hover:text-zinc-300 transition-colors text-left"
                     >
                       {isCollapsed ? <ChevronRight className="h-4 w-4 text-zinc-500" /> : <ChevronDown className="h-4 w-4 text-zinc-500" />}
                       <span className="text-sm font-bold text-zinc-300 uppercase tracking-wider">{category}</span>
                       <span className="text-xs text-zinc-500 bg-zinc-900 px-1.5 py-0.5 rounded-full">{categoryFiles.length}</span>
                     </button>
                     <button
                        onClick={() => handleDeleteCategory(category)}
                        disabled={deleting === `cat:${category}`}
                        className="p-1 hover:bg-red-900/50 rounded text-zinc-500 hover:text-red-400 transition-colors"
                        title="Delete Category"
                     >
                        <Trash2 className="h-4 w-4" />
                     </button>
                 </div>

                 {!isCollapsed && (
                   <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
                      {categoryFiles.map((file) => (
                        <div key={file.name} className="flex flex-col gap-2 p-2 bg-zinc-900/50 border border-zinc-800 overflow-hidden text-xs relative group">
                          <div className="relative aspect-square w-full bg-zinc-950 border border-zinc-700 flex items-center justify-center">
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
                             
                             <button
                                onClick={() => handleDeleteIcon(file.publicUrl, file.name, category)}
                                disabled={deleting === file.publicUrl}
                                className="absolute top-1 right-1 p-1.5 bg-zinc-900/80 hover:bg-red-900 border border-zinc-700 hover:border-red-500 text-zinc-400 hover:text-red-200 z-20 opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Delete Icon"
                             >
                                <Trash2 className="h-3 w-3" />
                             </button>
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
