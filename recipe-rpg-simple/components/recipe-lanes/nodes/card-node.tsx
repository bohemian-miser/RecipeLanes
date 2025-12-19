import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { RecipeNode } from '../../../lib/recipe-lanes/types';

const CardNode = ({ data }: NodeProps<RecipeNode>) => {
  const isIngredient = data.type === 'ingredient';
  const isHeating = !!data.temperature;
  
  return (
    <div className={`w-[140px] bg-white rounded-lg shadow-sm border ${isHeating ? 'border-red-200' : 'border-zinc-200'} overflow-hidden group hover:shadow-md transition-shadow`}>
      <Handle type="target" position={Position.Top} className="!bg-zinc-300 !w-2 !h-1 !rounded-none !-top-[1px]" />
      
      {/* Header */}
      <div className={`h-6 px-2 flex items-center justify-between ${isHeating ? 'bg-red-50' : 'bg-zinc-50'} border-b border-zinc-100`}>
          <span className="text-[9px] font-bold text-zinc-500 uppercase">
              {isIngredient ? 'INGR' : `STEP ${data.id.split('-').pop()}`}
          </span>
          {data.duration && (
              <span className="text-[9px] text-zinc-400 font-mono">{data.duration}</span>
          )}
      </div>

      <div className="p-2 flex gap-2 items-start">
           <div className="w-8 h-8 flex-shrink-0 bg-zinc-50 rounded flex items-center justify-center border border-zinc-100">
                {data.iconUrl ? (
                    <img 
                        src={data.iconUrl} 
                        className="w-6 h-6 object-contain"
                        style={{ imageRendering: 'pixelated' }}
                    />
                ) : (
                    <span>{isIngredient ? '🥕' : '🍳'}</span>
                )}
           </div>
           <div className="text-[10px] leading-tight text-zinc-700 font-medium line-clamp-3">
               {data.text}
           </div>
      </div>
      
      {data.temperature && (
          <div className="px-2 pb-1 text-[9px] text-red-500 font-bold text-right">
              {data.temperature}
          </div>
      )}

      <Handle type="source" position={Position.Bottom} className="!bg-zinc-300 !w-2 !h-1 !rounded-none !-bottom-[1px]" />
    </div>
  );
};

export default memo(CardNode);
