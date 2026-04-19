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

import { useState, useEffect, Suspense, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/auth-provider';
import { LogoutButton } from '@/components/logout-button';
import ReactFlowDiagram, { ReactFlowDiagramHandle } from '@/components/recipe-lanes/react-flow-diagram';
import { ReactFlowProvider } from 'reactflow';
import { createVisualRecipeAction, adjustRecipeAction, saveRecipeAction, checkExistingCopiesAction, debugLogAction, applyIconSearchResultsAction } from '@/app/actions';
import { iconSearchMethods, defaultIconSearchMethod } from '@/lib/icon-search-registry';
import { standardizeIngredientName } from '@/lib/utils';
import { IngredientsSidebar } from '@/components/recipe-lanes/ui/ingredients-sidebar';
import { TimelineView } from '@/components/recipe-lanes/timeline-view';
import type { RecipeGraph } from '@/lib/recipe-lanes/types';
import { hasNodeIcon, preserveNodeShortlist, getNodeShortlistLength, getNodeIngredientName, getNodeHydeQueries } from '@/lib/recipe-lanes/model-utils';
import { useRecipeStore } from '@/lib/stores/recipe-store';
import { LayoutMode } from '@/lib/recipe-lanes/layout';
import { Wand2, ChefHat, ArrowRight, Code, MessageSquare, Send, LayoutDashboard, Kanban, GitGraph, Columns, AlignCenter, Network, Sparkles, CircleDot, Share2, Sprout, Move, RotateCw, Orbit, Type, Play, Pause, Pencil, RotateCcw, Globe, Lock, Plus, LayoutGrid, Star, User, ShoppingBasket, HelpCircle, Github } from 'lucide-react';
import { Banner } from '@/components/ui/banner';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/lib/firebase-client';
import { FeedbackModal } from '@/components/feedback-modal';

function RecipeLanesContent() {
  const { user, isAdmin, loading: authLoading, signIn } = useAuth();
  const searchParams = useSearchParams();
  const recipeId = searchParams.get('id');
  const router = useRouter();

  const [recipeTitle, setRecipeTitle] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [recipeText, setRecipeText] = useState('');
  const [chatInput, setChatInput] = useState('');
  const graph = useRecipeStore(s => s.graph);
  const ownerId = useRecipeStore(s => s.ownerId);
  const ownerName = useRecipeStore(s => s.ownerName);
  const { mergeSnapshot, setGraph, reset: resetRecipeStore } = useRecipeStore.getState();
  
  useEffect(() => {
      console.log('[RecipeLanesPage] User:', user?.uid, 'Owner:', ownerId);
  }, [user, ownerId]);

  const [notification, setNotification] = useState<string | null>(null); 
  const [status, setStatus] = useState<'idle' | 'parsing' | 'forging' | 'adjusting' | 'complete' | 'error' | 'loading'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [showIngredients, setShowIngredients] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [iconSearchStatus, setIconSearchStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [iconSearchMethodId, setIconSearchMethodId] = useState(defaultIconSearchMethod.id);
  const [iconSearchElapsed, setIconSearchElapsed] = useState<number | null>(null);
  const [jsonText, setJsonText] = useState('');
  const [layoutMode, setLayoutMode] = useState<LayoutMode | 'repulsive' | 'timeline2'>('dagre');
  const layoutModeRestoredRef = useRef(false);
  const [iconTheme, setIconTheme] = useState<'classic' | 'modern' | 'modern_clean'>('classic');
  const [showForkPrompt, setShowForkPrompt] = useState(false);
  const [warningDismissed, setWarningDismissed] = useState(false);
  const [existingCopies, setExistingCopies] = useState<any[] | null>(null);
  const [existingCopiesDismissed, setExistingCopiesDismissed] = useState(false);
  const [guestBannerDismissed, setGuestBannerDismissed] = useState(false);

  const diagramRef = useRef<ReactFlowDiagramHandle>(null);
  const isForking = useRef(false);
  const titleBeforeEdit = useRef('');
  const autoFillIconsRef = useRef(false);

  const isOwner = !ownerId || (!!user && user.uid === ownerId);

  // ... (Restore Last Recipe, Save Last ID, Sync JSON, Warning, Persistence) ...

  const handleEditAttempt = async () => {
      if (!user) {
          showNotification("Log in to save your changes.");
          return;
      }
      if (isOwner) return;
      if (existingCopies === null) return; // Wait for check to complete
      if (isForking.current) return;

      // Auto-Fork if no copies exist (First time editing shared recipe)
      if (existingCopies.length === 0) {
          showNotification("Saving a local copy...");
          await handleFork(); 
          return;
      }

      // If copies exist, prompt the user
      if (!showForkPrompt) {
          setShowForkPrompt(true);
      }
  };

  const handleUpdateServes = (newServes: number) => {
      if (!graph) return;
      const baseServes = graph.baseServes || 1;
      const scale = newServes / baseServes;
      const newNodes = graph.nodes.map(n => {
          if (n.type === 'ingredient' && n.quantity) {
              const newQty = Math.round((n.quantity * scale) * 100) / 100;
              // Update text if we can reconstruct it cleanly
              if (n.canonicalName) {
                  return { ...n, text: `${newQty} ${n.unit || ''} ${n.canonicalName}`.trim().replace(/\s+/g, ' ') };
              }
          }
          return n;
      });
      
      setGraph({ ...graph, serves: newServes, nodes: newNodes });
  };
  useEffect(() => {
      const isNew = searchParams.get('new');

      if (isNew) {
          localStorage.removeItem('last_recipe_id');
          // Clear the ?new=true param cleanly using router to stay in sync
          router.replace('/lanes');
      }
  }, [searchParams, router]);

  // Save Last Recipe ID
  useEffect(() => {
      const id = searchParams.get('id');
      if (id) {
          localStorage.setItem('last_recipe_id', id);
      }
  }, [searchParams]);

  // Sync graph to jsonText
  useEffect(() => {
      if (graph) {
          // url is no longer in the graph so it's safe.
          const safeGraph = { ...graph };
          setJsonText(JSON.stringify(safeGraph, null, 2));
      }
  }, [graph]);

  // Save Text Draft on Unload/Refresh (Persistence)
  useEffect(() => {
      const savedText = localStorage.getItem('recipe_draft');
      if (savedText && !recipeText && !searchParams.get('id')) {
           setRecipeText(savedText);
      }
  }, []); // Only on mount

  useEffect(() => {
      if (recipeText) {
          localStorage.setItem('recipe_draft', recipeText);
      }
  }, [recipeText]);

  const showNotification = (msg: string) => {
      setNotification(msg);
      setTimeout(() => setNotification(null), 3000);
  };

  const handleBatchIconSearch = async (methodId?: string) => {
      if (!graph || !recipeId) return;
      const mid = methodId ?? iconSearchMethodId;
      const method = iconSearchMethods.find(m => m.id === mid) ?? iconSearchMethods[0];

      setIconSearchStatus('running');
      setIconSearchElapsed(null);
      try {
          const hydeMap = new Map<string, string[]>();
          for (const node of graph.nodes) {
              if (!node.visualDescription) continue;
              const stdName = standardizeIngredientName(getNodeIngredientName(node));
              const queries = getNodeHydeQueries(node);
              const existing = hydeMap.get(stdName) ?? [];
              hydeMap.set(stdName, Array.from(new Set([...existing, ...queries])));
          }
          const ingredients = Array.from(hydeMap.entries()).map(([name, queries]) => ({
              name,
              queries: queries.length ? queries : [name],
          }));
          if (ingredients.length === 0) { setIconSearchStatus('idle'); return; }

          console.log(`[batchIconSearch] ${method.name} — ${ingredients.length} ingredients`);
          const results = await method.search(ingredients, 12);
          const res = await applyIconSearchResultsAction(recipeId, results);
          if (!res.success) throw new Error(res.error);
          console.log(`[batchIconSearch] applied ${res.applied} in ${res.elapsed}ms`);
          setIconSearchElapsed(res.elapsed);
          setIconSearchStatus('done');
          setTimeout(() => setIconSearchStatus('idle'), 4000);
      } catch (e: any) {
          console.error('[handleBatchIconSearch]', e);
          setIconSearchStatus('error');
          setTimeout(() => setIconSearchStatus('idle'), 3000);
      }
  };

const saveAndHandleFork = async (graphToSave: RecipeGraph) => {
      const currentId = searchParams.get('id');
      const isNotOwner = (user && ownerId && user.uid !== ownerId) || (!user && ownerId);
      
      let targetId = currentId || undefined;

      if (isNotOwner && currentId) {
          console.log('Forking recipe (Not Owner)');
          graphToSave.sourceId = currentId;
          targetId = undefined;
          
          let newTitle = graphToSave.title || 'Untitled';
          if (newTitle.startsWith('Yet another copy of ')) {
             const match = newTitle.match(/Yet another copy of (.*) \((\d+)\)$/);
             if (match) {
                 newTitle = `Yet another copy of ${match[1]} (${parseInt(match[2]) + 1})`;
             } else {
                 newTitle = `${newTitle} (1)`;
             }
          } else if (newTitle.startsWith('Another copy of ')) {
             newTitle = newTitle.replace('Another copy of ', 'Yet another copy of ');
          } else if (newTitle.startsWith('Copy of ')) {
             newTitle = newTitle.replace('Copy of ', 'Another copy of ');
          } else {
             newTitle = `Copy of ${newTitle}`;
          }
          
          graphToSave.title = newTitle;
          setRecipeTitle(newTitle);
          showNotification("Saving a copy to your profile...");
      }

      const res = await saveRecipeAction(graphToSave, targetId);
      
      if (res.id) {
          const url = new URL(window.location.href);
          url.searchParams.delete('new');
          url.searchParams.set('id', res.id);
          window.history.replaceState({}, '', url.pathname + url.search);
      }
      return res;
  };

  const handleJsonSave = async () => {
      try {
          const partialGraph = JSON.parse(jsonText);
          
          // Restore icons from existing graph
          const newNodes = partialGraph.nodes.map((n: any) => {
              const original = graph?.nodes.find(o => o.id === n.id);
              if (original && getNodeShortlistLength(original) > 0) {
                  return preserveNodeShortlist(n, original);
              }
              return n;
          });
          
          const newGraph = { ...partialGraph, nodes: newNodes };
          setGraph(newGraph);
          if (user) {
              const res = await saveAndHandleFork(newGraph);
              if (res.id) {
                  showNotification("JSON saved.");
              }
          }
      } catch (e) {
          showNotification("Invalid JSON");
      }
  };

  const handleToggleJson = () => {
      if (!showJson && diagramRef.current) {
          const freshGraph = diagramRef.current.getGraph();
          if (freshGraph) {
              const safeGraph = { 
                  ...freshGraph, 
                  nodes: freshGraph.nodes
              };
              setJsonText(JSON.stringify(safeGraph, null, 2));
          }
      }
      setShowJson(!showJson);
  };

  const [spacing, setSpacing] = useState(0.5);
  const [edgeStyle, setEdgeStyle] = useState<'straight' | 'step' | 'bezier'>('straight');
  const [textPos, setTextPos] = useState<'bottom' | 'top' | 'left' | 'right'>('bottom');
  const [isLive, setIsLive] = useState(false);
  const [inputExpanded, setInputExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
      if (!inputExpanded && textareaRef.current) {
          textareaRef.current.style.height = '';
      }
  }, [inputExpanded]);

  // Reset the layout-mode restoration flag whenever the recipe changes so a
  // fresh load picks up the saved layout mode from the new graph.
  useEffect(() => {
      layoutModeRestoredRef.current = false;
  }, [recipeId]);

  // Restore the layout mode from the saved graph on initial load.
  // This ensures that if the user last saved in swimlanes mode, we restore
  // to swimlanes mode on reload rather than defaulting to dagre.
  useEffect(() => {
      if (!graph || layoutModeRestoredRef.current) return;
      if (graph.layoutMode && graph.layoutMode !== layoutMode) {
          layoutModeRestoredRef.current = true;
          setLayoutMode(graph.layoutMode as LayoutMode | 'repulsive');
      } else {
          layoutModeRestoredRef.current = true;
      }
  }, [graph?.layoutMode]);

  // Listener for Recipe Updates
  // NOTE: Depends on `recipeId` (string), NOT `searchParams` (object).
  // Using searchParams as a dependency caused the listener to re-run on every save
  // because window.history.replaceState (called in handleSave) makes useSearchParams
  // return a new object reference, even when the ID hasn't changed. This caused
  // resetRecipeStore() → graph = null → DiagramInner remount → stale position restore.
  useEffect(() => {
      if (!recipeId) return;

      resetRecipeStore();
      debugLogAction('Setting up listener for recipe: ' + recipeId);
      setStatus('loading');
      setWarningDismissed(false);

      // Use Firestore Listener
      const unsubscribe = onSnapshot(doc(db, 'recipes', recipeId), (docSnapshot) => {
          if (docSnapshot.exists()) {
              const data = docSnapshot.data();
              const currentGraph = data.graph as RecipeGraph;
              if (data.visibility) currentGraph.visibility = data.visibility as any;
              mergeSnapshot(currentGraph, {
                  ownerId: data.ownerId || undefined,
                  ownerName: data.ownerName || undefined,
              });
              if (currentGraph.layoutMode) setLayoutMode(currentGraph.layoutMode as any);
              setRecipeText(currentGraph.originalText || '');
              setRecipeTitle(currentGraph.title || '');
              setStatus('complete');
          } else {
              setError('Recipe not found');
              setStatus('error');
          }
      }, (err) => {
          console.error('Snapshot listener error:', err);
          setError('Failed to sync recipe');
      });

      return () => unsubscribe();
  }, [recipeId]);

  // After a new recipe is created, auto-fill icons using the default (client-side) method
  // once the graph has loaded. The server-side path may not have a CF URL configured.
  useEffect(() => {
      if (!autoFillIconsRef.current) return;
      if (!graph || !recipeId || graph.nodes.length === 0) return;
      autoFillIconsRef.current = false;
      handleBatchIconSearch(defaultIconSearchMethod.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, recipeId]);

  useEffect(() => {
      setExistingCopiesDismissed(false);

      // If we don't have a user or ownerId yet, we can't determine copies.
      // Set to null to block auto-forking until we know for sure.
      if (!recipeId || !user || !ownerId) {
          setExistingCopies(null);
          return;
      }

      if (user.uid !== ownerId) {
           setExistingCopies(null); // Reset to loading before fetch
           checkExistingCopiesAction(recipeId).then(res => {
               setExistingCopies(res.copies || []);
           });
      } else {
           setExistingCopies([]); // Owner doesn't need copy check
      }
  }, [recipeId, user, ownerId]);

  const handleNew = () => {
      setRecipeText('');
      setRecipeTitle('');
      resetRecipeStore();
      setError(null);
      setStatus('idle');
      setWarningDismissed(false);
      setGuestBannerDismissed(false);
      localStorage.removeItem('recipe_draft'); 
      router.push('/lanes?new=true');
  };

  const handleFork = async () => {
      const currentGraph = diagramRef.current ? diagramRef.current.getGraph() : graph;
      if (!currentGraph) return;
      if (isForking.current) return;
      
      isForking.current = true;
      setStatus('forging');
      // Create copy
      const currentId = searchParams.get('id');
      
      // Smarter Naming
      let newTitle = recipeTitle;
      
      if (existingCopies && existingCopies.length > 0 && !recipeTitle.startsWith('Copy of') && !recipeTitle.startsWith('Another copy of') && !recipeTitle.startsWith('Yet another copy of')) {
         newTitle = `Another copy of ${recipeTitle}`;
      } else if (newTitle.startsWith('Yet another copy of ')) {
         const match = newTitle.match(/Yet another copy of (.*) \((\d+)\)$/);
         if (match) {
             newTitle = `Yet another copy of ${match[1]} (${parseInt(match[2]) + 1})`;
         } else {
             newTitle = `${newTitle} (1)`;
         }
      } else if (newTitle.startsWith('Another copy of ')) {
         newTitle = newTitle.replace('Another copy of ', 'Yet another copy of ');
      } else if (newTitle.startsWith('Copy of ')) {
         newTitle = newTitle.replace('Copy of ', 'Another copy of ');
      } else {
         newTitle = `Copy of ${newTitle}`;
      }

      const newGraph = { 
          ...currentGraph, 
          title: newTitle,
          sourceId: currentId || undefined
      };
      const res = await saveRecipeAction(newGraph, undefined); // New ID
      if (res.id) {
          const url = new URL(window.location.href);
          url.searchParams.set('id', res.id);
          router.push(url.pathname + url.search);
          setWarningDismissed(true);
          setStatus('complete');
          setRecipeTitle(newGraph.title!);
          showNotification("New version created.");
      } else {
          showNotification("Fork failed: " + res.error);
          setStatus('error');
      }
      isForking.current = false;
  };

  const handleTitleChange = async (newTitle: string) => {
      setEditingTitle(false);
      if (newTitle === titleBeforeEdit.current) return;
      setRecipeTitle(newTitle);

      if (graph) {
          const newGraph = { ...graph, title: newTitle };
          setGraph(newGraph);

          const isOwner = user && user.uid === ownerId;
          const currentId = searchParams.get('id');

          if (isOwner && currentId) {
               const res = await saveRecipeAction(newGraph, currentId);
               if (res.error) showNotification("Failed to save title: " + res.error);
          } else if (user) {
               showNotification("Saving a copy to your profile...");
               const currentId = searchParams.get('id');
               const copyGraph = { ...newGraph, sourceId: currentId || undefined };
               const res = await saveRecipeAction(copyGraph, undefined);
               if (res.id) {
                   const url = new URL(window.location.href);
                   url.searchParams.set('id', res.id);
                   router.push(url.pathname + url.search);
                   showNotification("Saved copy to your profile.");
               }
          }
      }
  };

  const handleShare = async () => {
      if (!graph) return;
      // Check real URL first because searchParams might be stale due to shallow update
      const url = new URL(window.location.href);
      const currentId = url.searchParams.get('id') || searchParams.get('id');
      
      if (currentId) {
          navigator.clipboard.writeText(url.toString());
          showNotification('Link copied to clipboard!');
          return;
      }

      setStatus('loading');
      const graphToSave = { ...graph, title: recipeTitle }; // Ensure title is current
      const res = await saveRecipeAction(graphToSave);
      if (res.id) {
          const url = new URL(window.location.href);
          url.searchParams.set('id', res.id);
          router.push(url.pathname + url.search);
          navigator.clipboard.writeText(url.toString());
          setStatus('complete');
          showNotification('Recipe saved! Link copied to clipboard.');
      } else {
          setError('Failed to save recipe');
          setStatus('complete');
      }
  };

const handleVisualize = async () => {
    console.log('Starting visualization...');
    await debugLogAction('Starting visualization...');
    if (!recipeText.trim()) return;
    
    setStatus('parsing');
    setError(null);
    setGuestBannerDismissed(false);
    
    try {
        // Use New Fast Path Action
        const currentId = searchParams.get('id');
        const res = await createVisualRecipeAction(recipeText, currentId || undefined);
        
        if (res.error || !res.id) {
            throw new Error(res.error || 'Failed to parse recipe structure.');
        }
        const url = new URL(window.location.href);
        url.searchParams.delete('new');
        url.searchParams.set('id', res.id);
        
        autoFillIconsRef.current = true;
        router.push(url.pathname + url.search);

        setStatus('complete');
        // autoFillIconsRef triggers client-side icon fill once the graph snapshot loads.
        setWarningDismissed(false);
        localStorage.setItem('recipe_draft', recipeText);
    } catch (e: any) {
        console.error('Visualization failed:', e);
        setError(e.message);
        setStatus('error');
    }
  };

  const handleAdjust = async () => {
      if (!graph || !chatInput.trim()) return;
      
      const prompt = chatInput;
      setChatInput(''); // Clear immediately
      setStatus('adjusting');
      setError(null);

      try {
          const res = await adjustRecipeAction(graph, prompt);
          if (res.error || !res.graph) {
              throw new Error(res.error || 'Failed to adjust graph.');
          }
          res.graph.title = recipeTitle; // Preserve title
          setGraph(res.graph);
          
          const currentId = searchParams.get('id') || undefined;
          if (currentId) {
              await saveRecipeAction(res.graph, currentId);
          }
          
          setStatus('complete');
      } catch (e: any) {
          console.error('Adjustment failed:', e);
          setError(e.message);
          setStatus('error'); 
      }
  };

    const handleLayoutClick = async (mode: LayoutMode | 'repulsive' | 'timeline2') => {
        if (layoutMode === mode) {
            diagramRef.current?.resetLayout();
        } else {
            setLayoutMode(mode);
            if (mode === 'repulsive') setEdgeStyle('bezier');
            
            if (graph) {
                // Clear x/y from main nodes so the new mode computes a fresh layout 
                // (unless it already exists in graph.layouts). This prevents using 
                // the previous mode's coordinates for the new mode.
                const freshNodes = graph.nodes.map(n => {
                    const { x, y, ...rest } = n;
                    return rest as any;
                });
                
                const newGraph = { ...graph, layoutMode: mode, nodes: freshNodes };
                setGraph(newGraph);
                
                if (user && isOwner && recipeId) {
                    await saveRecipeAction(newGraph, recipeId);
                }
            }
        }
    };

    if (authLoading) return <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-500 font-mono">Loading...</div>;
  
  const hasIcons = graph?.nodes.some(n => hasNodeIcon(n));
  const isPublic = graph?.visibility === 'public';

  // Common Nav Item Styles
  const navItemClass = "flex items-center gap-2 px-3 py-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors text-xs font-medium";

  return (
    <div className="fixed inset-0 flex flex-col bg-zinc-950 text-zinc-100 font-sans overflow-hidden overscroll-none">
        {/* Utility Bar */}
        <header className="h-14 shrink-0 border-b border-zinc-800 flex items-center justify-between px-4 bg-zinc-950 z-20">
            <div className="flex items-center gap-4 overflow-hidden">
                {/* Logo */}
                <div className="flex items-center gap-2 shrink-0">
                    <ChefHat className="w-6 h-6 text-yellow-500" />
                    <span className="hidden md:inline font-bold text-lg text-zinc-100 tracking-tight">Recipe Lanes</span>
                </div>
                
                {/* Title (Editable) */}
                <div className="flex-1 min-w-0 flex items-center justify-start group mx-2">
                    {editingTitle ? (
                        <input 
                            className="bg-transparent border-b border-zinc-700 outline-none w-full max-w-[200px] text-sm font-bold text-zinc-100"
                            value={recipeTitle}
                            onChange={(e) => setRecipeTitle(e.target.value)}
                            onBlur={(e) => handleTitleChange(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleTitleChange(e.currentTarget.value)}
                            autoFocus
                        />
                    ) : (
                        <div
                            className="flex items-center gap-2 cursor-pointer truncate"
                            onClick={() => { titleBeforeEdit.current = recipeTitle; setEditingTitle(true); }}
                        >
                            <h1 className="text-sm font-bold text-zinc-100 truncate">
                                {recipeTitle || 'Untitled Recipe'}
                            </h1>
                            <Pencil className="w-3 h-3 text-zinc-600 group-hover:text-zinc-400 opacity-0 group-hover:opacity-100" />
                        </div>
                    )}
                    {ownerId && (
                        <span className="text-[9px] text-zinc-600 font-mono ml-2">
                           by {ownerName || 'Anon'}
                        </span>
                    )}
                </div>
            </div>
            
            {/* Right Side Actions */}
            <div className="flex items-center gap-2">
                {/* Navigation Tabs */}
                <Link href="/gallery" className={navItemClass} title="Public Gallery">
                    <Globe className="w-4 h-4" />
                    <span>Gallery</span>
                </Link>
                {user && (
                    <>
                        <Link href="/gallery?filter=mine" className={navItemClass} title="My Recipes">
                            <User className="w-4 h-4" />
                            <span className="hidden md:inline">Mine</span>
                        </Link>
                        <Link href="/gallery?filter=starred" className={navItemClass} title="Starred">
                            <Star className="w-4 h-4" />
                            <span className="hidden md:inline">Starred</span>
                        </Link>
                    </>
                )}
                <button onClick={handleNew} className={navItemClass} title="Create New">
                    <Plus className="w-4 h-4" />
                    <span className="hidden md:inline">New</span>
                </button>
                
                <button onClick={() => setShowFeedback(true)} className={navItemClass} title="Feedback & Contribute">
                    <MessageSquare className="w-4 h-4" />
                </button>

                <a href="https://github.com/Bohemian-Miser/RecipeLanes" target="_blank" rel="noopener noreferrer" className={navItemClass} title="Find me on GitHub">
                    <Github className="w-4 h-4" />
                </a>

                <div className="h-4 w-px bg-zinc-800 mx-2" />

                {/* User Controls */}
                <div className="text-[10px] font-mono text-zinc-600 shrink-0 flex items-center gap-3">
                    {user ? (
                        <>
                            <span className="truncate max-w-[150px] hidden sm:block" title={user.displayName || user.email || ''}>
                                {user.displayName || 'User'}
                            </span>
                            <LogoutButton className="hover:text-red-400" />
                        </>
                    ) : (
                        <button onClick={signIn} className="hover:text-yellow-500 whitespace-nowrap">
                            Login
                        </button>
                    )}
                </div>
            </div>
        </header>
        
            <div className="absolute top-16 left-0 right-0 z-50 flex flex-col items-center pointer-events-none gap-2">
    
                {/* Existing Copies Banner - Hide if Fork Prompt is active */}
                {existingCopies && existingCopies.length > 0 && !showForkPrompt && !existingCopiesDismissed && (
                    <Banner color="blue" onDismiss={() => setExistingCopiesDismissed(true)}>
                        {/* TODO: Filter by sourceId when implemented */}
                        <span>You have <Link href="/gallery?filter=mine" className="underline font-bold hover:text-white">{existingCopies.length} existing {existingCopies.length > 1 ? 'copies' : 'copy'}</Link> of this recipe. <Link href={`/lanes?id=${existingCopies[0].id}`} className="underline font-bold hover:text-white">Go to latest?</Link></span>
                        <div className="flex flex-wrap justify-center gap-2">
                            <button onClick={handleFork} className="underline font-bold hover:text-white">
                                Save another copy?
                            </button>
                        </div>
                    </Banner>
                )}

                {/* Notification Banner */}
                {notification && (
                    <Banner color="green" onDismiss={() => setNotification(null)}>
                        {notification}
                    </Banner>
                )}

                {/* Fork Prompt Banner (Destructive Action Intercept) */}
                {showForkPrompt && existingCopies && existingCopies.length > 0 && (
                    <Banner color="blue" onDismiss={() => setShowForkPrompt(false)}>
                        {/* TODO: Filter by sourceId when implemented */}
                        <span>You have <Link href="/gallery?filter=mine" className="underline font-bold hover:text-white">{existingCopies.length} existing {existingCopies.length === 1 ? 'copy' : 'copies'}</Link> of this recipe, to make changes, open one of these. Any further changes won&apos;t be saved.</span>
                        <div className="flex gap-2">
                            <button onClick={handleFork} className="underline font-bold hover:text-white">
                                Save another copy
                            </button>
                        </div>
                    </Banner>
                )}
                
                {/* Guest Banner */}
                    {!user && graph && !guestBannerDismissed && (
                        <Banner color="yellow" onDismiss={() => setGuestBannerDismissed(true)}>
                            Recipe not saved to account. <button onClick={(e) => { e.stopPropagation(); signIn(); }} className="underline font-bold hover:text-zinc-800">Log in</button> to save edits permanently.
                        </Banner>
                    )}
                </div>

        {/* Input Area (Collapsible) */}
        <div className={`shrink-0 bg-zinc-900 border-b border-zinc-800 transition-all duration-300 ease-in-out z-10 ${inputExpanded ? 'max-h-[80vh]' : 'max-h-16'}`}>
             <div className="p-2 flex gap-2">
                <textarea 
                    ref={textareaRef}
                    className={`flex-1 bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-300 focus:ring-1 focus:ring-yellow-500/50 outline-none resize-y transition-all duration-300 ${inputExpanded ? 'h-[50vh]' : 'h-10'}`}
                    placeholder="Paste recipe here..."
                    value={recipeText}
                    onChange={(e) => {
                        setRecipeText(e.target.value);
                        handleEditAttempt();
                    }}
                    onFocus={() => setInputExpanded(true)}
                    onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                            handleVisualize();
                            setInputExpanded(false);
                        }
                    }}
                />
                <button
                    onClick={() => { handleVisualize(); setInputExpanded(false); }}
                    disabled={status === 'parsing' || status === 'forging' || !recipeText}
                    className="shrink-0 w-10 h-10 flex items-center justify-center bg-yellow-500 hover:bg-yellow-400 text-black rounded-lg transition-colors disabled:opacity-50"
                    aria-label="Visualize"
                >
                    {status === 'parsing' || status === 'forging' ? (
                        <div className="flex space-x-1">
                            <div className="w-1 h-1 bg-black rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                            <div className="w-1 h-1 bg-black rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                            <div className="w-1 h-1 bg-black rounded-full animate-bounce"></div>
                        </div>
                    ) : (
                        <ArrowRight className="w-5 h-5" />
                    )}
                </button>
                {inputExpanded && (
                    <button 
                        onClick={() => setInputExpanded(false)}
                        className="shrink-0 w-10 h-10 flex items-center justify-center bg-zinc-800 text-zinc-400 rounded-lg hover:bg-zinc-700"
                    >
                        <Code className="w-4 h-4 rotate-90" />
                    </button>
                )}
             </div>
             {error && (
                <div className="px-2 pb-2 text-[10px] text-red-400">
                    {error}
                </div>
             )}
        </div>

        {/* Visualizer (Full Remaining Height) */}
        <div className="flex-1 flex flex-col relative overflow-hidden bg-zinc-100">
            {/* Toolbar */}
            <div className="shrink-0 h-12 bg-white/90 backdrop-blur border-b border-zinc-200 flex items-center justify-between px-4 overflow-x-auto z-10 no-scrollbar relative">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowIngredients(!showIngredients)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${showIngredients ? 'bg-yellow-500/10 text-yellow-700' : 'text-zinc-600 hover:bg-zinc-100'}`}
                        title="Toggle Ingredients"
                    >
                        <ChefHat className="w-4 h-4" />
                        <span className="hidden sm:inline">INGREDIENTS</span>
                    </button>
                    
                    <div className="h-4 w-px bg-zinc-200 mx-1" />

                    {/* Layout Dropdown */}
                    <div className="flex items-center gap-2 pl-2">
                        <span className="text-xs font-mono text-zinc-400">Layout</span>
                        <select 
                            value={layoutMode} 
                            onChange={(e) => handleLayoutClick(e.target.value as any)}
                            className="text-xs bg-zinc-50 border border-zinc-200 rounded p-1.5 text-zinc-700 font-medium focus:ring-1 focus:ring-yellow-500/50 outline-none"
                            title="Layout Mode"
                        >
                            <option value="swimlanes">Lanes</option>
                            <option value="dagre">Smart</option>
                            <option value="dagre-lr">Smart LR</option>
                            <option value="repulsive">Repulsive</option>
                            <option value="timeline">Timeline</option>
                            <option value="timeline2">Timeline (Classic)</option>
                        </select>
                        {/* Reset Layout Button */}
                        <button 
                            onClick={() => diagramRef.current?.resetLayout()}
                            className="p-1.5 rounded hover:bg-zinc-100 text-zinc-400 hover:text-zinc-600 transition-colors"
                            title="Reset Layout Positions"
                        >
                            <RotateCcw className="w-3 h-3" />
                        </button>
                    </div>

                    <div className="h-4 w-px bg-zinc-200 mx-2" />

                    {/* Batch icon search — admin only, not a security gate, just hides confusing dev controls */}
                    {isAdmin && graph && recipeId && (
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-zinc-400">Icons</span>
                            <select
                                value={iconSearchMethodId}
                                onChange={e => setIconSearchMethodId(e.target.value)}
                                disabled={iconSearchStatus === 'running'}
                                className="text-xs bg-zinc-50 border border-zinc-200 rounded p-1.5 text-zinc-700 font-medium focus:ring-1 focus:ring-yellow-500/50 outline-none"
                            >
                                {iconSearchMethods.map(m => (
                                    <option key={m.id} value={m.id}>{m.name}</option>
                                ))}
                            </select>
                            <button
                                onClick={() => handleBatchIconSearch()}
                                disabled={iconSearchStatus === 'running'}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                                    iconSearchStatus === 'done' ? 'bg-green-100 text-green-700' :
                                    iconSearchStatus === 'error' ? 'bg-red-100 text-red-700' :
                                    iconSearchStatus === 'running' ? 'bg-yellow-100 text-yellow-700' :
                                    'text-zinc-600 hover:bg-zinc-100'
                                }`}
                            >
                                <Sparkles className="w-4 h-4 shrink-0" />
                                <span className="hidden sm:inline whitespace-nowrap">
                                    {iconSearchStatus === 'running' ? 'RUNNING...' :
                                     iconSearchStatus === 'done' ? `DONE${iconSearchElapsed != null ? ` ${(iconSearchElapsed / 1000).toFixed(1)}s` : ''}` :
                                     iconSearchStatus === 'error' ? 'ERROR' : 'FILL'}
                                </span>
                            </button>
                        </div>
                    )}

                    <div className="h-4 w-px bg-zinc-200 mx-2" />

                    {/* Style Dropdown */}
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-zinc-400">Style</span>
                        <select 
                            value={iconTheme} 
                            onChange={(e) => setIconTheme(e.target.value as any)}
                            className="text-xs bg-zinc-50 border border-zinc-200 rounded p-1.5 text-zinc-700 font-medium focus:ring-1 focus:ring-yellow-500/50 outline-none"
                            title="Icon Style"
                        >
                            <option value="classic">Classic</option>
                            <option value="modern">Modern</option>
                            <option value="modern_clean">Clean</option>
                        </select>
                    </div>
                    

                </div>

                <div className="flex items-center gap-4">
                    {/* Live Toggle */}
                    <button 
                         onClick={() => setIsLive(!isLive)}
                         className={`p-1.5 rounded transition-colors ${isLive ? 'bg-green-100 text-green-600' : 'text-zinc-400'}`}
                         title={isLive ? "Pause Physics" : "Start Physics"}
                    >
                        {isLive ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    </button>

                    {/* Text Position */}
                    <div className="flex items-center gap-2 border-r border-zinc-200 pr-4">
                         <Type className="w-4 h-4 text-zinc-400" />
                         <select 
                             value={textPos} 
                             onChange={(e) => setTextPos(e.target.value as any)}
                             className="text-xs bg-zinc-50 border border-zinc-200 rounded p-1 text-zinc-900"
                         >
                             <option value="bottom">Bottom</option>
                             <option value="top">Top</option>
                             <option value="right">Right</option>
                             <option value="left">Left</option>
                         </select>
                    </div>

                    {/* Line Style */}
                    <div className="flex items-center gap-2 border-r border-zinc-200 pr-4">
                         <span className="text-xs font-mono text-zinc-400">Lines</span>
                         <select 
                             value={edgeStyle} 
                             onChange={(e) => setEdgeStyle(e.target.value as any)}
                             className="text-xs bg-zinc-50 border border-zinc-200 rounded p-1 text-zinc-900"
                         >
                             <option value="straight">Straight</option>
                             <option value="step">Step</option>
                             <option value="bezier">Curve</option>
                         </select>
                    </div>

                    {/* Spacing Slider */}
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-zinc-400">Spacing</span>
                        <input 
                            type="range" 
                            min="0" 
                            max="1" 
                            step="0.01" 
                            value={spacing} 
                            onChange={(e) => setSpacing(parseFloat(e.target.value))}
                            className="w-20 h-1 bg-zinc-200 rounded-lg appearance-none cursor-pointer touch-none"
                        />
                    </div>

                    {/* JSON Toggle */}
                    {graph && (
                        <>
                            <button 
                                onClick={() => diagramRef.current?.toggleVisibility()}
                                className={`flex items-center gap-1.5 text-[10px] px-2 py-1.5 rounded shadow-sm border transition-colors font-mono ${isPublic ? 'bg-yellow-500/10 border-yellow-500 text-yellow-600' : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}
                                title="Toggle Visibility"
                            >
                                {isPublic ? <Globe className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                                <span className="hidden xl:inline">{isPublic ? 'Public' : 'Unlisted'}</span>
                            </button>

                            <button 
                                onClick={handleToggleJson}
                                className={`p-1.5 rounded hover:bg-zinc-100 transition-colors ${showJson ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-400'}`}
                                title="Toggle JSON View"
                            >
                                <Code className="w-4 h-4" />
                            </button>
                        </>
                    )}
                </div>
            </div>
            
            {showIngredients && graph && (
                <IngredientsSidebar 
                    graph={graph} 
                    onClose={() => setShowIngredients(false)} 
                    onUpdateServes={handleUpdateServes} 
                />
            )}

            <div className="flex-1 relative">
                {graph && layoutMode === 'timeline2' ? (
                    <TimelineView 
                        graph={graph} 
                        onSave={async (newGraph) => {
                            // Update layouts map for consistency with ReactFlowDiagram
                            const layouts = newGraph.layouts || {};
                            layouts['timeline2'] = newGraph.nodes.map(n => ({ 
                                id: n.id, 
                                x: n.x ?? 0, 
                                y: n.y ?? 0 
                            }));
                            const finalGraph = { ...newGraph, layouts };
                            
                            setGraph(finalGraph);
                            if (user && isOwner && recipeId) {
                                await saveRecipeAction(finalGraph, recipeId);
                            }
                        }}
                    />
                ) : graph ? (
                    <ReactFlowDiagram
                        ref={diagramRef}
                        graph={graph}
                        mode={layoutMode as LayoutMode | 'repulsive'}
                        spacing={spacing}
                        edgeStyle={edgeStyle}
                        textPos={textPos}
                        isLive={isLive}
                        iconTheme={iconTheme}
                        onInteraction={() => setInputExpanded(false)}
                        onEdit={handleEditAttempt}
                        onSave={(newGraph) => {
                            setGraph(newGraph);
                            if (newGraph.title) setRecipeTitle(newGraph.title);
                        }}
                        isLoggedIn={!!user}
                        isOwner={isOwner}
                        onNotify={showNotification}
                    />
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-zinc-400">
                        <Wand2 className="w-8 h-8 opacity-20 mb-2" />
                        <p className="text-sm">Ready to Visualise</p>
                    </div>
                )}
            </div>

            {/* JSON View Overlay (Editable) */}
            {showJson && graph && (
                <div className="absolute top-0 right-0 bottom-0 z-50 bg-white/95 backdrop-blur border-l border-zinc-200 w-full md:w-[40%] flex flex-col shadow-2xl p-4 animate-in slide-in-from-right duration-300">
                    <div className="flex justify-between items-center mb-4 border-b border-zinc-200 pb-2">
                        <h3 className="text-sm font-bold text-zinc-600 uppercase tracking-wider flex items-center gap-2">
                            <Code className="w-4 h-4" /> JSON Editor
                        </h3>
                        <div className="flex gap-2">
                            <button onClick={() => setShowJson(false)} className="text-xs text-zinc-500 hover:text-zinc-800 px-2 py-1">Close</button>
                            <button onClick={handleJsonSave} className="text-xs bg-zinc-900 text-white px-3 py-1.5 rounded hover:bg-zinc-700 font-bold transition-colors">Apply & Save</button>
                        </div>
                    </div>
                    <textarea 
                        className="flex-1 bg-zinc-50 border border-zinc-200 rounded p-4 text-xs font-sans text-zinc-700 resize-none focus:outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-200 leading-relaxed font-mono"
                        value={jsonText}
                        onChange={(e) => setJsonText(e.target.value)}
                        spellCheck={false}
                        placeholder="Graph JSON..."
                    />
                </div>
            )}

            {/* Bottom Area: Legend (Left) & Chat (Right) */}
            {graph && (
                <div className="absolute bottom-0 left-0 right-0 z-30 pointer-events-none md:pointer-events-auto">
                    {/* Desktop Layout (Floating) */}
                    <div className="hidden md:block absolute bottom-4 left-4 p-3 bg-white/90 backdrop-blur rounded-lg shadow-lg border border-zinc-200 text-xs text-zinc-700 pointer-events-auto">
                        <div className="font-bold text-zinc-400 uppercase tracking-widest text-[10px]">Legend</div>
                        {!hasIcons && (
                            <>
                                <div className="flex items-center gap-2"><span className="text-xl">🥕</span> Ingredients</div>
                                <div className="flex items-center gap-2"><span className="text-xl">🍳</span> Actions</div>
                            </>
                        )}
                        <div className="flex items-center gap-1 opacity-50 border-t border-zinc-100 pt-2"><span className="text-xs font-bold">Shift+Click</span> Select Branch</div>
                        <div className="flex items-center gap-1 opacity-50"><span className="text-xs font-bold">Shift+Drag</span> Rotate Branch</div>
                    </div>

                    <div className="hidden md:flex absolute bottom-4 left-1/2 -translate-x-1/2 justify-center pointer-events-auto w-full max-w-lg">
                        <div className="w-full bg-white/95 backdrop-blur border border-zinc-200 rounded-full shadow-xl flex items-center p-1">
                            <MessageSquare className="w-5 h-5 text-zinc-400 ml-2" />
                            <input 
                                className="flex-1 bg-transparent border-none outline-none text-sm text-zinc-800 placeholder-zinc-400 h-10 px-2"
                                placeholder="Adjust recipe..."
                                value={chatInput}
                                onChange={(e) => setChatInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleAdjust()}
                                disabled={status === 'adjusting'}
                            />
                            <button
                                onClick={handleAdjust}
                                disabled={!chatInput.trim() || status === 'adjusting'}
                                className="p-2 bg-zinc-900 hover:bg-zinc-800 text-white rounded-full transition-colors disabled:opacity-50 m-1"
                            >
                                {status === 'adjusting' ? <Wand2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                            </button>
                        </div>
                    </div>

                    {/* Mobile Layout (Split Bottom Bar) */}
                    <div className="md:hidden flex h-16 bg-white/95 backdrop-blur border-t border-zinc-200 pointer-events-auto">
                        {/* Legend (Left Half) */}
                        <div className="w-1/2 p-2 text-[10px] text-zinc-600 border-r border-zinc-100 flex flex-col justify-center gap-1">
                            {!hasIcons && <div className="truncate">🥕 Ingredients  🍳 Actions</div>}
                            <div className="font-bold text-zinc-800">Tap & Hold: Select Branch</div>
                        </div>
                        
                        {/* Chat (Right Half) */}
                        <div className="w-1/2 p-2 flex items-center gap-1">
                            <input 
                                className="flex-1 bg-zinc-100 border border-zinc-200 rounded-md px-2 text-xs h-full text-zinc-800 outline-none"
                                placeholder="Adjust..."
                                value={chatInput}
                                onChange={(e) => setChatInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleAdjust()}
                                disabled={status === 'adjusting'}
                            />
                            <button
                                onClick={handleAdjust}
                                disabled={!chatInput.trim() || status === 'adjusting'}
                                className="h-full w-10 flex items-center justify-center bg-zinc-900 text-white rounded-md shrink-0"
                            >
                                {status === 'adjusting' ? <Wand2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
        
        <FeedbackModal 
            isOpen={showFeedback} 
            onClose={() => setShowFeedback(false)} 
            graphJson={jsonText}
        />
    </div>
  );
}

export default function RecipeLanesPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-zinc-500 font-mono">Loading...</div>}>
      <ReactFlowProvider>
        <RecipeLanesContent />
      </ReactFlowProvider>
    </Suspense>
  );
}