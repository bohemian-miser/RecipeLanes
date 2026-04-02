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
import { RefreshCw, X, Hammer } from 'lucide-react';
import { RecipeNode } from '../../../lib/recipe-lanes/types';
import { getNodeIconUrl, isIconSearchMatched, getNodeIngredientName, getNodeTheme } from '../../../lib/recipe-lanes/model-utils';

interface MinimalNodeViewProps {
    data: RecipeNode;
    selected?: boolean;
    isRerolling: boolean;
    isForging: boolean;
    isPivotMode: boolean;
    handlers: {
        onReroll: (e: React.MouseEvent) => void;
        onForge: (e: React.MouseEvent) => void;
        onDelete: (e: React.MouseEvent) => void;
        onTouchStart: () => void;
        onTouchEnd: () => void;
    };
}

const parseNodeText = (text: string) => {
    // Basic heuristics for "Quantity Unit Name"
    const match = text.match(/^([\d./\u00BC-\u00BE]+)\s*([a-zA-Z]*)\s+(.*)$/);
    if (match) {
        return { qty: match[1], unit: match[2], name: match[3] };
    }
    return { qty: '', unit: '', name: text };
};

export const MinimalNodeModern: React.FC<MinimalNodeViewProps> = ({
    data, selected, isRerolling, isForging, isPivotMode, handlers
}) => {
    const isIngredient = data.type === 'ingredient';
    const themeVariant = getNodeTheme(data) === 'modern_clean' ? 'modern_clean' : 'modern';
    const iconUrl = getNodeIconUrl(data);

    // Show a subtle indicator when icon was found via search, not exact-name match
    const isSearchMatched = isIconSearchMatched(data);

    // Compact size for ingredients (80px), full size for actions/others (120px)
    const containerSize = isIngredient ? { width: 80, height: 80 } : { width: 120, height: 120 };
    const iconClass = isIngredient ? 'w-16 h-16' : 'w-24 h-24';

    if (isIngredient) {
        const parsed = parseNodeText(data.text);
        
        if (themeVariant === 'modern_clean') {
                            // --- MODERN CLEAN (Badge Style) ---
                            return (
                                <div 
                                    className="relative flex flex-col items-center justify-center transition-transform duration-300 hover:z-50 group"
                                    style={containerSize} 
                                    title={getNodeIngredientName(data)}
                                    onTouchStart={handlers.onTouchStart}
                                    onTouchEnd={handlers.onTouchEnd}
                                >
                                    {/* Icon Container */}
                                    <div className={`relative ${iconClass} z-10 transition-transform duration-300 hover:scale-110 ${selected || isPivotMode ? 'drop-shadow-[0_0_10px_rgba(59,130,246,0.5)]' : ''}`}>
                                        <Handle id="target" type="target" position={Position.Top} className="absolute !bg-transparent !w-1 !h-1 !border-0 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                <Handle id="source" type="source" position={Position.Bottom} className="absolute !bg-transparent !w-1 !h-1 !border-0 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                                        
                                        {iconUrl ? (
                                            <img 
                                                src={iconUrl} 
                                                alt=""                                className={`w-full h-full object-contain drop-shadow-md rendering-pixelated ${isRerolling ? 'opacity-50' : ''}`}
                                style={{ imageRendering: 'pixelated' }}
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-3xl">🥕</div>
                        )}

                        {/* Quantity Badge (Left) - Scaled down */}
                        {parsed.qty && (
                            <div className="absolute -left-3 top-1/2 -translate-y-1/2 bg-white/90 backdrop-blur border border-zinc-200 shadow-sm rounded-md px-1 py-0.5 flex flex-col items-center min-w-[28px] z-50 pointer-events-none">
                                <span className="text-base font-bold font-serif text-orange-600 leading-none">{parsed.qty}</span>
                                {parsed.unit && <span className="text-[7px] text-zinc-400 uppercase font-bold">{parsed.unit}</span>}
                            </div>
                        )}

                        {/* Controls */}
                        <div className="absolute -top-2 -right-4 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-50">
                            <button onClick={handlers.onReroll} disabled={isRerolling || isForging} className="bg-white/80 rounded-full p-1 shadow hover:text-blue-500">
                                <RefreshCw className={`w-3 h-3 ${isRerolling ? 'animate-spin' : ''}`} />
                            </button>
                            <button onClick={handlers.onForge} disabled={isRerolling || isForging} className="bg-white/80 rounded-full p-1 shadow hover:text-amber-500" title="Forge new icon">
                                <Hammer className={`w-3 h-3 ${isForging ? 'text-amber-500' : ''}`} />
                            </button>
                            <button onClick={handlers.onDelete} className="bg-white/80 rounded-full p-1 shadow hover:text-red-500">
                                <X className="w-3 h-3" />
                            </button>
                        </div>

                        {/* Search-match confidence dot */}
                        {isSearchMatched && (
                            <span
                                className="absolute bottom-0 right-0 w-[5px] h-[5px] rounded-full bg-amber-400 pointer-events-none z-20"
                                title="Icon matched by search"
                                data-testid="search-match-indicator"
                            />
                        )}
                    </div>

                    {/* Pill Text (Name Only) - Wrapped */}
                    <div className="relative z-50 -mt-5 bg-white/90 backdrop-blur-sm border border-white/50 shadow-sm rounded-xl px-2 py-0.5 pointer-events-none w-max max-w-[160px] text-center">
                        <span className="text-[9px] font-bold text-zinc-800 uppercase tracking-wide leading-tight whitespace-normal block">
                            {parsed.name}
                        </span>
                    </div>
                </div>
            );
        } else {
            // --- MODERN (Inline Pill Style) ---
            return (
                <div 
                    className="relative flex flex-col items-center justify-center transition-transform duration-300 hover:z-50 group"
                    style={containerSize} 
                    title={getNodeIngredientName(data)}
                    onTouchStart={handlers.onTouchStart}
                    onTouchEnd={handlers.onTouchEnd}
                >
                    {/* Icon Container */}
                    <div className={`relative ${iconClass} z-10 transition-transform duration-300 hover:scale-110 ${selected || isPivotMode ? 'drop-shadow-[0_0_10px_rgba(59,130,246,0.5)]' : ''}`}>
                        <Handle id="target" type="target" position={Position.Top} className="!bg-transparent !w-1 !h-1 !border-0 top-2 left-1/2" />
                        <Handle id="source" type="source" position={Position.Bottom} className="!bg-transparent !w-1 !h-1 !border-0 bottom-2 left-1/2" />
                        
                        {iconUrl ? (
                            <img 
                                src={iconUrl} 
                                alt="" 
                                className={`w-full h-full object-contain drop-shadow-md rendering-pixelated ${isRerolling ? 'opacity-50' : ''}`}
                                style={{ imageRendering: 'pixelated' }}
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-3xl">🥕</div>
                        )}

                        {/* Controls */}
                        <div className="absolute -top-2 -right-4 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-50">
                            <button onClick={handlers.onReroll} disabled={isRerolling || isForging} className="bg-white/80 rounded-full p-1 shadow hover:text-blue-500">
                                <RefreshCw className={`w-3 h-3 ${isRerolling ? 'animate-spin' : ''}`} />
                            </button>
                            <button onClick={handlers.onForge} disabled={isRerolling || isForging} className="bg-white/80 rounded-full p-1 shadow hover:text-amber-500" title="Forge new icon">
                                <Hammer className={`w-3 h-3 ${isForging ? 'text-amber-500' : ''}`} />
                            </button>
                            <button onClick={handlers.onDelete} className="bg-white/80 rounded-full p-1 shadow hover:text-red-500">
                                <X className="w-3 h-3" />
                            </button>
                        </div>

                        {/* Search-match confidence dot */}
                        {isSearchMatched && (
                            <span
                                className="absolute bottom-0 right-0 w-[5px] h-[5px] rounded-full bg-amber-400 pointer-events-none z-20"
                                title="Icon matched by search"
                                data-testid="search-match-indicator"
                            />
                        )}
                    </div>

                    {/* Inline Pill (Qty + Name) - Wrapped */}
                    <div className="relative z-50 -mt-5 bg-white/90 backdrop-blur-sm border border-white/50 shadow-sm rounded-xl px-2 py-0.5 pointer-events-none w-max max-w-[180px] text-center">
                        <div className="flex flex-wrap items-center justify-center gap-1 text-[9px] font-bold leading-tight">
                            {parsed.qty && (
                                <span className="text-orange-600 whitespace-nowrap">
                                    {parsed.qty}
                                    {parsed.unit && <span className="text-amber-600 text-[8px] ml-0.5 lowercase">{parsed.unit}</span>}
                                    <span className="text-zinc-400 ml-1">×</span>
                                </span>
                            )}
                            <span className="text-zinc-800 uppercase tracking-wide whitespace-normal">
                                {parsed.name}
                            </span>
                        </div>
                    </div>
                </div>
            );
        }
    } else {
        // ACTION NODE (Shared)
        return (
          <div 
              className="relative flex items-center justify-center group hover:z-50"
              style={{ width: 140, height: 140 }}
              onTouchStart={handlers.onTouchStart}
              onTouchEnd={handlers.onTouchEnd}
          >
              {/* Text Bubble (Left) */}
              <div className="absolute right-[55%] top-1/2 -translate-y-1/2 w-36 flex flex-col items-end text-right z-50 pointer-events-none opacity-90 hover:opacity-100 transition-opacity">
                  <div className="bg-white/90 backdrop-blur-sm border border-zinc-200 shadow-md px-2 py-1.5 rounded-lg">
                      <span className="text-[10px] font-semibold text-zinc-800 leading-snug block whitespace-normal">
                          {data.text}
                      </span>
                      {(data.duration || data.temperature) && (
                          <div className="flex flex-wrap gap-1 mt-1 justify-end">
                              {data.duration && (
                                  <span className="text-[7px] font-bold bg-blue-50 text-blue-600 px-1 py-0.5 rounded border border-blue-100">
                                      ⏱ {data.duration}
                                  </span>
                              )}
                              {data.temperature && (
                                  <span className="text-[7px] font-bold bg-red-50 text-red-600 px-1 py-0.5 rounded border border-red-100">
                                      🔥 {data.temperature}
                                  </span>
                              )}
                          </div>
                      )}
                  </div>
                  {/* Connector Line */}
                  <div className="w-6 h-[1px] bg-zinc-300 mr-[-6px] mt-[-12px]"></div>
              </div>

              {/* Icon */}
              <div className={`relative w-28 h-28 z-10 flex items-center justify-center transition-transform group-hover:scale-110 ${selected || isPivotMode ? 'drop-shadow-[0_0_10px_rgba(59,130,246,0.5)]' : ''}`}>
                  <Handle id="target" type="target" position={Position.Top} className="!bg-transparent !w-1 !h-1 !border-0 top-2" />
                  <Handle id="source" type="source" position={Position.Bottom} className="!bg-transparent !w-1 !h-1 !border-0 bottom-2" />
                  
                  {iconUrl ? (
                      <img 
                          src={iconUrl} 
                          alt="" 
                          className={`w-full h-full object-contain drop-shadow-xl rendering-pixelated ${isRerolling ? 'opacity-50' : ''}`}
                          style={{ imageRendering: 'pixelated' }}
                      />
                  ) : (
                      <div className="text-3xl">🍳</div>
                  )}

                  {/* Controls */}
                  <div className="absolute top-0 right-4 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-50">
                      <button onClick={handlers.onReroll} disabled={isRerolling || isForging} className="bg-white/80 rounded-full p-1 shadow hover:text-blue-500" title="Cycle shortlist">
                          <RefreshCw className={`w-3 h-3 ${isRerolling ? 'animate-spin' : ''}`} />
                      </button>
                      <button onClick={handlers.onForge} disabled={isRerolling || isForging} className="bg-white/80 rounded-full p-1 shadow hover:text-amber-500" title="Forge new icon">
                          <Hammer className={`w-3 h-3 ${isForging ? 'text-amber-500' : ''}`} />
                      </button>
                      <button onClick={handlers.onDelete} className="bg-white/80 rounded-full p-1 shadow hover:text-red-500">
                          <X className="w-3 h-3" />
                      </button>
                  </div>

                  {/* Search-match confidence dot */}
                  {isSearchMatched && (
                      <span
                          className="absolute bottom-0 right-0 w-[5px] h-[5px] rounded-full bg-amber-400 pointer-events-none z-20"
                          title="Icon matched by search"
                          data-testid="search-match-indicator"
                      />
                  )}
              </div>
          </div>
        );
    }
};