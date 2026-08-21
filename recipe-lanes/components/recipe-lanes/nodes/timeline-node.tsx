/*
 * Copyright (C) 2026 Bohemian Miser <https://substack.com/@bohemianmiser>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

'use client';

import React, { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { useRecipeStore } from '@/lib/stores/recipe-store';
import {
    getNodeIconUrlAt,
    currentShortlistIndex,
} from '@/lib/recipe-lanes/model-utils';

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
    const storeNode      = useRecipeStore(s => s.graph?.nodes.find(n => n.id === id));
    const openIconEditor = useRecipeStore(s => s.openIconEditor);
    const leafNodeScale  = useRecipeStore(s => s.leafNodeScale);
    // "Tick off" steps (#281): whether this node has been marked done by the cook.
    const isCompleted         = useRecipeStore(s => s.completedNodeIds.includes(id));
    const toggleNodeCompleted = useRecipeStore(s => s.toggleNodeCompleted);
    const node           = storeNode ?? data;

    const currentIndex = Math.max(0, currentShortlistIndex(node));
    const iconUrl      = getNodeIconUrlAt(node, currentIndex);

    const isIngredient = data.type === 'ingredient';
    const lineColor    = data.lineColor ?? '#D4D4D8';
    const borderColor  = selected ? '#6366f1' : lineColor;

    const handleEditIcon = (e: React.MouseEvent) => {
        e.stopPropagation();
        openIconEditor(id);
    };

    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        data.onDelete?.();
    };

    const handleToggleCompleted = (e: React.MouseEvent) => {
        e.stopPropagation();
        toggleNodeCompleted(id);
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
            style={{
                position: 'relative', width: DIAMETER, height: DIAMETER,
                // Leaf-node size slider (#155): shrink leaves (no incoming edge).
                ...(data.isLeaf && leafNodeScale < 1
                    ? { transform: `scale(${leafNodeScale})`, transformOrigin: 'center center' }
                    : {}),
            }}
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
                opacity: isCompleted ? 0.45 : 1,
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

            {/* Hover buttons — edit icon (✎), delete (×) */}
            <button
                onClick={handleEditIcon}
                className="nodrag opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ ...BTN, top: -9, left: -9, background: '#3b82f6' }}
                title="Edit icon"
                data-testid="node-edit-icon"
            >✎</button>

            <button
                onClick={handleDelete}
                className="nodrag opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ ...BTN, top: -9, right: -9, background: '#ef4444' }}
                title="Delete"
            >×</button>

            {/* Complete toggle (#281) — bottom-left, stays visible (not hover-gated)
                once completed so the cook can see and undo the tick. */}
            <button
                onClick={handleToggleCompleted}
                className={`nodrag transition-opacity ${isCompleted ? 'opacity-100' : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100'}`}
                style={{ ...BTN, top: DIAMETER - 9, left: -9, background: isCompleted ? '#10b981' : '#71717a' }}
                aria-label={isCompleted ? 'Mark as not done' : 'Mark as done'}
                aria-pressed={isCompleted}
                title={isCompleted ? 'Mark as not done' : 'Mark as done'}
                data-testid="node-complete-toggle"
            >✓</button>
        </div>
    );
};

export default memo(TimelineNode);
