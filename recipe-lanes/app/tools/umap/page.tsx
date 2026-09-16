'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase-client';
import { FeedbackButton } from '@/components/feedback-button';
import {
    INGREDIENT_CATEGORIES,
    ICON_ONLY_CATEGORIES,
    getIngredientCategory,
    type ClassificationCategory,
} from '@/lib/recipe-lanes/ingredient-taxonomy';

type IconPoint = {
    id: string;
    name: string;
    x: number;
    y: number;
    imgUrl: string;
    /** Taxonomy category written by scripts/backfill-icon-categories.ts. */
    category?: string;
};

type Cam = { x: number; y: number; scale: number };

const IMG_SIZE = 38;
/** Ring radius: just outside the 38px icon box, so the art is never covered. */
const RING_RADIUS = 22;
const RING_WIDTH = 2;
/** Icons the backfill has not reached yet (or that carry an unknown id). */
const UNCLASSIFIED_COLOR = '#71717a';
/** How much a non-selected category fades when a legend entry is picked. */
const DIMMED_ALPHA = 0.25;

/**
 * Every category an icon may carry, in taxonomy display order. Icons get the
 * twelve comparison categories plus `action_or_state` ("Oven Preheating"),
 * which is why this concatenates rather than using INGREDIENT_CATEGORIES alone.
 */
const ICON_CATEGORIES = [...INGREDIENT_CATEGORIES, ...ICON_ONLY_CATEGORIES];

// Keyed by plain `string`, not by the id union: the lookups below start from a
// Firestore field, which is an arbitrary string until it has been recognised.
const ICON_CATEGORY_BY_ID = new Map<string, ClassificationCategory>(
    ICON_CATEGORIES.map(c => [c.id, c]),
);

/**
 * Resolves a stored `category` string to its taxonomy entry.
 *
 * `getIngredientCategory` is the canonical accessor for the twelve comparison
 * ids; the map adds the icon-only `action_or_state`. Anything else — no
 * category field yet, or an id from an older taxonomy — resolves to undefined
 * and is rendered grey, so "not classified" reads as absence rather than as a
 * real group.
 */
function lookupCategory(category: string | undefined) {
    if (category === undefined) return undefined;
    return getIngredientCategory(category) ?? ICON_CATEGORY_BY_ID.get(category);
}

function categoryColor(category: string | undefined): string {
    return lookupCategory(category)?.color ?? UNCLASSIFIED_COLOR;
}

function categoryLabel(category: string | undefined): string {
    return lookupCategory(category)?.label ?? 'unclassified';
}

function iconUrl(id: string, name: string, bucket: string): string {
    const shortId = id.substring(0, 8);
    const kebab = name.trim().replace(/\s+/g, '-');
    const path = `icons/${kebab}-${shortId}.thumb.png`;
    return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media`;
}

function toScreen(px: number, py: number, cam: Cam) {
    return { sx: px * cam.scale + cam.x, sy: py * cam.scale + cam.y };
}

function toWorld(sx: number, sy: number, cam: Cam) {
    return { wx: (sx - cam.x) / cam.scale, wy: (sy - cam.y) / cam.scale };
}

// Pick one representative per LOD grid cell, filtered to viewport.
function selectReps(points: IconPoint[], cam: Cam, w: number, h: number, cellGap: number): IconPoint[] {
    const cellDataSize = cellGap / cam.scale;
    const cells = new Map<string, IconPoint>();
    for (const pt of points) {
        const key = `${Math.floor(pt.x / cellDataSize)},${Math.floor(pt.y / cellDataSize)}`;
        if (!cells.has(key)) cells.set(key, pt);
    }
    const margin = IMG_SIZE;
    return Array.from(cells.values()).filter(pt => {
        const { sx, sy } = toScreen(pt.x, pt.y, cam);
        return sx > -margin && sx < w + margin && sy > -margin && sy < h + margin;
    });
}

export default function UmapPage() {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [points, setPoints] = useState<IconPoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [hovered, setHovered] = useState<IconPoint | null>(null);
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
    const [cellGap, setCellGap] = useState(76);
    const cellGapRef = useRef(76);
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    const selectedCategoryRef = useRef<string | null>(null);

    const camera = useRef<Cam>({ x: 0, y: 0, scale: 1 });
    const dragging = useRef<{ startX: number; startY: number; camX: number; camY: number } | null>(null);
    const imgCache = useRef(new Map<string, HTMLImageElement | 'loading' | 'error'>());
    // Keep points in a ref so draw() called from image onload always sees current data.
    const pointsRef = useRef<IconPoint[]>([]);

    const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? 'recipe-lanes.firebasestorage.app';

    // Counts over ALL points, not the LOD representatives: the legend is a
    // census of the corpus, and it must not change as you zoom.
    const categoryCounts = useMemo(() => {
        const counts = new Map<string, number>();
        let unclassified = 0;
        for (const pt of points) {
            if (pt.category === undefined) unclassified++;
            else counts.set(pt.category, (counts.get(pt.category) ?? 0) + 1);
        }
        return { counts, unclassified };
    }, [points]);

    function getOrLoadImg(url: string): HTMLImageElement | null {
        const cached = imgCache.current.get(url);
        if (cached instanceof HTMLImageElement) return cached;
        if (cached === 'loading' || cached === 'error') return null;
        imgCache.current.set(url, 'loading');
        const img = new Image();
        img.onload = () => { imgCache.current.set(url, img); draw(); };
        img.onerror = () => { imgCache.current.set(url, 'error'); };
        img.src = url;
        return null;
    }

    function draw() {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d')!;
        const cam = camera.current;
        const pts = pointsRef.current;
        const selected = selectedCategoryRef.current;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Gridlines in data space
        const gridStep = 1;
        const { x: cx, y: cy, scale } = cam;
        const left = -cx / scale, right = (canvas.width - cx) / scale;
        const top = -cy / scale, bottom = (canvas.height - cy) / scale;
        const startX = Math.floor(left / gridStep) * gridStep;
        const startY = Math.floor(top / gridStep) * gridStep;
        ctx.strokeStyle = '#e5e7eb';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let gx = startX; gx <= right; gx += gridStep) {
            const sx = gx * scale + cx;
            ctx.moveTo(sx, 0); ctx.lineTo(sx, canvas.height);
        }
        for (let gy = startY; gy <= bottom; gy += gridStep) {
            const sy = gy * scale + cy;
            ctx.moveTo(0, sy); ctx.lineTo(canvas.width, sy);
        }
        ctx.stroke();

        const reps = selectReps(pts, cam, canvas.width, canvas.height, cellGapRef.current);
        const half = IMG_SIZE / 2;

        for (const pt of reps) {
            const { sx, sy } = toScreen(pt.x, pt.y, cam);
            const color = categoryColor(pt.category);
            // With a category selected, everything else keeps its colour but
            // fades back, so the selection reads against the real map rather
            // than against an empty one.
            const dimmed = selected !== null && pt.category !== selected;
            ctx.globalAlpha = dimmed ? DIMMED_ALPHA : 1;

            const img = getOrLoadImg(pt.imgUrl);
            if (img) {
                // Ring first, icon over it: the stroke sits proud of the 38px
                // box, so the art stays fully visible inside a colour halo.
                ctx.beginPath();
                ctx.arc(sx, sy, RING_RADIUS, 0, Math.PI * 2);
                ctx.strokeStyle = color;
                ctx.lineWidth = RING_WIDTH;
                ctx.stroke();
                ctx.drawImage(img, sx - half, sy - half, IMG_SIZE, IMG_SIZE);
            } else {
                // Pre-load placeholder. Category-coloured too, so the map is
                // already readable before a single thumbnail has arrived.
                ctx.beginPath();
                ctx.arc(sx, sy, 3, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.fill();
            }
        }

        ctx.globalAlpha = 1;
    }

    useEffect(() => { pointsRef.current = points; }, [points]);
    useEffect(() => { cellGapRef.current = cellGap; draw(); }, [cellGap]);
    useEffect(() => { selectedCategoryRef.current = selectedCategory; draw(); }, [selectedCategory]);

    function onWheel(e: WheelEvent) {
        e.preventDefault();
        const rect = canvasRef.current!.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const { wx, wy } = toWorld(sx, sy, camera.current);
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        camera.current.scale *= factor;
        camera.current.x = sx - wx * camera.current.scale;
        camera.current.y = sy - wy * camera.current.scale;
        draw();
    }

    // Size the canvas pixel buffer to match the container after mount.
    // Never read window in JSX — avoids SSR/client hydration mismatch.
    useEffect(() => {
        const container = containerRef.current;
        const canvas = canvasRef.current;
        if (!container || !canvas) return;

        const resize = () => {
            canvas.width = container.offsetWidth;
            canvas.height = container.offsetHeight;
            draw();
        };

        resize();
        const ro = new ResizeObserver(resize);
        ro.observe(container);
        canvas.addEventListener('wheel', onWheel, { passive: false });
        return () => { ro.disconnect(); canvas.removeEventListener('wheel', onWheel); };
    }, []);

    // Load points
    useEffect(() => {
        getDocs(collection(db, 'icon_index')).then(snap => {
            const pts: IconPoint[] = [];
            snap.forEach(doc => {
                const d = doc.data();
                if (d.umap_x == null || d.umap_y == null) return;
                pts.push({
                    id: doc.id,
                    name: d.ingredient_name ?? doc.id,
                    x: d.umap_x,
                    y: d.umap_y,
                    imgUrl: iconUrl(doc.id, d.ingredient_name ?? doc.id, bucket),
                    // Absent until the icon backfill has run against this env;
                    // the whole view degrades to grey rings, never to an error.
                    category: typeof d.category === 'string' ? d.category : undefined,
                });
            });
            setPoints(pts);
            setLoading(false);
        });
    }, []);

    // Fit camera to data on first load
    useEffect(() => {
        if (points.length === 0) return;
        const canvas = canvasRef.current;
        if (!canvas || canvas.width === 0) return;
        const xs = points.map(p => p.x);
        const ys = points.map(p => p.y);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        const pad = 60;
        const scaleX = (canvas.width - pad * 2) / (maxX - minX);
        const scaleY = (canvas.height - pad * 2) / (maxY - minY);
        const scale = Math.min(scaleX, scaleY);
        camera.current = {
            scale,
            x: pad - minX * scale + ((canvas.width - pad * 2) - (maxX - minX) * scale) / 2,
            y: pad - minY * scale + ((canvas.height - pad * 2) - (maxY - minY) * scale) / 2,
        };
        draw();
    }, [points]);

    function findNearest(sx: number, sy: number): IconPoint | null {
        const canvas = canvasRef.current;
        if (!canvas) return null;
        const reps = selectReps(pointsRef.current, camera.current, canvas.width, canvas.height, cellGapRef.current);
        let best: IconPoint | null = null;
        let bestD = (IMG_SIZE / 2 + 6) ** 2;
        for (const pt of reps) {
            const { sx: px, sy: py } = toScreen(pt.x, pt.y, camera.current);
            const d = (px - sx) ** 2 + (py - sy) ** 2;
            if (d < bestD) { bestD = d; best = pt; }
        }
        return best;
    }

    function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
        const rect = canvasRef.current!.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        setMousePos({ x: e.clientX, y: e.clientY });

        if (dragging.current) {
            camera.current.x = dragging.current.camX + (sx - dragging.current.startX);
            camera.current.y = dragging.current.camY + (sy - dragging.current.startY);
            draw();
            return;
        }

        setHovered(findNearest(sx, sy));
    }

    function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
        const rect = canvasRef.current!.getBoundingClientRect();
        dragging.current = {
            startX: e.clientX - rect.left,
            startY: e.clientY - rect.top,
            camX: camera.current.x,
            camY: camera.current.y,
        };
        setHovered(null);
    }

    function onMouseUp() { dragging.current = null; }

    /** Click the selected entry again to clear the highlight. */
    function toggleCategory(id: string) {
        setSelectedCategory(current => (current === id ? null : id));
    }

    return (
        <div className="w-screen h-screen bg-white flex flex-col">
            <div className="px-4 py-2 flex items-center gap-3 border-b border-zinc-200">
                <span className="text-sm font-mono text-zinc-500">icon embedding space</span>
                {!loading && <span className="text-xs text-zinc-400">{points.length} icons · scroll to zoom · drag to pan</span>}
                {loading && <span className="text-xs text-zinc-400 animate-pulse">loading...</span>}
                <div className="ml-auto flex items-center gap-3">
                    {!loading && (
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-zinc-500">density</span>
                            <input
                                type="range" min={20} max={200} step={4}
                                value={cellGap}
                                onChange={e => setCellGap(Number(e.target.value))}
                                className="w-24 accent-zinc-400"
                            />
                            <span className="text-xs text-zinc-600 w-6 text-right">{cellGap}</span>
                        </div>
                    )}
                    {/* This toolbar is light-themed, unlike the other top bars,
                        so the button needs its own colours rather than the
                        shared dark nav-item styling. */}
                    <FeedbackButton className="flex items-center gap-2 px-2 py-1 rounded-md text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors text-xs font-medium" />
                </div>
            </div>

            <div ref={containerRef} className="relative flex-1">
                <canvas
                    ref={canvasRef}
                    className="absolute inset-0 cursor-crosshair"
                    onMouseMove={onMouseMove}
                    onMouseDown={onMouseDown}
                    onMouseUp={onMouseUp}
                    onMouseLeave={onMouseUp}
                />

                {!loading && (
                    <div className="absolute top-3 left-3 z-10 max-h-[calc(100%-1.5rem)] overflow-y-auto bg-white/95 border border-zinc-200 rounded-lg shadow-sm p-2">
                        <p className="text-xs font-medium text-zinc-500 px-1 pb-1">category</p>
                        {ICON_CATEGORIES.map(category => {
                            const count = categoryCounts.counts.get(category.id) ?? 0;
                            const active = selectedCategory === category.id;
                            return (
                                <button
                                    key={category.id}
                                    type="button"
                                    onClick={() => toggleCategory(category.id)}
                                    className={`w-full flex items-center gap-2 px-1 py-0.5 rounded text-left text-xs transition-colors ${
                                        active ? 'bg-zinc-100 text-zinc-900 font-medium' : 'text-zinc-600 hover:bg-zinc-50'
                                    }`}
                                    aria-pressed={active}
                                    title={category.rules}
                                >
                                    <span
                                        className="w-3 h-3 rounded-full shrink-0"
                                        style={{ backgroundColor: category.color }}
                                    />
                                    <span className="flex-1 truncate">{category.label}</span>
                                    <span className="tabular-nums text-zinc-400">{count}</span>
                                </button>
                            );
                        })}
                        {/* Not a category — the count of icons the backfill has
                            not reached. Deliberately not clickable: there is
                            nothing to highlight, only something to go and run. */}
                        {categoryCounts.unclassified > 0 && (
                            <div className="w-full flex items-center gap-2 px-1 py-0.5 text-xs text-zinc-400 border-t border-zinc-100 mt-1 pt-1">
                                <span
                                    className="w-3 h-3 rounded-full shrink-0 opacity-40"
                                    style={{ backgroundColor: UNCLASSIFIED_COLOR }}
                                />
                                <span className="flex-1 truncate">unclassified</span>
                                <span className="tabular-nums">{categoryCounts.unclassified}</span>
                            </div>
                        )}
                    </div>
                )}

                {hovered && (
                    <div
                        className="pointer-events-none fixed z-10 bg-white border border-zinc-200 rounded-lg p-2 shadow-lg"
                        style={{ left: mousePos.x + 16, top: mousePos.y - 80 }}
                    >
                        <img
                            src={hovered.imgUrl}
                            alt={hovered.name}
                            className="w-16 h-16 object-contain"
                        />
                        <p className="text-xs text-zinc-600 mt-1 max-w-32 text-center leading-tight">{hovered.name}</p>
                        <p
                            className="text-[10px] mt-0.5 text-center leading-tight"
                            style={{ color: categoryColor(hovered.category) }}
                        >
                            {categoryLabel(hovered.category)}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
