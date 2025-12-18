'use client';

import { useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { Login } from '@/components/login';
import SwimlaneDiagram from '@/components/recipe-lanes/swimlane-diagram';
import { parseRecipeAction, generateGraphIconsAction } from '@/app/actions';
import type { RecipeGraph } from '@/lib/recipe-lanes/types';
import { Wand2, ChefHat, ArrowRight, Code } from 'lucide-react';
import { AUTH_DISABLED } from '@/lib/config';

export default function RecipeLanesPage() {
  const { user, loading: authLoading } = useAuth();
  const [recipeText, setRecipeText] = useState('');
  const [graph, setGraph] = useState<RecipeGraph | null>(null);
  const [status, setStatus] = useState<'idle' | 'parsing' | 'forging' | 'complete' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);

  const handleVisualize = async () => {
    if (!recipeText.trim()) return;
    
    setStatus('parsing');
    setError(null);
    setGraph(null);

    try {
        // 1. Parse Text -> Graph
        const parseRes = await parseRecipeAction(recipeText);
        if (parseRes.error || !parseRes.graph) {
            throw new Error(parseRes.error || 'Failed to parse recipe structure.');
        }
        
        const rawGraph = parseRes.graph;
        setGraph(rawGraph);
        setStatus('forging');

        // 2. Forge Icons -> Graph
        const iconRes = await generateGraphIconsAction(rawGraph);
        if (iconRes.error) {
            console.warn('Icon generation incomplete:', iconRes.error);
        }
        
        setGraph(iconRes.graph); // This is a new object reference now
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
      <div className="max-w-6xl mx-auto p-6 space-y-8">
        
        {/* Header */}
        <header className="flex items-center justify-between border-b border-zinc-800 pb-6">
            <div className="flex items-center gap-3">
                <ChefHat className="w-8 h-8 text-yellow-500" />
                <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Recipe Lanes</h1>
            </div>
            <div className="text-xs font-mono text-zinc-500">
                {user?.email || 'Guest Admin'}
            </div>
        </header>

        {/* Input Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="space-y-4">
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 shadow-xl">
                    <label className="block text-sm font-medium text-zinc-400 mb-2 uppercase tracking-wider font-mono">
                        Input Recipe
                    </label>
                    <textarea 
                        className="w-full h-64 bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-sm text-zinc-300 focus:ring-2 focus:ring-yellow-500/50 focus:border-yellow-500 outline-none resize-none leading-relaxed"
                        placeholder="Paste your recipe here (e.g. 'Boil water, add pasta...')"
                        value={recipeText}
                        onChange={(e) => setRecipeText(e.target.value)}
                    />
                    <div className="mt-4 flex justify-end">
                        <button
                            onClick={handleVisualize}
                            disabled={status === 'parsing' || status === 'forging' || !recipeText}
                            className="flex items-center gap-2 px-4 py-2 bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {status === 'parsing' ? (
                                <>Parsing <span className="animate-pulse">...</span></>
                            ) : status === 'forging' ? (
                                <>Forging Icons <Wand2 className="w-4 h-4 animate-spin" /></>
                            ) : (
                                <>Visualize <ArrowRight className="w-4 h-4" /></>
                            )}
                        </button>
                    </div>
                </div>

                {/* Status / Error */}
                {error && (
                    <div className="p-4 bg-red-900/20 border border-red-800 rounded-lg text-red-400 text-sm">
                        {error}
                    </div>
                )}
            </div>

            {/* Visualizer Section */}
            <div className="lg:col-span-2">
                <div className="bg-zinc-100 rounded-xl border border-zinc-800 min-h-[600px] shadow-2xl overflow-hidden relative flex flex-col">
                    <div className="w-full h-10 bg-zinc-200 border-b border-zinc-300 flex items-center justify-between px-4">
                        <div className="flex gap-2">
                            <div className="w-3 h-3 rounded-full bg-red-400"></div>
                            <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                            <div className="w-3 h-3 rounded-full bg-green-400"></div>
                        </div>
                        {graph && (
                            <button 
                                onClick={() => setShowJson(!showJson)}
                                className={`p-1.5 rounded hover:bg-zinc-300 transition-colors ${showJson ? 'bg-zinc-300 text-zinc-900' : 'text-zinc-500'}`}
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
                            <div className="p-8 pt-12 min-w-full min-h-full">
                                <SwimlaneDiagram graph={graph} />
                            </div>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-zinc-400 space-y-4">
                                <div className="w-16 h-16 border-2 border-zinc-300 border-dashed rounded-full flex items-center justify-center">
                                    <Wand2 className="w-6 h-6 opacity-50" />
                                </div>
                                <p>Enter a recipe to generate lanes.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
}
