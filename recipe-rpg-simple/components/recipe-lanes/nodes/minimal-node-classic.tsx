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

export const MinimalNodeClassic: React.FC<MinimalNodeViewProps> = ({ 
    data, selected, isRerolling, isPivotMode, handlers 
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

    return (
        <div 
            className={`flex ${flexClass} items-center justify-center relative group transition-transform duration-300`}
            style={{ 
                width: isVertical ? 120 : 'auto', 
                minWidth: isVertical ? 120 : 180
            }}
            title={data.visualDescription || data.text}
            onTouchStart={handlers.onTouchStart}
            onTouchEnd={handlers.onTouchEnd}
        >
            {/* Icon Container - Scaled Up */}
            <div className={`relative w-20 h-20 flex-shrink-0 flex items-center justify-center transition-all duration-200 z-10 ${selected || isPivotMode ? 'border-2 border-dashed border-blue-500 rounded-lg bg-blue-50/10' : ''} ${isPivotMode ? 'ring-2 ring-blue-400 ring-offset-2' : ''}`}>
                <Handle id="target" type="target" position={Position.Top} className="absolute !bg-transparent !w-1 !h-1 !border-0 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                <Handle id="source" type="source" position={Position.Top} className="absolute !bg-transparent !w-1 !h-1 !border-0 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />

                {data.iconUrl ? (
                    <img 
                        src={data.iconUrl} 
                        alt="" 
                        className={`w-18 h-18 object-contain drop-shadow-md mix-blend-multiply ${isRerolling ? 'opacity-50' : ''}`}
                        style={{ imageRendering: 'pixelated' }}
                    />
                ) : (
                    <span className="text-5xl drop-shadow-sm">{isIngredient ? '🥕' : '🍳'}</span>
                )}
                
                {/* Reroll Button */}
                <button 
                    onClick={handlers.onReroll}
                    disabled={isRerolling}
                    className={`nodrag absolute -top-2 -right-2 bg-zinc-100 rounded-full p-1 shadow-md border border-zinc-200 text-zinc-500 hover:text-blue-500 transition-all z-50 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 ${isRerolling ? '!opacity-100 block cursor-not-allowed' : ''}`}
                    title="Reroll Icon"
                >
                    <RefreshCw className={`w-3 h-3 ${isRerolling ? 'animate-spin text-blue-500' : ''}`} />
                </button>

                {/* Delete Button */}
                <button 
                    onClick={handlers.onDelete}
                    className={`nodrag absolute -top-2 -left-2 bg-zinc-100 rounded-full p-1 shadow-md border border-zinc-200 text-zinc-500 hover:text-red-500 transition-all z-50 opacity-100 sm:opacity-0 sm:group-hover:opacity-100`}
                    title="Delete Step"
                >
                    <X className="w-3 h-3" />
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