'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase-client';
import { FeedbackButton } from '@/components/feedback-button';
import {
    getClassificationCategory,
    ALL_CLASSIFICATION_CATEGORIES,
    UNCLASSIFIED_PRESENTATION,
} from '@/lib/recipe-lanes/ingredient-taxonomy';

type IconPoint = {
    id: string;
    name: string;
    x: number;
    y: number;
    imgUrl: string;
    /**
     * A category id this taxonomy KNOWS, or undefined.
     *
     * Normalised at load: an id the taxonomy no longer recognises, an empty
     * string, or a missing field all become undefined here rather than being
     * carried around raw. That is what lets the legend census be exhaustive —
     * every point is either one of the listed categories or unclassified, so
     * the counts and `points.length` cannot drift apart.
     */
    category?: string;
};

type Cam = { x: number; y: number; scale: number };

const IMG_SIZE = 38;
/**
 * Ring radius. Must clear the icon's half-DIAGONAL (√2 · 38 / 2 ≈ 26.9), not
 * just its half-width: at radius 22 the ring passed under the corners of the
 * 38px box, so any icon whose art reached its corners clipped its own ring.
 */
const RING_RADIUS = 27;
const RING_WIDTH = 2;
/** Dash pattern for points with no category — a cue that survives colour-blindness. */
const UNCLASSIFIED_DASH = [4, 4];
/** How much a non-selected category fades when a legend entry is picked. */
const DIMMED_ALPHA = 0.25;

/** Dark canvas: the category palette only separates against a dark ground. */
const CANVAS_BG = '#09090b';
const GRID_COLOR = '#27272a';

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

/**
 * Pick one representative per LOD grid cell, filtered to viewport.
 *
 * `selected` makes the sampling selection-AWARE, and that is load-bearing:
 * sampling category-blind meant a cell whose first point happened to be some
 * other category dropped the selected point entirely, so highlighting a
 * category hid most of it — the denser the map, the more of the selection
 * vanished. A cell that contains a selected-category point now shows one.
 */
function selectReps(
    points: IconPoint[],
    cam: Cam,
    w: number,
    h: number,
    cellGap: number,
    selected: string | null,
): IconPoint[] {
    const cellDataSize = cellGap / cam.scale;
    const cells = new Map<string, IconPoint>();
    for (const pt of points) {
        const key = `${Math.floor(pt.x / cellDataSize)},${Math.floor(pt.y / cellDataSize)}`;
        const current = cells.get(key);
        if (current === undefined) {
            cells.set(key, pt);
        } else if (selected !== null && pt.category === selected && current.category !== selected) {
            cells.set(key, pt);
        }
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

    /**
     * Legend census over ALL points, not the LOD representatives — it describes
     * the corpus, so it must not change as you zoom. Because `category` is
     * normalised at load, these counts plus `unclassified` always total
     * `points.length`.
     */
    const census = useMemo(() => {
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
        ctx.fillStyle = CANVAS_BG;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Gridlines in data space
        const gridStep = 1;
        const { x: cx, y: cy, scale } = cam;
        const left = -cx / scale, right = (canvas.width - cx) / scale;
        const top = -cy / scale, bottom = (canvas.height - cy) / scale;
        const startX = Math.floor(left / gridStep) * gridStep;
        const startY = Math.floor(top / gridStep) * gridStep;
        ctx.strokeStyle = GRID_COLOR;
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

        const reps = selectReps(pts, cam, canvas.width, canvas.height, cellGapRef.current, selected);
        const half = IMG_SIZE / 2;

        for (const pt of reps) {
            const { sx, sy } = toScreen(pt.x, pt.y, cam);
            const category = getClassificationCategory(pt.category);
            const color = category?.color ?? UNCLASSIFIED_PRESENTATION.color;
            // With a category selected, everything else keeps its colour but
            // fades back, so the selection reads against the real map rather
            // than against an empty one.
            const dimmed = selected !== null && pt.category !== selected;
            ctx.globalAlpha = dimmed ? DIMMED_ALPHA : 1;
            // A dashed ring separates "not classified yet" from `other`, which
            // is a decision the classifier actually made. Both are grey, so
            // colour alone could not carry that difference.
            ctx.setLineDash(category === undefined ? UNCLASSIFIED_DASH : []);

            const img = getOrLoadImg(pt.imgUrl);
            if (img) {
                // Ring first, icon over it: the stroke clears the whole 38px
                // box, so the art sits inside an unbroken colour halo.
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
        ctx.setLineDash([]);
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
                    // Resolved through the taxonomy here rather than at render
                    // time: anything it does not recognise becomes undefined,
                    // i.e. unclassified, in exactly one place.
                    category: getClassificationCategory(d.category)?.id,
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
        // Same selection as draw(), or hover would target points that are not
        // the ones on screen.
        const reps = selectReps(
            pointsRef.current,
            camera.current,
            canvas.width,
            canvas.height,
            cellGapRef.current,
            selectedCategoryRef.current,
        );
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

    const hoveredCategory = hovered ? getClassificationCategory(hovered.category) : undefined;

    return (
        <div className="w-screen h-screen bg-zinc-950 flex flex-col">
            <div className="px-4 py-2 flex items-center gap-3 border-b border-zinc-800">
                <span className="text-sm font-mono text-zinc-400">icon embedding space</span>
                {!loading && <span className="text-xs text-zinc-500">{points.length} icons · scroll to zoom · drag to pan</span>}
                {loading && <span className="text-xs text-zinc-500 animate-pulse">loading...</span>}
                <div className="ml-auto flex items-center gap-3">
                    {!loading && (
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-zinc-500">density</span>
                            <input
                                type="range" min={20} max={200} step={4}
                                value={cellGap}
                                onChange={e => setCellGap(Number(e.target.value))}
                                className="w-24 accent-zinc-500"
                            />
                            <span className="text-xs text-zinc-400 w-6 text-right">{cellGap}</span>
                        </div>
                    )}
                    <FeedbackButton className="flex items-center gap-2 px-2 py-1 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors text-xs font-medium" />
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
                    <div className="absolute top-3 left-3 z-10 max-h-[calc(100%-1.5rem)] overflow-y-auto bg-zinc-900/95 border border-zinc-800 rounded-lg shadow-lg p-2">
                        <p className="text-xs font-medium text-zinc-500 px-1 pb-1">category</p>
                        {ALL_CLASSIFICATION_CATEGORIES.map(category => {
                            const count = census.counts.get(category.id) ?? 0;
                            const active = selectedCategory === category.id;
                            return (
                                <button
                                    key={category.id}
                                    type="button"
                                    onClick={() => toggleCategory(category.id)}
                                    className={`w-full flex items-center gap-2 px-1 py-0.5 rounded text-left text-xs transition-colors ${
                                        active ? 'bg-zinc-800 text-zinc-100 font-medium' : 'text-zinc-400 hover:bg-zinc-800/60'
                                    }`}
                                    aria-pressed={active}
                                    title={category.rules}
                                >
                                    <span
                                        className="w-3 h-3 rounded-full shrink-0"
                                        style={{ backgroundColor: category.color }}
                                    />
                                    <span className="flex-1 truncate">{category.label}</span>
                                    <span className="tabular-nums text-zinc-500">{count}</span>
                                </button>
                            );
                        })}
                        {/* Not a category — the points the backfill has not
                            reached, or that carry an id this taxonomy dropped.
                            Deliberately not clickable: there is nothing to
                            highlight, only something to go and run. The hollow
                            dashed swatch mirrors the dashed ring on the canvas. */}
                        {census.unclassified > 0 && (
                            <div className="w-full flex items-center gap-2 px-1 py-0.5 text-xs text-zinc-500 border-t border-zinc-800 mt-1 pt-1">
                                <span
                                    className="w-3 h-3 rounded-full shrink-0 border border-dashed"
                                    style={{ borderColor: UNCLASSIFIED_PRESENTATION.color }}
                                />
                                <span className="flex-1 truncate">{UNCLASSIFIED_PRESENTATION.label}</span>
                                <span className="tabular-nums">{census.unclassified}</span>
                            </div>
                        )}
                    </div>
                )}

                {hovered && (
                    <div
                        className="pointer-events-none fixed z-10 bg-zinc-900 border border-zinc-800 rounded-lg p-2 shadow-lg"
                        style={{ left: mousePos.x + 16, top: mousePos.y - 80 }}
                    >
                        <img
                            src={hovered.imgUrl}
                            alt={hovered.name}
                            className="w-16 h-16 object-contain"
                        />
                        <p className="text-xs text-zinc-300 mt-1 max-w-32 text-center leading-tight">{hovered.name}</p>
                        <p
                            className="text-[10px] mt-0.5 text-center leading-tight"
                            style={{ color: hoveredCategory?.color ?? UNCLASSIFIED_PRESENTATION.color }}
                        >
                            {hoveredCategory?.label ?? UNCLASSIFIED_PRESENTATION.label}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
