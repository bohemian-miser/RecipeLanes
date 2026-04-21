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

  return (
    <div className="absolute inset-0 z-50 bg-zinc-100/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center" data-testid="loading-screen">
      <div className="bg-white border-2 border-zinc-200 p-8 rounded-2xl shadow-xl flex flex-col items-center max-w-sm w-full space-y-6">
        <Loader2 className="w-12 h-12 text-yellow-500 animate-spin" />
        
        <div className="space-y-2">
          <h2 className="text-xl font-bold text-zinc-800">
            {phase === 'graph' ? 'Making Recipe Graph' : 'Finding Icons'}
          </h2>
          <p className="text-sm text-zinc-500">
            {phase === 'graph' 
              ? 'Parsing your ingredients and steps into a visual flow...' 
              : 'Searching our database for the best ingredients imagery...'}
          </p>
        </div>
      </div>
    </div>
  );
}
