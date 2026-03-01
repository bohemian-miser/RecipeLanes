import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { RecipeNode } from '../../../lib/recipe-lanes/types';

const MicroNode = ({ data }: NodeProps<RecipeNode>) => {
  const isIngredient = data.type === 'ingredient';
  const color = isIngredient ? 'bg-orange-400' : 'bg-zinc-600';
  
  return (
    <div className="group relative flex items-center justify-center w-3 h-3">
      <Handle type="target" position={Position.Top} className="!bg-transparent !w-1 !h-1 !border-0" />
      
      <div className={`w-3 h-3 rounded-full ${color} shadow-sm border border-white/50 hover:scale-150 transition-transform cursor-pointer`} />

      {/* Tooltip on hover */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none bg-zinc-800 text-white text-[9px] px-2 py-1 rounded whitespace-nowrap z-50">
          {data.visualDescription || data.text.substring(0, 30)}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-transparent !w-1 !h-1 !border-0" />
    </div>
  );
};

export default memo(MicroNode);
