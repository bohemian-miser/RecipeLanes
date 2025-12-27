'use client';

import { useState, useEffect, Suspense, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/auth-provider';
import { LogoutButton } from '@/components/logout-button';
import ReactFlowDiagram, { ReactFlowDiagramHandle } from '@/components/recipe-lanes/react-flow-diagram';
import { parseRecipeAction, generateGraphIconsAction, adjustRecipeAction, saveRecipeAction, getRecipeAction, checkExistingCopiesAction, getOrCreateIconAction } from '@/app/actions';
import { IngredientsSummary } from '@/components/recipe-lanes/ui/ingredients-summary';
import type { RecipeGraph } from '@/lib/recipe-lanes/types';
import { LayoutMode } from '@/lib/recipe-lanes/layout';
import { Wand2, ChefHat, ArrowRight, Code, MessageSquare, Send, LayoutDashboard, List, GitGraph, Columns, AlignCenter, Network, Sparkles, CircleDot, Share2, Sprout, Move, RotateCw, Orbit, Type, Play, Pause, Pencil, RotateCcw, Globe, Lock, Plus, LayoutGrid, Star, User } from 'lucide-react';

function RecipeLanesContent() {
  const { user, loading: authLoading, signIn } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const [recipeTitle, setRecipeTitle] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [recipeText, setRecipeText] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [graph, setGraph] = useState<RecipeGraph | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null); 
  const [status, setStatus] = useState<'idle' | 'parsing' | 'forging' | 'adjusting' | 'complete' | 'error' | 'loading'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [layoutMode, setLayoutMode] = useState<LayoutMode | 'repulsive'>('dagre');
  const [showOverrideWarning, setShowOverrideWarning] = useState(false);
  const [existingCopies, setExistingCopies] = useState<any[]>([]);
  const [forgingProgress, setForgingProgress] = useState<{ completed: number, total: number } | null>(null);

  const diagramRef = useRef<ReactFlowDiagramHandle>(null);

  const isOwner = !ownerId || (!!user && user.uid === ownerId);

  // Restore Last Recipe
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
          const safeGraph = { 
              ...graph, 
              nodes: graph.nodes.map(n => {
                  const { iconUrl, ...rest } = n;
                  return rest;
              })
          };
          setJsonText(JSON.stringify(safeGraph, null, 2));
      }
  }, [graph]);

  // Warning logic
  useEffect(() => {
      if (graph && recipeText && graph.originalText && recipeText.trim() !== graph.originalText.trim()) {
          setShowOverrideWarning(true);
      } else {
          setShowOverrideWarning(false);
      }
  }, [recipeText, graph]);

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

  const handleJsonSave = async () => {
      try {
          const partialGraph = JSON.parse(jsonText);
          
          // Restore iconUrls from existing graph
          const newNodes = partialGraph.nodes.map((n: any) => {
              const original = graph?.nodes.find(o => o.id === n.id);
              return { ...n, iconUrl: original?.iconUrl };
          });
          
          const newGraph = { ...partialGraph, nodes: newNodes };
          setGraph(newGraph);
          if (user) {
              const res = await saveRecipeAction(newGraph, searchParams.get('id') || undefined);
              if (res.id) {
                  const url = new URL(window.location.href);
                  url.searchParams.set('id', res.id);
                  router.push(url.pathname + url.search);
                  setOwnerId(user.uid);
                  showNotification("JSON saved.");
              }
          }
      } catch (e) {
          showNotification("Invalid JSON");
      }
  };
  const [spacing, setSpacing] = useState(1);
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

  useEffect(() => {
      const id = searchParams.get('id');
      if (id && !graph) {
          setStatus('loading');
          getRecipeAction(id).then(res => {
              if (res.graph) {
                  setGraph(res.graph);
                  if (res.ownerId) setOwnerId(res.ownerId);
                  setRecipeText(res.graph.originalText || '');
                  setRecipeTitle(res.graph.title || '');
                  
                  if (res.graph.nodes.some(n => !n.iconUrl)) {
                      generateGraphIconsAction(res.graph).then(iconRes => {
                          if (iconRes.graph) setGraph(iconRes.graph);
                      });
                  }

                  setStatus('complete');
              } else {
                  setError('Recipe not found');
                  setStatus('error');
              }
          });
      }
  }, [searchParams]);

  useEffect(() => {
      const id = searchParams.get('id');
      if (id && user && ownerId && user.uid !== ownerId) {
           checkExistingCopiesAction(id).then(res => {
               if (res.copies && res.copies.length > 0) {
                   setExistingCopies(res.copies);
               }
           });
      }
  }, [searchParams, user, ownerId]);

  const handleNew = () => {
      setRecipeText('');
      setRecipeTitle('');
      setGraph(null);
      setOwnerId(null);
      setError(null);
      setStatus('idle');
      setShowOverrideWarning(false);
      localStorage.removeItem('recipe_draft'); 
      router.push('/lanes?new=true');
  };

  const handleFork = async () => {
      if (!graph) return;
      setStatus('forging');
      // Create copy
      const currentId = searchParams.get('id');
      
      // Smarter Naming
      let newTitle = recipeTitle;
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

      const newGraph = { 
          ...graph, 
          title: newTitle,
          sourceId: currentId || undefined
      };
      const res = await saveRecipeAction(newGraph, undefined); // New ID
      if (res.id) {
          const url = new URL(window.location.href);
          url.searchParams.set('id', res.id);
          router.push(url.pathname + url.search);
          if (user) setOwnerId(user.uid);
          setShowOverrideWarning(false);
          setStatus('complete');
          setRecipeTitle(newGraph.title!);
          showNotification("New version created.");
      }
  };

  const handleOverrideCopy = async (copyId: string) => {
      if (!graph) return;
      setStatus('loading');
      // Overwrite the existing copy with current graph
      // Preserve the copy's ID, but update content.
      // We might want to keep the copy's title? Or update it?
      // Prompt says "override". Usually implies full replace.
      // We'll keep current graph's title (Bob's title) or maybe Alice wants to keep her title?
      // For simplicity, we save 'graph' to 'copyId'.
      const res = await saveRecipeAction(graph, copyId);
      if (res.id) {
          const url = new URL(window.location.href);
          url.searchParams.set('id', res.id);
          router.push(url.pathname + url.search);
          if (user) setOwnerId(user.uid);
          setExistingCopies([]); // Clear banner
          setStatus('complete');
          showNotification("Existing copy updated.");
      }
  };

  const handleTitleChange = async (newTitle: string) => {
      setEditingTitle(false);
      if (newTitle === recipeTitle) return; 
      setRecipeTitle(newTitle);
      
      if (graph) {
          const newGraph = { ...graph, title: newTitle };
          setGraph(newGraph);
          
          const isOwner = user && user.uid === ownerId;
          const currentId = searchParams.get('id');

          if (isOwner && currentId) {
               await saveRecipeAction(newGraph, currentId);
          } else if (user) {
               showNotification("Saving a copy to your profile...");
               const currentId = searchParams.get('id');
               const copyGraph = { ...newGraph, sourceId: currentId || undefined };
               const res = await saveRecipeAction(copyGraph, undefined);
               if (res.id) {
                   const url = new URL(window.location.href);
                   url.searchParams.set('id', res.id);
                   router.push(url.pathname + url.search);
                   setOwnerId(user.uid);
                   showNotification("Saved copy to your profile.");
               }
          }
      }
  };

  const handleShare = async () => {
      if (!graph) return;
      const currentId = searchParams.get('id');
      if (currentId) {
          navigator.clipboard.writeText(window.location.href);
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
    if (!recipeText.trim()) return;
    
    setStatus('parsing');
    setError(null);
    setForgingProgress(null);
    
    try {
        const parseRes = await parseRecipeAction(recipeText);
        if (parseRes.error || !parseRes.graph) {
            throw new Error(parseRes.error || 'Failed to parse recipe structure.');
        }
        
        let currentGraph = parseRes.graph;
        
        if (!recipeTitle && currentGraph.title) {
            setRecipeTitle(currentGraph.title);
        } else {
            currentGraph.title = recipeTitle || currentGraph.title;
        }
        
        setGraph(currentGraph);
        
        // Auto-save immediately (Structure only)
        console.log('Auto-saving structure...');
        let currentId = searchParams.get('id') || undefined;
        
        // Forking Logic: If we are not the owner, we fork on save
        // This applies if:
        // 1. We are logged in but not the owner (Alice/Bob)
        // 2. We are a guest and the recipe has an owner (Guest/Alice)
        const isNotOwner = (user && ownerId && user.uid !== ownerId) || (!user && ownerId);
        
        if (isNotOwner && currentId) {
             console.log('Forking recipe because user is not owner (or guest)');
             currentGraph.sourceId = currentId;
             currentId = undefined; // Force new creation
             // Smarter Copy Naming
             let newTitle = currentGraph.title || 'Untitled';
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
             
             currentGraph.title = newTitle;
             setRecipeTitle(newTitle);
        }

        const saveRes = await saveRecipeAction(currentGraph, currentId);
        
        if (saveRes.id) {
             const url = new URL(window.location.href);
             url.searchParams.delete('new');
             url.searchParams.set('id', saveRes.id);
             window.history.replaceState({}, '', url.pathname + url.search);
             if (user) setOwnerId(user.uid);
             
             // Update currentId for subsequent saves in this function
             currentId = saveRes.id;
        }

        setStatus('forging');

        // Client-side Icon Generation Loop
        const nodesToProcess = currentGraph.nodes.filter(n => !n.iconUrl && n.visualDescription);
        const total = nodesToProcess.length;
        let completed = 0;
        
        if (total > 0) {
            setForgingProgress({ completed: 0, total });
            
            const chunkSize = 3;
            for (let i = 0; i < total; i += chunkSize) {
                const batch = nodesToProcess.slice(i, i + chunkSize);
                
                await Promise.all(batch.map(async (node) => {
                    if (!node.visualDescription) return;
                    const result = await getOrCreateIconAction(node.visualDescription);
                    
                    if (result && !result.error && result.iconUrl) {
                        setGraph(prev => {
                            if (!prev) return null;
                            const newNodes = prev.nodes.map(n => n.id === node.id ? { ...n, iconUrl: result.iconUrl } : n);
                            return { ...prev, nodes: newNodes };
                        });
                        // Update local currentGraph for final save reference (though state is better)
                        currentGraph.nodes = currentGraph.nodes.map(n => n.id === node.id ? { ...n, iconUrl: result.iconUrl } : n);
                    }
                    completed++;
                    setForgingProgress({ completed, total });
                }));
            }
        }

        // Final Save with icons
        if (saveRes.id) {
             await saveRecipeAction(currentGraph, saveRes.id);
        }
        
        setStatus('complete');
        setForgingProgress(null);
        setShowOverrideWarning(false);
        localStorage.setItem('recipe_draft', recipeText);

    } catch (e: any) {
        console.error('Visualization failed:', e);
        setError(e.message);
        setStatus('error');
        setForgingProgress(null);
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

  if (authLoading) return <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-500 font-mono">Loading...</div>;
  
  const hasIcons = graph?.nodes.some(n => !!n.iconUrl);
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
                            onClick={() => setEditingTitle(true)}
                        >
                            <h1 className="text-sm font-bold text-zinc-100 truncate">
                                {recipeTitle || 'Untitled Recipe'}
                            </h1>
                            <Pencil className="w-3 h-3 text-zinc-600 group-hover:text-zinc-400 opacity-0 group-hover:opacity-100" />
                        </div>
                    )}
                    {ownerId && (
                        <span className="text-[9px] text-zinc-600 font-mono ml-2">
                           by {ownerId}
                        </span>
                    )}
                </div>
            </div>
            
            {/* Right Side Actions */}
            <div className="flex items-center gap-2">
                {/* Navigation Tabs */}
                <Link href="/gallery" className={navItemClass} title="Public Gallery">
                    <Globe className="w-4 h-4" />
                    <span className="hidden md:inline">Public</span>
                </Link>
                <Link href="/gallery?filter=mine" className={navItemClass} title="My Recipes">
                    <User className="w-4 h-4" />
                    <span className="hidden md:inline">Mine</span>
                </Link>
                <Link href="/gallery?filter=starred" className={navItemClass} title="Starred">
                    <Star className="w-4 h-4" />
                    <span className="hidden md:inline">Starred</span>
                </Link>
                <button onClick={handleNew} className={navItemClass} title="Create New">
                    <Plus className="w-4 h-4" />
                    <span className="hidden md:inline">New</span>
                </button>

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
        
        {/* Existing Copies Banner */}
        {existingCopies.length > 0 && (
            <div className="bg-blue-500/10 border-b border-blue-500/20 text-blue-400 text-[10px] py-2 px-4 text-center font-mono flex flex-col gap-1 items-center animate-in slide-in-from-top-2">
                <span>You have {existingCopies.length} existing {existingCopies.length === 1 ? 'copy' : 'copies'} of this recipe.</span>
                <div className="flex gap-4">
                    <button onClick={() => router.push(`/lanes?id=${existingCopies[0].id}`)} className="underline font-bold hover:text-blue-300">
                        Open {existingCopies.length === 1 ? 'it' : 'latest'}
                    </button>
                    <button onClick={() => handleOverrideCopy(existingCopies[0].id)} className="underline font-bold hover:text-blue-300" title="Overwrite your existing copy with this version">
                        Override it
                    </button>
                    <button onClick={handleFork} className="underline font-bold hover:text-blue-300">
                        Make another copy
                    </button>
                    {existingCopies.length > 1 && (
                        <Link href={`/gallery?filter=mine&search=${encodeURIComponent(recipeTitle)}`} className="underline font-bold hover:text-blue-300">
                            See all
                        </Link>
                    )}
                </div>
            </div>
        )}

        {/* Notification Banner */}
        {notification && (
            <div className="bg-green-500/10 border-b border-green-500/20 text-green-500 text-[10px] py-1 px-4 text-center font-mono animate-in slide-in-from-top-2">
                {notification}
            </div>
        )}

        {/* Warning Banner */}
        {showOverrideWarning && (
            <div className="bg-orange-500/10 border-b border-orange-500/20 text-orange-500 text-[10px] py-1 px-4 text-center font-mono cursor-pointer hover:bg-orange-500/20 transition-colors" onClick={handleFork}>
                This will override the current recipe, click <span className="underline font-bold hover:text-orange-400">here to make a new version</span>
            </div>
        )}
        
        {/* Guest Banner */}
        {!user && graph && (
            <div className="bg-yellow-500/10 border-b border-yellow-500/20 text-yellow-500 text-[10px] py-1 px-4 text-center font-mono">
                Recipe not saved to account. <button onClick={signIn} className="underline font-bold hover:text-yellow-400">Log in</button> to save edits permanently.
            </div>
        )}

        {/* Input Area (Collapsible) */}
        <div className={`shrink-0 bg-zinc-900 border-b border-zinc-800 transition-all duration-300 ease-in-out z-10 ${inputExpanded ? 'max-h-[80vh]' : 'max-h-16'}`}>
             <div className="p-2 flex gap-2">
                <textarea 
                    ref={textareaRef}
                    className={`flex-1 bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-xs text-zinc-300 focus:ring-1 focus:ring-yellow-500/50 outline-none resize-y transition-all duration-300 ${inputExpanded ? 'h-[50vh]' : 'h-10'}`}
                    placeholder="Paste recipe here..."
                    value={recipeText}
                    onChange={(e) => setRecipeText(e.target.value)}
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
                >
                    {status === 'parsing' ? <span className="animate-pulse">...</span> : <ArrowRight className="w-5 h-5" />}
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
                {status === 'forging' && forgingProgress && (
                    <div className="absolute bottom-0 left-0 h-0.5 bg-yellow-500 transition-all duration-300" style={{ width: `${(forgingProgress.completed / forgingProgress.total) * 100}%` }} />
                )}
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setLayoutMode('swimlanes')}
                        className={`p-1.5 rounded hover:bg-zinc-100 text-zinc-600 ${layoutMode === 'swimlanes' ? 'bg-zinc-100' : ''}`}
                        title="Lanes"
                    >
                        <List className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => setLayoutMode('dagre')}
                        className={`p-1.5 rounded hover:bg-zinc-100 text-zinc-600 ${layoutMode === 'dagre' ? 'bg-zinc-100' : ''}`}
                        title="Smart"
                    >
                        <Network className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => setLayoutMode('dagre-lr')}
                        className={`p-1.5 rounded hover:bg-zinc-100 text-zinc-600 ${layoutMode === 'dagre-lr' ? 'bg-zinc-100' : ''}`}
                        title="Smart LR"
                    >
                        <RotateCw className="w-4 h-4" />
                    </button>
                     <button
                        onClick={() => { setLayoutMode('repulsive'); setEdgeStyle('bezier'); }}
                        className={`p-1.5 rounded hover:bg-zinc-100 text-zinc-600 ${layoutMode === 'repulsive' ? 'bg-zinc-100' : ''}`}
                        title="Repulsive"
                    >
                        <Orbit className="w-4 h-4" />
                    </button>
                    
                    {graph && (
                        <button
                            onClick={() => diagramRef.current?.resetLayout()}
                            className="p-1.5 rounded hover:bg-zinc-100 text-zinc-600 ml-2 border-l border-zinc-100"
                            title="Reset Layout"
                        >
                            <RotateCcw className="w-4 h-4" />
                        </button>
                    )}
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
                            min="0.2" 
                            max="3" 
                            step="0.1" 
                            value={spacing} 
                            onChange={(e) => setSpacing(parseFloat(e.target.value))}
                            className="w-20 h-1 bg-zinc-200 rounded-lg appearance-none cursor-pointer"
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
                                onClick={() => setShowJson(!showJson)}
                                className={`p-1.5 rounded hover:bg-zinc-100 transition-colors ${showJson ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-400'}`}
                                title="Toggle JSON View"
                            >
                                <Code className="w-4 h-4" />
                            </button>
                        </>
                    )}
                </div>
            </div>
            
            {graph && <IngredientsSummary graph={graph} />}

            <div className="flex-1 relative"> 
                {graph ? (
                    <ReactFlowDiagram 
                        ref={diagramRef}
                        graph={graph} 
                        mode={layoutMode} 
                        spacing={spacing} 
                        edgeStyle={edgeStyle} 
                        textPos={textPos} 
                        isLive={isLive} 
                        onInteraction={() => setInputExpanded(false)}
                        onSave={(newGraph) => setGraph(newGraph)}
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
    </div>
  );
}

export default function RecipeLanesPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-zinc-500 font-mono">Loading...</div>}>
      <RecipeLanesContent />
    </Suspense>
  );
}