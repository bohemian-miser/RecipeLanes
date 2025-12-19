import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { RecipeNode } from '../../../lib/recipe-lanes/types';

const MinimalNode = ({ data }: NodeProps<RecipeNode>) => {
  const isIngredient = data.type === 'ingredient';
  
  return (
    <div className="flex flex-col items-center justify-center w-[60px]">
      <Handle type="target" position={Position.Top} className="!bg-zinc-400 !w-1 !h-1" />
      
      <div className="relative w-12 h-12 flex items-center justify-center bg-white rounded-full shadow-sm border border-zinc-200">
          {data.iconUrl ? (
              <img 
                src={data.iconUrl} 
                alt="" 
                className="w-8 h-8 object-contain"
                style={{ imageRendering: 'pixelated' }}
              />
          ) : (
             <span className="text-xl">{isIngredient ? '🥕' : '🍳'}</span>
          )}
      </div>

      <div className="mt-1 text-[8px] leading-tight text-center font-medium text-zinc-600 w-[80px] break-words line-clamp-2 bg-white/80 rounded px-1">
          {data.text}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-zinc-400 !w-1 !h-1" />
    </div>
  );
};

export default memo(MinimalNode);
