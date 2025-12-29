import React, { memo, useState } from 'react';
import { Handle, Position, NodeProps, useReactFlow } from 'reactflow';
import { RefreshCw, RotateCw, X } from 'lucide-react';
import { RecipeNode } from '../../../lib/recipe-lanes/types';
import { rerollIconAction } from '@/app/actions';
import { useSearchParams } from 'next/navigation';

// Track rejected URLs for the session to prevent them from reappearing immediately
const sessionRejectedUrls = new Set<string>();

const MinimalNode = ({ id, data, selected }: NodeProps<RecipeNode & { onDelete?: () => void, onSetLongPress?: (active: boolean) => void }>) => {
  const isIngredient = data.type === 'ingredient';
  const [isRerolling, setIsRerolling] = useState(false);
  const [isPivotMode, setIsPivotMode] = useState(false);
  const longPressTimer = React.useRef<NodeJS.Timeout | null>(null);
  const { setNodes } = useReactFlow();
  const searchParams = useSearchParams();
  const recipeId = searchParams.get('id');

  const rotation = data.rotation || 0;
  
  const textPos = data.textPos || 'bottom';
  const isVertical = textPos === 'top' || textPos === 'bottom';
  
  const flexClass = {
      bottom: 'flex-col',
      top: 'flex-col-reverse',
      right: 'flex-row',
      left: 'flex-row-reverse'
  }[textPos];

  const handleTouchStart = () => {
      longPressTimer.current = setTimeout(() => {
          setIsPivotMode(true);
          if (data.onSetLongPress) data.onSetLongPress(true);
          // Optional: Vibrate
          if (navigator.vibrate) navigator.vibrate(50);
      }, 600); // 600ms hold
  };

  const handleTouchEnd = () => {
      if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
      }
      // Reset visual state after a delay or drag starts (handled by parent consuming the flag)
      // Actually, if we just tapped (no drag), we should reset.
      // If we dragged, the parent consumed the flag.
      // But we need to reset the visual `isPivotMode`.
      setTimeout(() => setIsPivotMode(false), 500); 
  };

  const handleDelete = (e: React.MouseEvent) => {
      e.stopPropagation();
      console.log(`[MinimalNode] Delete clicked for ${id}`);
      if (data.onDelete) {
          data.onDelete();
      } else {
          console.error(`[MinimalNode] No onDelete handler for ${id}`);
      }
  };

  const handleReroll = async (e: React.MouseEvent) => {
      e.stopPropagation();
      setIsRerolling(true);
      
      const ingredientName = data.visualDescription || data.text;
      const currentUrl = data.iconUrl || '';
      
      if (currentUrl) {
          sessionRejectedUrls.add(currentUrl);
      }

      try {
        const res = await rerollIconAction(id, ingredientName, currentUrl, Array.from(sessionRejectedUrls), recipeId || undefined);
        if (res && res.iconUrl) {
            setNodes((nodes) => nodes.map(n => {
                // Update all nodes that share the same visual description/text
                const nName = n.data.visualDescription || n.data.text;
                if (nName === ingredientName) {
                    return { ...n, data: { ...n.data, iconUrl: res.iconUrl, iconId: res.iconId } };
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
  
            className={`flex ${flexClass} items-center justify-center relative group transition-transform duration-300`}
  
            style={{ 
  
                width: isVertical ? 100 : 'auto', 
  
                minWidth: isVertical ? 100 : 160
  
                // No rotation transform here, so text/icon stay upright
  
            }}
  
            title={data.visualDescription || data.text}
            
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
  
        >
  
          {/* ... handles ... */}
  
          
  
                {/* Icon Container */}
  
          
  
                <div className={`relative w-16 h-16 flex-shrink-0 flex items-center justify-center transition-all duration-200 z-10 ${selected || isPivotMode ? 'border-2 border-dashed border-blue-500 rounded-lg bg-blue-50/10' : ''} ${isPivotMode ? 'ring-2 ring-blue-400 ring-offset-2' : ''}`}>
  
          
  
                    <Handle 
  
          
  
                      id="target"
  
          
  
                      type="target" 
  
          
  
                      position={Position.Top} 
  
          
  
                      className="absolute !bg-transparent !w-1 !h-1 !border-0 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" 
  
          
  
                    />
  
          
  
                    <Handle 
  
          
  
                      id="source"
  
          
  
                      type="source" 
  
          
  
                      position={Position.Top} 
  
          
  
                      className="absolute !bg-transparent !w-1 !h-1 !border-0 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" 
  
          
  
                    />
  
    
  
              {data.iconUrl ? (
  
                  <img 
  
                    src={data.iconUrl} 
  
                    alt="" 
  
                    className={`w-14 h-14 object-contain drop-shadow-md mix-blend-multiply ${isRerolling ? 'opacity-50' : ''}`}
  
                    style={{ imageRendering: 'pixelated' }}
  
                  />
  
              ) : (
  
                 <span className="text-4xl drop-shadow-sm">{isIngredient ? '🥕' : '🍳'}</span>
  
              )}
  
              
  
              {/* Reroll Button */}
              <button 
                  onClick={handleReroll}
                  className={`nodrag absolute -top-2 -right-2 bg-zinc-100 rounded-full p-1 shadow-md border border-zinc-200 text-zinc-500 hover:text-blue-500 transition-all z-50 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 ${isRerolling ? '!opacity-100 block' : ''}`}
                  title="Reroll Icon"
              >
                  <RefreshCw className={`w-3 h-3 ${isRerolling ? 'animate-spin text-blue-500' : ''}`} />
              </button>

              {/* Delete Button */}
              <button 
                  onClick={handleDelete}
                  className={`nodrag absolute -top-2 -left-2 bg-zinc-100 rounded-full p-1 shadow-md border border-zinc-200 text-zinc-500 hover:text-red-500 transition-all z-50 opacity-100 sm:opacity-0 sm:group-hover:opacity-100`}
                  title="Delete Step (Connect Parents to Children)"
              >
                  <X className="w-3 h-3" />
              </button>
  
          </div>
  
    
  
                {/* Text Container */}
  
    
  
                <div 
  
    
  
                  className={`text-[10px] leading-[0.8rem] text-center font-medium text-zinc-800 break-words px-1 z-20 ${isVertical ? 'w-full mt-[-4px]' : 'w-24'}`} 
  
    
  
                  style={{ textShadow: '0 0 4px rgba(255,255,255,0.8), 0 0 2px rgba(255,255,255,1)' }}
  
    
  
                >
  
    
  
                    {data.text}
  
    
  
                    {(data.temperature || data.duration) && (
  
    
  
                        <div className="flex flex-col items-center mt-1 space-y-0.5 opacity-80">
  
    
  
                            {data.temperature && <span className="text-[8px] bg-red-100/80 px-1 rounded text-red-800 border border-red-200">{data.temperature}</span>}
  
    
  
                            {data.duration && <span className="text-[8px] bg-blue-100/80 px-1 rounded text-blue-800 border border-blue-200">{data.duration}</span>}
  
    
  
                        </div>
  
    
  
                    )}
  
    
  
                </div>
  
    
  
              </div>
  
    
  
            );
  
  
};

export default memo(MinimalNode);