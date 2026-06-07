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

import { Loader2 } from 'lucide-react';

export type LoadingPhase = 'graph' | 'icons' | null;

interface LoadingScreenProps {
  phase: LoadingPhase;
}

export function LoadingScreen({ phase }: LoadingScreenProps) {
  if (!phase) return null;

  if (phase === 'icons') {
    return (
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none" data-testid="loading-screen">
        <div className="bg-white border border-zinc-200 px-4 py-2 rounded-full shadow-lg flex items-center gap-2">
          <Loader2 className="w-4 h-4 text-yellow-500 animate-spin shrink-0" />
          <span className="text-sm font-medium text-zinc-700">Finding icons...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-50 bg-zinc-100/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center" data-testid="loading-screen">
      <div className="bg-white border-2 border-zinc-200 p-8 rounded-2xl shadow-xl flex flex-col items-center max-w-sm w-full space-y-6">
        <Loader2 className="w-12 h-12 text-yellow-500 animate-spin" />
        <div className="space-y-2">
          <h2 className="text-xl font-bold text-zinc-800">Making Recipe Graph</h2>
          <p className="text-sm text-zinc-500">Parsing your ingredients and steps into a visual flow...</p>
        </div>
      </div>
    </div>
  );
}
