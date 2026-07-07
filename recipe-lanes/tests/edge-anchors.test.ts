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

/**
 * Edge-anchor geometry (lib/recipe-lanes/edge-anchors.ts).
 *
 * The coordinate contract these tests pin down (measured in the real DOM):
 * the classic handle sits at the TOP-CENTER of the icon container, and icon
 * metadata percentages map over the container. Leaf scaling (#155) pins the
 * transform origin to the handle point, so frames scale in size only.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
    anchorBBox,
    anchorPoint,
    fallbackRadius,
    frameCenter,
    getClassicFrame,
    getLeafScaleOrigin,
    getModernFrame,
} from '../lib/recipe-lanes/edge-anchors';
import { getEdgeParams } from '../lib/recipe-lanes/graph-utils';

const HANDLE = { x: 200, y: 100 }; // RF-reported: top-center of the icon container

describe('getClassicFrame', () => {
    it('maps the ingredient frame over the 56px container, handle at top-center', () => {
        const f = getClassicFrame(HANDLE, true);
        assert.deepStrictEqual(f, { x: 200 - 28, y: 106, size: 56 });
    });

    it('maps the action frame over the 80px container', () => {
        const f = getClassicFrame(HANDLE, false);
        assert.deepStrictEqual(f, { x: 200 - 40, y: 106, size: 80 });
    });

    it('centered metadata lands at the container center (the arrow-too-low fix: 28px below handle for ingredients, not 40)', () => {
        const p = anchorPoint(getClassicFrame(HANDLE, true), { x: 0.5, y: 0.5 });
        assert.deepStrictEqual(p, { x: 200, y: 134 });
    });

    it('off-center (squished) metadata scales by the 56px frame, not 80', () => {
        // center.x = 0.75 → 14px right of the container center, not 20px
        const p = anchorPoint(getClassicFrame(HANDLE, true), { x: 0.75, y: 0.5 });
        assert.strictEqual(p.x, 200 - 28 + 0.75 * 56);
        assert.strictEqual(p.x, 214);
    });

    it('leaf scale shrinks the frame around the fixed handle point', () => {
        const f = getClassicFrame(HANDLE, true, 0.5);
        assert.deepStrictEqual(f, { x: 200 - 14, y: 106, size: 28 });
        // handle point is invariant: frame top-center == handle at every scale
        for (const s of [0.4, 0.7, 1]) {
            const fs = getClassicFrame(HANDLE, true, s);
            assert.strictEqual(fs.x + fs.size / 2, HANDLE.x);
            assert.strictEqual(fs.y, HANDLE.y + 6); // overhang is constant, unscaled
        }
    });
});

describe('getModernFrame', () => {
    it('action: 96px image inset 12px in the 120px container', () => {
        const f = getModernFrame({ x: 0, y: 0 }, false);
        assert.deepStrictEqual(f, { x: 12, y: 12, size: 96 });
    });

    it('ingredient: 64px image inset 8px in the 80px container (was mapped as 96/12 before)', () => {
        const f = getModernFrame({ x: 0, y: 0 }, true);
        assert.deepStrictEqual(f, { x: 8, y: 8, size: 64 });
    });

    it('scales about the container top-center', () => {
        const f = getModernFrame({ x: 0, y: 0 }, false, 0.5);
        // container center x = 60 stays; image 48 wide → x = 60 - 24
        assert.deepStrictEqual(f, { x: 36, y: 6, size: 48 });
    });
});

describe('bbox + fallbacks', () => {
    it('anchorBBox maps and pads the normalized bbox', () => {
        const frame = { x: 100, y: 100, size: 56 };
        const b = anchorBBox(frame, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, { x: 2, top: 2, bottom: 2 });
        assert.deepStrictEqual(b, { x: 112, y: 112, w: 32, h: 32 });
    });

    it('frameCenter is the missing-metadata anchor (not the handle/top)', () => {
        assert.deepStrictEqual(frameCenter({ x: 172, y: 100, size: 56 }), { x: 200, y: 128 });
    });

    it('fallbackRadius scales with the leaf scale', () => {
        assert.strictEqual(fallbackRadius('classic', true), 24);
        assert.strictEqual(fallbackRadius('classic', false), 36);
        assert.strictEqual(fallbackRadius('classic', true, 0.5), 12);
        assert.strictEqual(fallbackRadius('modern', false), 58);
    });
});

describe('getLeafScaleOrigin', () => {
    it('pins the handle point for each textPos layout', () => {
        assert.strictEqual(getLeafScaleOrigin('bottom', 56), '50% 0px');
        assert.strictEqual(getLeafScaleOrigin('top', 56), '50% calc(100% - 56px)');
        assert.strictEqual(getLeafScaleOrigin('right', 80), '40px calc(50% - 40px)');
        assert.strictEqual(getLeafScaleOrigin('left', 80), 'calc(100% - 40px) calc(50% - 40px)');
    });
});

describe('getEdgeParams (integration of the anchor math)', () => {
    const mkNode = (id: string, x: number, y: number, type: 'ingredient' | 'action', meta?: any, isLeaf = false) => ({
        id,
        type: 'minimal',
        position: { x, y },
        positionAbsolute: { x, y },
        width: 100,
        height: 120,
        data: {
            type,
            isLeaf,
            iconTheme: 'classic',
            ...(meta ? { iconShortlist: [{ icon: { id: 'i1', metadata: meta }, matchType: 'search' }], shortlistIndex: 0 } : {}),
        },
    }) as any;

    const CENTERED = { center: { x: 0.5, y: 0.5 }, bbox: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } };

    it('vertical edge into an ingredient stops at the icon bbox, 56px frame', () => {
        // source action above, target ingredient below, both metadata'd, same x
        const src = mkNode('a', 0, 0, 'action', CENTERED);
        const tgt = mkNode('b', 0, 300, 'ingredient', CENTERED);
        const srcHandle = { x: 60, y: 0 };    // top-center of action container
        const tgtHandle = { x: 60, y: 300 };  // top-center of ingredient container
        const p = getEdgeParams(src, tgt, srcHandle, tgtHandle);

        // target center = handle.y + 6 + 0.5*56 = 334; bbox top = 306 + 0.25*56 - 2 = 318
        assert.strictEqual(p.tx, 60);
        assert.strictEqual(p.ty, 318);
        // source center = 6 + 0.5*80 = 46; bbox bottom = 6 + 0.75*80 + 5 = 71
        assert.strictEqual(p.sy, 71);
    });

    it('leaf scale moves the target intersection with the shrunken frame', () => {
        const src = mkNode('a', 0, 0, 'action', CENTERED);
        const tgt = mkNode('b', 0, 300, 'ingredient', CENTERED, true);
        const p1 = getEdgeParams(src, tgt, { x: 60, y: 0 }, { x: 60, y: 300 });
        const pHalf = getEdgeParams(src, tgt, { x: 60, y: 0 }, { x: 60, y: 300 }, { target: 0.5 });
        // half-scale frame: size 28, bbox top = 306 + 0.25*28 - 2 = 311
        assert.strictEqual(pHalf.ty, 311);
        assert.ok(pHalf.ty < p1.ty, 'smaller leaf → arrow ends closer to the (fixed) handle');
    });

    it('missing metadata anchors at the frame center with a scaled radius', () => {
        const src = mkNode('a', 0, 0, 'action');
        const tgt = mkNode('b', 0, 300, 'ingredient', undefined, true);
        const p = getEdgeParams(src, tgt, { x: 60, y: 0 }, { x: 60, y: 300 }, { target: 0.5 });
        // target frame center = 306 + 14; radius = 24*0.5 = 12 → ty = 320 - 12 = 308
        assert.strictEqual(p.ty, 308);
    });
});
