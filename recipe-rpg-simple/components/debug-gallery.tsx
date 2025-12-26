/* eslint-disable @next/next/no-img-element */
'use client';

import { useEffect, useState, useMemo } from 'react';
import { getAllStorageFilesAction, deleteIconByUrlAction, deleteIngredientCategoryAction, updateIconMetadataAction } from '@/app/actions';
import { ChevronDown, ChevronRight, Trash2, Edit2, Check, X } from 'lucide-react';

interface FileData {
  publicUrl: string;
  name: string;
  ingredientName?: string;
  visualDescription?: string;
  popularityScore: string;
  impressions: string;
  rejections: string;
}

export function DebugGallery({ refreshKey }: { refreshKey?: number }) {
  const [storageFiles, setStorageFiles] = useState<FileData[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  
  // Editing state
  const [editingUrl, setEditingUrl] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ ingredientName: string, visualDescription: string }>({ ingredientName: '', visualDescription: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
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

  const groupedStorageFiles = useMemo(() => {
    if (!storageFiles) return {};
    const groups: Record<string, FileData[]> = {};
    storageFiles.forEach(file => {
      // Use metadata ingredient name if available, else fallback to filename parsing
      let category = 'Uncategorized';
      if (file.ingredientName) {
          category = file.ingredientName;
      } else {
          const basename = file.name.split('/').pop() || '';
          const nameWithoutExt = basename.replace('.png', '');
          const parts = nameWithoutExt.split('-');
          if (parts.length > 1 && !isNaN(Number(parts[parts.length - 1]))) {
              parts.pop();
          }
          category = parts.join(' ') || 'Uncategorized';
      }
      
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

  const handleStartEdit = (file: FileData) => {
      setEditingUrl(file.publicUrl);
      setEditForm({
          ingredientName: file.ingredientName || '',
          visualDescription: file.visualDescription || ''
      });
  };

  const handleSaveEdit = async () => {
      if (!editingUrl) return;
      setSaving(true);
      try {
          // If ingredient name changed, we might need to update category grouping locally, 
          // but for now just update the file data
          await updateIconMetadataAction(editingUrl, editForm.ingredientName, { 
              ingredientName: editForm.ingredientName,
              visualDescription: editForm.visualDescription
          });
          
          setStorageFiles(prev => prev ? prev.map(f => {
              if (f.publicUrl === editingUrl) {
                  return { ...f, ...editForm };
              }
              return f;
          }) : null);
          setEditingUrl(null);
      } catch (err: any) {
          setErrors(prev => [...prev, `Update Error: ${err.message}`]);
      } finally {
          setSaving(false);
      }
  };

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
          setStorageFiles(prev => prev ? prev.filter(f => {
              // Simplified check: remove if ingredientName matches or fallback grouping logic
              return f.ingredientName !== category; 
          }) : null);
          // Note: This local update is imperfect if category relied on filename parsing, but sufficient for debug UI.
      } catch (err: any) {
          setErrors(prev => [...prev, `Delete Category Error: ${err.message}`]);
      } finally {
          setDeleting(null);
      }
  };

  // Hide if loading
  if (loading) return <div className="p-8 text-center text-zinc-500 font-sans text-sm animate-pulse">Loading Debug Gallery...</div>;
  if (storageFiles === null) return null; // Likely not admin

  return (
    <div className="w-full mt-12 border-t-2 border-zinc-800 pt-8 space-y-8 font-sans">
      {errors.length > 0 && (
        <div className="bg-red-900/20 border border-red-800 p-4 text-red-400 text-xs rounded">
          <h3 className="font-bold mb-2">Debug Errors:</h3>
          <ul className="list-disc pl-4 space-y-1">
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      <div>
        <h2 className="text-xl text-zinc-500 font-bold mb-4 uppercase tracking-widest flex items-center gap-2">
            Storage Files <span className="text-xs bg-zinc-800 px-2 py-1 rounded-full text-zinc-400 normal-case font-normal">{storageFiles.length} items</span>
        </h2>
        
        <div className="space-y-4">
          {storageCategories.map((category) => {
             const key = `storage:${category}`;
             const isCollapsed = collapsedCategories.has(key);
             const categoryFiles = groupedStorageFiles[category];
             
             return (
               <div key={key} className="border border-zinc-800 bg-zinc-900/30 rounded-lg overflow-hidden">
                 <div className="flex items-center justify-between p-3 bg-zinc-800/50 hover:bg-zinc-800 transition-colors">
                     <button 
                       onClick={() => toggleStorageCategory(category)}
                       className="flex-1 flex items-center gap-2 text-left"
                     >
                       {isCollapsed ? <ChevronRight className="h-4 w-4 text-zinc-500" /> : <ChevronDown className="h-4 w-4 text-zinc-500" />}
                       <span className="text-sm font-bold text-zinc-300">{category}</span>
                       <span className="text-xs text-zinc-500 bg-zinc-900 px-2 py-0.5 rounded-full">{categoryFiles.length}</span>
                     </button>
                     <button
                        onClick={() => handleDeleteCategory(category)}
                        disabled={deleting === `cat:${category}`}
                        className="p-1.5 hover:bg-red-900/30 rounded text-zinc-500 hover:text-red-400 transition-colors"
                        title="Delete Category"
                     >
                        <Trash2 className="h-4 w-4" />
                     </button>
                 </div>

                 {!isCollapsed && (
                   <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                      {categoryFiles.map((file) => {
                        const isEditing = editingUrl === file.publicUrl;
                        return (
                        <div key={file.name} className="flex gap-3 p-3 bg-zinc-900 border border-zinc-800 rounded-lg relative group hover:border-zinc-700 transition-colors">
                          {/* Image */}
                          <div className="w-16 h-16 shrink-0 bg-zinc-950 border border-zinc-800 rounded flex items-center justify-center relative overflow-hidden">
                             <img 
                               src={file.publicUrl} 
                               alt="debug-file" 
                               className="w-full h-full object-contain" 
                               style={{ imageRendering: 'pixelated' }}
                             />
                          </div>

                          {/* Info / Edit Form */}
                          <div className="flex-1 min-w-0 flex flex-col gap-1">
                            {isEditing ? (
                                <div className="space-y-2">
                                    <input 
                                        className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 focus:border-blue-500 outline-none"
                                        value={editForm.ingredientName}
                                        onChange={e => setEditForm(prev => ({ ...prev, ingredientName: e.target.value }))}
                                        placeholder="Label"
                                    />
                                    <textarea 
                                        className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[10px] text-zinc-400 focus:border-blue-500 outline-none resize-none h-12 leading-tight"
                                        value={editForm.visualDescription}
                                        onChange={e => setEditForm(prev => ({ ...prev, visualDescription: e.target.value }))}
                                        placeholder="Visual Description"
                                    />
                                    <div className="flex gap-2 justify-end">
                                        <button onClick={() => setEditingUrl(null)} className="p-1 hover:bg-zinc-800 rounded text-zinc-500"><X className="w-3 h-3" /></button>
                                        <button onClick={handleSaveEdit} disabled={saving} className="p-1 bg-blue-900/30 hover:bg-blue-900/50 rounded text-blue-400"><Check className="w-3 h-3" /></button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="font-bold text-xs text-zinc-300 truncate" title={file.ingredientName || file.name}>{file.ingredientName || 'Unknown'}</div>
                                        <button onClick={() => handleStartEdit(file)} className="text-zinc-600 hover:text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity"><Edit2 className="w-3 h-3" /></button>
                                    </div>
                                    <div className="text-[10px] text-zinc-500 line-clamp-2 leading-tight" title={file.visualDescription}>
                                        {file.visualDescription || 'No description'}
                                    </div>
                                    <div className="mt-auto flex items-center justify-between text-[10px] font-mono text-zinc-600">
                                        <span title="Popularity (LCB)">Score: <span className="text-green-600">{Number(file.popularityScore).toFixed(2)}</span></span>
                                        <span title="Impressions / Rejections">{file.impressions}/{file.rejections}</span>
                                    </div>
                                </>
                            )}
                          </div>

                          {/* Delete Action */}
                          {!isEditing && (
                             <button
                                onClick={() => handleDeleteIcon(file.publicUrl, file.name, category)}
                                disabled={deleting === file.publicUrl}
                                className="absolute -top-2 -right-2 p-1.5 bg-zinc-800 hover:bg-red-900/50 border border-zinc-700 hover:border-red-500/50 text-zinc-500 hover:text-red-400 rounded-full opacity-0 group-hover:opacity-100 transition-all shadow-sm z-10"
                                title="Delete Icon"
                             >
                                <Trash2 className="h-3 w-3" />
                             </button>
                          )}
                        </div>
                      );
                      })}
                   </div>
                 )}
               </div>
             );
          })}
           {storageFiles.length === 0 && (
              <div className="p-8 text-center border-2 border-dashed border-zinc-800 rounded-lg text-zinc-600 italic">No files found in bucket 'icons/' prefix.</div>
          )}
        </div>
      </div>
    </div>
  );
}