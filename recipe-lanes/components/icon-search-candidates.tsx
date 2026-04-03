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
import { IconStats } from '@/lib/recipe-lanes/types';
import { getIconThumbUrl } from '@/lib/recipe-lanes/model-utils';

interface IconSearchCandidatesProps {
  query: string;
  candidates: IconStats[];
  isSearching: boolean;
  onIconClick?: (candidate: IconStats) => void;
}

export function IconSearchCandidates({ query, candidates, isSearching, onIconClick }: IconSearchCandidatesProps) {
  if (isSearching) {
    return (
      <div className="w-full border-4 border-zinc-700 bg-zinc-800 p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.5)]">
        <div className="animate-pulse text-yellow-500 font-mono tracking-wider uppercase text-sm text-center">
          SEARCHING...
        </div>
      </div>
    );
  }

  if (candidates.length === 0 && query) {
    return (
      <div className="w-full border-4 border-zinc-700 bg-zinc-800 p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.5)]">
        <p className="text-zinc-500 font-mono text-sm text-center uppercase tracking-wider">
          No candidates found for &apos;{query}&apos;
        </p>
      </div>
    );
  }

  if (candidates.length === 0) {
    return null;
  }

  return (
    <div className="w-full border-4 border-zinc-700 bg-zinc-800 p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.5)]">
      <p className="text-zinc-500 font-mono text-xs uppercase tracking-wider mb-4">
        {candidates.length} result{candidates.length !== 1 ? 's' : ''} for &apos;{query}&apos;
      </p>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
        {candidates.map((candidate) => (
          <div
            key={candidate.id}
            className="flex flex-col items-center gap-2 p-2 border-2 border-zinc-700 bg-zinc-900 hover:border-yellow-500 transition-colors cursor-pointer"
            onClick={() => onIconClick?.(candidate)}
          >
            {candidate.visualDescription ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={getIconThumbUrl(candidate)}
                alt={candidate.id}
                width={64}
                height={64}
                className="w-16 h-16 object-contain"
                style={{ imageRendering: 'pixelated' }}
              />
            ) : (
              <div className="w-16 h-16 bg-zinc-700 flex items-center justify-center">
                <span className="text-zinc-500 text-xs font-mono">?</span>
              </div>
            )}
            <span className="text-yellow-500 font-mono text-[10px] leading-tight text-center break-all w-full truncate" title={candidate.id}>
              {candidate.id.length > 10 ? candidate.id.slice(0, 10) + '…' : candidate.id}
            </span>
            {(candidate.impressions !== undefined || candidate.score !== undefined) && (
              <span className="text-zinc-500 font-mono text-[9px]">
                {candidate.impressions !== undefined && `${candidate.impressions}x`}
                {candidate.score !== undefined && candidate.impressions !== undefined && ' · '}
                {candidate.score !== undefined && `${candidate.score.toFixed(2)}`}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
