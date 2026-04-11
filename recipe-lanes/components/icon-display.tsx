/*
 * Copyright (C) 2026 Bohemian Miser <https://substack.com/@bohemianmiser>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/* eslint-disable @next/next/no-img-element */
import React, { useState, useMemo } from 'react';
import { RefreshCw, ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { RecipeNode } from '@/lib/recipe-lanes/types';
import { getNodeIconUrl, getNodeIconId, getNodeIconMetadata, getNodeIconStatus, getNodeIngredientName } from '@/lib/recipe-lanes/model-utils';
import { standardizeIngredientName } from '@/lib/utils';

interface IconDisplayProps {
  nodes: RecipeNode[];
  onReroll: (node: RecipeNode) => void;
  onDelete: (nodeId: string, ingredientName: string) => void;
  rerollingIds: Set<string>;
  error: string | null;
  highlightedIconId: string | null;
  onIconClick?: (node: RecipeNode) => void;
}

export function IconDisplay({ nodes, onReroll, onDelete, rerollingIds, error, highlightedIconId, onIconClick }: IconDisplayProps) {
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  // Group nodes by ingredient
  const groupedNodes = useMemo(() => {
    const groups: Record<string, RecipeNode[]> = {};
    nodes.forEach(node => {
      const ingredient = standardizeIngredientName(getNodeIngredientName(node));
      if (!groups[ingredient]) {
        groups[ingredient] = [];
      }
      groups[ingredient].push(node);
    });
    return groups;
  }, [nodes]);

  const categories = useMemo(() => Object.keys(groupedNodes).sort(), [groupedNodes]);

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
    <div className="flex w-full flex-col items-center space-y-6" data-testid="inventory-display">
      {error && (
        <div className="w-full bg-red-900/50 p-4 text-xs text-red-300 border-2 border-red-700 font-mono">
          [ERROR]: {error}
        </div>
      )}

      <div className="w-full space-y-4">
        {nodes.length === 0 && (
          <div className="w-full flex h-64 items-center justify-center border-4 border-dashed border-zinc-800 bg-zinc-900/50">
            <p className="p-4 text-center text-zinc-600 text-xs uppercase tracking-widest">Inventory Empty</p>
          </div>
        )}

        {categories.map((category) => {
           const isCollapsed = collapsedCategories.has(category);
           const categoryNodes = groupedNodes[category];
           
           return (
             <div key={category} className="border-2 border-zinc-800 bg-zinc-900/30">
               <button 
                 onClick={() => toggleCategory(category)}
                 className="w-full flex items-center justify-between p-3 bg-zinc-800/50 hover:bg-zinc-800 transition-colors text-left"
               >
                 <div className="flex items-center gap-2">
                   {isCollapsed ? <ChevronRight className="h-4 w-4 text-zinc-500" /> : <ChevronDown className="h-4 w-4 text-zinc-500" />}
                   <span className="text-sm font-bold text-zinc-300 uppercase tracking-wider">{category}</span>
                   <span className="text-xs text-zinc-500 bg-zinc-900 px-1.5 py-0.5 rounded-full">{categoryNodes.length}</span>
                 </div>
               </button>

               {!isCollapsed && (
                 <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
                    {categoryNodes.map((node) => {
                      const ingredient = standardizeIngredientName(getNodeIngredientName(node));
                      const iconUrl = getNodeIconUrl(node);
                      const iconId = getNodeIconId(node);
                      const isPending = !iconUrl && !iconId;
                      const isRerolling = rerollingIds.has(node.id);
                      
                      return (
                      <div 
                        key={node.id} 
                        className={`group relative bg-zinc-800 border-4 border-zinc-700 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.5)] transition-all duration-100 
                          ${highlightedIconId === node.id ? 'border-yellow-500 scale-105' : 'hover:-translate-y-1 hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,0.5)]'}
                          ${isPending ? 'opacity-75 pointer-events-none' : ''}
                        `}
                      >
                        <div className="p-3 flex flex-col items-center space-y-3">
                          <div className="relative aspect-square w-full bg-zinc-900 border-2 border-zinc-950 flex items-center justify-center overflow-hidden">
                             
                             {isPending ? (
                               <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900 z-20">
                                 <RefreshCw className="h-6 w-6 text-yellow-500 animate-spin mb-2" />
                                 <span className="text-[8px] text-yellow-500 font-mono animate-pulse uppercase">Forging...</span>
                               </div>
                             ) : (
                               iconUrl && (
                                 onIconClick ? (
                                   <button
                                     type="button"
                                     className="w-full h-full cursor-pointer focus:outline-none"
                                     onClick={(e) => { e.stopPropagation(); onIconClick(node); }}
                                     title="View details"
                                   >
                                     <img
                                       src={iconUrl}
                                       alt={ingredient}
                                       title={getNodeIngredientName(node)}
                                       className={`w-full h-full object-contain rendering-pixelated ${isRerolling ? 'opacity-50 grayscale' : ''}`}
                                       style={{ imageRendering: 'pixelated' }}
                                     />
                                   </button>
                                 ) : (
                                   <img
                                     src={iconUrl}
                                     alt={ingredient}
                                     title={getNodeIngredientName(node)}
                                     className={`w-full h-full object-contain rendering-pixelated ${isRerolling ? 'opacity-50 grayscale' : ''}`}
                                     style={{ imageRendering: 'pixelated' }}
                                   />
                                 )
                               )
                             )}
                          </div>
                          <div className="flex w-full items-center justify-between gap-2">
                            <span className="text-[10px] text-yellow-500 font-bold truncate uppercase flex-1 tracking-tighter" title={ingredient}>
                              {ingredient}
                            </span>
                            <div className="flex items-center gap-1">
                                <button
                                  onClick={(e) => { e.stopPropagation(); onReroll(node); }}
                                  disabled={isRerolling || isPending}
                                  className="p-1 hover:text-white text-zinc-500 transition-colors disabled:opacity-50"
                                  title="Reroll"
                                >
                                  <RefreshCw className={`h-3 w-3 ${isRerolling ? 'animate-spin text-yellow-500' : ''}`} />
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); onDelete(node.id, ingredient); }}
                                  disabled={isPending}
                                  className="p-1 hover:text-red-400 text-zinc-500 transition-colors disabled:opacity-50"
                                  title="Remove from Inventory"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                    })}
                 </div>
               )}
             </div>
           );
        })}
      </div>
    </div>
  );
}