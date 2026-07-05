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
import Link from 'next/link';
import { useAuth } from '@/components/auth-provider';
import { LogIn } from 'lucide-react';
import { canProceedToSignIn } from '@/lib/legal/consent';

export function Login() {
  const { signIn, error } = useAuth();
  const [agreed, setAgreed] = useState(false);

  // New users have no prior consent record, so signing in requires ticking the box.
  const canSignIn = canProceedToSignIn(agreed);

  const handleSignIn = () => {
    if (!canSignIn) return;
    signIn();
  };

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

      <label className="flex items-start gap-2 text-xs font-mono text-zinc-400 max-w-xs text-left cursor-pointer">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 accent-yellow-500"
          aria-label="I agree to the Terms of Service"
        />
        <span>
          I have read and agree to the{' '}
          <Link
            href="/terms"
            target="_blank"
            className="text-yellow-500 hover:text-yellow-400 underline"
          >
            Terms of Service &amp; Privacy
          </Link>
          .
        </span>
      </label>

      <button
        onClick={handleSignIn}
        disabled={!canSignIn}
        className="flex items-center gap-2 px-6 py-3 bg-yellow-500 hover:bg-yellow-400 text-black font-bold uppercase tracking-wider rounded transition-all hover:scale-105 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:bg-yellow-500"
      >
        <LogIn className="w-5 h-5" />
        <span>Sign in with Google</span>
      </button>
    </div>
  );
}