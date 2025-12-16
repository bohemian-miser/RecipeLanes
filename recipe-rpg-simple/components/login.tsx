'use client';

import { useAuth } from '@/components/auth-provider';
import { LogIn } from 'lucide-react';

export function Login() {
  const { signIn } = useAuth();

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
      <div className="text-zinc-400 text-sm font-mono text-center max-w-md">
        <p className="mb-4">AUTHENTICATION REQUIRED</p>
        <p>You must be logged in to forge new icons.</p>
      </div>
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
