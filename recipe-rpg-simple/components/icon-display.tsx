/* eslint-disable @next/next/no-img-element */
import React from 'react';
import { RefreshCw } from "lucide-react";

export interface Icon {
  id: string;
  ingredient: string;
  iconUrl: string;
}

interface IconDisplayProps {
  icons: Icon[];
  onReroll: (icon: Icon) => void;
  isLoading: boolean;
  error: string | null;
  highlightedIconId: string | null;
}

export function IconDisplay({ icons, onReroll, isLoading, error, highlightedIconId }: IconDisplayProps) {
  return (
    <div className="flex w-full flex-col items-center space-y-6">
      {error && (
        <div className="w-full bg-red-900/50 p-4 text-xs text-red-300 border-2 border-red-700 font-mono">
          [ERROR]: {error}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6 w-full min-h-[16rem]">
        {icons.length === 0 && !isLoading && (
          <div className="col-span-full flex h-64 items-center justify-center border-4 border-dashed border-zinc-800 bg-zinc-900/50">
            <p className="p-4 text-center text-zinc-600 text-xs uppercase tracking-widest">Inventory Empty</p>
          </div>
        )}

        {icons.map((icon) => (
          <div 
            key={icon.id} 
            className={`group relative bg-zinc-800 border-4 border-zinc-700 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.5)] transition-all duration-100 
              ${highlightedIconId === icon.id ? 'border-yellow-500 scale-105' : 'hover:-translate-y-1 hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,0.5)]'}
            `}
          >
            <div className="p-3 flex flex-col items-center space-y-3">
              <div className="relative aspect-square w-full bg-zinc-900 border-2 border-zinc-950 flex items-center justify-center overflow-hidden">
                 <img 
                   src={icon.iconUrl} 
                   alt={icon.ingredient}
                   className="w-full h-full object-contain rendering-pixelated"
                   style={{ imageRendering: 'pixelated' }}
                 />
              </div>
              <div className="flex w-full items-center justify-between gap-2">
                <span className="text-[10px] text-yellow-500 font-bold truncate uppercase flex-1 tracking-tighter" title={icon.ingredient}>
                  {icon.ingredient}
                </span>
                <button
                  onClick={() => onReroll(icon)}
                  disabled={isLoading}
                  className="p-1 hover:text-white text-zinc-500 transition-colors"
                  title="Reroll"
                >
                  <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>
          </div>
        ))}
        
        {isLoading && (
           <div className="flex h-full w-full aspect-[3/4] items-center justify-center border-4 border-dashed border-zinc-700 bg-zinc-800 animate-pulse">
             <span className="text-zinc-500 text-[10px] uppercase">Forging...</span>
           </div>
        )}
      </div>
    </div>
  );
}