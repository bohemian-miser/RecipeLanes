import React, { memo } from 'react';
import { NodeProps } from 'reactflow';

const LaneNode = ({ data }: NodeProps) => {
  return (
    <div 
        className="w-full h-full border-r-2 border-zinc-200 border-dashed relative group"
    >
      <div className="absolute top-4 left-0 w-full text-center">
          <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">{data.label}</span>
      </div>
    </div>
  );
};

export default memo(LaneNode);
