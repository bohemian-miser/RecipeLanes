import React from 'react';
import { Handle, Position } from 'reactflow';
import { RefreshCw, X } from 'lucide-react';
import { RecipeNode } from '../../../lib/recipe-lanes/types';

interface MinimalNodeViewProps {
    data: RecipeNode;
    selected?: boolean;
    isRerolling: boolean;
    isPivotMode: boolean;
    handlers: {
        onReroll: (e: React.MouseEvent) => void;
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
    data, selected, isRerolling, isPivotMode, handlers 
}) => {
    const isIngredient = data.type === 'ingredient';

    if (isIngredient) {
        const parsed = parseNodeText(data.text);
        return (
          <div 
              className="relative flex flex-col items-center justify-center transition-transform duration-300 hover:z-50"
              style={{ width: 140, height: 140 }} 
              title={data.visualDescription || data.text}
              onTouchStart={handlers.onTouchStart}
              onTouchEnd={handlers.onTouchEnd}
          >
              {/* Icon Container */}
              <div className={`relative w-28 h-28 z-10 transition-transform duration-300 hover:scale-110 ${selected || isPivotMode ? 'drop-shadow-[0_0_10px_rgba(59,130,246,0.5)]' : ''}`}>
                  <Handle id="target" type="target" position={Position.Top} className="!bg-transparent !w-1 !h-1 !border-0 top-2 left-1/2" />
                  <Handle id="source" type="source" position={Position.Bottom} className="!bg-transparent !w-1 !h-1 !border-0 bottom-2 left-1/2" />
                  
                  {data.iconUrl ? (
                      <img 
                          src={data.iconUrl} 
                          alt="" 
                          className={`w-full h-full object-contain drop-shadow-md rendering-pixelated ${isRerolling ? 'opacity-50' : ''}`}
                          style={{ imageRendering: 'pixelated' }}
                      />
                  ) : (
                      <div className="w-full h-full flex items-center justify-center text-4xl">🥕</div>
                  )}

                  {/* Controls */}
                  <div className="absolute top-0 right-0 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={handlers.onReroll} disabled={isRerolling} className="bg-white/80 rounded-full p-1 shadow hover:text-blue-500">
                          <RefreshCw className={`w-3 h-3 ${isRerolling ? 'animate-spin' : ''}`} />
                      </button>
                      <button onClick={handlers.onDelete} className="bg-white/80 rounded-full p-1 shadow hover:text-red-500">
                          <X className="w-3 h-3" />
                      </button>
                  </div>
              </div>

              {/* Pill Text */}
              <div className="relative z-20 -mt-6 bg-white/90 backdrop-blur-sm border border-white/50 shadow-sm rounded-full px-3 py-1 pointer-events-none max-w-full truncate">
                  <div className="flex items-center justify-center gap-1 text-[10px] font-bold leading-none whitespace-nowrap">
                      {parsed.qty && (
                          <>
                              <span className="text-orange-600">{parsed.qty}</span>
                              {parsed.unit && <span className="text-amber-600 text-[9px] lowercase">{parsed.unit}</span>}
                              <span className="text-zinc-400">×</span>
                          </>
                      )}
                      <span className="text-zinc-800 uppercase tracking-wide truncate">{parsed.name}</span>
                  </div>
              </div>
          </div>
        );
    } else {
        // ACTION NODE
        return (
          <div 
              className="relative flex items-center justify-center group hover:z-50"
              style={{ width: 160, height: 160 }}
              onTouchStart={handlers.onTouchStart}
              onTouchEnd={handlers.onTouchEnd}
          >
              {/* Text Bubble (Left) */}
              <div className="absolute right-[55%] top-1/2 -translate-y-1/2 w-40 flex flex-col items-end text-right z-20 pointer-events-none opacity-90 hover:opacity-100 transition-opacity">
                  <div className="bg-white/90 backdrop-blur-sm border border-zinc-200 shadow-md px-3 py-2 rounded-lg">
                      <span className="text-xs font-semibold text-zinc-800 leading-snug block">
                          {data.text}
                      </span>
                      {(data.duration || data.temperature) && (
                          <div className="flex flex-wrap gap-1 mt-1 justify-end">
                              {data.duration && (
                                  <span className="text-[8px] font-bold bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded border border-blue-100">
                                      ⏱ {data.duration}
                                  </span>
                              )}
                              {data.temperature && (
                                  <span className="text-[8px] font-bold bg-red-50 text-red-600 px-1.5 py-0.5 rounded border border-red-100">
                                      🔥 {data.temperature}
                                  </span>
                              )}
                          </div>
                      )}
                  </div>
                  {/* Connector Line */}
                  <div className="w-8 h-[1px] bg-zinc-300 mr-[-8px] mt-[-15px]"></div>
              </div>

              {/* Icon */}
              <div className={`relative w-32 h-32 z-10 flex items-center justify-center transition-transform group-hover:scale-110 ${selected || isPivotMode ? 'drop-shadow-[0_0_10px_rgba(59,130,246,0.5)]' : ''}`}>
                  <Handle id="target" type="target" position={Position.Top} className="!bg-transparent !w-1 !h-1 !border-0 top-2" />
                  <Handle id="source" type="source" position={Position.Bottom} className="!bg-transparent !w-1 !h-1 !border-0 bottom-2" />
                  
                  {data.iconUrl ? (
                      <img 
                          src={data.iconUrl} 
                          alt="" 
                          className={`w-full h-full object-contain drop-shadow-xl rendering-pixelated ${isRerolling ? 'opacity-50' : ''}`}
                          style={{ imageRendering: 'pixelated' }}
                      />
                  ) : (
                      <div className="text-4xl">🍳</div>
                  )}

                  {/* Controls */}
                  <div className="absolute top-0 right-4 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={handlers.onReroll} disabled={isRerolling} className="bg-white/80 rounded-full p-1 shadow hover:text-blue-500">
                          <RefreshCw className={`w-3 h-3 ${isRerolling ? 'animate-spin' : ''}`} />
                      </button>
                      <button onClick={handlers.onDelete} className="bg-white/80 rounded-full p-1 shadow hover:text-red-500">
                          <X className="w-3 h-3" />
                      </button>
                  </div>
              </div>
          </div>
        );
    }
};
