"""
ie_05_viz.py

Reads scripts/ie_data/viz_data.json and generates scripts/icon-explorer.html,
then starts a local HTTP server on port 8765 serving from scripts/.

Run from recipe-lanes/:
    python3 scripts/ie_05_viz.py
"""

import json
import os
import sys
import webbrowser
import http.server
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).parent
IE_DATA_DIR = Path(__file__).parent.parent.parent / 'recipe-lanes' / 'scripts' / 'ie_data'
VIZ_DATA_FILE = IE_DATA_DIR / "viz_data.json"
OUTPUT_HTML = SCRIPT_DIR / "icon-explorer.html"

SERVER_PORT = 8765
SERVER_URL = f"http://localhost:{SERVER_PORT}/icon-explorer.html"


# ---------------------------------------------------------------------------
# HTML template
# ---------------------------------------------------------------------------

HTML_TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Action Icon Explorer</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  html, body {
    width: 100%; height: 100%;
    background: #12121f;
    color: #e0e0f0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 14px;
    overflow: hidden;
  }

  #app {
    display: flex;
    width: 100vw;
    height: 100vh;
  }

  /* ---- Canvas area ---- */
  #canvas-area {
    flex: 1 1 0;
    min-width: 0;
    position: relative;
    overflow: hidden;
  }

  #main-canvas {
    display: block;
    width: 100%;
    height: 100%;
    cursor: grab;
  }
  #main-canvas.dragging { cursor: grabbing; }

  /* ---- Sidebar ---- */
  #sidebar {
    flex: 0 0 280px;
    width: 280px;
    background: #1a1a2e;
    border-left: 1px solid #2a2a4a;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  #sidebar-header {
    padding: 16px 16px 12px;
    border-bottom: 1px solid #2a2a4a;
    flex-shrink: 0;
  }

  #sidebar-header h1 {
    font-size: 15px;
    font-weight: 700;
    color: #c0c0f0;
    margin-bottom: 12px;
    letter-spacing: 0.02em;
  }

  /* Tabs */
  #tab-bar {
    display: flex;
    gap: 4px;
    margin-bottom: 12px;
  }

  .tab-btn {
    flex: 1;
    padding: 6px 8px;
    border: 1px solid #3a3a5a;
    border-radius: 6px;
    background: #12121f;
    color: #8888aa;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
    text-align: center;
  }
  .tab-btn:hover:not(.active):not(:disabled) {
    background: #222240;
    color: #b0b0d0;
    border-color: #5a5a8a;
  }
  .tab-btn.active {
    background: #3a3a7a;
    color: #e0e0ff;
    border-color: #6a6aaa;
    font-weight: 600;
  }
  .tab-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  /* K selector */
  #k-controls {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  #k-controls label {
    font-size: 12px;
    color: #8888aa;
    white-space: nowrap;
  }

  #k-select {
    flex: 1;
    padding: 4px 8px;
    background: #12121f;
    border: 1px solid #3a3a5a;
    border-radius: 5px;
    color: #c0c0f0;
    font-size: 13px;
    cursor: pointer;
    outline: none;
  }
  #k-select:focus { border-color: #6a6aaa; }

  /* Divider */
  .divider {
    height: 1px;
    background: #2a2a4a;
    margin: 0;
    flex-shrink: 0;
  }

  /* Cluster list */
  #cluster-list-wrap {
    flex: 1 1 0;
    overflow-y: auto;
    padding: 8px 0;
  }
  #cluster-list-wrap::-webkit-scrollbar { width: 5px; }
  #cluster-list-wrap::-webkit-scrollbar-track { background: transparent; }
  #cluster-list-wrap::-webkit-scrollbar-thumb { background: #3a3a5a; border-radius: 3px; }

  .cluster-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 14px;
    cursor: pointer;
    border: 1px solid transparent;
    border-radius: 6px;
    margin: 1px 6px;
    transition: background 0.12s, border-color 0.12s;
  }
  .cluster-row:hover { background: #222240; }
  .cluster-row.selected {
    background: #252550;
    border-color: #5a5aaa;
  }

  .cluster-swatch {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    flex-shrink: 0;
    box-shadow: 0 0 0 1px rgba(255,255,255,0.15);
  }

  .cluster-name {
    flex: 1;
    font-size: 13px;
    color: #c0c0e0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cluster-badge {
    font-size: 11px;
    color: #6060a0;
    flex-shrink: 0;
    background: #1e1e3a;
    padding: 2px 6px;
    border-radius: 10px;
    white-space: nowrap;
  }

  /* Footer */
  #sidebar-footer {
    flex-shrink: 0;
    padding: 10px 14px;
    border-top: 1px solid #2a2a4a;
    font-size: 11px;
    color: #505080;
    line-height: 1.6;
  }

  /* ---- Tooltip ---- */
  #tooltip {
    position: fixed;
    display: none;
    background: #1e1e3a;
    border: 1px solid #4a4a7a;
    border-radius: 8px;
    padding: 10px 13px;
    max-width: 260px;
    pointer-events: none;
    z-index: 1000;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
  }
  #tooltip .tt-desc {
    font-weight: 700;
    font-size: 13px;
    color: #e0e0ff;
    margin-bottom: 4px;
    word-break: break-word;
  }
  #tooltip .tt-count {
    font-size: 12px;
    color: #8080c0;
  }
  #tooltip .tt-cluster {
    font-size: 12px;
    color: #7070b0;
    margin-top: 2px;
  }

  /* ---- Loading overlay ---- */
  #loading-overlay {
    position: absolute;
    inset: 0;
    background: rgba(18,18,31,0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 15px;
    color: #8888cc;
    pointer-events: none;
    z-index: 10;
  }
  #loading-overlay.hidden { display: none; }

  #error-msg {
    position: absolute;
    inset: 0;
    display: none;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 10px;
    color: #cc6666;
    font-size: 14px;
    z-index: 10;
  }
</style>
</head>
<body>
<div id="app">
  <div id="canvas-area">
    <canvas id="main-canvas"></canvas>
    <div id="loading-overlay">Loading data...</div>
    <div id="error-msg"></div>
  </div>

  <div id="sidebar">
    <div id="sidebar-header">
      <h1>Action Icon Explorer</h1>
      <div id="tab-bar">
        <button class="tab-btn active" id="btn-text" onclick="app.switchTab('text')">Text Embeddings</button>
        <button class="tab-btn" id="btn-image" onclick="app.switchTab('image')">Image Embeddings</button>
      </div>
      <div id="k-controls">
        <label for="k-select">Clusters K:</label>
        <select id="k-select" onchange="app.switchK(parseInt(this.value))">
          <option value="10">10</option>
          <option value="15">15</option>
          <option value="20">20</option>
          <option value="25" selected>25</option>
          <option value="30">30</option>
          <option value="40">40</option>
        </select>
      </div>
    </div>

    <div class="divider"></div>

    <div id="cluster-list-wrap">
      <div id="cluster-list"></div>
    </div>

    <div class="divider"></div>
    <div id="sidebar-footer">Loading...</div>
  </div>
</div>

<div id="tooltip">
  <div class="tt-desc" id="tt-desc"></div>
  <div class="tt-count" id="tt-count"></div>
  <div class="tt-cluster" id="tt-cluster"></div>
</div>

<script>
'use strict';

const COLORS = [
  '#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f',
  '#edc948','#b07aa1','#ff9da7','#9c755f','#bab0ac',
  '#1f77b4','#ff7f0e','#2ca02c','#d62728','#9467bd',
  '#8c564b','#e377c2','#bcbd22','#17becf','#393b79',
  '#637939','#8c6d31','#843c39','#7b4173','#aec7e8'
];

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ---------------------------------------------------------------------------
// Main App class
// ---------------------------------------------------------------------------

class IconExplorerApp {
  constructor() {
    this.data = null;
    this.images = [];        // HTMLImageElement per item
    this.imagesLoaded = 0;
    this.imageTotal = 0;
    this.stillLoading = false;
    this.loadTimer = null;

    // View state
    this.currentTab = 'text';   // 'text' | 'image'
    this.currentK = 25;
    this.selectedCluster = null; // null or int

    // Transform
    this.panX = 0;
    this.panY = 0;
    this.zoom = 1.0;

    // Drag/touch state
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.dragStartPanX = 0;
    this.dragStartPanY = 0;
    this.lastPinchDist = null;

    // Hover
    this.hoveredIdx = -1;
    this.lastMouseX = 0;
    this.lastMouseY = 0;

    // RAF handle
    this._rafId = null;
    this._renderScheduled = false;
  }

  // ---- Initialise -------------------------------------------------------

  async init() {
    this.canvas = document.getElementById('main-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.tooltip = document.getElementById('tooltip');
    this.loadingOverlay = document.getElementById('loading-overlay');

    this._bindEvents();
    this._resizeCanvas();

    // Load data
    try {
      const resp = await fetch('ie_data/viz_data.json');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      this.data = await resp.json();
    } catch (err) {
      this._showError(`Failed to load viz_data.json:<br><code>${err.message}</code>`);
      return;
    }

    this._setup();
  }

  _showError(msg) {
    this.loadingOverlay.classList.add('hidden');
    const el = document.getElementById('error-msg');
    el.style.display = 'flex';
    el.innerHTML = `<div>${msg}</div>`;
  }

  _setup() {
    const d = this.data;
    const n = d.items.length;

    // Check image embedding availability
    const hasImageCoords = d.items.some(item => item.umap_image != null);
    this.hasImage = hasImageCoords;

    const btnImage = document.getElementById('btn-image');
    if (!this.hasImage) {
      btnImage.disabled = true;
      btnImage.title = 'Image embeddings not available';
    }

    // Update footer
    const nWithIcon = d.items.filter(it => it.thumb_b64).length;
    document.getElementById('sidebar-footer').textContent =
      `${n} descriptions · ${nWithIcon} with icons`;

    // Pre-load images
    this.images = new Array(n).fill(null);
    this.imageTotal = nWithIcon;
    this.imagesLoaded = 0;
    this.stillLoading = nWithIcon > 0;

    for (let i = 0; i < n; i++) {
      const item = d.items[i];
      if (item.thumb_b64) {
        const img = new Image();
        img.onload = () => {
          this.imagesLoaded++;
          if (this.imagesLoaded >= this.imageTotal) {
            this.stillLoading = false;
            if (this.loadTimer) { clearInterval(this.loadTimer); this.loadTimer = null; }
          }
        };
        img.src = item.thumb_b64;
        this.images[i] = img;
      }
    }

    // Periodic re-render while images load
    if (this.stillLoading) {
      this.loadTimer = setInterval(() => {
        if (!this.stillLoading && this.loadTimer) {
          clearInterval(this.loadTimer);
          this.loadTimer = null;
        }
        this._scheduleRender();
      }, 500);
    }

    // Initial view
    this._fitView();
    this._buildSidebar();
    this.loadingOverlay.classList.add('hidden');
    this._scheduleRender();
  }

  // ---- View helpers -------------------------------------------------------

  _getPoints() {
    const key = this.currentTab === 'image' ? 'umap_image' : 'umap_text';
    return this.data.items.map(it => it[key] || it.umap_text);
  }

  _fitView() {
    const pts = this._getPoints();
    if (!pts.length) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of pts) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }

    const W = this.canvas.width, H = this.canvas.height;
    const pad = 60;
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const scale = Math.min((W - pad*2) / rangeX, (H - pad*2) / rangeY) * 0.95;
    this.zoom = scale;

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    this.panX = W / 2 - cx * scale;
    this.panY = H / 2 - cy * scale;
  }

  _worldToScreen(wx, wy) {
    return [wx * this.zoom + this.panX, wy * this.zoom + this.panY];
  }

  _screenToWorld(sx, sy) {
    return [(sx - this.panX) / this.zoom, (sy - this.panY) / this.zoom];
  }

  // ---- Cluster helpers ----------------------------------------------------

  _getClusterInfo() {
    const k = this.currentK;
    const key = `k${k}`;
    const source = (this.currentTab === 'image' && this.data.clusters_image)
      ? this.data.clusters_image
      : this.data.clusters;
    const clusterData = source[key];
    if (!clusterData) return { labels: [], names: {} };
    return clusterData;
  }

  _getClusterColor(clusterId) {
    return COLORS[clusterId % COLORS.length];
  }

  // ---- Sidebar ------------------------------------------------------------

  _buildSidebar() {
    const { labels, names } = this._getClusterInfo();
    const k = this.currentK;
    const items = this.data.items;

    // Count items per cluster
    const counts = new Array(k).fill(0);
    for (const lbl of labels) counts[lbl]++;

    const list = document.getElementById('cluster-list');
    list.innerHTML = '';

    for (let c = 0; c < k; c++) {
      const name = (names && names[String(c)]) || `Cluster ${c+1}`;
      const color = this._getClusterColor(c);
      const row = document.createElement('div');
      row.className = 'cluster-row' + (this.selectedCluster === c ? ' selected' : '');
      row.dataset.clusterId = c;

      const swatch = document.createElement('div');
      swatch.className = 'cluster-swatch';
      swatch.style.background = color;

      const nameEl = document.createElement('div');
      nameEl.className = 'cluster-name';
      nameEl.textContent = name;
      nameEl.title = name;

      const badge = document.createElement('div');
      badge.className = 'cluster-badge';
      badge.textContent = `${counts[c]} icons`;

      row.appendChild(swatch);
      row.appendChild(nameEl);
      row.appendChild(badge);

      row.addEventListener('click', () => {
        this.selectedCluster = (this.selectedCluster === c) ? null : c;
        this._buildSidebar();
        this._scheduleRender();
      });

      list.appendChild(row);
    }
  }

  // ---- Rendering ----------------------------------------------------------

  _scheduleRender() {
    if (!this._renderScheduled) {
      this._renderScheduled = true;
      requestAnimationFrame(() => {
        this._renderScheduled = false;
        this._render();
      });
    }
  }

  _render() {
    const canvas = this.canvas;
    const ctx = this.ctx;
    const W = canvas.width, H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    if (!this.data) return;

    const items = this.data.items;
    const pts = this._getPoints();
    const { labels } = this._getClusterInfo();
    const sel = this.selectedCluster;

    const baseIconSize = 28;
    const iconSize = clamp(baseIconSize * this.zoom, 12, 60);
    const half = iconSize / 2;

    // Two-pass rendering: dimmed first, then highlighted
    const renderItem = (i, dimmed) => {
      const [wx, wy] = pts[i];
      const sx = wx * this.zoom + this.panX;
      const sy = wy * this.zoom + this.panY;

      // Cull
      if (sx < -iconSize || sx > W + iconSize || sy < -iconSize || sy > H + iconSize) return;

      const clusterId = labels[i] ?? 0;
      const color = this._getClusterColor(clusterId);
      const inSelected = (sel === null) || (clusterId === sel);
      const isSelected = sel !== null && clusterId === sel;

      ctx.globalAlpha = dimmed ? 0.15 : 1.0;

      // Halo
      const haloSize = isSelected ? (half + 7) : (half + 5);
      ctx.beginPath();
      ctx.arc(sx, sy, haloSize, 0, Math.PI * 2);
      ctx.fillStyle = color + 'cc';
      ctx.fill();

      // Icon image
      const img = this.images[i];
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, sx - half, sy - half, iconSize, iconSize);
      } else {
        // Fallback dot
        ctx.beginPath();
        ctx.arc(sx, sy, half * 0.55, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff55';
        ctx.fill();
      }
    };

    // Render dimmed pass
    if (sel !== null) {
      for (let i = 0; i < items.length; i++) {
        const clusterId = labels[i] ?? 0;
        if (clusterId !== sel) renderItem(i, true);
      }
    }

    ctx.globalAlpha = 1.0;

    // Render normal/selected pass
    for (let i = 0; i < items.length; i++) {
      const clusterId = labels[i] ?? 0;
      if (sel === null || clusterId === sel) renderItem(i, false);
    }

    ctx.globalAlpha = 1.0;
  }

  // ---- Hover / tooltip ----------------------------------------------------

  _findNearest(mx, my) {
    if (!this.data) return -1;
    const pts = this._getPoints();
    const RADIUS = 20;
    let best = -1, bestDist = RADIUS * RADIUS;

    for (let i = 0; i < pts.length; i++) {
      const [wx, wy] = pts[i];
      const sx = wx * this.zoom + this.panX;
      const sy = wy * this.zoom + this.panY;
      const dx = sx - mx, dy = sy - my;
      const d2 = dx*dx + dy*dy;
      if (d2 < bestDist) { bestDist = d2; best = i; }
    }
    return best;
  }

  _updateTooltip(mx, my) {
    const idx = this._findNearest(mx, my);
    if (idx === -1 || !this.data) {
      this.tooltip.style.display = 'none';
      this.hoveredIdx = -1;
      return;
    }

    if (idx === this.hoveredIdx) return; // no change

    this.hoveredIdx = idx;
    const item = this.data.items[idx];
    const { labels, names } = this._getClusterInfo();
    const clusterId = labels[idx] ?? 0;
    const clusterName = (names && names[String(clusterId)]) || `Cluster ${clusterId+1}`;

    document.getElementById('tt-desc').textContent = item.desc;
    document.getElementById('tt-count').textContent = `Count: ${item.count}`;
    document.getElementById('tt-cluster').textContent = `Cluster: ${clusterName}`;

    const W = window.innerWidth, H = window.innerHeight;
    const ttW = 270, ttH = 80;
    let tx = mx + 16, ty = my - 10;
    if (tx + ttW > W - 10) tx = mx - ttW - 16;
    if (ty + ttH > H - 10) ty = H - ttH - 10;
    if (ty < 10) ty = 10;

    this.tooltip.style.left = tx + 'px';
    this.tooltip.style.top = ty + 'px';
    this.tooltip.style.display = 'block';
  }

  // ---- Tab / K switching --------------------------------------------------

  switchTab(tab) {
    if (tab === 'image' && !this.hasImage) return;
    this.currentTab = tab;
    this.selectedCluster = null;

    document.getElementById('btn-text').classList.toggle('active', tab === 'text');
    document.getElementById('btn-image').classList.toggle('active', tab === 'image');

    this._fitView();
    this._buildSidebar();
    this._scheduleRender();
  }

  switchK(k) {
    this.currentK = k;
    this.selectedCluster = null;
    this._buildSidebar();
    this._scheduleRender();
  }

  // ---- Resize -------------------------------------------------------------

  _resizeCanvas() {
    const area = document.getElementById('canvas-area');
    const dpr = window.devicePixelRatio || 1;
    const W = area.clientWidth, H = area.clientHeight;
    this.canvas.width = W * dpr;
    this.canvas.height = H * dpr;
    this.canvas.style.width = W + 'px';
    this.canvas.style.height = H + 'px';
    this.ctx.scale(dpr, dpr);
    if (this.data) { this._fitView(); }
    this._scheduleRender();
  }

  // ---- Event binding ------------------------------------------------------

  _bindEvents() {
    window.addEventListener('resize', () => this._resizeCanvas());

    // Mouse
    this.canvas.addEventListener('mousedown', e => this._onMouseDown(e));
    window.addEventListener('mousemove', e => this._onMouseMove(e));
    window.addEventListener('mouseup', () => this._onMouseUp());
    this.canvas.addEventListener('wheel', e => this._onWheel(e), { passive: false });
    this.canvas.addEventListener('mouseleave', () => {
      this.tooltip.style.display = 'none';
      this.hoveredIdx = -1;
    });

    // Touch
    this.canvas.addEventListener('touchstart', e => this._onTouchStart(e), { passive: false });
    this.canvas.addEventListener('touchmove', e => this._onTouchMove(e), { passive: false });
    this.canvas.addEventListener('touchend', () => this._onTouchEnd());
  }

  _onMouseDown(e) {
    this.isDragging = true;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.dragStartPanX = this.panX;
    this.dragStartPanY = this.panY;
    this.canvas.classList.add('dragging');
    this.tooltip.style.display = 'none';
  }

  _onMouseMove(e) {
    if (this.isDragging) {
      this.panX = this.dragStartPanX + (e.clientX - this.dragStartX);
      this.panY = this.dragStartPanY + (e.clientY - this.dragStartY);
      this._scheduleRender();
    } else {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      this._updateTooltip(mx, my);
    }
  }

  _onMouseUp() {
    this.isDragging = false;
    this.canvas.classList.remove('dragging');
  }

  _onWheel(e) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const delta = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    this._zoomAround(mx, my, delta);
  }

  _zoomAround(sx, sy, factor) {
    const [wx, wy] = this._screenToWorld(sx, sy);
    this.zoom *= factor;
    this.zoom = clamp(this.zoom, 0.05, 20000);
    this.panX = sx - wx * this.zoom;
    this.panY = sy - wy * this.zoom;
    this._scheduleRender();
  }

  _getTouchDist(t1, t2) {
    const dx = t1.clientX - t2.clientX, dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx*dx + dy*dy);
  }

  _onTouchStart(e) {
    e.preventDefault();
    if (e.touches.length === 1) {
      this.isDragging = true;
      this.dragStartX = e.touches[0].clientX;
      this.dragStartY = e.touches[0].clientY;
      this.dragStartPanX = this.panX;
      this.dragStartPanY = this.panY;
      this.lastPinchDist = null;
    } else if (e.touches.length === 2) {
      this.isDragging = false;
      this.lastPinchDist = this._getTouchDist(e.touches[0], e.touches[1]);
    }
  }

  _onTouchMove(e) {
    e.preventDefault();
    if (e.touches.length === 1 && this.isDragging) {
      this.panX = this.dragStartPanX + (e.touches[0].clientX - this.dragStartX);
      this.panY = this.dragStartPanY + (e.touches[0].clientY - this.dragStartY);
      this._scheduleRender();
    } else if (e.touches.length === 2 && this.lastPinchDist != null) {
      const dist = this._getTouchDist(e.touches[0], e.touches[1]);
      const factor = dist / this.lastPinchDist;
      this.lastPinchDist = dist;
      const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const rect = this.canvas.getBoundingClientRect();
      this._zoomAround(mx - rect.left, my - rect.top, factor);
    }
  }

  _onTouchEnd() {
    this.isDragging = false;
    this.lastPinchDist = null;
  }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const app = new IconExplorerApp();
app.init().catch(err => {
  console.error('IconExplorer init error:', err);
});
</script>
</body>
</html>
"""


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def generate_html():
    """Write icon-explorer.html to scripts/."""
    print(f"Reading {VIZ_DATA_FILE}...")
    if not VIZ_DATA_FILE.exists():
        print(f"ERROR: {VIZ_DATA_FILE} not found.", file=sys.stderr)
        sys.exit(1)

    # Quick validation
    with open(VIZ_DATA_FILE, "r", encoding="utf-8") as f:
        try:
            data = json.load(f)
        except json.JSONDecodeError as e:
            print(f"ERROR: viz_data.json is not valid JSON: {e}", file=sys.stderr)
            sys.exit(1)

    n = len(data.get("items", []))
    clusters = data.get("clusters", {})
    print(f"  {n} items, cluster keys: {list(clusters.keys())}")

    print(f"Writing {OUTPUT_HTML}...")
    OUTPUT_HTML.write_text(HTML_TEMPLATE, encoding="utf-8")
    size_kb = OUTPUT_HTML.stat().st_size / 1024
    print(f"  icon-explorer.html written: {size_kb:.1f} KB")


def start_server():
    """Start HTTPServer serving from scripts/ on port 8765."""
    os.chdir(str(SCRIPT_DIR))

    handler = http.server.SimpleHTTPRequestHandler

    # Suppress default request logging noise slightly
    class QuietHandler(handler):
        def log_message(self, fmt, *args):
            # Only log errors (4xx/5xx)
            if args and len(args) >= 2:
                code = str(args[1])
                if code.startswith(("4", "5")):
                    super().log_message(fmt, *args)

    server = http.server.HTTPServer(("", SERVER_PORT), QuietHandler)

    print(f"\nOpen {SERVER_URL}")
    print("Serving from:", SCRIPT_DIR)
    print("Press Ctrl-C to stop.\n")

    try:
        webbrowser.open(SERVER_URL)
    except Exception:
        pass  # Browser open is best-effort

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
        server.server_close()


if __name__ == "__main__":
    generate_html()
    start_server()
