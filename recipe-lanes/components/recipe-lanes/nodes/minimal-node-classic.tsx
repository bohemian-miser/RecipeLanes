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

import React from 'react';
import { Handle, Position } from 'reactflow';
import { Pencil, X } from 'lucide-react';
import { RecipeNode } from '../../../lib/recipe-lanes/types';
import { getNodeIngredientName, getNodeIconStatus } from '../../../lib/recipe-lanes/model-utils';

interface MinimalNodeViewProps {
    data: RecipeNode;
    selected?: boolean;
    /** Whether the cook has ticked this step off (#281). */
    isCompleted?: boolean;
    isPivotMode: boolean;
    /** Current icon URL driven by the shortlist store — do not call getNodeIconUrl(data) here. */
    iconUrl: string | undefined;
    /** Whether the current shortlist entry was resolved via search rather than generation. */
    isSearchMatched: boolean;
    handlers: {
        onEditIcon: (e: React.MouseEvent) => void;
        onDelete: (e: React.MouseEvent) => void;
        onToggleCompleted: (e: React.MouseEvent) => void;
        onPointerDownCapture: (e: React.PointerEvent) => void;
        onPointerMoveCapture: (e: React.PointerEvent) => void;
        onPointerUpCapture: () => void;
        onPointerCancelCapture: () => void;
    };
}

export const MinimalNodeClassic: React.FC<MinimalNodeViewProps> = ({
    data, selected, isCompleted, isPivotMode, iconUrl, isSearchMatched, handlers
}) => {
    const isIngredient = data.type === 'ingredient';
    const textPos = data.textPos || 'bottom';
    const isVertical = textPos === 'top' || textPos === 'bottom';
  
    const flexClass = {
        bottom: 'flex-col',
        top: 'flex-col-reverse',
        right: 'flex-row',
        left: 'flex-row-reverse'
    }[textPos];

    const justifyClass = isVertical ? 'justify-center' : 'justify-start';

    // Compact Ingredients: 56px container (w-14), 48px icon (w-12)
    // Standard Actions: 80px container (w-20), 72px icon (w-18)
    const containerSize = isIngredient ? 'w-14 h-14' : 'w-20 h-20';
    const imageSize = isIngredient ? 'w-12 h-12' : 'w-18 h-18';
    // min-width also reduces for vertical ingredients to keep them tight
    const verticalMinWidth = isIngredient ? 100 : 120;
    const horizontalMinWidth = isIngredient ? 140 : 180;

    //  {/* Debug Bounding Box & Center */}
    //             { { iconMetadata && ( }
    //                     <>
    //                     // <div className="absolute border border-red-500/70 z-50 pointer-events-none" style={{ left: `${iconMetadata.bbox.x * 100}%`, top: `${iconMetadata.bbox.y * 100}%`, width: `${iconMetadata.bbox.w * 100}%`, height: `${iconMetadata.bbox.h * 100}%` }} />
    //                     <div className="absolute w-1.5 h-1.5 bg-red-500 rounded-full z-50 pointer-events-none shadow-sm border border-white" style={{ left: `${iconMetadata.center.x * 100}%`, top: `${iconMetadata.center.y * 100}%`, transform: 'translate(-50%, -50%)' }} />
    //                     </>
    //             )} 

    return (
        <div 
            className={`flex ${flexClass} items-center ${justifyClass} relative group transition-transform duration-300`}
            style={{ 
                width: isVertical ? verticalMinWidth : 'auto', 
                minWidth: isVertical ? verticalMinWidth : horizontalMinWidth
            }}
            title={getNodeIngredientName(data)}
            onPointerDownCapture={handlers.onPointerDownCapture}
            onPointerMoveCapture={handlers.onPointerMoveCapture}
            onPointerUpCapture={handlers.onPointerUpCapture}
            onPointerCancelCapture={handlers.onPointerCancelCapture}
        >
            {/* Icon Container */}
            <div
                className={`relative ${containerSize} flex-shrink-0 flex items-center justify-center transition-all duration-200 z-10 ${selected || isPivotMode ? 'border-2 border-dashed border-blue-500 rounded-lg bg-blue-50/10' : ''} ${isPivotMode ? 'ring-2 ring-blue-400 ring-offset-2' : ''}`}
            >
                {/* NOTE: despite the top-1/2 classes, ReactFlow's stylesheet
                    (.react-flow__handle-top { top:-4px }) wins the cascade, so these
                    handles actually sit at the TOP-CENTER of this container (verified
                    by DOM measurement). The edge-anchor math in lib/recipe-lanes/
                    edge-anchors.ts depends on that — if you change handle positioning,
                    update the contract there and re-run the probe. */}
                <Handle id="target" type="target" position={Position.Top} className="absolute !bg-transparent !w-1 !h-1 !border-0 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                <Handle id="source" type="source" position={Position.Top} className="absolute !bg-transparent !w-1 !h-1 !border-0 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />

                {iconUrl ? (
                    <img
                        src={iconUrl}
                        alt=""
                        className={`${imageSize} object-contain drop-shadow-md mix-blend-multiply`}
                        style={{ imageRendering: 'pixelated', ...(isCompleted ? { opacity: 0.45 } : {}) }}
                    />
                ) : (
                    getNodeIconStatus(data) === 'failed' ? (
                       <div className="flex flex-col items-center justify-center text-red-500" style={isCompleted ? { opacity: 0.45 } : undefined}>
                           <X className="w-5 h-5 mb-0.5" />
                           <span className="text-[8px] font-bold uppercase leading-none">Failed</span>
                       </div>
                    ) : (
                       <span className={`text-5xl drop-shadow-sm ${getNodeIconStatus(data) === 'processing' || getNodeIconStatus(data) === 'pending' ? 'animate-pulse opacity-50' : ''}`} style={isCompleted ? { opacity: 0.45 } : undefined}>{isIngredient ? '🥕' : '🍳'}</span>
                    )
                )}
                
                {/* Edit Icon Button — opens the icon editor modal (shortlist + generate). */}
                <button
                    onClick={handlers.onEditIcon}
                    className="nodrag absolute -top-2 -right-2 bg-zinc-100 rounded-full p-1 shadow-md border border-zinc-200 text-zinc-500 hover:text-blue-500 transition-all z-50 opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                    title="Edit icon"
                    data-testid="node-edit-icon"
                >
                    <Pencil className="w-3 h-3" />
                </button>

                {/* Delete Button */}
                <button
                    onClick={handlers.onDelete}
                    className={`nodrag absolute -top-2 -left-2 bg-zinc-100 rounded-full p-1 shadow-md border border-zinc-200 text-zinc-500 hover:text-red-500 transition-all z-50 opacity-100 sm:opacity-0 sm:group-hover:opacity-100`}
                    title="Delete Step"
                >
                    <X className="w-3 h-3" />
                </button>

                {/* Search-match confidence dot */}
                {isSearchMatched && (
                    <span
                        className="absolute bottom-0 right-0 w-[5px] h-[5px] rounded-full bg-amber-400 pointer-events-none z-20"
                        title="Icon matched by search"
                        data-testid="search-match-indicator"
                    />
                )}

                {/* Complete Toggle Button — lives inside the Icon Container, tucked into
                    its bottom-left corner. The dimming when completed is applied to the
                    icon art itself (img/fallback above), not this container, so the
                    button stays fully visible and clickable. */}
                <button
                    onClick={handlers.onToggleCompleted}
                    className={`nodrag absolute -bottom-1 -left-1 rounded-full p-1 shadow-md border transition-all z-50 ${isCompleted ? 'opacity-100 bg-emerald-500 border-emerald-600 text-white' : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 bg-zinc-100 border-zinc-200 text-zinc-500 hover:text-emerald-500'}`}
                    aria-label={isCompleted ? 'Mark as not done' : 'Mark as done'}
                    aria-pressed={isCompleted}
                    title={isCompleted ? 'Mark as not done' : 'Mark as done'}
                    data-testid="node-complete-toggle"
                >
                    <span className="flex items-center justify-center w-3 h-3 text-[9px] font-bold leading-none">✓</span>
                </button>
            </div>

            {/* Text Container - Scaled Up */}
            <div 
                className={`text-xs leading-tight text-center font-medium text-zinc-800 break-words px-1 z-20 ${isVertical ? 'w-full mt-[-4px]' : 'w-28'}`} 
                style={{ textShadow: '0 0 4px rgba(255,255,255,0.8), 0 0 2px rgba(255,255,255,1)' }}
            >
                {data.text}
                {(data.temperature || data.duration) && (
                    <div className="flex flex-col items-center mt-1 space-y-0.5 opacity-80">
                        {data.temperature && <span className="text-[9px] bg-red-100/80 px-1 rounded text-red-800 border border-red-200">{data.temperature}</span>}
                        {data.duration && <span className="text-[9px] bg-blue-100/80 px-1 rounded text-blue-800 border border-blue-200">{data.duration}</span>}
                    </div>
                )}
            </div>
        </div>
    );
};
