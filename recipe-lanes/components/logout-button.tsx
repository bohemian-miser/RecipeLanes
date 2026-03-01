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
import { LogOut } from 'lucide-react';

export function LogoutButton({ className = "" }: { className?: string }) {
  const { logout } = useAuth();

  return (
    <button onClick={logout} className={`p-2 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-red-400 transition-colors ${className}`} title="Logout">
       <LogOut className="w-4 h-4" />
    </button>
  );
}