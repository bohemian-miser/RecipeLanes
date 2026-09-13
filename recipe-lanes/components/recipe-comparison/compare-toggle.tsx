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

import { Check } from 'lucide-react';
import { useRecipeComparison } from './comparison-context';

/**
 * The tick box on a gallery card that adds the recipe to the comparison
 * table. Renders nothing for signed-out visitors (no provider). Lives inside
 * the card's <Link>, so it must swallow the click.
 */
export function CompareToggle({ recipeId, title }: { recipeId: string; title: string }) {
    const compare = useRecipeComparison();
    if (!compare) return null;

    const selected = compare.isSelected(recipeId);
    const atCap = !selected && compare.selectedIds.length >= compare.max;

    return (
        <button
            type="button"
            role="checkbox"
            aria-checked={selected}
            aria-label={selected ? `Remove ${title} from comparison` : `Add ${title} to comparison`}
            title={atCap ? `Compare up to ${compare.max} recipes` : selected ? 'Remove from comparison' : 'Add to comparison'}
            data-testid="compare-toggle"
            disabled={atCap}
            onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                compare.toggle(recipeId);
            }}
            className={`absolute top-2 left-2 z-10 flex h-7 w-7 items-center justify-center rounded-md border backdrop-blur-sm transition-all
                ${selected
                    ? 'bg-yellow-500 border-yellow-400 text-black opacity-100'
                    : 'bg-black/50 border-zinc-600 text-transparent hover:text-zinc-300 hover:border-zinc-400 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100'}
                ${atCap ? 'cursor-not-allowed' : ''}`}
        >
            <Check className="h-4 w-4" strokeWidth={3} />
        </button>
    );
}
