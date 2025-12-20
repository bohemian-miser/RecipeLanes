import React, { memo, useState } from 'react';
import { Handle, Position, NodeProps, useReactFlow } from 'reactflow';
import { RefreshCw } from 'lucide-react';
import { RecipeNode } from '../../../lib/recipe-lanes/types';
import { rerollIconAction } from '@/app/actions';

const MinimalNode = ({ id, data }: NodeProps<RecipeNode>) => {
  const isIngredient = data.type === 'ingredient';
  const [isRerolling, setIsRerolling] = useState(false);
  const { setNodes } = useReactFlow();

  const handleReroll = async (e: React.MouseEvent) => {
      e.stopPropagation();
      setIsRerolling(true);
      
      const ingredientName = data.visualDescription || data.text;
      
      try {
        const res = await rerollIconAction(id, ingredientName, data.iconUrl || '');
        if (res && res.iconUrl) {
            setNodes((nodes) => nodes.map(n => {
                // Update all nodes that share the same visual description/text
                const nName = n.data.visualDescription || n.data.text;
                if (nName === ingredientName) {
                    return { ...n, data: { ...n.data, iconUrl: res.iconUrl } };
                }
                return n;
            }));
        }
      } catch (err) {
          console.error("Reroll failed", err);
      } finally {
          setIsRerolling(false);
      }
  };
  
  return (
    <div 
        className="flex flex-col items-center justify-center w-[100px] relative group"
        title={data.visualDescription || data.text}
    >
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
                className={`w-16 h-16 object-contain drop-shadow-md mix-blend-multiply ${isRerolling ? 'opacity-50' : ''}`}
                style={{ imageRendering: 'pixelated' }}
              />
          ) : (
             <span className="text-4xl drop-shadow-sm">{isIngredient ? '🥕' : '🍳'}</span>
          )}
          
          <button 
              onClick={handleReroll}
              className={`absolute -top-2 -right-2 bg-white rounded-full p-1 shadow-md border border-zinc-200 text-zinc-500 hover:text-blue-500 transition-all z-50 ${isRerolling ? 'opacity-100 block' : 'opacity-0 group-hover:opacity-100'}`}
              title="Reroll Icon"
          >
              <RefreshCw className={`w-3 h-3 ${isRerolling ? 'animate-spin text-blue-500' : ''}`} />
          </button>
      </div>

      <div className="mt-1 text-[10px] leading-tight text-center font-medium text-zinc-800 w-full break-words line-clamp-3 px-1" style={{ textShadow: '0 0 4px rgba(255,255,255,0.8), 0 0 2px rgba(255,255,255,1)' }}>
          {data.text}
      </div>
    </div>
  );
};

export default memo(MinimalNode);