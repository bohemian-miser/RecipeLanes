'use client';

import { useEffect, useState } from 'react';
import { getSharedGalleryAction } from '@/app/actions';
import { RefreshCw } from 'lucide-react';

export function SharedGallery() {
  const [galleryIcons, setGalleryIcons] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSharedGalleryAction()
      .then((icons) => {
        setGalleryIcons(icons);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to fetch shared gallery:', err);
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="text-center text-zinc-600 font-mono text-xs animate-pulse p-8">Loading Community Collection...</div>;
  if (galleryIcons.length === 0) return null;

  // Group by ingredient
  const grouped: Record<string, any[]> = {};
  galleryIcons.forEach(icon => {
      if (!grouped[icon.ingredient_name]) grouped[icon.ingredient_name] = [];
      grouped[icon.ingredient_name].push(icon);
  });

  return (
    <div className="w-full space-y-6 pt-8 border-t border-zinc-800">
      <h2 className="text-xl text-yellow-500 font-mono uppercase tracking-widest text-center">Community Collection (Top 4)</h2>
      
      <div className="grid grid-cols-1 gap-8">
        {Object.entries(grouped).map(([ingredient, icons]) => (
          <div key={ingredient} className="space-y-3">
            <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-wider pl-2 border-l-2 border-yellow-500/30">
              {ingredient}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {icons.map((icon) => (
                <div key={icon.id} className="relative aspect-square bg-zinc-800 border-2 border-zinc-700 shadow-md group overflow-hidden">
                   <div className="absolute top-1 right-1 z-10 bg-black/60 px-1.5 py-0.5 text-[10px] font-mono text-green-400 pointer-events-none rounded">
                      {Number(icon.popularity_score || 0).toFixed(2)}
                   </div>
                   <img 
                     src={icon.url} 
                     alt={ingredient}
                     className="w-full h-full object-contain rendering-pixelated transition-transform group-hover:scale-110"
                     style={{ imageRendering: 'pixelated' }}
                   />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
