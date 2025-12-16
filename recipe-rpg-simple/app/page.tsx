'use client';

import { useState, useId, useEffect } from 'react';
import { IngredientForm } from '@/components/ingredient-form';
import { IconDisplay, Icon } from '@/components/icon-display';
import { DebugGallery } from '@/components/debug-gallery';
import { SharedGallery } from '@/components/shared-gallery';
import { RerollMonitor } from '@/components/reroll-monitor';
import { Login } from '@/components/login';
import { useAuth } from '@/components/auth-provider';
import { getOrCreateIconAction, recordRejectionAction, getAllIconsAction } from './actions';
import { LogOut } from 'lucide-react';

export default function Home() {
  const { user, loading: authLoading, logout } = useAuth();
  const [icons, setIcons] = useState<Icon[]>([]);
  
  // Session State
  const [sessionRejections, setSessionRejections] = useState<Record<string, number>>({});
  const [seenIcons, setSeenIcons] = useState<Record<string, Set<string>>>({});
  const [lastDebugInfo, setLastDebugInfo] = useState<any>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Parallel Request Management
  const [rerollingIds, setRerollingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const uniqueId = useId();

  const toTitleCase = (str: string) => {
    return str.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  };

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
    const rawIngredient = formData.get('ingredient') as string;
    
    // Allow parallel submissions, only check if input is empty
    if (!rawIngredient) return;

    // Reset form immediately to allow next input
    event.currentTarget.reset();
    
    // Optimistic UI: Add pending card
    const newIngredient = toTitleCase(rawIngredient);
    const tempId = `temp-${uniqueId}-${Date.now()}-${Math.random()}`;
    const pendingIcon: Icon = {
        id: tempId,
        ingredient: newIngredient,
        iconUrl: '',
        isPending: true
    };
    setIcons(prev => [...prev, pendingIcon]);
    
    setError(null);
    setLastDebugInfo(null);

    const rejections = sessionRejections[newIngredient] || 0;
    const seen = Array.from(seenIcons[newIngredient] || []);

    try {
      const result = await getOrCreateIconAction(rawIngredient, rejections, seen);
      
      if ('error' in result && result.error) {
          throw new Error(result.error);
      }
      
      const { iconUrl, popularityScore, debugInfo } = result as any; 
      
      const newIcon: Icon = {
        id: `${uniqueId}-${Date.now()}-${Math.random()}`, 
        ingredient: newIngredient,
        iconUrl: iconUrl,
        popularityScore: popularityScore
      };
      
      // Replace pending icon with real one
      setIcons(prev => prev.map(i => i.id === tempId ? newIcon : i));
      updateSeen(newIngredient, iconUrl);
      setLastDebugInfo(debugInfo);
      setRefreshKey(prev => prev + 1);
      
    } catch (err) {
      setError('Failed to forge item. Please try again.');
      console.error(err);
      // Remove pending icon on error
      setIcons(prev => prev.filter(i => i.id !== tempId));
    }
  };

  const handleReroll = async (iconToReroll: Icon) => {
    // Prevent double reroll of same item
    if (rerollingIds.has(iconToReroll.id)) return;
    
    setRerollingIds(prev => {
        const next = new Set(prev);
        next.add(iconToReroll.id);
        return next;
    });
    
    try {
        // 1. Record Rejection
        await recordRejectionAction(iconToReroll.iconUrl, iconToReroll.ingredient);
        
        // 2. Update Session Stats
        const ingredient = iconToReroll.ingredient;
        const newRejections = (sessionRejections[ingredient] || 0) + 1;
        setSessionRejections(prev => ({ ...prev, [ingredient]: newRejections }));
        
        const seen = Array.from(seenIcons[ingredient] || []);
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
        setRerollingIds(prev => {
            const next = new Set(prev);
            next.delete(iconToReroll.id);
            return next;
        });
    }
  };

  const handleInventoryDelete = (iconId: string) => {
      setIcons(prev => prev.filter(i => i.id !== iconId));
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen w-full bg-zinc-900 text-zinc-100 font-mono items-center justify-center">
        <div className="animate-pulse text-yellow-500">INITIALIZING...</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full bg-zinc-900 text-zinc-100 font-mono">
      <main className="container mx-auto flex flex-col items-center p-4 sm:p-8">
        <div className="w-full max-w-4xl space-y-8">
          <header className="text-center space-y-4 relative">
            <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-yellow-500 uppercase drop-shadow-[0_4px_0_rgba(0,0,0,1)]">
              Icon Maker
            </h1>
            <p className="text-lg text-zinc-400">
              Forge pixel art icons from text! Build your collection.
            </p>
            {user && (
              <div className="absolute top-0 right-0 flex flex-col items-end gap-2">
                <span className="text-[10px] text-zinc-600 font-mono hidden sm:block">{user.email}</span>
                <button 
                  onClick={() => logout()}
                  className="p-2 text-zinc-500 hover:text-red-400 transition-colors"
                  title="Sign Out"
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            )}
          </header>

          {!user ? (
            <Login />
          ) : (
            <>
              <IngredientForm
                onSubmit={handleSubmit}
                isLoading={false} // Always allow new submissions
              />
              
              <RerollMonitor debugInfo={lastDebugInfo} />

              <IconDisplay
                icons={icons}
                onReroll={handleReroll}
                onDelete={handleInventoryDelete}
                rerollingIds={rerollingIds}
                error={error}
                highlightedIconId={null}
              />

              <SharedGallery />

              <DebugGallery refreshKey={refreshKey} />
            </>
          )}
        </div>
      </main>
    </div>
  );
}
