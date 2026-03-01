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

import { useAuth } from '@/components/auth-provider';
import { LogIn } from 'lucide-react';

export function Login() {
  const { signIn, error } = useAuth();

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
      <div className="text-zinc-400 text-sm font-mono text-center max-w-md">
        <p className="mb-4">AUTHENTICATION REQUIRED</p>
        <p>You must be logged in to forge new icons.</p>
      </div>
      
      {error && (
        <div className="text-red-400 text-xs font-mono max-w-xs text-center border border-red-900 bg-red-900/10 p-2 rounded">
          {error}
        </div>
      )}

      <button
        onClick={signIn}
        className="flex items-center gap-2 px-6 py-3 bg-yellow-500 hover:bg-yellow-400 text-black font-bold uppercase tracking-wider rounded transition-all hover:scale-105"
      >
        <LogIn className="w-5 h-5" />
        <span>Sign in with Google</span>
      </button>
    </div>
  );
}