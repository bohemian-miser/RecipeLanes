'use client';

import Link from 'next/link';
import { ChefHat, Calendar, GitGraph, Copy, Star, ThumbsUp, ThumbsDown } from 'lucide-react';
import { useState } from 'react';
import { toggleStarAction, voteRecipeAction, copyRecipeAction } from '@/app/actions';
import { useRouter } from 'next/navigation';

interface RecipeCardProps {
  recipe: {
    id: string;
    title: string;
    previewIcon?: string;
    createdAt?: string;
    nodeCount: number;
    likes: number;
    dislikes: number;
    // We assume server passes initial user state if possible, but simplified for now
  };
  userId?: string; // Optional: Current user ID for optimistic updates
}

export function RecipeCard({ recipe }: RecipeCardProps) {
  const router = useRouter();
  const [likes, setLikes] = useState(recipe.likes);
  const [isStarred, setIsStarred] = useState(false); // Optimistic default
  const [isCopying, setIsCopying] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsCopying(true);
    const result = await copyRecipeAction(recipe.id);
    if (result.newId) {
      router.push(`/lanes?id=${result.newId}`);
    } else {
      alert(result.error || 'Failed to copy');
      setIsCopying(false);
    }
  };

  const handleVote = async (e: React.MouseEvent, type: 'like' | 'dislike') => {
    e.preventDefault();
    e.stopPropagation();
    // Optimistic
    if (type === 'like') setLikes(prev => prev + 1);
    await voteRecipeAction(recipe.id, type);
  };

  const handleStar = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsStarred(prev => !prev);
    await toggleStarAction(recipe.id);
  };

  return (
    <Link href={`/lanes?id=${recipe.id}`} className="block group h-full">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden hover:border-yellow-500/50 hover:shadow-xl hover:shadow-yellow-500/5 transition-all duration-300 h-full flex flex-col relative">
        
        {/* Actions Overlay (Visible on Hover) */}
        <div className="absolute top-2 right-2 z-10 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button 
                onClick={handleCopy} 
                disabled={isCopying}
                className="p-2 bg-black/50 hover:bg-yellow-500/20 text-zinc-300 hover:text-yellow-500 rounded-full backdrop-blur-sm transition-colors"
                title="Copy Recipe"
            >
                <Copy className="w-4 h-4" />
            </button>
            <button 
                onClick={handleStar}
                className={`p-2 bg-black/50 hover:bg-yellow-500/20 rounded-full backdrop-blur-sm transition-colors ${isStarred ? 'text-yellow-500' : 'text-zinc-300'}`}
                title="Star Recipe"
            >
                <Star className={`w-4 h-4 ${isStarred ? 'fill-yellow-500' : ''}`} />
            </button>
        </div>

        {/* Preview Image */}
        {recipe.previewIcon ? (
            <div className="h-40 bg-zinc-950/50 flex items-center justify-center p-6 border-b border-zinc-800/50 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 to-transparent opacity-50" />
                <img 
                    src={recipe.previewIcon} 
                    alt="" 
                    className="h-full w-full object-contain drop-shadow-xl group-hover:scale-110 transition-transform duration-500" 
                    style={{ imageRendering: 'pixelated' }}
                />
            </div>
        ) : (
            <div className="h-40 bg-zinc-950/50 flex items-center justify-center p-6 border-b border-zinc-800/50">
                <ChefHat className="w-12 h-12 text-zinc-800" />
            </div>
        )}
        
        <div className="p-5 flex-1 flex flex-col">
            <h3 className="font-bold text-lg mb-3 text-zinc-200 group-hover:text-yellow-500 transition-colors line-clamp-2 leading-tight">
                {recipe.title}
            </h3>
            
            <div className="flex items-center gap-4 text-xs text-zinc-500 font-mono mt-auto pt-4 border-t border-zinc-800/50">
                <div className="flex items-center gap-1.5" title="Created At">
                    <Calendar className="w-3 h-3" />
                    {recipe.createdAt ? new Date(recipe.createdAt).toLocaleDateString() : 'Unknown'}
                </div>
                <div className="flex items-center gap-1.5" title="Steps">
                    <GitGraph className="w-3 h-3" />
                    {recipe.nodeCount}
                </div>
                
                {/* Voting Mini-UI */}
                <div className="flex items-center gap-2 ml-auto">
                    <button 
                        onClick={(e) => handleVote(e, 'like')}
                        className="flex items-center gap-1 hover:text-green-400 transition-colors"
                    >
                        <ThumbsUp className="w-3 h-3" />
                        <span>{likes}</span>
                    </button>
                </div>
            </div>
        </div>
      </div>
    </Link>
  );
}
