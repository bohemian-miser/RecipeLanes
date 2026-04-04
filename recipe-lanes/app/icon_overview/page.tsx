/*
 * Copyright (C) 2026 Bohemian Miser <https://substack.com/@bohemianmiser>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

'use client';

import { useState, useEffect, useRef } from 'react';
import { IngredientForm } from '@/components/ingredient-form';
import { IconDisplay } from '@/components/icon-display';
import { IconSearchCandidates } from '@/components/icon-search-candidates';
import { SharedGallery } from '@/components/shared-gallery';
import { QueueMonitor } from '@/components/queue-monitor';
import { LogoutButton } from '@/components/logout-button';
import { useAuth } from '@/components/auth-provider';
import { createDebugRecipeAction, addIngredientNodeAction, rejectIcon, deleteRecipeAction, searchIconCandidatesAction } from '@/app/actions';
import { ChefHat, Globe, Plus, Github } from 'lucide-react';
import Link from 'next/link';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase-client';
import { DB_COLLECTION_RECIPES } from '@/lib/config';
import { standardizeIngredientName } from '@/lib/utils';
import { getNodeIconUrl, getNodeIconId, getNodeIngredientName } from '@/lib/recipe-lanes/model-utils';
import { RecipeNode, IconStats } from '@/lib/recipe-lanes/types';
import { IconDetailModal } from '@/components/icon-detail-modal';
import { IconOverviewModal } from '@/components/icon-overview-modal';

export default function Home() {
  const { user, loading: authLoading, signIn } = useAuth();
  const [nodes, setNodes] = useState<RecipeNode[]>([]);
  const [recipeId, setRecipeId] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);
  
  const [rerollingIds, setRerollingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<RecipeNode | null>(null);
  const [selectedGalleryIcon, setSelectedGalleryIcon] = useState<{ icon: IconStats; matchScore?: number } | null>(null);

  const [mode, setMode] = useState<'forge' | 'search'>('forge');
  const [searchCandidates, setSearchCandidates] = useState<IconStats[]>([]);
  const [searchMatchScores, setSearchMatchScores] = useState<Record<string, number>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  // Use a ref to track if we've already created a recipe to prevent double-creation in strict mode
  const recipeCreated = useRef(false);

  // 1. Initialize Debug Recipe
  useEffect(() => {
    async function init() {
      if (authLoading) return;
      if (recipeId) {
          setInitializing(false);
          return;
      }
      if (recipeCreated.current) return;
      recipeCreated.current = true;
      
      try {
        const result = await createDebugRecipeAction();
        if (result.error) throw new Error(result.error);
        if (result.recipeId) {
            console.log('Debug Recipe Created:', result.recipeId);
            setRecipeId(result.recipeId);
        }
      } catch (e) {
        console.error('Failed to create debug recipe:', e);
        setError('Failed to initialize session.');
      } finally {
        setInitializing(false);
      }
    }
    
    init();

    // Cleanup on Unmount
    return () => {
        if (recipeId) {
            // Best effort cleanup
            deleteRecipeAction(recipeId).catch(console.error);
        }
    };
  }, [authLoading, recipeId]); // Run when auth ready or ID changes

  // 2. Listen for Updates
  useEffect(() => {
    if (!recipeId) return;

        console.log('Setting up listener for recipe:', recipeId);
    // We can use the client-side DB directly for listening!
    // Assuming config.ts exports DB_COLLECTION_RECIPES
    const unsub = onSnapshot(doc(db, DB_COLLECTION_RECIPES, recipeId), (docSnap) => {
      if (docSnap.exists()) {
        console.log('Recipe Update Received');
        const data = docSnap.data();
        const graph = data?.graph;
        console.log('Graph Nodes:', graph?.nodes?.length || 0);
            if (graph && Array.isArray(graph.nodes)) {
                // Reverse to show newest first
                const newNodes: RecipeNode[] = [...graph.nodes].reverse();
                setNodes(newNodes);
            }
        }
    });

    return () => unsub();
  }, [recipeId]);


  const toTitleCase = (str: string) => {
    return str.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!recipeId) {
        setError("Session not initialized.");
        return;
    }

    const formData = new FormData(event.currentTarget);
    const rawIngredient = formData.get('ingredient') as string;
    
    if (!rawIngredient) return;

    event.currentTarget.reset();
    
    const newIngredient = toTitleCase(rawIngredient);
    
    // Optimistic Update (optional, but good for UX)
    // We rely on the listener, but adding a temporary one helps with "instant" feel
    // Actually, let's just let the listener handle it since it's fast enough locally
    // and safer for consistency. But we can set a loading state if we want.
    
    try {
        await addIngredientNodeAction(recipeId, newIngredient);
    } catch (e: any) {
        console.error(e);
        setError("Failed to add item.");
    }
  };

  const handleSearch = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const query = formData.get('ingredient') as string;
    if (!query) return;

    event.currentTarget.reset();
    setIsSearching(true);
    try {
      const result = await searchIconCandidatesAction(query);
      setSearchCandidates(result.candidates);
      setSearchMatchScores(result.matchScores);
      setSearchQuery(query);
    } catch (e: any) {
      console.error(e);
      setSearchCandidates([]);
      setSearchMatchScores({});
      setSearchQuery(query);
    } finally {
      setIsSearching(false);
    }
  };

  const handleReroll = async (nodeToReroll: RecipeNode) => {
    if (rerollingIds.has(nodeToReroll.id)) return;
    if (!recipeId) return;
    
    setRerollingIds(prev => {
        const next = new Set(prev);
        next.add(nodeToReroll.id);
        return next;
    });
    
    try {
        const currentIconId = getNodeIconId(nodeToReroll);
        const ingredient = standardizeIngredientName(getNodeIngredientName(nodeToReroll));

        const result = await rejectIcon(
            recipeId,
            ingredient,
            currentIconId
        );

        if (result.error) throw new Error(result.error); 

    } catch (err: any) {
        setError(err.message || 'Failed to reroll item.');
        console.error(err);
    } finally {
        setRerollingIds(prev => {
            const next = new Set(prev);
            next.delete(nodeToReroll.id);
            return next;
        });
    }
  };

  const handleInventoryDelete = async (nodeId: string, ingredientName: string) => {
     setNodes(prev => prev.filter(n => n.id !== nodeId));
  };

  if (authLoading || initializing) {
    return (
      <div className="flex min-h-screen w-full bg-zinc-900 text-zinc-100 font-mono items-center justify-center">
        <div className="animate-pulse text-yellow-500">INITIALIZING SESSION...</div>
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
                  <span>Gallery</span>
              </Link>
              <Link href="/lanes" className={navItemClass} title="Recipe Lanes">
                  <Plus className="w-4 h-4" />
                  <span className="hidden md:inline">Lanes</span>
              </Link>

              <a href="https://github.com/Bohemian-Miser/RecipeLanes" target="_blank" rel="noopener noreferrer" className={navItemClass} title="Find me on GitHub">
                  <Github className="w-4 h-4" />
              </a>

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
            <div className="flex items-center justify-center gap-6 pt-2">
              <button
                onClick={() => setMode('forge')}
                className={`font-mono text-sm uppercase tracking-wider pb-1 transition-colors ${
                  mode === 'forge'
                    ? 'text-yellow-500 border-b-2 border-yellow-500'
                    : 'text-zinc-500 border-b-2 border-transparent hover:text-zinc-300'
                }`}
              >
                Forge
              </button>
              <button
                onClick={() => setMode('search')}
                className={`font-mono text-sm uppercase tracking-wider pb-1 transition-colors ${
                  mode === 'search'
                    ? 'text-yellow-500 border-b-2 border-yellow-500'
                    : 'text-zinc-500 border-b-2 border-transparent hover:text-zinc-300'
                }`}
              >
                Search
              </button>
            </div>
          </section>

          <IngredientForm
            onSubmit={mode === 'forge' ? handleSubmit : handleSearch}
            isLoading={false}
          />

          {mode === 'search' && (
            <IconSearchCandidates
              query={searchQuery}
              candidates={searchCandidates}
              matchScores={searchMatchScores}
              isSearching={isSearching}
              onIconClick={(candidate, matchScore) => setSelectedGalleryIcon({ icon: candidate, matchScore })}
            />
          )}

          {mode === 'forge' && <QueueMonitor />}

          {mode === 'forge' && (
            <IconDisplay
              nodes={nodes}
              onReroll={handleReroll}
              onDelete={handleInventoryDelete}
              rerollingIds={rerollingIds}
              error={error}
              highlightedIconId={null}
              onIconClick={setSelectedNode}
            />
          )}

          <SharedGallery
            onIconClick={(icon) => setSelectedGalleryIcon({ icon })}
          />
        </div>
      </main>

      <IconDetailModal node={selectedNode} onClose={() => setSelectedNode(null)} />
      {selectedGalleryIcon && (
        <IconOverviewModal
          icon={selectedGalleryIcon.icon}
          matchScore={selectedGalleryIcon.matchScore}
          onClose={() => setSelectedGalleryIcon(null)}
        />
      )}
    </div>
  );
}