/*
 * Copyright (C) 2026 Bohemian Miser <https://substack.com/@bohemianmiser>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

'use client';

import React, { memo, useState } from 'react';
import { Handle, Position } from 'reactflow';
import { useSearchParams } from 'next/navigation';
import { useRecipeStore } from '@/lib/stores/recipe-store';
import {
    getNodeIngredientName,
    getNodeIconId,
    getNodeShortlistKey,
    getNodeIconUrlAt,
    currentShortlistIndex,
} from '@/lib/recipe-lanes/model-utils';
import { forgeIconAction } from '@/app/actions';

const NODE_R   = 20;              // must match TL.NODE_R
const DIAMETER = NODE_R * 2;     // 40px
const INNER_R  = NODE_R - 3;     // 17px — image clip

const BTN: React.CSSProperties = {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: '50%',
    border: '1.5px solid white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    zIndex: 50,
    fontSize: 11,
    color: 'white',
    lineHeight: 1,
};

const TimelineNode: React.FC<any> = ({ data, selected, id }) => {
    const [isForging, setIsForging]   = useState(false);
    const searchParams                = useSearchParams();
    const recipeId                    = searchParams.get('id');

    const storeNode      = useRecipeStore(s => s.graph?.nodes.find(n => n.id === id));
    const cycleShortlist = useRecipeStore(s => s.cycleShortlist);
    const node           = storeNode ?? data;

    const currentIndex = Math.max(0, currentShortlistIndex(node));
    const iconUrl      = getNodeIconUrlAt(node, currentIndex);
    const shortlistKey = getNodeShortlistKey(node);

    // Clear forge state when the shortlist key changes (forge result arrived)
    const [prevKey, setPrevKey] = useState(shortlistKey);
    if (shortlistKey !== prevKey) {
        setPrevKey(shortlistKey);
        if (isForging) setIsForging(false);
    }

    const isIngredient = data.type === 'ingredient';
    const lineColor    = data.lineColor ?? '#D4D4D8';
    const borderColor  = selected ? '#6366f1' : lineColor;

    const handleReroll = (e: React.MouseEvent) => {
        e.stopPropagation();
        cycleShortlist(id);
    };

    const handleForge = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isForging) return;
        setIsForging(true);
        try {
            const res = await forgeIconAction(
                recipeId ?? '',
                getNodeIngredientName(data),
                getNodeIconId(data) ?? '',
            );
            if (res && !res.success) setIsForging(false);
        } catch {
            setIsForging(false);
        }
    };

    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        data.onDelete?.();
    };

    const handleTouchStart = () => {
        if (data.onSetLongPress) {
            const t = setTimeout(() => data.onSetLongPress(true), 300);
            (handleTouchStart as any)._t = t;
        }
    };

    const handleTouchEnd = () => {
        clearTimeout((handleTouchStart as any)._t);
        setTimeout(() => data.onSetLongPress?.(false), 500);
    };

    return (
        <div
            className="group"
            style={{ position: 'relative', width: DIAMETER, height: DIAMETER }}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
        >
            {/* Invisible handles — positions are overridden in TimelineEdge */}
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

            {/* Selection halo */}
            {selected && (
                <div style={{
                    position: 'absolute',
                    top: -5, left: -5,
                    width: DIAMETER + 10, height: DIAMETER + 10,
                    borderRadius: '50%',
                    border: '2px dashed #6366f1',
                    opacity: 0.5,
                    pointerEvents: 'none',
                }} />
            )}

            {/* Circle body */}
            <div style={{
                width: DIAMETER,
                height: DIAMETER,
                borderRadius: '50%',
                background: 'white',
                border: `${selected ? 3 : isIngredient ? 1.5 : 2}px ${isIngredient ? 'dashed' : 'solid'} ${borderColor}`,
                boxSizing: 'border-box',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
            }}>
                {iconUrl ? (
                    <img
                        src={iconUrl}
                        alt=""
                        style={{ width: INNER_R * 2, height: INNER_R * 2, objectFit: 'contain' }}
                    />
                ) : (
                    <span style={{ fontSize: 16 }}>{isIngredient ? '🥕' : '⚡'}</span>
                )}
            </div>

            {/* Label below the circle */}
            <div style={{
                position: 'absolute',
                top: DIAMETER + 5,
                left: '50%',
                transform: 'translateX(-50%)',
                fontSize: 8,
                fontFamily: 'ui-sans-serif, system-ui, sans-serif',
                color: '#3f3f46',
                textAlign: 'center',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                textShadow: '0 0 3px rgba(255,255,255,0.9)',
            }}>
                {data.text}
                {data.duration && (
                    <div style={{ fontSize: 7, color: '#a1a1aa', fontFamily: 'ui-monospace, monospace', marginTop: 1 }}>
                        {data.duration}
                    </div>
                )}
            </div>

            {/* Hover buttons — reroll (↺), forge (⚒), delete (×) */}
            <button
                onClick={handleReroll}
                className="nodrag opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ ...BTN, top: -9, left: -9, background: '#3b82f6' }}
                title="Cycle shortlist"
            >↺</button>

            <button
                onClick={handleForge}
                className="nodrag opacity-0 group-hover:opacity-100 transition-opacity"
                style={{
                    ...BTN,
                    top: -9,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: isForging ? '#f59e0b' : '#92400e',
                    cursor: isForging ? 'not-allowed' : 'pointer',
                }}
                title="Forge new icon"
            >{isForging ? '…' : '⚒'}</button>

            <button
                onClick={handleDelete}
                className="nodrag opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ ...BTN, top: -9, right: -9, background: '#ef4444' }}
                title="Delete"
            >×</button>
        </div>
    );
};

export default memo(TimelineNode);
