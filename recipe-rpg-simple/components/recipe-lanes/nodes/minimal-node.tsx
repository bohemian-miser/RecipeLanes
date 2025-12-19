import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { RecipeNode } from '../../../lib/recipe-lanes/types';

const MinimalNode = ({ data }: NodeProps<RecipeNode>) => {
  const isIngredient = data.type === 'ingredient';
  
  return (
    <div className="flex flex-col items-center justify-center w-[100px] relative">
      {/* Central Handle for Floating Edges */}
      <Handle 
        type="target" 
        position={Position.Top} 
        className="!bg-transparent !w-1 !h-1 !border-0 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" 
      />
      <Handle 
        type="source" 
        position={Position.Top} 
        className="!bg-transparent !w-1 !h-1 !border-0 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" 
      />
      
      <div className="relative w-16 h-16 flex items-center justify-center transition-transform hover:scale-110">
          {data.iconUrl ? (
              <img 
                src={data.iconUrl} 
                alt="" 
                className="w-16 h-16 object-contain drop-shadow-md"
                style={{ imageRendering: 'pixelated' }}
              />
          ) : (
             <span className="text-4xl drop-shadow-sm">{isIngredient ? '🥕' : '🍳'}</span>
          )}
      </div>

      <div className="mt-1 text-[10px] leading-tight text-center font-medium text-zinc-800 w-full break-words line-clamp-3 px-1" style={{ textShadow: '0 0 4px rgba(255,255,255,0.8), 0 0 2px rgba(255,255,255,1)' }}>
          {data.text}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-zinc-400 !w-1 !h-1 !opacity-50" />
    </div>
  );
};

export default memo(MinimalNode);
