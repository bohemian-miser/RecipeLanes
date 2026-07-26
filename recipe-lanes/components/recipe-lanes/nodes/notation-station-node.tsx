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

import React, { memo } from 'react';
import { Handle, Position } from 'reactflow';

const SIZE = 52;

// Ring colour by lane/station type, mirroring the mockup's "ring color = heat"
// convention (pans get a warm ring, pots a cool one, serve the brand ring).
const RING_COLOR: Record<string, string> = {
    prep: '#8a8781',
    cook: '#c07840',
    serve: '#eab308',
};

// Row-anchor pseudo-node: one per lane, rendered at the left of its spine.
// Synthetic data comes from layout-notation.ts (NotationStationData), not a
// real RecipeNode — there is nothing here to forge/reroll/delete.
const NotationStationNode: React.FC<any> = ({ data }) => {
    const laneType: string = data?.laneType ?? 'cook';
    const ring = RING_COLOR[laneType] ?? RING_COLOR.cook;

    return (
        <div style={{ position: 'relative', width: SIZE, height: SIZE }}>
            <Handle
                type="source"
                position={Position.Right}
                style={{ opacity: 0, width: 1, height: 1, top: '50%', left: '50%' }}
            />

            <div
                style={{
                    width: SIZE,
                    height: SIZE,
                    borderRadius: '50%',
                    background: '#fff',
                    border: `2.5px solid ${ring}`,
                    boxSizing: 'border-box',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 24,
                    lineHeight: 1,
                }}
            >
                {data?.glyph ?? '🍳'}
            </div>

            <div
                style={{
                    position: 'absolute',
                    top: SIZE + 4,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    fontSize: 10,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
                    color: '#6f6a61',
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                }}
            >
                {data?.label}
            </div>
        </div>
    );
};

export default memo(NotationStationNode);
