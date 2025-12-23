'use client';

import { useState, useEffect, Suspense, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/auth-provider';
import ReactFlowDiagram from '@/components/recipe-lanes/react-flow-diagram';
import { parseRecipeAction, generateGraphIconsAction, adjustRecipeAction, saveRecipeAction, getRecipeAction } from '@/app/actions';
import type { RecipeGraph } from '@/lib/recipe-lanes/types';
import { LayoutMode } from '@/lib/recipe-lanes/layout';
import { Wand2, ChefHat, ArrowRight, Code, MessageSquare, Send, LayoutDashboard, List, GitGraph, Columns, AlignCenter, Network, Sparkles, CircleDot, Share2, Sprout, Move, RotateCw, Orbit, Type, Play, Pause, Pencil } from 'lucide-react';

function RecipeLanesContent() {
  const { user, loading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const [recipeTitle, setRecipeTitle] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [recipeText, setRecipeText] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [graph, setGraph] = useState<RecipeGraph | null>(null);
  const [status, setStatus] = useState<'idle' | 'parsing' | 'forging' | 'adjusting' | 'complete' | 'error' | 'loading'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [layoutMode, setLayoutMode] = useState<LayoutMode | 'repulsive'>('dagre');
  const [spacing, setSpacing] = useState(1);
  const [edgeStyle, setEdgeStyle] = useState<'straight' | 'step' | 'bezier'>('straight');
  const [textPos, setTextPos] = useState<'bottom' | 'top' | 'left' | 'right'>('bottom');
  const [isLive, setIsLive] = useState(false);
  const [inputExpanded, setInputExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
      if (!inputExpanded && textareaRef.current) {
          // Clear inline styles applied by manual resizing
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

  const handleShare = async () => {
      if (!graph) return;
      const currentId = searchParams.get('id');
      if (currentId) {
          navigator.clipboard.writeText(window.location.href);
          alert('Link copied to clipboard!');
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
          alert('Recipe saved! Link copied to clipboard.');
      } else {
          setError('Failed to save recipe');
          setStatus('complete');
      }
  };

  const handleVisualize = async () => {
    if (!recipeText.trim()) return;
    
    setStatus('parsing');
    setError(null);
    setGraph(null);
    setRecipeTitle(''); // Reset title for new recipe

    try {
        const parseRes = await parseRecipeAction(recipeText);
        if (parseRes.error || !parseRes.graph) {
            throw new Error(parseRes.error || 'Failed to parse recipe structure.');
        }
        
        const rawGraph = parseRes.graph;
        
        if (!recipeTitle && rawGraph.title) {
            setRecipeTitle(rawGraph.title);
        } else {
            rawGraph.title = recipeTitle || rawGraph.title;
        }
        
        setGraph(rawGraph);
        setStatus('forging');

        const iconRes = await generateGraphIconsAction(rawGraph);
        if (iconRes.error) {
            console.warn('Icon generation incomplete:', iconRes.error);
        }
        
        setGraph(iconRes.graph); 
        setStatus('complete');

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
          setStatus('complete');
      } catch (e: any) {
          console.error('Adjustment failed:', e);
          setError(e.message);
          setStatus('error'); // Keep graph visible
      }
  };

  if (authLoading) return <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-500 font-mono">Loading...</div>;
  
  const hasIcons = graph?.nodes.some(n => !!n.iconUrl);

  return (
    <div className="fixed inset-0 flex flex-col bg-zinc-950 text-zinc-100 font-sans overflow-hidden overscroll-none">
        {/* Utility Bar */}
        <header className="h-14 shrink-0 border-b border-zinc-800 flex items-center justify-between px-4 bg-zinc-950 z-20">
            <div className="flex items-center gap-4 overflow-hidden">
                <div className="flex items-center gap-2 shrink-0">
                    <ChefHat className="w-6 h-6 text-yellow-500" />
                    <Link href="/gallery" className="text-xs font-mono text-zinc-400 hover:text-white transition-colors">
                        Gallery
                    </Link>
                </div>
                
                {/* Title (Editable) */}
                <div className="flex-1 min-w-0 flex items-center justify-center group mx-2">
                    {editingTitle ? (
                        <input 
                            className="bg-transparent border-b border-zinc-700 outline-none w-full max-w-[200px] text-center text-sm font-bold text-zinc-100"
                            value={recipeTitle}
                            onChange={(e) => setRecipeTitle(e.target.value)}
                            onBlur={() => setEditingTitle(false)}
                            onKeyDown={(e) => e.key === 'Enter' && setEditingTitle(false)}
                            autoFocus
                        />
                    ) : (
                        <div 
                            className="flex items-center gap-2 cursor-pointer truncate"
                            onClick={() => setEditingTitle(true)}
                        >
                            <h1 className="text-sm font-bold text-zinc-100 truncate">
                                {recipeTitle || 'Recipe Lanes'}
                            </h1>
                            <Pencil className="w-3 h-3 text-zinc-600 group-hover:text-zinc-400 opacity-0 group-hover:opacity-100" />
                        </div>
                    )}
                </div>
            </div>
            
            <div className="text-[10px] font-mono text-zinc-600 shrink-0 flex items-center gap-3">
                {user ? (
                    <>
                        <span className="truncate max-w-[150px] hidden sm:block" title={user.email || ''}>
                            {user.displayName || user.email}
                        </span>
                        <Link href="/gallery?filter=mine" className="hover:text-yellow-500 transition-colors whitespace-nowrap">
                            My Recipes
                        </Link>
                    </>
                ) : (
                    <button onClick={() => router.push('/gallery')} className="hover:text-yellow-500 whitespace-nowrap">
                        Guest (Login)
                    </button>
                )}
            </div>
        </header>
        
        {/* Guest Banner */}
        {!user && graph && (
            <div className="bg-yellow-500/10 border-b border-yellow-500/20 text-yellow-500 text-[10px] py-1 px-4 text-center font-mono">
                Recipe not saved to account. <Link href="/gallery" className="underline font-bold">Log in</Link> to save edits permanently.
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
        <div className="flex-1 relative overflow-hidden bg-zinc-100">
            {/* Toolbar */}
            <div className="absolute top-0 left-0 right-0 h-12 bg-white/90 backdrop-blur border-b border-zinc-200 flex items-center justify-between px-4 overflow-x-auto z-10 no-scrollbar">
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
                             className="text-xs bg-zinc-50 border border-zinc-200 rounded p-1"
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
                             className="text-xs bg-zinc-50 border border-zinc-200 rounded p-1"
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

                    {/* Share Button */}
                    {graph && (
                        <button 
                            onClick={handleShare}
                            className="p-1.5 rounded hover:bg-zinc-100 transition-colors text-zinc-500 hover:text-zinc-900"
                            title="Share Recipe"
                        >
                            <Share2 className="w-4 h-4" />
                        </button>
                    )}
                    {/* JSON Toggle */}
                    {graph && (
                        <button 
                            onClick={() => setShowJson(!showJson)}
                            className={`p-1.5 rounded hover:bg-zinc-100 transition-colors ${showJson ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-400'}`}
                            title="Toggle JSON View"
                        >
                            <Code className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>
            
            <div className="absolute inset-0 pt-12 bottom-0"> 
                {graph ? (
                    <ReactFlowDiagram graph={graph} mode={layoutMode} spacing={spacing} edgeStyle={edgeStyle} textPos={textPos} isLive={isLive} onInteraction={() => setInputExpanded(false)} />
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-zinc-400">
                        <Wand2 className="w-8 h-8 opacity-20 mb-2" />
                        <p className="text-sm">Ready to Visualise</p>
                    </div>
                )}
            </div>

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