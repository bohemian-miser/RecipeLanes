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

function iconUrl(id: string, name: string, bucket: string): string {
    const shortId = id.substring(0, 8);
    const kebab = name.trim().replace(/\s+/g, '-');
    const path = `icons/${kebab}-${shortId}.png`;
    return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media`;
}

export default function UmapPage() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [points, setPoints] = useState<IconPoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [hovered, setHovered] = useState<IconPoint | null>(null);
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

    // camera: translate + scale
    const camera = useRef({ x: 0, y: 0, scale: 1 });
    const dragging = useRef<{ startX: number; startY: number; camX: number; camY: number } | null>(null);

    const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? 'recipe-lanes.firebasestorage.app';

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

    // Fit camera to data on load
    useEffect(() => {
        if (points.length === 0) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const xs = points.map(p => p.x);
        const ys = points.map(p => p.y);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        const pad = 40;
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

    function toScreen(px: number, py: number) {
        const { x, y, scale } = camera.current;
        return { sx: px * scale + x, sy: py * scale + y };
    }

    function toWorld(sx: number, sy: number) {
        const { x, y, scale } = camera.current;
        return { wx: (sx - x) / scale, wy: (sy - y) / scale };
    }

    function draw() {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d')!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#09090b';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        for (const pt of points) {
            const { sx, sy } = toScreen(pt.x, pt.y);
            ctx.beginPath();
            ctx.arc(sx, sy, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#52525b';
            ctx.fill();
        }
    }

    // Redraw when points change
    useEffect(() => { draw(); }, [points]);

    function findNearest(sx: number, sy: number): IconPoint | null {
        let best: IconPoint | null = null;
        let bestD = 12 * 12;
        for (const pt of points) {
            const { sx: px, sy: py } = toScreen(pt.x, pt.y);
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

        const nearest = findNearest(sx, sy);
        setHovered(nearest);
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

    function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
        e.preventDefault();
        const rect = canvasRef.current!.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const { wx, wy } = toWorld(sx, sy);
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        camera.current.scale *= factor;
        camera.current.x = sx - wx * camera.current.scale;
        camera.current.y = sy - wy * camera.current.scale;
        draw();
    }

    return (
        <div className="w-screen h-screen bg-zinc-950 flex flex-col">
            <div className="px-4 py-2 flex items-center gap-3 border-b border-zinc-800">
                <span className="text-sm font-mono text-zinc-400">icon embedding space</span>
                {!loading && <span className="text-xs text-zinc-600">{points.length} icons · scroll to zoom · drag to pan</span>}
                {loading && <span className="text-xs text-zinc-500 animate-pulse">loading...</span>}
            </div>

            <div className="relative flex-1">
                <canvas
                    ref={canvasRef}
                    width={typeof window !== 'undefined' ? window.innerWidth : 1200}
                    height={typeof window !== 'undefined' ? window.innerHeight - 41 : 800}
                    className="block cursor-crosshair"
                    onMouseMove={onMouseMove}
                    onMouseDown={onMouseDown}
                    onMouseUp={onMouseUp}
                    onMouseLeave={onMouseUp}
                    onWheel={onWheel}
                />

                {hovered && (
                    <div
                        className="pointer-events-none fixed z-10 bg-zinc-900 border border-zinc-700 rounded-lg p-2 shadow-xl"
                        style={{ left: mousePos.x + 16, top: mousePos.y - 80 }}
                    >
                        <img
                            src={hovered.imgUrl}
                            alt={hovered.name}
                            className="w-16 h-16 object-contain"
                        />
                        <p className="text-xs text-zinc-300 mt-1 max-w-32 text-center leading-tight">{hovered.name}</p>
                    </div>
                )}
            </div>
        </div>
    );
}
