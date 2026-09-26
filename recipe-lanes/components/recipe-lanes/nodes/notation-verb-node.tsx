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
import { classifyVerb } from '../../../lib/recipe-lanes/verbs';
import {
    notationClampStyle,
    LABEL_LINE_HEIGHT,
    VERB_CHIP_FONT_PX,
    VERB_CHIP_PADDING_X,
    VERB_CHIP_PADDING_Y,
    VERB_CHIP_TOP_OFFSET,
    VERB_GLYPH_SIZE,
    VERB_LABEL_FONT_PX,
    VERB_LABEL_MAX_LINES,
    VERB_LABEL_TOP_OFFSET,
    VERB_LABEL_WIDTH,
} from '../../../lib/recipe-lanes/notation-metrics';

// Geometry lives in notation-metrics.ts because the layout reserves space by
// these exact numbers; a local copy here is how the two silently drift apart.
const SIZE = VERB_GLYPH_SIZE;
const SPINE_INK = '#3a362f';
const CHIP_BG = '#fdf3d3';
const CHIP_INK = '#7c5b06';

// Renders an action node that matched a cooking-verb glyph (see verbs.ts) as
// a small circle sitting directly ON the station spine line, per the
// "Notation" layout preset mockup (Panel B).
const NotationVerbNode: React.FC<any> = ({ data, selected }) => {
    const match = classifyVerb(data?.text ?? '');
    const glyph = match?.glyph ?? '⚡';

    return (
        <div style={{ position: 'relative', width: SIZE, height: SIZE }}>
            <Handle
                type="target"
                position={Position.Left}
                style={{ opacity: 0, width: 1, height: 1, top: '50%', left: '50%' }}
            />
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
                    border: `1.6px solid ${selected ? '#6366f1' : SPINE_INK}`,
                    boxSizing: 'border-box',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 14,
                    lineHeight: 1,
                }}
                title={data?.text}
            >
                {glyph}
            </div>

            {/* Label underneath. Clamped to VERB_LABEL_MAX_LINES: the layout
                reserves exactly that many lines of row height, so an unclamped
                5-line label bleeds through the next row's spine. Full text
                stays reachable via the glyph's title tooltip above. */}
            <div
                style={{
                    position: 'absolute',
                    top: VERB_LABEL_TOP_OFFSET,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: VERB_LABEL_WIDTH,
                    fontSize: VERB_LABEL_FONT_PX,
                    lineHeight: LABEL_LINE_HEIGHT,
                    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
                    color: '#2a2724',
                    textAlign: 'center',
                    whiteSpace: 'normal',
                    wordBreak: 'break-word',
                    pointerEvents: 'none',
                    textShadow: '0 0 3px rgba(255,255,255,0.9), 0 0 3px rgba(255,255,255,0.9)',
                    ...notationClampStyle(VERB_LABEL_MAX_LINES),
                }}
            >
                {data?.text}
            </div>

            {/* Duration chip */}
            {data?.duration && (
                <div
                    style={{
                        position: 'absolute',
                        top: VERB_CHIP_TOP_OFFSET,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        background: CHIP_BG,
                        color: CHIP_INK,
                        fontSize: VERB_CHIP_FONT_PX,
                        lineHeight: 1,
                        padding: `${VERB_CHIP_PADDING_Y}px ${VERB_CHIP_PADDING_X}px`,
                        borderRadius: 7,
                        whiteSpace: 'nowrap',
                        pointerEvents: 'none',
                    }}
                >
                    {data.duration}
                </div>
            )}
        </div>
    );
};

export default memo(NotationVerbNode);
