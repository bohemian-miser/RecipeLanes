/* eslint-disable @next/next/no-img-element */
import React, { useState, useMemo } from 'react';
import { RefreshCw, ChevronDown, ChevronRight, Trash2 } from "lucide-react";

export interface Icon {
  id: string;
  ingredient: string;
  iconUrl: string;
  popularityScore?: number;
}

interface IconDisplayProps {
  icons: Icon[];
  onReroll: (icon: Icon) => void;
  onDelete: (iconId: string, ingredientName: string) => void;
  isLoading: boolean;
  error: string | null;
  highlightedIconId: string | null;
}

export function IconDisplay({ icons, onReroll, onDelete, isLoading, error, highlightedIconId }: IconDisplayProps) {
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  // Group icons by ingredient
  const groupedIcons = useMemo(() => {
    const groups: Record<string, Icon[]> = {};
    icons.forEach(icon => {
      if (!groups[icon.ingredient]) {
        groups[icon.ingredient] = [];
      }
      groups[icon.ingredient].push(icon);
    });
    return groups;
  }, [icons]);

  const categories = useMemo(() => Object.keys(groupedIcons).sort(), [groupedIcons]);

  const toggleCategory = (category: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  return (
    <div className="flex w-full flex-col items-center space-y-6">
      {error && (
        <div className="w-full bg-red-900/50 p-4 text-xs text-red-300 border-2 border-red-700 font-mono">
          [ERROR]: {error}
        </div>
      )}

      <div className="w-full space-y-4">
        {icons.length === 0 && !isLoading && (
          <div className="w-full flex h-64 items-center justify-center border-4 border-dashed border-zinc-800 bg-zinc-900/50">
            <p className="p-4 text-center text-zinc-600 text-xs uppercase tracking-widest">Inventory Empty</p>
          </div>
        )}

        {categories.map((category) => {
           const isCollapsed = collapsedCategories.has(category);
           const categoryIcons = groupedIcons[category];
           
           return (
             <div key={category} className="border-2 border-zinc-800 bg-zinc-900/30">
               <button 
                 onClick={() => toggleCategory(category)}
                 className="w-full flex items-center justify-between p-3 bg-zinc-800/50 hover:bg-zinc-800 transition-colors text-left"
               >
                 <div className="flex items-center gap-2">
                   {isCollapsed ? <ChevronRight className="h-4 w-4 text-zinc-500" /> : <ChevronDown className="h-4 w-4 text-zinc-500" />}
                   <span className="text-sm font-bold text-zinc-300 uppercase tracking-wider">{category}</span>
                   <span className="text-xs text-zinc-500 bg-zinc-900 px-1.5 py-0.5 rounded-full">{categoryIcons.length}</span>
                 </div>
               </button>

               {!isCollapsed && (
                 <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
                    {categoryIcons.map((icon) => (
                      <div 
                        key={icon.id} 
                        className={`group relative bg-zinc-800 border-4 border-zinc-700 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.5)] transition-all duration-100 
                          ${highlightedIconId === icon.id ? 'border-yellow-500 scale-105' : 'hover:-translate-y-1 hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,0.5)]'}
                        `}
                      >
                        <div className="p-3 flex flex-col items-center space-y-3">
                          <div className="relative aspect-square w-full bg-zinc-900 border-2 border-zinc-950 flex items-center justify-center overflow-hidden">
                             {icon.popularityScore !== undefined && (
                                <div className="absolute top-1 right-1 z-10 bg-black/50 px-1 py-0.5 text-[8px] font-mono text-green-400 pointer-events-none">
                                  {icon.popularityScore.toFixed(1)}
                                </div>
                             )}
                             <img 
                               src={icon.iconUrl} 
                               alt={icon.ingredient}
                               className="w-full h-full object-contain rendering-pixelated"
                               style={{ imageRendering: 'pixelated' }}
                             />
                          </div>
                          <div className="flex w-full items-center justify-between gap-2">
                            <span className="text-[10px] text-yellow-500 font-bold truncate uppercase flex-1 tracking-tighter" title={icon.ingredient}>
                              {icon.ingredient}
                            </span>
                            <div className="flex items-center gap-1">
                                <button
                                  onClick={(e) => { e.stopPropagation(); onReroll(icon); }}
                                  disabled={isLoading}
                                  className="p-1 hover:text-white text-zinc-500 transition-colors"
                                  title="Reroll"
                                >
                                  <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); onDelete(icon.id, icon.ingredient); }}
                                  disabled={isLoading}
                                  className="p-1 hover:text-red-400 text-zinc-500 transition-colors"
                                  title="Remove from Inventory"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                 </div>
               )}
             </div>
           );
        })}
        
        {isLoading && (
           <div className="flex h-32 w-full items-center justify-center border-4 border-dashed border-zinc-700 bg-zinc-800 animate-pulse">
             <span className="text-zinc-500 text-[10px] uppercase">Forging...</span>
           </div>
        )}
      </div>
    </div>
  );
}