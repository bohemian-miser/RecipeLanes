'use client';

import { useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { Login } from '@/components/login';
import SwimlaneDiagram from '@/components/recipe-lanes/swimlane-diagram';
import { parseRecipeAction, generateGraphIconsAction, adjustRecipeAction } from '@/app/actions';
import type { RecipeGraph } from '@/lib/recipe-lanes/types';
import { Wand2, ChefHat, ArrowRight, Code, MessageSquare, Send } from 'lucide-react';

export default function RecipeLanesPage() {
  const { user, loading: authLoading } = useAuth();
  const [recipeText, setRecipeText] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [graph, setGraph] = useState<RecipeGraph | null>(null);
  const [status, setStatus] = useState<'idle' | 'parsing' | 'forging' | 'adjusting' | 'complete' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);

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
          setGraph(res.graph);
          setStatus('complete');
      } catch (e: any) {
          console.error('Adjustment failed:', e);
          setError(e.message);
          setStatus('error'); // Keep graph visible
      }
  };

  if (authLoading) return <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-500 font-mono">Loading...</div>;

  // Guest access allowed - no Login block

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
                {user?.email || 'Guest Mode'}
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
                            <>Forging Icons <Wand2 className="w-4 h-4 animate-spin" /></>
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
            <div className="w-full h-12 bg-white border-b border-zinc-200 flex items-center justify-end px-4">
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
                    <div className="p-8 min-w-full min-h-full pb-32">
                        <SwimlaneDiagram graph={graph} />
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

            {/* Chat Adjustment Interface (Floating at bottom of graph) */}
            {graph && (
                <div className="absolute bottom-6 left-6 right-6 flex justify-center">
                    <div className="w-full max-w-2xl bg-white border border-zinc-200 rounded-full shadow-xl flex items-center p-1.5 pl-5 gap-2 transition-all focus-within:ring-2 focus-within:ring-yellow-500/50 focus-within:border-yellow-500">
                        <MessageSquare className="w-5 h-5 text-zinc-400" />
                        <input 
                            className="flex-1 bg-transparent border-none outline-none text-sm text-zinc-800 placeholder-zinc-400 h-10"
                            placeholder="Adjust recipe (e.g. 'Add garlic to the sauce', 'Make it spicy')..."
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAdjust()}
                            disabled={status === 'adjusting'}
                        />
                        <button
                            onClick={handleAdjust}
                            disabled={!chatInput.trim() || status === 'adjusting'}
                            className="p-2.5 bg-zinc-900 hover:bg-zinc-800 text-white rounded-full transition-colors disabled:opacity-50"
                        >
                            {status === 'adjusting' ? (
                                <Wand2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <Send className="w-4 h-4" />
                            )}
                        </button>
                    </div>
                </div>
            )}
        </div>
      </div>
    </div>
  );
}
