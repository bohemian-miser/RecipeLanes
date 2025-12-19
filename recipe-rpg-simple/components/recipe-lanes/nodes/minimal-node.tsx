import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { RecipeNode } from '../../../lib/recipe-lanes/types';

const MinimalNode = ({ data }: NodeProps<RecipeNode>) => {
  const isIngredient = data.type === 'ingredient';
  
  return (
    <div className="flex flex-col items-center justify-center w-[100px]">
      <Handle type="target" position={Position.Top} className="!bg-zinc-400 !w-1 !h-1" />
      
      <div className="relative w-16 h-16 flex items-center justify-center bg-white rounded-full shadow-sm border border-zinc-200 hover:shadow-md transition-shadow">
          {data.iconUrl ? (
              <img 
                src={data.iconUrl} 
                alt="" 
                className="w-12 h-12 object-contain"
                style={{ imageRendering: 'pixelated' }}
              />
          ) : (
             <span className="text-3xl">{isIngredient ? '🥕' : '🍳'}</span>
          )}
      </div>

      <div className="mt-2 text-[10px] leading-tight text-center font-medium text-zinc-700 w-full break-words line-clamp-3 bg-white/80 rounded px-1 backdrop-blur-sm">
          {data.text}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-zinc-400 !w-1 !h-1" />
    </div>
  );
};

export default memo(MinimalNode);
