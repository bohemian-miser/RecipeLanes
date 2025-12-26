'use client';

import { useAuth } from '@/components/auth-provider';
import { LogOut } from 'lucide-react';

export function LogoutButton({ className = "" }: { className?: string }) {
  const { logout } = useAuth();

  return (
    <button onClick={logout} className={`p-2 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-red-400 transition-colors ${className}`} title="Logout">
       <LogOut className="w-4 h-4" />
    </button>
  );
}
