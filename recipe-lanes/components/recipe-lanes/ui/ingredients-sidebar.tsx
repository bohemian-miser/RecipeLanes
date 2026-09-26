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
import { ChefHat, X, Users, Pencil } from 'lucide-react';
import { getNodeIconUrl, computeIngredientRowPatch } from '@/lib/recipe-lanes/model-utils';

interface IngredientsSidebarProps {
  graph: RecipeGraph;
  onClose: () => void;
  onUpdateServes: (newServes: number) => void;
  /** Commit a partial field patch to an ingredient (undoable store write). */
  onEditNode?: (nodeId: string, patch: Partial<RecipeNode>) => void;
  /** Open the icon editor modal (shortlist picker + credit-gated generate). */
  onEditIcon?: (nodeId: string) => void;
}

type Draft = { qty: string; unit: string; name: string };

/** Seed a node's editable drafts. Quantity is shown scaled to the current serves. */
function nodeToDraft(n: RecipeNode, scale: number): Draft {
  return {
    qty: n.quantity != null ? String(Math.round(n.quantity * scale * 100) / 100) : '',
    unit: n.unit ?? '',
    name: n.canonicalName ?? n.text ?? '',
  };
}

export function IngredientsSidebar({
  graph,
  onClose,
  onUpdateServes,
  onEditNode,
  onEditIcon,
}: IngredientsSidebarProps) {
  const serves = graph.serves || graph.baseServes || 1;
  const baseServes = graph.baseServes || 1;
  const scale = serves / baseServes;

  const handleServesChange = (val: number) => {
    onUpdateServes(Math.max(1, val));
  };

  const ingredientNodes = graph.nodes.filter(n => n.type === 'ingredient');

  // Local drafts for the inline editors (number / unit / name). Kept in sync
  // with the graph for the node the user isn't actively editing (e.g. after
  // undo, a serves change, or a snapshot merge) without clobbering
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
        if (!cur || cur.qty !== d.qty || cur.unit !== d.unit || cur.name !== d.name) {
          next[n.id] = d;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  const setField = (id: string, field: keyof Draft, val: string) =>
    setDrafts(d => ({ ...d, [id]: { ...(d[id] ?? { qty: '', unit: '', name: '' }), [field]: val } }));

  // Commit the number / unit / name boxes together — text (the diagram label)
  // is rebuilt from all three so the info isn't duplicated across fields.
  const commitRow = (node: RecipeNode) => {
    const d = drafts[node.id];
    if (!d || !onEditNode) return;
    const patch = computeIngredientRowPatch(node, d, scale);
    if (Object.keys(patch).length > 0) onEditNode(node.id, patch);
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
                const label = node.canonicalName || node.text;

                return (
                    <div key={node.id} className="flex items-start gap-3 group">
                        {/* Left column: icon with the edit-icon button beneath it. */}
                        <div className="flex flex-col items-center gap-1 shrink-0 w-10">
                            {iconUrl ? (
                                <img src={iconUrl} className="w-10 h-10 object-contain mix-blend-multiply bg-zinc-50 rounded-lg p-1 border border-zinc-100" alt="" />
                            ) : (
                                <div className="w-10 h-10 flex items-center justify-center bg-zinc-100 rounded-lg text-xl">🥕</div>
                            )}
                            {onEditIcon && (
                                <button
                                    onClick={() => onEditIcon(node.id)}
                                    className="p-1 rounded hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700"
                                    title="Edit icon"
                                    aria-label={`Edit icon for ${label}`}
                                    data-testid="sidebar-edit-icon"
                                >
                                    <Pencil className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>

                        {/* Right column: number + unit, then the ingredient name. */}
                        <div className="flex-1 pt-0.5 min-w-0 space-y-1.5">
                            {onEditNode ? (
                                <>
                                    <div className="flex items-center gap-1.5">
                                        <input
                                            type="number"
                                            step="any"
                                            min="0"
                                            className="w-16 bg-zinc-50 border border-zinc-200 rounded px-1.5 py-0.5 text-sm font-bold text-blue-600 focus:outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-200"
                                            value={drafts[node.id]?.qty ?? ''}
                                            onChange={(e) => setField(node.id, 'qty', e.target.value)}
                                            onFocus={() => focusRow(node.id)}
                                            onBlur={() => blurRow(() => commitRow(node))}
                                            aria-label={`Quantity for ${label}`}
                                        />
                                        <input
                                            type="text"
                                            className="flex-1 min-w-0 bg-zinc-50 border border-zinc-200 rounded px-2 py-0.5 text-xs uppercase font-bold text-zinc-500 focus:outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-200"
                                            value={drafts[node.id]?.unit ?? ''}
                                            onChange={(e) => setField(node.id, 'unit', e.target.value)}
                                            onFocus={() => focusRow(node.id)}
                                            onBlur={() => blurRow(() => commitRow(node))}
                                            placeholder="unit"
                                            aria-label={`Unit for ${label}`}
                                        />
                                    </div>
                                    <input
                                        type="text"
                                        className="w-full bg-zinc-50 border border-zinc-200 rounded px-2 py-1 text-sm text-zinc-800 font-medium capitalize focus:outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-200"
                                        value={drafts[node.id]?.name ?? ''}
                                        onChange={(e) => setField(node.id, 'name', e.target.value)}
                                        onFocus={() => focusRow(node.id)}
                                        onBlur={() => blurRow(() => commitRow(node))}
                                        placeholder="Ingredient name"
                                        aria-label={`Ingredient name for ${label}`}
                                    />
                                </>
                            ) : (
                                <div className="text-sm text-zinc-800 font-medium leading-tight">
                                    {displayQty !== '' && <span className="font-bold text-blue-600 mr-1">{displayQty}</span>}
                                    {node.unit && <span className="text-zinc-500 text-xs uppercase font-bold mr-1">{node.unit}</span>}
                                    <span className="capitalize">{label}</span>
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    </div>
  );
}
