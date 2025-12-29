'use client';

import { useState, useId, useEffect } from 'react';
import { IngredientForm } from '@/components/ingredient-form';
import { IconDisplay, Icon } from '@/components/icon-display';
import { SharedGallery } from '@/components/shared-gallery';
import { RerollMonitor } from '@/components/reroll-monitor';
import { Login } from '@/components/login';
import { LogoutButton } from '@/components/logout-button';
import { useAuth } from '@/components/auth-provider';
import { getOrCreateIconAction, recordRejectionAction, getAllIconsAction, deleteIconByUrlAction } from './actions';
import { LogOut, ChefHat, Globe, User, Star, Plus } from 'lucide-react';
import Link from 'next/link';
import { AUTH_DISABLED } from '@/lib/config';

export default function Home() {
  const { user, loading: authLoading, logout, signIn } = useAuth();
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
    
    if (!rawIngredient) return;

    event.currentTarget.reset();
    
    const newIngredient = toTitleCase(rawIngredient);
    const tempId = typeof crypto !== 'undefined' && crypto.randomUUID ? `temp-${crypto.randomUUID()}` : `temp-${Date.now()}`;
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
      
      const { iconUrl, popularityScore, debugInfo, visualDescription } = result as any; 
      
      const newIcon: Icon = {
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`, 
        ingredient: newIngredient,
        iconUrl: iconUrl,
        popularityScore: popularityScore,
        visualDescription: visualDescription
      };
      
      setIcons(prev => prev.map(i => i.id === tempId ? newIcon : i));
      updateSeen(newIngredient, iconUrl);
      setLastDebugInfo(debugInfo);
      setRefreshKey(prev => prev + 1);
      
    } catch (err: any) {
      setError(err.message || 'Failed to forge item. Please try again.');
      console.error(err);
      setIcons(prev => prev.filter(i => i.id !== tempId));
    }
  };

  const handleReroll = async (iconToReroll: Icon) => {
    if (rerollingIds.has(iconToReroll.id)) return;
    
    setRerollingIds(prev => {
        const next = new Set(prev);
        next.add(iconToReroll.id);
        return next;
    });
    
    try {
        await recordRejectionAction(iconToReroll.iconUrl, iconToReroll.ingredient);
        
        const ingredient = iconToReroll.ingredient;
        const newRejections = (sessionRejections[ingredient] || 0) + 1;
        setSessionRejections(prev => ({ ...prev, [ingredient]: newRejections }));
        
        const seen = Array.from(seenIcons[ingredient] || []);
        if (!seen.includes(iconToReroll.iconUrl)) seen.push(iconToReroll.iconUrl);

        const result = await getOrCreateIconAction(ingredient, newRejections, seen);

        if ('error' in result && result.error) throw new Error(result.error);
        const { iconUrl, popularityScore, debugInfo, visualDescription } = result as any;

        setIcons(prev => prev.map(icon => 
            icon.id === iconToReroll.id 
                ? { ...icon, iconUrl: iconUrl, popularityScore: popularityScore, visualDescription: visualDescription }
                : icon
        ));
        updateSeen(ingredient, iconUrl);
        setLastDebugInfo(debugInfo);
        setRefreshKey(prev => prev + 1);

    } catch (err: any) {
        setError(err.message || 'Failed to reroll item.');
        console.error(err);
    } finally {
        setRerollingIds(prev => {
            const next = new Set(prev);
            next.delete(iconToReroll.id);
            return next;
        });
    }
  };

  const handleInventoryDelete = async (iconId: string, ingredientName?: string) => {
      const icon = icons.find(i => i.id === iconId);
      if (icon && icon.iconUrl) {
          // Call server action to delete from DB/Storage
          deleteIconByUrlAction(icon.iconUrl, ingredientName || icon.ingredient).catch(console.error);
      }
      setIcons(prev => prev.filter(i => i.id !== iconId));
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen w-full bg-zinc-900 text-zinc-100 font-mono items-center justify-center">
        <div className="animate-pulse text-yellow-500">INITIALIZING...</div>
      </div>
    );
  }

  const navItemClass = "flex items-center gap-2 px-3 py-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors text-xs font-medium";

  return (
    <div className="flex min-h-screen w-full flex-col bg-zinc-900 text-zinc-100 font-sans overflow-x-hidden">
      {/* Consistent Header */}
      <header className="h-14 shrink-0 border-b border-zinc-800 flex items-center justify-between px-4 bg-zinc-950 z-20 sticky top-0">
          <div className="flex items-center gap-4 overflow-hidden">
              <div className="flex items-center gap-2 shrink-0">
                  <ChefHat className="w-6 h-6 text-yellow-500" />
                  <span className="hidden md:inline font-bold text-lg text-zinc-100 tracking-tight uppercase">Icon Maker</span>
              </div>
          </div>
          
          <div className="flex items-center gap-2">
              <Link href="/gallery" className={navItemClass} title="Public Gallery">
                  <Globe className="w-4 h-4" />
                  <span className="hidden md:inline">Public</span>
              </Link>
              <Link href="/lanes" className={navItemClass} title="Recipe Lanes">
                  <Plus className="w-4 h-4" />
                  <span className="hidden md:inline">Lanes</span>
              </Link>

              <div className="h-4 w-px bg-zinc-800 mx-2" />

              <div className="text-[10px] font-mono text-zinc-600 shrink-0 flex items-center gap-3">
                  {user ? (
                      <>
                          <span className="truncate max-w-[150px] hidden sm:block" title={user.displayName || user.email || ''}>
                              {user.displayName || 'User'}
                          </span>
                          <LogoutButton className="hover:text-red-400" />
                      </>
                  ) : (
                      <button onClick={signIn} className="hover:text-yellow-500 whitespace-nowrap px-3 py-1.5 rounded bg-zinc-800 text-xs font-bold uppercase tracking-wider">
                          Login
                      </button>
                  )}
              </div>
          </div>
      </header>

      <main className="container mx-auto flex flex-col items-center p-4 sm:p-8 flex-1">
        <div className="w-full max-w-4xl space-y-8">
          <section className="text-center space-y-4">
            <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-yellow-500 uppercase drop-shadow-[0_4px_0_rgba(0,0,0,1)]">
              Forge Icons
            </h1>
            <p className="text-lg text-zinc-400 font-mono">
              Convert text to pixel-art assets.
            </p>
          </section>

          <IngredientForm
            onSubmit={handleSubmit}
            isLoading={false}
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
        </div>
      </main>
    </div>
  );
}
