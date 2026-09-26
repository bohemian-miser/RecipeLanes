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
import {
    STATION_BADGE_SIZE,
    STATION_LABEL_FONT_PX,
    STATION_LABEL_MAX_WIDTH,
    STATION_LABEL_TOP_OFFSET,
} from '../../../lib/recipe-lanes/notation-metrics';

// Geometry lives in notation-metrics.ts — the layout reserves the badge's row
// band and its label's clearance from these exact numbers.
const SIZE = STATION_BADGE_SIZE;

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
                /* The label below is capped + ellipsised and cannot take a
                   tooltip (pointer-events: none), so the badge carries it. */
                title={data?.label}
            >
                {data?.glyph ?? '🍳'}
            </div>

            {/* Station name. `nowrap` means this ink is unbounded to the left
                and right of the badge, so it is capped at
                STATION_LABEL_MAX_WIDTH with an ellipsis — the layout reserves
                exactly that much room before the row's first step. */}
            <div
                style={{
                    position: 'absolute',
                    top: STATION_LABEL_TOP_OFFSET,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    maxWidth: STATION_LABEL_MAX_WIDTH,
                    fontSize: STATION_LABEL_FONT_PX,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
                    color: '#6f6a61',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    textAlign: 'center',
                    pointerEvents: 'none',
                }}
            >
                {data?.label}
            </div>
        </div>
    );
};

export default memo(NotationStationNode);
