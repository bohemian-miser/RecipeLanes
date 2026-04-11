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
import React from 'react';
import { X } from 'lucide-react';
import { RecipeNode, SearchTerm } from '@/lib/recipe-lanes/types';
import { getNodeIngredientName, getNodeIcon, getNodeIconUrl, getIconThumbUrl } from '@/lib/recipe-lanes/model-utils';

interface IconDetailModalProps {
  node: RecipeNode | null;
  onClose: () => void;
}

const SOURCE_BADGE: Record<SearchTerm['source'], { label: string; className: string }> = {
  hyde_from_img: { label: 'hyde', className: 'bg-amber-900/60 text-amber-300 border border-amber-700' },
  user_desc:     { label: 'user', className: 'bg-blue-900/60 text-blue-300 border border-blue-700' },
  llm_vision:   { label: 'llm',  className: 'bg-purple-900/60 text-purple-300 border border-purple-700' },
};

const STATUS_BADGE: Record<string, string> = {
  pending:    'bg-zinc-700 text-zinc-300',
  processing: 'bg-yellow-900/60 text-yellow-300 border border-yellow-700',
  failed:     'bg-red-900/60 text-red-300 border border-red-700',
};

export function IconDetailModal({ node, onClose }: IconDetailModalProps) {
  if (!node) return null;

  const icon = getNodeIcon(node);
  const iconUrl = getNodeIconUrl(node);
  const title = getNodeIngredientName(node);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg bg-zinc-900 border-2 border-zinc-700 shadow-[8px_8px_0px_0px_rgba(0,0,0,0.6)] overflow-y-auto max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 p-4 border-b border-zinc-800">
          <div className="flex items-center gap-4">
            {iconUrl ? (
              <img
                src={iconUrl}
                alt={title}
                width={128}
                height={128}
                className="shrink-0 border-2 border-zinc-700 bg-zinc-950"
                style={{ imageRendering: 'pixelated', width: 128, height: 128, objectFit: 'contain' }}
              />
            ) : (
              <div className="shrink-0 w-32 h-32 border-2 border-zinc-700 bg-zinc-950 flex items-center justify-center">
                <span className="text-zinc-600 text-xs font-mono">no image</span>
              </div>
            )}
            <div className="min-w-0">
              <h2 className="text-base font-bold text-yellow-500 uppercase tracking-tight leading-tight break-words">
                {title}
              </h2>
              {node?.status && (
                <span className={`mt-1 inline-block text-[10px] font-mono px-1.5 py-0.5 rounded ${STATUS_BADGE[node.status] ?? 'bg-zinc-700 text-zinc-400'}`}>
                  {node.status}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1 text-zinc-500 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {icon && (
          <div className="p-4 space-y-5">
            {/* Stats row */}
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { label: 'Impressions', value: icon.impressions },
                  { label: 'Rejections',  value: icon.rejections },
                  { label: 'Score',       value: icon.score !== undefined ? icon.score.toFixed(3) : undefined },
                ] as { label: string; value: string | number | undefined }[]
              ).map(({ label, value }) => (
                <div key={label} className="bg-zinc-800 border border-zinc-700 p-2 text-center">
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-mono">{label}</div>
                  <div className="text-sm font-bold text-zinc-100 mt-0.5 font-mono">
                    {value !== undefined ? value : '—'}
                  </div>
                </div>
              ))}
            </div>

            {/* ID */}
            <div>
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-mono mb-1">ID</div>
              <div
                className="text-xs text-zinc-300 font-mono truncate bg-zinc-800 border border-zinc-700 px-2 py-1.5"
                title={icon.id}
              >
                {icon.id}
              </div>
            </div>

            {/* URL */}
            {icon.visualDescription && (
              <div>
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-mono mb-1">URL</div>
                <div
                  className="text-xs text-zinc-300 font-mono truncate bg-zinc-800 border border-zinc-700 px-2 py-1.5"
                  title={getIconThumbUrl(icon)}
                >
                  {getIconThumbUrl(icon)}
                </div>
              </div>
            )}

            {/* Search Terms */}
            {icon.searchTerms && icon.searchTerms.length > 0 && (
              <div>
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-mono mb-2">Search Terms</div>
                <div className="flex flex-wrap gap-2">
                  {icon.searchTerms.map((term: SearchTerm, i: number) => {
                    const badge = SOURCE_BADGE[term.source];
                    return (
                      <div
                        key={i}
                        className="flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs font-mono"
                      >
                        <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${badge?.className ?? 'bg-zinc-700 text-zinc-400'}`}>
                          {badge?.label ?? term.source}
                        </span>
                        <span className="text-zinc-300">{term.text}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Metadata */}
            {icon.metadata && (
              <div>
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-mono mb-2">Metadata</div>
                <div className="bg-zinc-800 border border-zinc-700 p-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs font-mono">
                  <div className="text-zinc-500">center</div>
                  <div className="text-zinc-300">
                    ({icon.metadata.center.x}, {icon.metadata.center.y})
                  </div>
                  <div className="text-zinc-500">bbox</div>
                  <div className="text-zinc-300">
                    {icon.metadata.bbox.x} {icon.metadata.bbox.y} {icon.metadata.bbox.w} {icon.metadata.bbox.h}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {!icon && (
          <div className="p-8 text-center text-zinc-600 text-xs font-mono">No icon data available.</div>
        )}
      </div>
    </div>
  );
}
