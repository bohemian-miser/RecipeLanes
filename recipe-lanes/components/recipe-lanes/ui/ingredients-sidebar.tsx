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
import React, { useState, useEffect, useRef } from 'react';
import { RecipeGraph, RecipeNode } from '@/lib/recipe-lanes/types';
import { ChefHat, X, Users, RefreshCw, Hammer } from 'lucide-react';
import { getNodeIconUrl, getNodeShortlistLength, buildIngredientText } from '@/lib/recipe-lanes/model-utils';

interface IngredientsSidebarProps {
  graph: RecipeGraph;
  onClose: () => void;
  onUpdateServes: (newServes: number) => void;
  /** Commit a partial field patch to an ingredient (undoable store write). */
  onEditNode?: (nodeId: string, patch: Partial<RecipeNode>) => void;
  /** Advance the node's icon shortlist by one (no-op if the shortlist is empty). */
  onCycleShortlist?: (nodeId: string) => void;
  /** Reject the current icon and queue a brand-new AI icon for this ingredient. */
  onForge?: (node: RecipeNode) => void;
  /** Node ids with an in-flight forge request (drives the per-row spinner). */
  forgingIds?: Set<string>;
}

type Draft = { text: string; qty: string; desc: string };

/** Seed a node's editable drafts. Quantity is shown scaled to the current serves. */
function nodeToDraft(n: RecipeNode, scale: number): Draft {
  const scaledQty = n.quantity != null ? String(Math.round(n.quantity * scale * 100) / 100) : '';
  return { text: n.text ?? '', qty: scaledQty, desc: n.visualDescription ?? '' };
}

export function IngredientsSidebar({
  graph,
  onClose,
  onUpdateServes,
  onEditNode,
  onCycleShortlist,
  onForge,
  forgingIds,
}: IngredientsSidebarProps) {
  const serves = graph.serves || graph.baseServes || 1;
  const baseServes = graph.baseServes || 1;
  const scale = serves / baseServes;

  const handleServesChange = (val: number) => {
    onUpdateServes(Math.max(1, val));
  };

  const ingredientNodes = graph.nodes.filter(n => n.type === 'ingredient');

  // Local drafts for the inline editors (text / quantity / visual description).
  // Kept in sync with the graph for the node the user isn't actively editing
  // (e.g. after undo, a serves change, or a snapshot merge) without clobbering
  // in-progress typing on the focused row.
  const [drafts, setDrafts] = useState<Record<string, Draft>>(
    () => Object.fromEntries(ingredientNodes.map(n => [n.id, nodeToDraft(n, scale)])),
  );
  const editingIdRef = useRef<string | null>(null);

  useEffect(() => {
    setDrafts(prev => {
      const next = { ...prev };
      let changed = false;
      for (const n of ingredientNodes) {
        if (n.id === editingIdRef.current) continue;
        const d = nodeToDraft(n, scale);
        const cur = next[n.id];
        if (!cur || cur.text !== d.text || cur.qty !== d.qty || cur.desc !== d.desc) {
          next[n.id] = d;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  const setField = (id: string, field: keyof Draft, val: string) =>
    setDrafts(d => ({ ...d, [id]: { ...(d[id] ?? { text: '', qty: '', desc: '' }), [field]: val } }));

  const commitText = (node: RecipeNode) => {
    const v = drafts[node.id]?.text ?? '';
    if (v !== (node.text ?? '')) onEditNode?.(node.id, { text: v });
  };

  const commitDesc = (node: RecipeNode) => {
    const v = drafts[node.id]?.desc ?? '';
    if (v !== (node.visualDescription ?? '')) onEditNode?.(node.id, { visualDescription: v });
  };

  const commitQty = (node: RecipeNode) => {
    const raw = drafts[node.id]?.qty ?? '';
    if (raw.trim() === '') return;
    const displayed = parseFloat(raw);
    if (!Number.isFinite(displayed)) return;
    // The field shows the scaled amount; store the unscaled base so serves
    // scaling keeps working from the new value.
    const newBase = scale ? Math.round((displayed / scale) * 100) / 100 : displayed;
    if (newBase === node.quantity) return;
    const patch: Partial<RecipeNode> = { quantity: newBase };
    // Rebuild the label from the (scaled) displayed amount, mirroring serves scaling.
    if (node.canonicalName) patch.text = buildIngredientText(displayed, node.unit, node.canonicalName);
    onEditNode?.(node.id, patch);
  };

  const focusRow = (id: string) => { editingIdRef.current = id; };
  const blurRow = (commit: () => void) => { editingIdRef.current = null; commit(); };

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
                const displayQty = node.quantity != null ? Math.round(node.quantity * scale * 100) / 100 : '';
                const iconUrl = getNodeIconUrl(node);
                const isForging = forgingIds?.has(node.id) ?? false;
                const canCycle = getNodeShortlistLength(node) > 0;

                return (
                    <div key={node.id} className="flex items-start gap-3 group">
                        {iconUrl ? (
                            <img src={iconUrl} className="w-10 h-10 object-contain mix-blend-multiply bg-zinc-50 rounded-lg p-1 border border-zinc-100 shrink-0" alt="" />
                        ) : (
                            <div className="w-10 h-10 flex items-center justify-center bg-zinc-100 rounded-lg text-xl shrink-0">🥕</div>
                        )}
                        <div className="flex-1 pt-0.5 min-w-0 space-y-1.5">
                             <div className="flex items-center gap-1.5">
                                 {onEditNode ? (
                                     <input
                                         type="number"
                                         step="any"
                                         min="0"
                                         className="w-14 bg-zinc-50 border border-zinc-200 rounded px-1.5 py-0.5 text-sm font-bold text-blue-600 focus:outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-200"
                                         value={drafts[node.id]?.qty ?? ''}
                                         onChange={(e) => setField(node.id, 'qty', e.target.value)}
                                         onFocus={() => focusRow(node.id)}
                                         onBlur={() => blurRow(() => commitQty(node))}
                                         aria-label={`Quantity for ${node.canonicalName || node.text}`}
                                     />
                                 ) : (
                                     displayQty !== '' && <span className="font-bold text-blue-600">{displayQty}</span>
                                 )}
                                 {node.unit && <span className="text-zinc-500 text-xs uppercase font-bold">{node.unit}</span>}
                                 <span className="capitalize text-sm text-zinc-800 font-medium flex-1 truncate" title={node.canonicalName || node.text}>{node.canonicalName || node.text}</span>
                                 {onCycleShortlist && (
                                     <button
                                         onClick={() => onCycleShortlist(node.id)}
                                         disabled={!canCycle}
                                         className="p-1 rounded hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                                         title={canCycle ? 'Cycle icon' : 'No other icons yet'}
                                         aria-label={`Cycle icon for ${node.canonicalName || node.text}`}
                                     >
                                         <RefreshCw className="w-3.5 h-3.5" />
                                     </button>
                                 )}
                                 {onForge && (
                                     <button
                                         onClick={() => onForge(node)}
                                         disabled={isForging}
                                         className="p-1 rounded hover:bg-zinc-100 text-zinc-400 hover:text-amber-600 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                                         title="Forge new icon"
                                         aria-label={`Forge new icon for ${node.canonicalName || node.text}`}
                                     >
                                         <Hammer className={`w-3.5 h-3.5 ${isForging ? 'animate-pulse' : ''}`} />
                                     </button>
                                 )}
                             </div>
                             {onEditNode && (
                                 <input
                                     type="text"
                                     className="w-full bg-zinc-50 border border-zinc-200 rounded px-2 py-1 text-xs text-zinc-700 focus:outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-200"
                                     value={drafts[node.id]?.text ?? ''}
                                     onChange={(e) => setField(node.id, 'text', e.target.value)}
                                     onFocus={() => focusRow(node.id)}
                                     onBlur={() => blurRow(() => commitText(node))}
                                     placeholder="Recipe text"
                                     aria-label={`Recipe text for ${node.canonicalName || node.text}`}
                                 />
                             )}
                             {onEditNode && (
                                 <textarea
                                     className="w-full bg-zinc-50 border border-zinc-200 rounded px-2 py-1 text-[11px] text-zinc-600 resize-none focus:outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-200 leading-snug"
                                     rows={2}
                                     value={drafts[node.id]?.desc ?? ''}
                                     onChange={(e) => setField(node.id, 'desc', e.target.value)}
                                     onFocus={() => focusRow(node.id)}
                                     onBlur={() => blurRow(() => commitDesc(node))}
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
