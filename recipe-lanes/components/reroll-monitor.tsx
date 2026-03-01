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

/* eslint-disable @next/next/no-img-element */
import React from 'react';

interface Candidate {
  url: string;
  score: number;
  impressions: number;
  rejections: number;
}

interface DebugInfo {
  candidates?: Candidate[];
  sessionRejections?: number;
  totalAvailable?: number;
  decision?: string;
  note?: string;
}

export function RerollMonitor({ debugInfo }: { debugInfo: DebugInfo | null }) {
  if (!debugInfo) return null;

  return (
    <div className="w-full mb-8 border border-yellow-500/50 bg-yellow-900/10 p-4 font-mono text-xs">
      <h3 className="text-yellow-500 font-bold mb-2 uppercase tracking-widest border-b border-yellow-500/30 pb-1">
        Reroll Logic Monitor
      </h3>
      
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <span className="text-zinc-500">Decision:</span> <span className="text-white font-bold">{debugInfo.decision}</span>
        </div>
        <div>
          <span className="text-zinc-500">Session Rejects:</span> <span className="text-white">{debugInfo.sessionRejections ?? 'N/A'}</span>
        </div>
        <div>
          <span className="text-zinc-500">Total Pool:</span> <span className="text-white">{debugInfo.totalAvailable ?? 'N/A'}</span>
        </div>
      </div>

      {debugInfo.candidates && debugInfo.candidates.length > 0 && (
        <div className="space-y-2">
          <div className="text-zinc-500 uppercase tracking-wider mb-1">Top Candidates Considered:</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {debugInfo.candidates.map((cand, idx) => (
              <div key={idx} className="flex gap-3 bg-black/40 p-2 border border-zinc-700">
                <div className="w-10 h-10 bg-zinc-900 shrink-0">
                  <img src={cand.url} className="w-full h-full object-contain pixelated" style={{ imageRendering: 'pixelated' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between">
                    <span className="text-green-400 font-bold">LCB: {cand.score.toFixed(3)}</span>
                  </div>
                  <div className="text-zinc-500">
                    Imp: {cand.impressions} | Rej: {cand.rejections}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {debugInfo.note && (
          <div className="mt-2 text-zinc-400 italic">Note: {debugInfo.note}</div>
      )}
    </div>
  );
}