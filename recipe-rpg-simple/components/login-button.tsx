'use client';

import { useAuth } from '@/components/auth-provider';
import { LogIn } from 'lucide-react';

export function LoginButton({ text = "Login", className = "" }: { text?: string, className?: string }) {
  const { signIn } = useAuth();

  return (
    <button onClick={signIn} className={`flex items-center gap-2 hover:text-white transition-colors ${className}`}>
       <LogIn className="w-4 h-4" />
       <span>{text}</span>
    </button>
  );
}
