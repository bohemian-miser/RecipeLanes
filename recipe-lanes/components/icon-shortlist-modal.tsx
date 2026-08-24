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

import React from 'react';
import { X, Sparkles, Coins } from 'lucide-react';
import { RecipeNode } from '@/lib/recipe-lanes/types';
import {
  getNodeIngredientName,
  getNodeShortlistLength,
  getNodeIconUrlAt,
  getNodeIconStatus,
  isIconSearchMatchedAt,
  currentShortlistIndex,
} from '@/lib/recipe-lanes/model-utils';
import { STARTER_ICON_CREDITS, FORGE_CREDIT_COST } from '@/lib/config';

export interface IconCreditsInfo {
  signedIn: boolean;
  balance: number;
}

interface IconShortlistModalProps {
  node: RecipeNode;
  onClose: () => void;
  /** Make the shortlist entry at `index` the node's current icon. */
  onSelect: (index: number) => void;
  /** Spend a credit and queue a brand-new icon generation for this node. */
  onGenerate: () => void;
  /** True while the generate request is in flight. */
  isGenerating: boolean;
  /** Current credit state, or null while it is still loading. */
  credits: IconCreditsInfo | null;
  onSignIn: () => void;
}

/**
 * The icon editor: shows a node's whole icon shortlist at once (which counts
 * as an impression for every entry — the store flags shortlistSeenAll when
 * opening), lets the user pick one directly, and hosts the credit-gated
 * "generate new icon" button that replaced the old forge hammer.
 */
export function IconShortlistModal({
  node,
  onClose,
  onSelect,
  onGenerate,
  isGenerating,
  credits,
  onSignIn,
}: IconShortlistModalProps) {
  const title = getNodeIngredientName(node);
  const length = getNodeShortlistLength(node);
  const selectedIndex = currentShortlistIndex(node);
  const nodeStatus = getNodeIconStatus(node);
  const generationPending = nodeStatus === 'pending' || nodeStatus === 'processing';
  const busy = isGenerating || generationPending;

  const canAfford = credits !== null && credits.signedIn && credits.balance >= FORGE_CREDIT_COST;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
      data-testid="icon-editor-modal"
    >
      <div
        className="relative w-full max-w-md bg-white border border-zinc-200 rounded-xl shadow-2xl overflow-y-auto max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 p-4 border-b border-zinc-100">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-zinc-800 uppercase tracking-wide truncate">{title}</h2>
            <p className="text-[11px] text-zinc-400 mt-0.5">Pick an icon, or generate a new one.</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Shortlist grid */}
        <div className="p-4">
          {length > 0 ? (
            <div className="grid grid-cols-4 gap-2">
              {Array.from({ length }, (_, i) => {
                const url = getNodeIconUrlAt(node, i);
                const isSelected = i === selectedIndex;
                return (
                  <button
                    key={i}
                    onClick={() => onSelect(i)}
                    className={`relative aspect-square rounded-lg border-2 p-1 flex items-center justify-center transition-all bg-zinc-50 hover:bg-zinc-100 ${
                      isSelected
                        ? 'border-blue-500 ring-2 ring-blue-200'
                        : 'border-zinc-200 hover:border-zinc-300'
                    }`}
                    title={isSelected ? 'Current icon' : 'Use this icon'}
                    aria-pressed={isSelected}
                    data-testid={`icon-editor-entry-${i}`}
                  >
                    {url ? (
                      <img
                        src={url}
                        alt=""
                        className="w-full h-full object-contain mix-blend-multiply"
                        style={{ imageRendering: 'pixelated' }}
                      />
                    ) : (
                      <span className="text-xl">🥕</span>
                    )}
                    {isIconSearchMatchedAt(node, i) && (
                      <span
                        className="absolute bottom-1 right-1 w-[5px] h-[5px] rounded-full bg-amber-400 pointer-events-none"
                        title="Icon matched by search"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="py-6 text-center text-xs text-zinc-400">
              {generationPending ? 'An icon is being generated…' : 'No icons yet for this step.'}
            </div>
          )}
        </div>

        {/* Generate section */}
        <div className="p-4 border-t border-zinc-100 bg-zinc-50/60 rounded-b-xl space-y-2">
          {credits?.signedIn ? (
            <>
              <button
                onClick={onGenerate}
                disabled={busy || !canAfford}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:bg-zinc-200 disabled:text-zinc-400 text-white text-sm font-semibold transition-colors disabled:cursor-not-allowed"
                data-testid="icon-editor-generate"
              >
                <Sparkles className={`w-4 h-4 ${busy ? 'animate-pulse' : ''}`} />
                {busy
                  ? 'Generating…'
                  : `Generate a new icon (${FORGE_CREDIT_COST} credit${FORGE_CREDIT_COST === 1 ? '' : 's'})`}
              </button>
              <div
                className="flex items-center justify-center gap-1.5 text-[11px] text-zinc-500"
                data-testid="icon-editor-credits"
              >
                <Coins className="w-3.5 h-3.5 text-amber-500" />
                {credits.balance} icon credit{credits.balance === 1 ? '' : 's'} left
                {!canAfford && !busy && (
                  <span className="text-red-500 font-medium ml-1">— you are out of credits</span>
                )}
              </div>
            </>
          ) : credits === null ? (
            <div className="text-center text-[11px] text-zinc-400 py-2">Loading credits…</div>
          ) : (
            <button
              onClick={onSignIn}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-semibold transition-colors"
              data-testid="icon-editor-signin"
            >
              <Sparkles className="w-4 h-4" />
              Sign in to get {STARTER_ICON_CREDITS} free icon credits
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
