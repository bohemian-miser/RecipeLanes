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

import React from 'react';
import { Wand2 } from 'lucide-react';

interface IngredientFormProps {
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  isLoading: boolean;
}

export function IngredientForm({ onSubmit, isLoading }: IngredientFormProps) {
  return (
    <form onSubmit={onSubmit} className="flex w-full items-center space-x-2">
      <input
        type="text"
        name="ingredient"
        placeholder="ENTER INGREDIENT..."
        required
        autoComplete="off"
        className="flex w-full px-4 py-4 text-sm h-16 flex-1 rounded-none border-4 border-zinc-700 bg-zinc-800 text-yellow-500 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.5)] focus:border-yellow-500 focus:outline-none placeholder:text-zinc-600 uppercase tracking-wider"
        disabled={isLoading}
      />
      <button
        type="submit"
        disabled={isLoading}
        className="inline-flex items-center justify-center h-16 w-16 rounded-none border-4 border-zinc-700 bg-zinc-800 text-yellow-500 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.5)] hover:bg-zinc-700 hover:translate-y-1 hover:shadow-none transition-all disabled:opacity-50 active:translate-y-1 active:shadow-none"
        aria-label="Generate Icon"
      >
        <Wand2 className="h-6 w-6" />
      </button>
    </form>
  );
}