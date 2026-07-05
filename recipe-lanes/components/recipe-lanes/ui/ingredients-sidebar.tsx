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

import React, { useState, useEffect, useRef } from 'react';
import { RecipeGraph, RecipeNode } from '@/lib/recipe-lanes/types';
import { ChefHat, X, Users } from 'lucide-react';
import { getNodeIconUrl } from '@/lib/recipe-lanes/model-utils';

interface IngredientsSidebarProps {
  graph: RecipeGraph;
  onClose: () => void;
  onUpdateServes: (newServes: number) => void;
  /** Commit an ingredient's edited visual description (undoable store write). */
  onEditVisualDescription?: (nodeId: string, visualDescription: string) => void;
}

export function IngredientsSidebar({ graph, onClose, onUpdateServes, onEditVisualDescription }: IngredientsSidebarProps) {
  const serves = graph.serves || graph.baseServes || 1;
  const baseServes = graph.baseServes || 1;
  const scale = serves / baseServes;

  const handleServesChange = (val: number) => {
      const newServes = Math.max(1, val);
      onUpdateServes(newServes);
  };

  const ingredientNodes = graph.nodes.filter(n => n.type === 'ingredient');

  // Local drafts for the inline visual-description editor. Kept in sync with the
  // graph for fields the user isn't actively editing (e.g. after undo/merge), so
  // an external change is reflected without clobbering in-progress typing.
  const [descDrafts, setDescDrafts] = useState<Record<string, string>>(
    () => Object.fromEntries(ingredientNodes.map(n => [n.id, n.visualDescription ?? ''])),
  );
  const editingIdRef = useRef<string | null>(null);

  useEffect(() => {
    setDescDrafts(prev => {
      const next = { ...prev };
      let changed = false;
      for (const n of ingredientNodes) {
        if (n.id === editingIdRef.current) continue;
        const val = n.visualDescription ?? '';
        if (next[n.id] !== val) { next[n.id] = val; changed = true; }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  const commitDesc = (node: RecipeNode) => {
    const draft = descDrafts[node.id] ?? '';
    if (draft !== (node.visualDescription ?? '')) {
      onEditVisualDescription?.(node.id, draft);
    }
  };

  return (
    <div className="absolute left-0 top-14 bottom-0 w-72 bg-white border-r border-zinc-200 shadow-2xl z-40 flex flex-col animate-in slide-in-from-left duration-200">
        <div className="p-4 border-b border-zinc-100 flex items-center justify-between bg-zinc-50 shrink-0">
            <div className="flex items-center gap-2 text-zinc-700 font-bold">
                <ChefHat className="w-5 h-5" />
                <span className="tracking-wide">INGREDIENTS</span>
            </div>
            <button onClick={onClose} className="p-1 hover:bg-zinc-200 rounded text-zinc-500">
                <X className="w-4 h-4" />
            </button>
        </div>
        
        <div className="p-4 border-b border-zinc-100 flex items-center justify-between bg-white shrink-0">
            <div className="flex items-center gap-2 text-zinc-600 text-sm font-medium">
                <Users className="w-4 h-4" />
                <span>Serves</span>
            </div>
            <div className="flex items-center gap-2">
                <button onClick={() => handleServesChange(serves - 1)} className="w-8 h-8 flex items-center justify-center bg-zinc-100 rounded-full hover:bg-zinc-200 text-zinc-600 font-bold transition-colors">-</button>
                <span className="w-8 text-center font-mono font-bold text-zinc-800 text-lg">{serves}</span>
                <button onClick={() => handleServesChange(serves + 1)} className="w-8 h-8 flex items-center justify-center bg-zinc-100 rounded-full hover:bg-zinc-200 text-zinc-600 font-bold transition-colors">+</button>
            </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {ingredientNodes.map(node => {
                // Determine display quantity
                // Use stored quantity if available, otherwise try to parse text?
                // parser.ts ensures quantity is set if parseable.
                let displayQty: number | string = '';
                
                if (node.quantity) {
                    const scaled = node.quantity * scale;
                    // Format nice decimals
                    displayQty = Math.round(scaled * 100) / 100;
                }

                const iconUrl = getNodeIconUrl(node);

                return (
                    <div key={node.id} className="flex items-start gap-3 group">
                        {iconUrl ? (
                            <img src={iconUrl} className="w-10 h-10 object-contain mix-blend-multiply bg-zinc-50 rounded-lg p-1 border border-zinc-100 shrink-0" alt="" />
                        ) : (
                            <div className="w-10 h-10 flex items-center justify-center bg-zinc-100 rounded-lg text-xl shrink-0">🥕</div>
                        )}
                        <div className="flex-1 pt-0.5">
                             <div className="text-sm text-zinc-800 font-medium leading-tight">
                                 {displayQty && <span className="font-bold text-blue-600 mr-1">{displayQty}</span>}
                                 {node.unit && <span className="text-zinc-500 text-xs uppercase font-bold mr-1">{node.unit}</span>}
                                 <span className="capitalize">{node.canonicalName || node.text}</span>
                             </div>
                             {/* Debug/Fallback if text doesn't match */}
                             {(!node.canonicalName && node.text !== displayQty + ' ' + (node.unit||'') + ' ' + (node.canonicalName||'')) && (
                                 <div className="text-[10px] text-zinc-400 truncate hidden">{node.text}</div>
                             )}
                             {onEditVisualDescription && (
                                 <textarea
                                     className="mt-1.5 w-full bg-zinc-50 border border-zinc-200 rounded px-2 py-1 text-[11px] text-zinc-600 resize-none focus:outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-200 leading-snug"
                                     rows={2}
                                     value={descDrafts[node.id] ?? ''}
                                     onChange={(e) => setDescDrafts(d => ({ ...d, [node.id]: e.target.value }))}
                                     onFocus={() => { editingIdRef.current = node.id; }}
                                     onBlur={() => { editingIdRef.current = null; commitDesc(node); }}
                                     placeholder="Visual description (what the icon shows)…"
                                     aria-label={`Visual description for ${node.canonicalName || node.text}`}
                                 />
                             )}
                        </div>
                    </div>
                );
            })}
        </div>
    </div>
  );
}