import React, { useMemo } from 'react';
import { RecipeGraph } from '@/lib/recipe-lanes/types';
import { ChefHat } from 'lucide-react';

interface IngredientsSummaryProps {
  graph: RecipeGraph;
}

export function IngredientsSummary({ graph }: IngredientsSummaryProps) {
  const summary = useMemo(() => {
    const ingredients: Record<string, { count: number; iconUrl?: string; unit?: string }> = {};
    
    graph.nodes.forEach(node => {
      // RecipeNode has type 'ingredient' | 'action'
      if (node.type === 'action') return;

      const name = node.visualDescription || node.text || 'Unknown';
      // Simple quantity extraction (e.g. "2 carrots", "200g flour")
      const text = node.text || '';
      const qtyMatch = text.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?/);
      const qty = qtyMatch ? parseFloat(qtyMatch[1]) : 1;
      const unit = qtyMatch?.[2] || '';
      
      // Clean name (remove qty)
      const cleanName = name.replace(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?/, '').trim();
      const key = cleanName.toLowerCase();

      if (!ingredients[key]) {
        ingredients[key] = { count: 0, iconUrl: node.iconUrl, unit };
      }
      ingredients[key].count += qty;
      // Prefer keeping an icon if found
      if (!ingredients[key].iconUrl && node.iconUrl) {
          ingredients[key].iconUrl = node.iconUrl;
      }
    });

    return Object.entries(ingredients)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.count - a.count);
  }, [graph]);

  if (summary.length === 0) return null;

  return (
    <div className="bg-zinc-50 border-b border-zinc-200 p-2 flex gap-4 overflow-x-auto items-center no-scrollbar relative z-10 shrink-0">
      <div className="flex items-center gap-1 text-zinc-400 shrink-0">
          <ChefHat className="w-4 h-4" />
          <span className="text-[10px] uppercase font-bold tracking-wider">Ingredients</span>
      </div>
      {summary.map((item) => (
        <div key={item.name} className="flex items-center gap-2 bg-white border border-zinc-200 rounded-full px-2 py-1 shrink-0 shadow-sm">
          {item.iconUrl ? (
             <img src={item.iconUrl} className="w-5 h-5 object-contain mix-blend-multiply" alt="" />
          ) : (
             <span className="text-sm">🥕</span>
          )}
          <span className="text-xs font-medium text-zinc-700">
             {item.count > 0 ? Math.round(item.count * 100) / 100 : ''} {item.unit} <span className="capitalize">{item.name}</span>
          </span>
        </div>
      ))}
    </div>
  );
}