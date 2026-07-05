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

'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import type { RecipeNode } from '@/lib/recipe-lanes/types';

interface VisualDescriptionEditorProps {
  /** Nodes to edit — normally `graph.nodes`. */
  nodes: RecipeNode[];
  /** Commit a single node's new visualDescription (undoable store write). */
  onEdit: (nodeId: string, visualDescription: string) => void;
  /** Persist the current graph (e.g. save/fork). Called once on Save. */
  onSave: () => void;
  /** Close the panel without persisting. Already-committed edits remain. */
  onClose: () => void;
}

/**
 * Slide-in panel that lets a user edit each node's `visualDescription` (the
 * text that drives what the node's icon depicts) without dropping into the raw
 * JSON editor. Drafts are kept locally and committed to the store on blur (each
 * a discrete undoable change); the Save button flushes any remaining drafts and
 * persists. Mirrors the JSON editor overlay's layout and save affordances.
 */
export function VisualDescriptionEditor({ nodes, onEdit, onSave, onClose }: VisualDescriptionEditorProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>(
    () => Object.fromEntries(nodes.map(n => [n.id, n.visualDescription ?? ''])),
  );

  const commit = (node: RecipeNode) => {
    const draft = drafts[node.id] ?? '';
    if (draft !== (node.visualDescription ?? '')) {
      onEdit(node.id, draft);
    }
  };

  const handleSave = () => {
    // Flush any drafts not yet committed on blur (e.g. Save clicked mid-edit).
    nodes.forEach(commit);
    onSave();
    onClose();
  };

  return (
    <div className="absolute top-0 right-0 bottom-0 z-50 bg-white/95 backdrop-blur border-l border-zinc-200 w-full md:w-[40%] flex flex-col shadow-2xl p-4 animate-in slide-in-from-right duration-300">
      <div className="flex justify-between items-center mb-4 border-b border-zinc-200 pb-2">
        <h3 className="text-sm font-bold text-zinc-600 uppercase tracking-wider flex items-center gap-2">
          <Pencil className="w-4 h-4" /> Edit Visual Descriptions
        </h3>
        <div className="flex gap-2">
          <button onClick={onClose} className="text-xs text-zinc-500 hover:text-zinc-800 px-2 py-1">Close</button>
          <button onClick={handleSave} className="text-xs bg-zinc-900 text-white px-3 py-1.5 rounded hover:bg-zinc-700 font-bold transition-colors">Save</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 pr-1">
        {nodes.length === 0 ? (
          <p className="text-xs text-zinc-400">No steps to edit yet.</p>
        ) : (
          nodes.map((node) => (
            <div key={node.id} className="space-y-1">
              <label className="block text-xs font-semibold text-zinc-700 truncate" title={node.text}>
                {node.text || node.id}
              </label>
              <textarea
                className="w-full bg-zinc-50 border border-zinc-200 rounded p-2 text-xs text-zinc-700 resize-y focus:outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-200 leading-relaxed"
                rows={2}
                value={drafts[node.id] ?? ''}
                onChange={(e) => setDrafts((d) => ({ ...d, [node.id]: e.target.value }))}
                onBlur={() => commit(node)}
                placeholder="What the icon should depict…"
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
