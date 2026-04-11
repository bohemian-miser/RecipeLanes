'use client';

import { useEffect, useRef, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase-client';

type IconPoint = {
    id: string;
    name: string;
    x: number;
    y: number;
    imgUrl: string;
};

type Cam = { x: number; y: number; scale: number };

const IMG_SIZE = 38;

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

    const camera = useRef<Cam>({ x: 0, y: 0, scale: 1 });
    const dragging = useRef<{ startX: number; startY: number; camX: number; camY: number } | null>(null);
    const imgCache = useRef(new Map<string, HTMLImageElement | 'loading' | 'error'>());
    // Keep points in a ref so draw() called from image onload always sees current data.
    const pointsRef = useRef<IconPoint[]>([]);

    const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? 'recipe-lanes.firebasestorage.app';

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
            const img = getOrLoadImg(pt.imgUrl);
            if (img) {
                ctx.drawImage(img, sx - half, sy - half, IMG_SIZE, IMG_SIZE);
            } else {
                ctx.beginPath();
                ctx.arc(sx, sy, 3, 0, Math.PI * 2);
                ctx.fillStyle = '#d4d4d8';
                ctx.fill();
            }
        }
    }

    useEffect(() => { pointsRef.current = points; }, [points]);
    useEffect(() => { cellGapRef.current = cellGap; draw(); }, [cellGap]);

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

    return (
        <div className="w-screen h-screen bg-white flex flex-col">
            <div className="px-4 py-2 flex items-center gap-3 border-b border-zinc-200">
                <span className="text-sm font-mono text-zinc-500">icon embedding space</span>
                {!loading && <span className="text-xs text-zinc-400">{points.length} icons · scroll to zoom · drag to pan</span>}
                {loading && <span className="text-xs text-zinc-400 animate-pulse">loading...</span>}
                {!loading && (
                    <div className="flex items-center gap-2 ml-auto">
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
                    </div>
                )}
            </div>
        </div>
    );
}
