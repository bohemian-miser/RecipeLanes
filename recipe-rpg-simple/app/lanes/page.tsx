'use client';

import { useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { Login } from '@/components/login';
import SwimlaneDiagram from '@/components/recipe-lanes/swimlane-diagram';
import { parseRecipeAction, generateGraphIconsAction } from '@/app/actions';
import type { RecipeGraph } from '@/lib/recipe-lanes/types';
import { LayoutMode } from '@/lib/recipe-lanes/layout';
import { Wand2, ChefHat, ArrowRight, Code, LayoutDashboard, List } from 'lucide-react';
import { AUTH_DISABLED } from '@/lib/config';

export default function RecipeLanesPage() {
  const { user, loading: authLoading } = useAuth();
  const [recipeText, setRecipeText] = useState('');
  const [graph, setGraph] = useState<RecipeGraph | null>(null);
  const [status, setStatus] = useState<'idle' | 'parsing' | 'forging' | 'complete' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('lanes');

  const handleVisualize = async () => {
    if (!recipeText.trim()) return;
    
    setStatus('parsing');
    setError(null);
    setGraph(null);

    try {
        const parseRes = await parseRecipeAction(recipeText);
        if (parseRes.error || !parseRes.graph) {
            throw new Error(parseRes.error || 'Failed to parse recipe structure.');
        }
        
        const rawGraph = parseRes.graph;
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

  if (authLoading) return <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-500 font-mono">Loading...</div>;

  if (!user && !AUTH_DISABLED) {
      return (
          <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-4">
              <h1 className="text-4xl font-bold text-yellow-500 mb-8 font-mono tracking-tighter">RECIPE LANES</h1>
              <Login />
          </div>
      );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-yellow-500/30">
      <div className="w-full max-w-[95%] mx-auto p-6 space-y-6">
        
        {/* Header */}
        <header className="flex items-center justify-between border-b border-zinc-800 pb-4">
            <div className="flex items-center gap-3">
                <ChefHat className="w-8 h-8 text-yellow-500" />
                <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Recipe Lanes</h1>
            </div>
            <div className="text-xs font-mono text-zinc-500">
                {user?.email || 'Guest Admin'}
            </div>
        </header>

        {/* Input Section (Above Graph) */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 shadow-xl">
             <div className="flex gap-4">
                <div className="flex-1 space-y-2">
                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest font-mono">
                        Recipe Instructions
                    </label>
                    <textarea 
                        className="w-full h-32 bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-sm text-zinc-300 focus:ring-2 focus:ring-yellow-500/50 focus:border-yellow-500 outline-none resize-none leading-relaxed font-mono"
                        placeholder="Paste your recipe here (e.g. 'Boil water, add pasta...')"
                        value={recipeText}
                        onChange={(e) => setRecipeText(e.target.value)}
                        onKeyDown={(e) => {
                            // Cmd+Enter (Mac) or Ctrl+Enter (Windows/Linux) to submit
                            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                                e.preventDefault();
                                if (recipeText && status !== 'parsing' && status !== 'forging') {
                                    handleVisualize();
                                }
                            }
                        }}
                    />
                    <div className="text-[10px] text-zinc-600 text-right">
                        Cmd + Enter to Submit
                    </div>
                </div>
                
                <div className="flex flex-col justify-end w-48 gap-2">
                    <button
                        onClick={handleVisualize}
                        disabled={status === 'parsing' || status === 'forging' || !recipeText}
                        className="flex items-center justify-center gap-2 px-4 py-3 bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed w-full shadow-lg hover:shadow-yellow-500/20"
                    >
                        {status === 'parsing' ? (
                            <>Parsing <span className="animate-pulse">...</span></>
                        ) : status === 'forging' ? (
                            <>Forging <Wand2 className="w-4 h-4 animate-spin" /></>
                        ) : (
                            <>Visualise <ArrowRight className="w-5 h-5" /></>
                        )}
                    </button>
                </div>
             </div>
             {error && (
                <div className="mt-3 p-3 bg-red-900/20 border border-red-800 rounded-lg text-red-400 text-sm">
                    {error}
                </div>
             )}
        </div>

        {/* Visualizer Section */}
        <div className="bg-zinc-100 rounded-xl border border-zinc-800 min-h-[800px] shadow-2xl overflow-hidden relative flex flex-col">
            {/* Toolbar */}
            <div className="w-full h-12 bg-white border-b border-zinc-200 flex items-center justify-between px-4">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setLayoutMode('lanes')}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${layoutMode === 'lanes' ? 'bg-zinc-100 text-zinc-900 border border-zinc-300' : 'text-zinc-500 hover:bg-zinc-50'}`}
                    >
                        <List className="w-4 h-4" /> Lanes
                    </button>
                    <button
                        onClick={() => setLayoutMode('compact')}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${layoutMode === 'compact' ? 'bg-zinc-100 text-zinc-900 border border-zinc-300' : 'text-zinc-500 hover:bg-zinc-50'}`}
                    >
                        <LayoutDashboard className="w-4 h-4" /> Compact
                    </button>
                </div>
                
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
            
            <div className="flex-1 overflow-auto bg-white text-zinc-900 relative">
                {showJson && graph ? (
                    <pre className="p-4 text-xs font-mono bg-zinc-50 text-zinc-800 overflow-auto h-full">
                        {JSON.stringify(graph, null, 2)}
                    </pre>
                ) : graph ? (
                    <div className="p-8 min-w-full min-h-full">
                        <SwimlaneDiagram graph={graph} mode={layoutMode} />
                    </div>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-zinc-400 space-y-4">
                        <div className="w-20 h-20 border-2 border-zinc-200 border-dashed rounded-full flex items-center justify-center bg-zinc-50">
                            <Wand2 className="w-8 h-8 opacity-20" />
                        </div>
                        <p className="text-sm font-medium text-zinc-400">Ready to Visualise</p>
                    </div>
                )}
            </div>
        </div>
      </div>
    </div>
  );
}
