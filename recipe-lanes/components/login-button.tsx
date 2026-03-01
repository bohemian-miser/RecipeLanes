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

export function LoginButton({ text = "Login", className = "" }: { text?: string, className?: string }) {
  const { signIn } = useAuth();

  return (
    <button onClick={signIn} className={`flex items-center gap-2 hover:text-white transition-colors ${className}`}>
       <LogIn className="w-4 h-4" />
       <span>{text}</span>
    </button>
  );
}