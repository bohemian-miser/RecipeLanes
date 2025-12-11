'use client';

import { useState, useId } from 'react';
import { IngredientForm } from '@/components/ingredient-form';
import { IconDisplay, Icon } from '@/components/icon-display';
import { getOrCreateIconAction, updatePopularityAction } from './actions';

export default function Home() {
  const [icons, setIcons] = useState<Icon[]>([]);
  const [generationCounts, setGenerationCounts] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uniqueId = useId();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const newIngredient = formData.get('ingredient') as string;
    
    if (!newIngredient || isLoading) return;
    setIsLoading(true);
    setError(null);

    const count = generationCounts[newIngredient] || 0;

    try {
      const result = await getOrCreateIconAction(newIngredient, undefined, count);
      
      if ('error' in result && result.error) {
          throw new Error(result.error);
      }
      
      const { iconUrl } = result as { iconUrl: string }; // Type assertion helpers if needed
      
      const newIcon: Icon = {
        id: `${uniqueId}-${icons.length}`,
        ingredient: newIngredient,
        iconUrl: iconUrl,
      };
      
      setIcons(prev => [...prev, newIcon]);
      setGenerationCounts(prev => ({ ...prev, [newIngredient]: count + 1 }));
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
        await updatePopularityAction(iconToReroll.iconUrl, -1);
        
        const count = generationCounts[iconToReroll.ingredient] || 0;
        const result = await getOrCreateIconAction(iconToReroll.ingredient, iconToReroll.iconUrl, count);

        if ('error' in result && result.error) throw new Error(result.error);
        const { iconUrl } = result as { iconUrl: string };

        setIcons(prev => prev.map(icon => 
            icon.id === iconToReroll.id 
                ? { ...icon, iconUrl: iconUrl }
                : icon
        ));
        setGenerationCounts(prev => ({ ...prev, [iconToReroll.ingredient]: count + 1 }));
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
          
          <IconDisplay
            icons={icons}
            onReroll={handleReroll}
            isLoading={isLoading}
            error={error}
            highlightedIconId={null}
          />
        </div>
      </main>
    </div>
  );
}
