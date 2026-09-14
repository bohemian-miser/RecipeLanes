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

/**
 * Gallery "Compare" table: selected recipes as columns (icon + title), their
 * ingredients as rows (icon, label, unit), quantities in the cells and a
 * Total column on the right. Rows and columns can be reordered by dragging
 * (native HTML5 DnD) or with the arrow keys on a grip handle.
 *
 * All merging / totalling / ordering rules live in
 * lib/recipe-lanes/comparison-table.ts; this file is rendering + interaction.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ChefHat, GripVertical, GripHorizontal, Loader2, Table2, X } from 'lucide-react';
import { getComparisonRecipesAction } from '@/app/actions';
import {
    buildComparisonTable,
    formatQuantity,
    moveItem,
    type ComparisonCell,
    type ComparisonRecipe,
    type ComparisonRow,
} from '@/lib/recipe-lanes/comparison-table';
import { useRecipeComparison } from './comparison-context';

type DragKind = 'row' | 'col';
interface DragRef { kind: DragKind; index: number }

function cellText(cell: ComparisonCell | undefined): string {
    if (!cell) return '—';
    if (cell.quantity == null) return '✓';
    return cell.unquantified ? `${formatQuantity(cell.quantity)}+` : formatQuantity(cell.quantity);
}

/** Total column text: "5", "5+" when some recipe gave no number, "✓" when none did. */
function totalText(row: ComparisonRow): string {
    if (row.total === 0 && row.totalIsPartial) return '✓';
    return row.totalIsPartial ? `${formatQuantity(row.total)}+` : formatQuantity(row.total);
}

export function RecipeComparisonTable() {
    const compare = useRecipeComparison();
    const selectedIds = useMemo(() => compare?.selectedIds ?? [], [compare]);
    const remove = compare?.remove;
    const setSelectedIds = compare?.setSelectedIds;
    const clear = compare?.clear;

    const [loaded, setLoaded] = useState<Record<string, ComparisonRecipe>>({});
    const [notice, setNotice] = useState<string | null>(null);
    const [rowOrder, setRowOrder] = useState<string[]>([]);
    const [drag, setDrag] = useState<DragRef | null>(null);
    const [over, setOver] = useState<DragRef | null>(null);
    const inflight = useRef<Set<string>>(new Set());

    // Fetch any selected recipe we have not loaded yet. Recipes the action
    // drops (deleted, or not visible to this user) are unticked so the table
    // never shows a phantom column.
    useEffect(() => {
        if (!remove) return;
        const missing = selectedIds.filter(id => !loaded[id] && !inflight.current.has(id));
        if (missing.length === 0) return;
        missing.forEach(id => inflight.current.add(id));
        getComparisonRecipesAction(missing).then(res => {
            missing.forEach(id => inflight.current.delete(id));
            if (res.error) {
                setNotice(res.error);
                missing.forEach(remove);
                return;
            }
            const got: Record<string, ComparisonRecipe> = {};
            for (const r of res.recipes) got[r.id] = r;
            setLoaded(prev => ({ ...prev, ...got }));
            const dropped = missing.filter(id => !got[id]);
            if (dropped.length > 0) {
                dropped.forEach(remove);
                setNotice(dropped.length === 1 ? 'One selected recipe could not be loaded and was removed.' : `${dropped.length} selected recipes could not be loaded and were removed.`);
            }
        }).catch((e: any) => {
            missing.forEach(id => inflight.current.delete(id));
            setNotice(e?.message || 'Failed to load recipes');
        });
    }, [selectedIds, loaded, remove]);

    const columns = useMemo(() => selectedIds.map(id => loaded[id]).filter((r): r is ComparisonRecipe => !!r), [selectedIds, loaded]);
    const table = useMemo(() => buildComparisonTable(columns, rowOrder), [columns, rowOrder]);
    const rowKeys = useMemo(() => table.rows.map(r => r.key), [table]);
    const isLoading = selectedIds.some(id => !loaded[id]);

    const moveRow = useCallback((from: number, to: number) => {
        if (to < 0 || to >= rowKeys.length) return;
        setRowOrder(moveItem(rowKeys, from, to));
    }, [rowKeys]);

    const moveColumn = useCallback((from: number, to: number) => {
        if (!setSelectedIds || to < 0 || to >= selectedIds.length) return;
        setSelectedIds(moveItem(selectedIds, from, to));
    }, [selectedIds, setSelectedIds]);

    // --- Drag and drop (native) -------------------------------------------
    const onDragStart = (kind: DragKind, index: number) => (e: React.DragEvent) => {
        e.dataTransfer.effectAllowed = 'move';
        // Firefox refuses to start a drag without payload.
        e.dataTransfer.setData('text/plain', `${kind}:${index}`);
        setDrag({ kind, index });
    };
    const onDragOver = (kind: DragKind, index: number) => (e: React.DragEvent) => {
        if (!drag || drag.kind !== kind) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!over || over.kind !== kind || over.index !== index) setOver({ kind, index });
    };
    const onDrop = (kind: DragKind, index: number) => (e: React.DragEvent) => {
        if (!drag || drag.kind !== kind) return;
        e.preventDefault();
        if (kind === 'row') moveRow(drag.index, index); else moveColumn(drag.index, index);
        setDrag(null);
        setOver(null);
    };
    const onDragEnd = () => { setDrag(null); setOver(null); };

    // Keyboard fallback on the grip handles (native DnD is mouse/touch only).
    const onRowKey = (index: number) => (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowUp') { e.preventDefault(); moveRow(index, index - 1); }
        if (e.key === 'ArrowDown') { e.preventDefault(); moveRow(index, index + 1); }
    };
    const onColKey = (index: number) => (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); moveColumn(index, index - 1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); moveColumn(index, index + 1); }
    };

    if (!compare || selectedIds.length === 0) return null;

    const isOver = (kind: DragKind, index: number) => over?.kind === kind && over.index === index && drag?.index !== index;
    const isDragging = (kind: DragKind, index: number) => drag?.kind === kind && drag.index === index;

    return (
        <section
            data-testid="recipe-comparison"
            aria-label="Recipe comparison"
            className="bg-zinc-900/60 border border-zinc-800 rounded-xl overflow-hidden"
        >
            <header className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 border-b border-zinc-800">
                <div className="flex items-center gap-2 text-sm font-bold text-zinc-200">
                    <Table2 className="w-4 h-4 text-yellow-500" />
                    <span>
                        Comparing {selectedIds.length} {selectedIds.length === 1 ? 'recipe' : 'recipes'}
                    </span>
                    {isLoading && <Loader2 className="w-4 h-4 animate-spin text-zinc-500" aria-label="Loading" />}
                </div>
                <p className="text-xs text-zinc-500 flex-1 min-w-[12rem]">
                    {selectedIds.length === 1
                        ? 'Tick another recipe below to compare ingredients side by side.'
                        : 'Drag rows or columns to reorder. Totals sum matching units across all selected recipes.'}
                </p>
                <button
                    type="button"
                    onClick={clear}
                    className="text-xs font-medium text-zinc-400 hover:text-white px-2 py-1 rounded hover:bg-zinc-800 transition-colors"
                >
                    Clear all
                </button>
            </header>

            {notice && (
                <div className="px-4 py-2 text-xs text-amber-300 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-between gap-4">
                    <span>{notice}</span>
                    <button type="button" onClick={() => setNotice(null)} className="text-amber-200/70 hover:text-amber-100" aria-label="Dismiss">
                        <X className="w-3 h-3" />
                    </button>
                </div>
            )}

            {/* The table scrolls inside its own box (both axes) so the recipe
                header row floats above the ingredient rows and the ingredient
                column floats beside the cells, however long the list gets.
                A page-level sticky header is impossible here: the horizontal
                overflow wrapper is the nearest scroll container. */}
            <div className="overflow-auto max-h-[min(70vh,44rem)] overscroll-contain">
                <table className="w-full text-sm border-separate border-spacing-0" data-testid="recipe-comparison-table">
                    <thead className="sticky top-0 z-20" data-testid="comparison-header">
                        <tr>
                            <th scope="col" className="sticky left-0 z-30 bg-zinc-900 text-left text-[10px] uppercase tracking-wider text-zinc-500 font-mono px-3 py-2 border-b border-r border-zinc-700 min-w-[12rem] align-bottom">
                                Ingredient
                            </th>
                            {selectedIds.map((id, index) => {
                                const recipe = loaded[id];
                                return (
                                    <th
                                        key={id}
                                        scope="col"
                                        draggable
                                        data-testid="comparison-column"
                                        data-recipe-id={id}
                                        onDragStart={onDragStart('col', index)}
                                        onDragOver={onDragOver('col', index)}
                                        onDrop={onDrop('col', index)}
                                        onDragEnd={onDragEnd}
                                        className={`align-top px-2 py-2 border-b border-zinc-700 min-w-[7rem] max-w-[10rem] font-normal transition-colors cursor-grab active:cursor-grabbing
                                            ${isOver('col', index) ? 'bg-yellow-500/15 outline outline-1 outline-yellow-500/50' : 'bg-zinc-900'}
                                            ${isDragging('col', index) ? 'opacity-40' : ''}`}
                                    >
                                        <div className="flex flex-col items-center gap-1.5">
                                            <div className="flex items-center gap-1 self-stretch justify-between">
                                                <button
                                                    type="button"
                                                    aria-label={`Move column ${recipe?.title ?? ''}: use left and right arrow keys`}
                                                    title="Drag to reorder (or use ← →)"
                                                    onKeyDown={onColKey(index)}
                                                    className="text-zinc-600 hover:text-zinc-300 focus:text-yellow-500 focus:outline-none cursor-grab"
                                                >
                                                    <GripHorizontal className="w-4 h-4" />
                                                </button>
                                                <button
                                                    type="button"
                                                    aria-label={`Remove ${recipe?.title ?? 'recipe'} from comparison`}
                                                    title="Remove from comparison"
                                                    onClick={() => remove?.(id)}
                                                    className="text-zinc-600 hover:text-red-400 transition-colors"
                                                >
                                                    <X className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                            <Link href={`/lanes?id=${id}`} className="flex flex-col items-center gap-1 group/col" title={recipe?.title}>
                                                <div className="w-12 h-12 bg-zinc-950/60 border border-zinc-800 rounded-md flex items-center justify-center overflow-hidden">
                                                    {recipe?.previewIcon ? (
                                                        <img src={recipe.previewIcon} alt="" className="w-full h-full object-contain" style={{ imageRendering: 'pixelated' }} />
                                                    ) : recipe ? (
                                                        <ChefHat className="w-6 h-6 text-zinc-700" />
                                                    ) : (
                                                        <Loader2 className="w-4 h-4 animate-spin text-zinc-600" />
                                                    )}
                                                </div>
                                                <span className="text-xs text-zinc-300 group-hover/col:text-yellow-500 line-clamp-2 text-center leading-tight break-words">
                                                    {recipe?.title ?? 'Loading…'}
                                                </span>
                                            </Link>
                                        </div>
                                    </th>
                                );
                            })}
                            <th scope="col" className="text-right text-[10px] uppercase tracking-wider text-yellow-500/80 font-mono px-3 py-2 border-b border-l border-zinc-700 bg-zinc-900 min-w-[5rem] align-bottom">
                                <span className="inline-block rounded bg-yellow-500/10 px-1.5 py-0.5">Total</span>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {table.rows.map((row, index) => (
                            <tr
                                key={row.key}
                                draggable
                                data-testid="comparison-row"
                                data-row-key={row.key}
                                onDragStart={onDragStart('row', index)}
                                onDragOver={onDragOver('row', index)}
                                onDrop={onDrop('row', index)}
                                onDragEnd={onDragEnd}
                                className={`group/row transition-colors hover:bg-zinc-800/30
                                    ${isOver('row', index) ? 'bg-yellow-500/10 outline outline-1 outline-yellow-500/50' : ''}
                                    ${isDragging('row', index) ? 'opacity-40' : ''}`}
                            >
                                <th
                                    scope="row"
                                    className="sticky left-0 z-10 bg-zinc-900 font-normal text-left px-2 py-1.5 border-b border-r border-zinc-800/60"
                                    title={row.sources.length ? `From: ${row.sources.join(' · ')}` : undefined}
                                >
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            aria-label={`Move row ${row.label}: use up and down arrow keys`}
                                            title="Drag to reorder (or use ↑ ↓)"
                                            onKeyDown={onRowKey(index)}
                                            className="text-zinc-600 hover:text-zinc-300 focus:text-yellow-500 focus:outline-none cursor-grab shrink-0"
                                        >
                                            <GripVertical className="w-4 h-4" />
                                        </button>
                                        <div className="w-7 h-7 shrink-0 bg-zinc-950/60 border border-zinc-800 rounded flex items-center justify-center overflow-hidden">
                                            {row.iconUrl ? (
                                                <img src={row.iconUrl} alt="" className="w-full h-full object-contain" style={{ imageRendering: 'pixelated' }} />
                                            ) : (
                                                <ChefHat className="w-3.5 h-3.5 text-zinc-700" />
                                            )}
                                        </div>
                                        <span className="text-zinc-200 truncate" title={row.label}>{row.label}</span>
                                        {row.unit && <span className="text-[10px] font-mono text-zinc-500 shrink-0">{row.unit}</span>}
                                    </div>
                                </th>
                                {selectedIds.map(id => (
                                    <td
                                        key={id}
                                        className={`px-2 py-1.5 text-center font-mono tabular-nums border-b border-zinc-800/60 ${row.cells[id] ? 'text-zinc-200' : 'text-zinc-700'}`}
                                        title={row.cells[id]?.unquantified ? 'Listed without a quantity' : undefined}
                                    >
                                        {loaded[id] ? cellText(row.cells[id]) : ''}
                                    </td>
                                ))}
                                <td
                                    className="px-3 py-1.5 text-right font-mono tabular-nums text-yellow-400 bg-yellow-500/5 border-b border-l border-zinc-800/60"
                                    data-testid="comparison-total"
                                    title={row.totalIsPartial ? 'Some recipes list this ingredient without a quantity' : undefined}
                                >
                                    {totalText(row)}
                                    {row.unit && row.total > 0 && <span className="text-[10px] text-zinc-500 ml-1">{row.unit}</span>}
                                </td>
                            </tr>
                        ))}
                        {table.rows.length === 0 && (
                            <tr>
                                <td colSpan={selectedIds.length + 2} className="px-4 py-6 text-center text-xs text-zinc-500">
                                    {isLoading ? 'Loading ingredients…' : 'No ingredients found in the selected recipes.'}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
