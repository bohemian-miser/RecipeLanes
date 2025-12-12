'use client';

import { useState, useId, useEffect } from 'react';
import { IngredientForm } from '@/components/ingredient-form';
import { IconDisplay, Icon } from '@/components/icon-display';
import { DebugGallery } from '@/components/debug-gallery';
import { RerollMonitor } from '@/components/reroll-monitor';
import { getOrCreateIconAction, recordRejectionAction, getAllIconsAction } from './actions';

export default function Home() {
  const [icons, setIcons] = useState<Icon[]>([]);
  
  // Session State
  const [sessionRejections, setSessionRejections] = useState<Record<string, number>>({});
  const [seenIcons, setSeenIcons] = useState<Record<string, Set<string>>>({});
  const [lastDebugInfo, setLastDebugInfo] = useState<any>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uniqueId = useId();

  const updateSeen = (ingredient: string, url: string) => {
      setSeenIcons(prev => {
          const next = new Set(prev[ingredient] || []);
          next.add(url);
          return { ...prev, [ingredient]: next };
      });
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const newIngredient = formData.get('ingredient') as string;
    
    if (!newIngredient || isLoading) return;
    setIsLoading(true);
    setError(null);
    setLastDebugInfo(null);

    const rejections = sessionRejections[newIngredient] || 0;
    const seen = Array.from(seenIcons[newIngredient] || []);

    try {
      const result = await getOrCreateIconAction(newIngredient, rejections, seen);
      
      if ('error' in result && result.error) {
          throw new Error(result.error);
      }
      
      const { iconUrl, popularityScore, debugInfo } = result as any; 
      
      const newIcon: Icon = {
        id: `${uniqueId}-${icons.length}`,
        ingredient: newIngredient,
        iconUrl: iconUrl,
        popularityScore: popularityScore
      };
      
      setIcons(prev => [...prev, newIcon]);
      updateSeen(newIngredient, iconUrl);
      setLastDebugInfo(debugInfo);
      setRefreshKey(prev => prev + 1);
      
    } catch (err) {
      setError('Failed to forge item. Please try again.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReroll = async (iconToReroll: Icon) => {
    if (isLoading) return;
    setIsLoading(true);
    
    try {
        // 1. Record Rejection
        await recordRejectionAction(iconToReroll.iconUrl, iconToReroll.ingredient);
        
        // 2. Update Session Stats
        const ingredient = iconToReroll.ingredient;
        const newRejections = (sessionRejections[ingredient] || 0) + 1;
        setSessionRejections(prev => ({ ...prev, [ingredient]: newRejections }));
        
        const seen = Array.from(seenIcons[ingredient] || []);
        // Add the rejected one to seen if not already (it should be)
        if (!seen.includes(iconToReroll.iconUrl)) seen.push(iconToReroll.iconUrl);

        // 3. Get Next Icon
        const result = await getOrCreateIconAction(ingredient, newRejections, seen);

        if ('error' in result && result.error) throw new Error(result.error);
        const { iconUrl, popularityScore, debugInfo } = result as any;

        // 4. Update UI
        setIcons(prev => prev.map(icon => 
            icon.id === iconToReroll.id 
                ? { ...icon, iconUrl: iconUrl, popularityScore: popularityScore }
                : icon
        ));
        updateSeen(ingredient, iconUrl);
        setLastDebugInfo(debugInfo);
        setRefreshKey(prev => prev + 1);

    } catch (err) {
        setError('Failed to reroll item.');
        console.error(err);
    } finally {
        setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full bg-zinc-900 text-zinc-100 font-mono">
      <main className="container mx-auto flex flex-col items-center p-4 sm:p-8">
        <div className="w-full max-w-4xl space-y-8">
          <header className="text-center space-y-4">
            <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-yellow-500 uppercase drop-shadow-[0_4px_0_rgba(0,0,0,1)]">
              Recipe RPG
            </h1>
            <p className="text-lg text-zinc-400">
              Forge culinary items from text! Build your collection.
            </p>
          </header>

          <IngredientForm
            onSubmit={handleSubmit}
            isLoading={isLoading}
          />
          
          <RerollMonitor debugInfo={lastDebugInfo} />

          <IconDisplay
            icons={icons}
            onReroll={handleReroll}
            isLoading={isLoading}
            error={error}
            highlightedIconId={null}
          />

          <DebugGallery refreshKey={refreshKey} />
        </div>
      </main>
    </div>
  );
}
